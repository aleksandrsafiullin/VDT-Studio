import type { ModelBackendDetectionResult } from "../../contract";
import type { VdtSchemaId } from "../../schema-registry";
import { assertArgsSafe } from "../security";
import type { ExecFileProbe, SubscriptionCliAdapter, SubscriptionCliBuildArgsInput, SubscriptionCliModelProbeOptions } from "../types";
import { probeCodexAuth } from "./auth";
import { CODEX_BACKEND_ID, CODEX_CHATGPT_DEFAULT_MODEL, CODEX_FAST_SERVICE_TIER_ARGS } from "./constants";
import { parseCodexExecJson } from "./parser";
import { evaluateCodexVersion, parseCodexVersionOutput } from "./version";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractModelId(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (!isRecord(value)) return undefined;
  for (const key of ["slug", "id", "model", "name"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return undefined;
}

export function parseCodexModelList(output: string): readonly string[] {
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
  if (!trimmed) return Object.freeze(models);

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
    // Continue with JSONL and text fallbacks.
  }

  for (const line of trimmed.split(/\r?\n/)) {
    const text = line.trim();
    if (!text || /^[-=\s]+$/.test(text)) continue;
    try {
      const parsed = JSON.parse(text) as unknown;
      if (isRecord(parsed) && Array.isArray(parsed.models)) {
        parsed.models.forEach(add);
      } else {
        add(parsed);
      }
      continue;
    } catch {
      // Continue with table-style output.
    }
    const firstToken = text.match(/^([a-zA-Z0-9][a-zA-Z0-9._:/-]*)\b/)?.[1];
    if (firstToken && !["model", "models", "name", "id", "warning", "warn", "error"].includes(firstToken.toLowerCase())) add(firstToken);
  }

  return Object.freeze(models);
}

function isSupportedCodexChatGptModel(model: string): boolean {
  const normalized = model.toLowerCase();
  return !normalized.includes("-codex") && !normalized.includes("auto-review");
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

export async function listCodexModels(
  executable: string,
  options: SubscriptionCliModelProbeOptions = {}
): Promise<readonly string[]> {
  const execFile = options.execFile ?? defaultExecFileProbe;
  const execOptions = {
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 512 * 1024,
    windowsHide: true,
    shell: false,
    ...(options.signal ? { signal: options.signal } : {})
  } as const;
  let result: { stdout: string; stderr: string };
  try {
    result = await execFile(executable, ["debug", "models"], execOptions);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (!/service_tier|unknown variant `default`|unknown variant "default"/i.test(text)) throw error;
    result = await execFile(executable, ["debug", "models", ...CODEX_FAST_SERVICE_TIER_ARGS], execOptions);
  }
  return parseCodexModelList(`${result.stdout}\n${result.stderr}`).filter(isSupportedCodexChatGptModel);
}

/** Reviewed dynamic flags appended after manifest static args at spawn time. */
export function buildCodexDynamicArgs(input: SubscriptionCliBuildArgsInput): readonly string[] {
  const args: string[] = [];
  if (input.cwd) args.push("-C", input.cwd);
  args.push("--model", input.model ?? CODEX_CHATGPT_DEFAULT_MODEL);
  if (input.schemaPath) args.push("--output-schema", input.schemaPath);
  if (input.outputPath) args.push("--output-last-message", input.outputPath);
  assertArgsSafe(args);
  return Object.freeze(args);
}

function mapCodexError(message: string): string {
  if (/auth|login|sign[\s-]?in|not logged in/i.test(message)) return "AUTH_REQUIRED";
  if (/quota|usage limit|rate.?limit/i.test(message)) return "RATE_LIMITED";
  return "BACKEND_PARSE_FAILED";
}

export const codexSubscriptionCliAdapter: SubscriptionCliAdapter = {
  id: "codex",
  backendId: CODEX_BACKEND_ID,
  spawnHints: Object.freeze({ stdin: "prompt" }),

  buildArgs(input: SubscriptionCliBuildArgsInput): readonly string[] {
    return buildCodexDynamicArgs(input);
  },

  parseOutput(stdout: string, stderr: string, _schemaId: VdtSchemaId): unknown {
    const parsed = parseCodexExecJson(stdout, stderr);
    if (parsed.error) {
      throw Object.assign(new Error(parsed.error), { code: mapCodexError(parsed.error) });
    }
    if (parsed.output === undefined) {
      throw Object.assign(new Error("Codex exec output did not contain structured JSON."), { code: "BACKEND_PARSE_FAILED" });
    }
    return parsed.output;
  },

  async probeAuth(executable: string, signal?: AbortSignal): Promise<ModelBackendDetectionResult> {
    return testCodexConnection(executable, signal);
  },

  async listModels(executable: string, options?: SubscriptionCliModelProbeOptions): Promise<readonly string[]> {
    return listCodexModels(executable, options);
  }
};

export async function testCodexConnection(executable: string, signal?: AbortSignal): Promise<ModelBackendDetectionResult> {
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
    version = parseCodexVersionOutput(`${result.stdout}\n${result.stderr}`.trim())?.raw ?? null;
  } catch {
    version = null;
  }

  return probeCodexAuth(executable, {
    ...(signal ? { signal } : {}),
    versionStatus: evaluateCodexVersion(version)
  });
}
