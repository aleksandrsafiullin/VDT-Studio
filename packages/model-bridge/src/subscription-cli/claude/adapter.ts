import type { ModelBackendDetectionResult } from "../../contract";
import type { VdtSchemaId } from "../../schema-registry";
import { assertArgsSafe } from "../security";
import type { SubscriptionCliAdapter, SubscriptionCliBuildArgsInput } from "../types";
import { probeClaudeAuth } from "./auth";
import { parseClaudeJsonOutput } from "./parser";
import { evaluateClaudeVersion, parseClaudeVersionOutput } from "./version";

export const CLAUDE_BACKEND_ID = "claude_subscription";

/** Reviewed dynamic flags appended after manifest static args at spawn time. */
export function buildClaudeDynamicArgs(input: SubscriptionCliBuildArgsInput): readonly string[] {
  const args: string[] = [];
  if (input.model) args.push("--model", input.model);
  if (input.schemaPath) args.push("--json-schema", input.schemaPath);
  const prompt = input.promptText?.trim();
  if (!prompt) throw Object.assign(new Error("Claude subscription prompt text is required."), { code: "PROMPT_REQUIRED" });
  args.push(prompt);
  assertArgsSafe(args);
  return Object.freeze(args);
}

function mapClaudeError(message: string): string {
  if (/auth|login|sign[\s-]?in|not logged in/i.test(message)) return "AUTH_REQUIRED";
  if (/quota|usage limit|rate.?limit|billing/i.test(message)) return "RATE_LIMITED";
  return "BACKEND_PARSE_FAILED";
}

export const claudeSubscriptionCliAdapter: SubscriptionCliAdapter = {
  id: "claude",
  backendId: CLAUDE_BACKEND_ID,

  buildArgs(input: SubscriptionCliBuildArgsInput): readonly string[] {
    return buildClaudeDynamicArgs(input);
  },

  parseOutput(stdout: string, stderr: string, _schemaId: VdtSchemaId): unknown {
    const parsed = parseClaudeJsonOutput(stdout, stderr);
    if (parsed.error) {
      throw Object.assign(new Error(parsed.error), { code: mapClaudeError(parsed.error) });
    }
    if (parsed.output === undefined) {
      throw Object.assign(new Error("Claude Code output did not contain structured JSON."), { code: "BACKEND_PARSE_FAILED" });
    }
    return parsed.output;
  },

  async probeAuth(executable: string, signal?: AbortSignal): Promise<ModelBackendDetectionResult> {
    return testClaudeConnection(executable, signal);
  }
};

export async function testClaudeConnection(executable: string, signal?: AbortSignal): Promise<ModelBackendDetectionResult> {
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
    version = parseClaudeVersionOutput(`${result.stdout}\n${result.stderr}`.trim())?.raw ?? null;
  } catch {
    version = null;
  }

  return probeClaudeAuth(executable, {
    ...(signal ? { signal } : {}),
    versionStatus: evaluateClaudeVersion(version)
  });
}
