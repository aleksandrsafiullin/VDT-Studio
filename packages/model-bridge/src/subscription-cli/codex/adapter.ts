import type { ModelBackendDetectionResult } from "../../contract";
import type { VdtSchemaId } from "../../schema-registry";
import { assertArgsSafe } from "../security";
import type { SubscriptionCliAdapter, SubscriptionCliBuildArgsInput } from "../types";
import { probeCodexAuth } from "./auth";
import { parseCodexExecJson } from "./parser";
import { evaluateCodexVersion, parseCodexVersionOutput } from "./version";

export const CODEX_BACKEND_ID = "codex_subscription";

/** Reviewed dynamic flags appended after manifest static args at spawn time. */
export function buildCodexDynamicArgs(input: SubscriptionCliBuildArgsInput): readonly string[] {
  const args: string[] = [];
  if (input.model) args.push("--model", input.model);
  if (input.schemaPath) args.push("--output-schema", input.schemaPath);
  if (input.outputPath) args.push("--output-last-message", input.outputPath);
  args.push("-");
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
