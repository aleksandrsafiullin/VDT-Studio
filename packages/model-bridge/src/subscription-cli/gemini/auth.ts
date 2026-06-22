import { execFile, type ExecFileOptionsWithStringEncoding } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { ModelBackendDetectionResult, ModelBackendStatus } from "../../contract";
import { validateRegisteredSchema } from "../../schema-registry";
import type { ExecFileProbe } from "../types";
import { GEMINI_BACKEND_ID } from "./adapter";
import { parseGeminiJsonOutput } from "./parser";
import type { GeminiVersionEvaluation } from "./version";

export const GEMINI_CONNECTION_TEST_PROMPT = 'Respond with only valid JSON matching {"ok":true}. No tools, markdown, or commentary.';

export interface ProbeGeminiAuthOptions { signal?: AbortSignal; versionStatus?: GeminiVersionEvaluation; execFileImpl?: ExecFileProbe; timeoutMs?: number; }

function classify(text: string): ModelBackendStatus {
  if (/quota|rate.?limit|capacity|resource.?exhausted|429|daily limit/i.test(text)) return "rate_limited";
  if (/policy|code assist.*disabled|organization.*disabled/i.test(text)) return "unavailable";
  if (/auth|login|sign[\s-]?in|not logged|google account|credentials/i.test(text)) return "authentication_required";
  return "error";
}

function summary(status: ModelBackendStatus): string {
  if (status === "ready") return "Gemini Code Assist Enterprise authentication is ready.";
  if (status === "authentication_required") return "Gemini sign-in required. Run `gemini` in a terminal and complete Google authentication.";
  if (status === "rate_limited") return "Gemini account allowance or request limit was reached.";
  if (status === "unsupported_version") return "Gemini CLI version is not supported.";
  if (status === "unavailable") return "Gemini CLI is unavailable for this account tier or organization policy.";
  return "Gemini connection probe failed.";
}

export async function probeGeminiAuth(executable: string, options: ProbeGeminiAuthOptions = {}): Promise<ModelBackendDetectionResult> {
  if (options.versionStatus?.status === "unsupported_version") {
    return { backendId: GEMINI_BACKEND_ID, status: "unsupported_version", authSummary: summary("unsupported_version"), diagnostics: [...options.versionStatus.diagnostics] };
  }
  const cwd = await mkdtemp(path.join(os.tmpdir(), "vdt-gemini-probe-"));
  const policyPath = path.join(cwd, "deny-all-tools.toml");
  await writeFile(policyPath, '[[rule]]\ntoolName = "*"\ndecision = "deny"\npriority = 999\n', { encoding: "utf8", mode: 0o600 });
  try {
    const probe = options.execFileImpl ?? promisify(execFile);
    const execOptions: ExecFileOptionsWithStringEncoding = { encoding: "utf8", cwd, timeout: options.timeoutMs ?? 15_000, maxBuffer: 512 * 1024, windowsHide: true, shell: false, signal: options.signal };
    const result = await probe(executable, ["--output-format", "json", "--approval-mode", "default", "--admin-policy", policyPath, "--prompt", GEMINI_CONNECTION_TEST_PROMPT], execOptions);
    const parsed = parseGeminiJsonOutput(result.stdout, result.stderr);
    if (!parsed.error && validateRegisteredSchema("connection-test-v1", parsed.output)) {
      return { backendId: GEMINI_BACKEND_ID, status: "ready", authSummary: summary("ready"), diagnostics: [] };
    }
    const message = parsed.error ?? result.stderr ?? "Gemini connection response was invalid.";
    const status = classify(message);
    return { backendId: GEMINI_BACKEND_ID, status, authSummary: summary(status), diagnostics: [message].filter(Boolean) };
  } catch (error) {
    const execError = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    const message = `${execError.stderr ?? ""}\n${execError.stdout ?? ""}\n${execError.message}`.trim();
    const status = classify(message);
    return { backendId: GEMINI_BACKEND_ID, status, authSummary: summary(status), diagnostics: [message] };
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}
