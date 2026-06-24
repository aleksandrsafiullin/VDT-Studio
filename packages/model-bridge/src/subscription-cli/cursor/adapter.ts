import path from "node:path";
import type { ModelBackendDetectionResult } from "../../contract";
import type { VdtSchemaId } from "../../schema-registry";
import { assertArgsSafe } from "../security";
import type { ExecFileProbe, SubscriptionCliAdapter, SubscriptionCliBuildArgsInput, SubscriptionCliModelProbeOptions } from "../types";
import { probeCursorAuth } from "./auth";
import { CURSOR_BACKEND_ID } from "./detection";
import { parseCursorStreamJson } from "./parser";
import { evaluateCursorVersion, parseCursorVersionOutput } from "./version";

/** Reviewed dynamic flags appended after manifest static args at spawn time. */
export function buildCursorDynamicArgs(input: SubscriptionCliBuildArgsInput): readonly string[] {
  const args: string[] = [];
  if (input.enableWorkspaceTrust) args.push("--trust");
  if (input.model) args.push("--model", input.model);
  const workspace = input.cwd ?? (input.promptPath ? path.dirname(input.promptPath) : undefined);
  if (workspace) args.push("--workspace", workspace);
  assertArgsSafe(args, { allowScopedTrust: input.enableWorkspaceTrust === true });
  return Object.freeze(args);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mapCursorError(message: string): string {
  return /auth|login|sign[\s-]?in/i.test(message)
    ? "AUTH_REQUIRED"
    : /rate.?limit/i.test(message)
      ? "RATE_LIMITED"
      : "BACKEND_PARSE_FAILED";
}

function extractModelId(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (!isRecord(value)) return undefined;
  for (const key of ["id", "name", "model", "slug"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return undefined;
}

export function parseCursorAgentModelList(output: string): readonly string[] {
  const models: string[] = [];
  const seen = new Set<string>();
  const add = (value: unknown) => {
    const model = extractModelId(value);
    if (model && !seen.has(model)) {
      seen.add(model);
      models.push(model);
    }
  };

  const trimmed = output.trim();
  if (!trimmed || /no models available/i.test(trimmed)) return Object.freeze(models);

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      parsed.forEach(add);
      return Object.freeze(models);
    }
    if (isRecord(parsed)) {
      const nested = parsed.models ?? parsed.data;
      if (Array.isArray(nested)) {
        nested.forEach(add);
        return Object.freeze(models);
      }
      add(parsed);
      return Object.freeze(models);
    }
  } catch {
    // Continue with text output.
  }

  for (const line of trimmed.split(/\r?\n/)) {
    const text = line.trim().replace(/^[-*]\s+/, "");
    if (!text || /^[-=\s]+$/.test(text) || /no models available/i.test(text)) continue;
    const model = text.match(/^([a-zA-Z0-9][a-zA-Z0-9._:/-]*)(?:\s+-\s+|\s{2,}|$)/)?.[1];
    if (model && !["model", "models", "name", "id"].includes(model.toLowerCase())) add(model);
  }

  return Object.freeze(models);
}

async function defaultExecFileProbe(
  executable: string,
  args: readonly string[],
  options: Parameters<ExecFileProbe>[2]
): Promise<{ stdout: string; stderr: string }> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const result = await promisify(execFile)(executable, [...args], options);
  return { stdout: result.stdout, stderr: result.stderr };
}

export async function listCursorAgentModels(
  executable: string,
  options: SubscriptionCliModelProbeOptions = {}
): Promise<readonly string[]> {
  const execFile = options.execFile ?? defaultExecFileProbe;
  const result = await execFile(executable, ["models"], {
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 512 * 1024,
    windowsHide: true,
    shell: false,
    ...(options.signal ? { signal: options.signal } : {})
  });
  return parseCursorAgentModelList(`${result.stdout}\n${result.stderr}`);
}

export const cursorSubscriptionCliAdapter: SubscriptionCliAdapter = {
  id: "cursor-agent",
  backendId: CURSOR_BACKEND_ID,
  spawnHints: Object.freeze({ stdin: "prompt" }),

  buildArgs(input: SubscriptionCliBuildArgsInput): readonly string[] {
    return buildCursorDynamicArgs(input);
  },

  parseOutput(stdout: string, stderr: string, _schemaId: VdtSchemaId): unknown {
    const parsed = parseCursorStreamJson(stdout);
    if (parsed.error) {
      const stderrDetail = stderr.trim();
      const message = stderrDetail && /terminal result event|structured JSON/i.test(parsed.error)
        ? stderrDetail
        : parsed.error;
      throw Object.assign(new Error(message), { code: mapCursorError(message) });
    }
    if (parsed.output === undefined) {
      const detail = stderr.trim() || "Cursor output did not contain structured JSON.";
      throw Object.assign(new Error(detail), { code: mapCursorError(detail) });
    }
    return parsed.output;
  },

  parseStreamingOutput(stdout: string, stderr: string, _schemaId: VdtSchemaId): unknown | undefined {
    const parsed = parseCursorStreamJson(stdout);
    if (parsed.error) {
      if (/without a terminal result event|did not contain a terminal result event|did not contain structured JSON/i.test(parsed.error)) {
        const detail = stderr.trim();
        if (!detail) return undefined;
      }
      const stderrDetail = stderr.trim();
      const message = stderrDetail && /terminal result event|structured JSON/i.test(parsed.error)
        ? stderrDetail
        : parsed.error;
      throw Object.assign(new Error(message), { code: mapCursorError(message) });
    }
    return parsed.output;
  },

  async probeAuth(executable: string, signal?: AbortSignal): Promise<ModelBackendDetectionResult> {
    return testCursorConnection(executable, signal);
  },

  async listModels(executable: string, options?: SubscriptionCliModelProbeOptions): Promise<readonly string[]> {
    return listCursorAgentModels(executable, options);
  }
};

export async function testCursorConnection(executable: string, signal?: AbortSignal): Promise<ModelBackendDetectionResult> {
  let version: string | null = null;
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const result = await promisify(execFile)(executable, ["--version"], {
      encoding: "utf8",
      timeout: 5_000,
      maxBuffer: 64 * 1024,
      windowsHide: true,
      shell: false,
      signal
    });
    version = parseCursorVersionOutput(`${result.stdout}\n${result.stderr}`.trim())?.raw ?? null;
  } catch {
    version = null;
  }

  return probeCursorAuth(executable, {
    ...(signal ? { signal } : {}),
    versionStatus: evaluateCursorVersion(version)
  });
}
