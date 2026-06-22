import { execFile, type ExecFileOptionsWithStringEncoding } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { ModelBackendDetectionResult, ModelBackendStatus } from "../../contract";
import { validateRegisteredSchema } from "../../schema-registry";
import type { ExecFileProbe } from "../types";
import { COPILOT_BACKEND_ID } from "./adapter";
import { parseCopilotJsonlOutput } from "./parser";
import type { CopilotVersionEvaluation } from "./version";

export const COPILOT_CONNECTION_TEST_PROMPT = 'Respond with only valid JSON matching {"ok":true}. Do not use tools, markdown, or commentary.';
export interface ProbeCopilotAuthOptions { signal?: AbortSignal; versionStatus?: CopilotVersionEvaluation; execFileImpl?: ExecFileProbe; timeoutMs?: number; }

function classify(text: string): ModelBackendStatus {
  if (/premium request|quota|usage limit|rate.?limit|429|budget/i.test(text)) return "rate_limited";
  if (/organization.*policy|policy.*disabled|copilot cli.*disabled|plan.*unavailable/i.test(text)) return "unavailable";
  if (/auth|login|sign[\s-]?in|not logged|credentials/i.test(text)) return "authentication_required";
  return "error";
}

function summary(status: ModelBackendStatus): string {
  if (status === "ready") return "GitHub Copilot plan authentication is ready.";
  if (status === "authentication_required") return "GitHub sign-in required. Run `copilot login` in a terminal.";
  if (status === "rate_limited") return "Copilot premium request or usage limit was reached.";
  if (status === "unsupported_version") return "Copilot CLI version is not supported.";
  if (status === "unavailable") return "Copilot CLI is unavailable for this plan or organization policy.";
  return "Copilot connection probe failed.";
}

export async function probeCopilotAuth(executable: string, options: ProbeCopilotAuthOptions = {}): Promise<ModelBackendDetectionResult> {
  if (options.versionStatus?.status === "unsupported_version") {
    return { backendId: COPILOT_BACKEND_ID, status: "unsupported_version", authSummary: summary("unsupported_version"), diagnostics: [...options.versionStatus.diagnostics] };
  }
  const cwd = await mkdtemp(path.join(os.tmpdir(), "vdt-copilot-probe-"));
  try {
    const probe = options.execFileImpl ?? promisify(execFile);
    const execOptions: ExecFileOptionsWithStringEncoding = { encoding: "utf8", cwd, timeout: options.timeoutMs ?? 15_000, maxBuffer: 512 * 1024, windowsHide: true, shell: false, signal: options.signal };
    const args = ["--output-format=json", "--stream=off", "--available-tools=", "--disable-builtin-mcps", "--no-custom-instructions", "--no-ask-user", "--no-auto-update", "--prompt", COPILOT_CONNECTION_TEST_PROMPT];
    const result = await probe(executable, args, execOptions);
    const parsed = parseCopilotJsonlOutput(result.stdout, result.stderr);
    if (!parsed.error && validateRegisteredSchema("connection-test-v1", parsed.output)) {
      return { backendId: COPILOT_BACKEND_ID, status: "ready", authSummary: summary("ready"), diagnostics: [] };
    }
    const message = parsed.error ?? result.stderr ?? "Copilot connection response was invalid.";
    const status = classify(message);
    return { backendId: COPILOT_BACKEND_ID, status, authSummary: summary(status), diagnostics: [message].filter(Boolean) };
  } catch (error) {
    const execError = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    const message = `${execError.stderr ?? ""}\n${execError.stdout ?? ""}\n${execError.message}`.trim();
    const status = classify(message);
    return { backendId: COPILOT_BACKEND_ID, status, authSummary: summary(status), diagnostics: [message] };
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}
