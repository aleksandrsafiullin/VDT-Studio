import type { ModelBackendDetectionResult } from "../../contract";
import type { VdtSchemaId } from "../../schema-registry";
import { assertArgsSafe } from "../security";
import type { SubscriptionCliAdapter, SubscriptionCliBuildArgsInput } from "../types";
import { probeClaudeAuth } from "./auth";
import { parseClaudeJsonOutput } from "./parser";
import { evaluateClaudeVersion, parseClaudeVersionOutput } from "./version";
import { probeOwnedCliVersion } from "../codex/executable-selection";

export const CLAUDE_BACKEND_ID = "claude_subscription";

/** Versioned families whose official CLI/API documentation permits disabled thinking. */
export function claudeModelSupportsThinkingOff(model: string | undefined): boolean {
  if (!model || /fable/i.test(model)) return false;
  const version = /^claude-(?:opus|sonnet|haiku)-(\d+)(?:[.-](\d+))?(?:-|$)/i.exec(model);
  if (!version) return false;
  const major = Number(version[1]), minor = Number(version[2] ?? 0);
  // Date suffixes on the original Claude 4 IDs are not minor versions.
  return major === 4 && (minor <= 8 || /^20\d{6}$/.test(version[2] ?? "")) || major === 5 && (minor === 0 || /^20\d{6}$/.test(version[2] ?? ""));
}

export async function verifyDirectClaudeSubscription(executable: string, cwd: string, env: NodeJS.ProcessEnv, signal: AbortSignal): Promise<boolean> {
  try {
    const js = /\.[cm]?js$/.test(executable);
    const result = await probeOwnedCliVersion(js ? process.execPath : executable, cwd, env, { signal, requireConfirmedCleanup: true }, js ? [executable, "auth", "status"] : ["auth", "status"], 4000);
    return JSON.parse(result.stdout).authMethod === "claude.ai";
  } catch (error) {
    if (signal.aborted || (error as { code?: string })?.code === "CLEANUP_UNCONFIRMED") throw error;
    return false;
  }
}

export function claudeReasoningArgs(value: SubscriptionCliBuildArgsInput["modelReasoning"], model?: string, directSubscriptionVerified = false): string[] {
  if (value === undefined) return [];
  if (value === false) {
    if (!directSubscriptionVerified) throw Object.assign(new Error("Thinking Off is not verified for this Claude account/provider. Choose Provider default."), { code: "REASONING_UNSUPPORTED" });
    // Claude documents these families as always-thinking. Unversioned aliases
    // do not prove that disabling is supported by the selected upstream model.
    if (!claudeModelSupportsThinkingOff(model)) {
      throw Object.assign(new Error("The selected Claude model does not expose confirmed thinking-off support. Choose Provider default."), { code: "REASONING_UNSUPPORTED" });
    }
    return ["--settings", JSON.stringify({ alwaysThinkingEnabled: false, env: { MAX_THINKING_TOKENS: "0" } })];
  }
  if (typeof value !== "string" || !["low", "medium", "high", "xhigh", "max"].includes(value)) throw Object.assign(new Error("Unsupported Claude effort level."), { code: "REASONING_UNSUPPORTED" });
  return ["--effort", value];
}

/** Reviewed dynamic flags appended after manifest static args at spawn time. */
export function buildClaudeDynamicArgs(input: SubscriptionCliBuildArgsInput): readonly string[] {
  const args: string[] = [];
  args.push(...claudeReasoningArgs(input.modelReasoning, input.model, input.directClaudeSubscriptionVerified));
  if (input.model) args.push("--model", input.model);
  if (input.schemaPath) args.push("--json-schema", input.schemaPath);
  const prompt = input.promptText?.trim();
  if (!prompt) throw Object.assign(new Error("Claude subscription prompt text is required."), { code: "PROMPT_REQUIRED" });
  args.push(prompt);
  assertArgsSafe(args);
  return Object.freeze(args);
}

function mapClaudeError(message: string): string {
  if (/thinking|reasoning|effort/i.test(message)) return "REASONING_UNSUPPORTED";
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
