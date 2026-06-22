import type { ModelBackendDetectionResult } from "../../contract";
import type { VdtSchemaId } from "../../schema-registry";
import { assertArgsSafe } from "../security";
import type { SubscriptionCliAdapter, SubscriptionCliBuildArgsInput } from "../types";
import { probeGeminiAuth } from "./auth";
import { parseGeminiJsonOutput } from "./parser";
import { evaluateGeminiVersion, parseGeminiVersionOutput } from "./version";

export const GEMINI_BACKEND_ID = "gemini_subscription";

export function buildGeminiDynamicArgs(input: SubscriptionCliBuildArgsInput): readonly string[] {
  const prompt = input.promptText?.trim();
  if (!prompt) throw Object.assign(new Error("Gemini subscription prompt text is required."), { code: "PROMPT_REQUIRED" });
  if (!input.toolPolicyPath) throw Object.assign(new Error("Gemini deny-all tool policy is required."), { code: "UNSAFE_CONFIGURATION" });
  const args = ["--admin-policy", input.toolPolicyPath];
  if (input.model) args.push("--model", input.model);
  args.push("--prompt", prompt);
  assertArgsSafe(args);
  return Object.freeze(args);
}

function mapGeminiError(message: string): string {
  if (/auth|login|sign[\s-]?in|not logged|google account/i.test(message)) return "AUTH_REQUIRED";
  if (/quota|rate.?limit|capacity|resource.?exhausted|429|daily limit/i.test(message)) return "RATE_LIMITED";
  if (/policy|code assist.*disabled|organization.*disabled/i.test(message)) return "POLICY_DISABLED";
  return "BACKEND_PARSE_FAILED";
}

export const geminiSubscriptionCliAdapter: SubscriptionCliAdapter = {
  id: "gemini",
  backendId: GEMINI_BACKEND_ID,
  buildArgs: buildGeminiDynamicArgs,
  parseOutput(stdout: string, stderr: string, _schemaId: VdtSchemaId): unknown {
    const parsed = parseGeminiJsonOutput(stdout, stderr);
    if (parsed.error) throw Object.assign(new Error(parsed.error), { code: mapGeminiError(parsed.error) });
    if (parsed.output === undefined) throw Object.assign(new Error("Gemini CLI returned no structured output."), { code: "BACKEND_PARSE_FAILED" });
    return parsed.output;
  },
  async probeAuth(executable: string, signal?: AbortSignal): Promise<ModelBackendDetectionResult> {
    return testGeminiConnection(executable, signal);
  }
};

export async function testGeminiConnection(executable: string, signal?: AbortSignal): Promise<ModelBackendDetectionResult> {
  let version: string | null = null;
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const result = await promisify(execFile)(executable, ["--version"], { encoding: "utf8", timeout: 5_000, maxBuffer: 64 * 1024, windowsHide: true, shell: false, signal });
    version = parseGeminiVersionOutput(`${result.stdout}\n${result.stderr}`)?.raw ?? null;
  } catch { version = null; }
  return probeGeminiAuth(executable, { ...(signal ? { signal } : {}), versionStatus: evaluateGeminiVersion(version) });
}
