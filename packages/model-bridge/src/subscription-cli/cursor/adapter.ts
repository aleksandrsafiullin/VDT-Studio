import path from "node:path";
import type { ModelBackendDetectionResult } from "../../contract";
import type { VdtSchemaId } from "../../schema-registry";
import { assertArgsSafe } from "../security";
import type { SubscriptionCliAdapter, SubscriptionCliBuildArgsInput } from "../types";
import { probeCursorAuth } from "./auth";
import { CURSOR_BACKEND_ID } from "./detection";
import { parseCursorStreamJson } from "./parser";
import { evaluateCursorVersion, parseCursorVersionOutput } from "./version";

/** Reviewed dynamic flags appended after manifest static args at spawn time. */
export function buildCursorDynamicArgs(input: SubscriptionCliBuildArgsInput): readonly string[] {
  const args: string[] = [];
  if (input.model) args.push("--model", input.model);
  if (input.promptPath) {
    args.push("--workspace", path.dirname(input.promptPath));
  }
  const prompt = input.promptText?.trim();
  if (!prompt) throw Object.assign(new Error("Cursor subscription prompt text is required."), { code: "PROMPT_REQUIRED" });
  args.push(prompt);
  assertArgsSafe(args);
  return Object.freeze(args);
}

export const cursorSubscriptionCliAdapter: SubscriptionCliAdapter = {
  id: "cursor-agent",
  backendId: CURSOR_BACKEND_ID,

  buildArgs(input: SubscriptionCliBuildArgsInput): readonly string[] {
    return buildCursorDynamicArgs(input);
  },

  parseOutput(stdout: string, _stderr: string, _schemaId: VdtSchemaId): unknown {
    const parsed = parseCursorStreamJson(stdout);
    if (parsed.error) {
      const message = parsed.error;
      const code = /auth|login|sign[\s-]?in/i.test(message)
        ? "AUTH_REQUIRED"
        : /rate.?limit/i.test(message)
          ? "RATE_LIMITED"
          : "BACKEND_PARSE_FAILED";
      throw Object.assign(new Error(message), { code });
    }
    if (parsed.output === undefined) {
      throw Object.assign(new Error("Cursor output did not contain structured JSON."), { code: "BACKEND_PARSE_FAILED" });
    }
    return parsed.output;
  },

  async probeAuth(executable: string, signal?: AbortSignal): Promise<ModelBackendDetectionResult> {
    return testCursorConnection(executable, signal);
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
