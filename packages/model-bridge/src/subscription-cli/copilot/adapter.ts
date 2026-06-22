import type { ModelBackendDetectionResult } from "../../contract";
import type { VdtSchemaId } from "../../schema-registry";
import { assertArgsSafe } from "../security";
import type { SubscriptionCliAdapter, SubscriptionCliBuildArgsInput } from "../types";
import { probeCopilotAuth } from "./auth";
import { parseCopilotJsonlOutput } from "./parser";
import { evaluateCopilotVersion, parseCopilotVersionOutput } from "./version";

export const COPILOT_BACKEND_ID = "copilot_subscription";

export function buildCopilotDynamicArgs(input: SubscriptionCliBuildArgsInput): readonly string[] {
  const prompt = input.promptText?.trim();
  if (!prompt) throw Object.assign(new Error("Copilot subscription prompt text is required."), { code: "PROMPT_REQUIRED" });
  const args: string[] = [];
  if (input.model) args.push("--model", input.model);
  args.push("--prompt", prompt);
  assertArgsSafe(args);
  return Object.freeze(args);
}

function mapCopilotError(message: string): string {
  if (/auth|login|sign[\s-]?in|not logged|credentials/i.test(message)) return "AUTH_REQUIRED";
  if (/premium request|quota|usage limit|rate.?limit|429|budget/i.test(message)) return "RATE_LIMITED";
  if (/organization.*policy|policy.*disabled|copilot cli.*disabled|plan.*unavailable/i.test(message)) return "POLICY_DISABLED";
  return "BACKEND_PARSE_FAILED";
}

export const copilotSubscriptionCliAdapter: SubscriptionCliAdapter = {
  id: "copilot",
  backendId: COPILOT_BACKEND_ID,
  buildArgs: buildCopilotDynamicArgs,
  parseOutput(stdout: string, stderr: string, _schemaId: VdtSchemaId): unknown {
    const parsed = parseCopilotJsonlOutput(stdout, stderr);
    if (parsed.error) throw Object.assign(new Error(parsed.error), { code: mapCopilotError(parsed.error) });
    if (parsed.output === undefined) throw Object.assign(new Error("Copilot CLI returned no structured output."), { code: "BACKEND_PARSE_FAILED" });
    return parsed.output;
  },
  async probeAuth(executable: string, signal?: AbortSignal): Promise<ModelBackendDetectionResult> {
    return testCopilotConnection(executable, signal);
  }
};

export async function testCopilotConnection(executable: string, signal?: AbortSignal): Promise<ModelBackendDetectionResult> {
  let version: string | null = null;
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const result = await promisify(execFile)(executable, ["--version"], { encoding: "utf8", timeout: 5_000, maxBuffer: 64 * 1024, windowsHide: true, shell: false, signal });
    version = parseCopilotVersionOutput(`${result.stdout}\n${result.stderr}`)?.raw ?? null;
  } catch { version = null; }
  return probeCopilotAuth(executable, { ...(signal ? { signal } : {}), versionStatus: evaluateCopilotVersion(version) });
}
