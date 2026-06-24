import { execFile, type ExecFileOptionsWithStringEncoding } from "node:child_process";
import { promisify } from "node:util";
import type { ModelBackendDetectionResult, ModelBackendStatus } from "../../contract";
import { validateRegisteredSchema } from "../../schema-registry";
import type { ExecFileProbe } from "../types";
import { CODEX_BACKEND_ID, CODEX_CHATGPT_DEFAULT_MODEL, CODEX_FAST_SERVICE_TIER_ARGS } from "./constants";
import { parseCodexExecJson } from "./parser";
import type { CodexVersionEvaluation } from "./version";

const execFileAsync = promisify(execFile);

export const CODEX_CONNECTION_TEST_PROMPT =
  'Respond with only valid JSON matching {"ok":true}. No markdown, commentary, or extra keys.';

export interface ProbeCodexAuthOptions {
  signal?: AbortSignal | undefined;
  versionStatus?: CodexVersionEvaluation;
  execFileImpl?: ExecFileProbe;
  timeoutMs?: number;
}

type ExecResult = { stdout: string; stderr: string };

function classifyAuthFailure(stderr: string, stdout: string, exitCode?: number): ModelBackendStatus {
  const haystack = `${stderr}\n${stdout}`.toLowerCase();
  if (/rate.?limit|quota|too many requests|429|usage limit/.test(haystack)) return "rate_limited";
  if (/login|sign.?in|authenticate|authentication|not logged|chatgpt/.test(haystack)) return "authentication_required";
  if (exitCode === 0) return "error";
  return "error";
}

function authSummaryForStatus(status: ModelBackendStatus): string {
  switch (status) {
    case "ready":
      return "ChatGPT subscription is authenticated and ready.";
    case "authentication_required":
      return "ChatGPT sign-in required. Run `codex login` in a terminal.";
    case "rate_limited":
      return "Codex usage limit reached. Try again later.";
    case "unsupported_version":
      return "Codex CLI version is not supported.";
    case "installed":
      return "Codex CLI is installed; authentication was not verified.";
    case "error":
      return "Codex connection probe failed.";
    default:
      return "Codex CLI status is unknown.";
  }
}

function parseStatusJson(stdout: string): ModelBackendStatus | undefined {
  try {
    const payload = JSON.parse(stdout.trim()) as unknown;
    if (typeof payload !== "object" || payload === null) return undefined;
    const record = payload as Record<string, unknown>;
    const loggedIn = record.loggedIn ?? record.logged_in ?? record.authenticated ?? record.isAuthenticated;
    if (loggedIn === true) return "ready";
    if (loggedIn === false) return "authentication_required";
    const status = typeof record.status === "string" ? record.status.toLowerCase() : "";
    if (status.includes("ready") || status.includes("authenticated") || status.includes("logged")) return "ready";
    if (status.includes("login") || status.includes("auth")) return "authentication_required";
    if (status.includes("rate")) return "rate_limited";
    return undefined;
  } catch {
    return undefined;
  }
}

function parseStatusText(output: string): ModelBackendStatus | undefined {
  const text = output.toLowerCase();
  if (/logged in|authenticated|using chatgpt/.test(text)) return "ready";
  if (/not logged|log in|login required|sign.?in|authenticate/.test(text)) return "authentication_required";
  if (/rate.?limit|quota|usage limit/.test(text)) return "rate_limited";
  return undefined;
}

function isUnsupportedJsonFlag(error: NodeJS.ErrnoException & { stdout?: string; stderr?: string }): boolean {
  const text = `${error.stderr ?? ""}\n${error.stdout ?? ""}\n${error.message ?? ""}`;
  return /unexpected argument '--json'|unknown option.*--json|unrecognized.*--json/i.test(text);
}

function isLegacyServiceTierConfigError(error: NodeJS.ErrnoException & { stdout?: string; stderr?: string }): boolean {
  const text = `${error.stderr ?? ""}\n${error.stdout ?? ""}\n${error.message ?? ""}`;
  return /service_tier|unknown variant `default`|unknown variant "default"/i.test(text);
}

async function runExec(
  executable: string,
  args: readonly string[],
  options: ProbeCodexAuthOptions,
  input?: string
): Promise<ExecResult> {
  const execImpl = options.execFileImpl ?? execFileAsync;
  const execOptions: ExecFileOptionsWithStringEncoding = {
    encoding: "utf8",
    timeout: options.timeoutMs ?? 15_000,
    maxBuffer: 512 * 1024,
    windowsHide: true,
    shell: false,
    signal: options.signal,
    ...(input === undefined ? {} : { input })
  };
  const result = await execImpl(executable, [...args], execOptions);
  return { stdout: result.stdout, stderr: result.stderr };
}

async function runExecWithConfigFallback(
  executable: string,
  args: readonly string[],
  options: ProbeCodexAuthOptions,
  input?: string
): Promise<ExecResult> {
  try {
    return await runExec(executable, args, options, input);
  } catch (error) {
    const execError = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    if (!isLegacyServiceTierConfigError(execError)) throw error;
    return runExec(executable, [...args, ...CODEX_FAST_SERVICE_TIER_ARGS], options, input);
  }
}

async function probeWithStatusCommand(
  executable: string,
  options: ProbeCodexAuthOptions
): Promise<ModelBackendDetectionResult | null> {
  try {
    const result = await runExecWithConfigFallback(executable, ["login", "status", "--json"], options);
    const mapped =
      parseStatusJson(result.stdout) ??
      parseStatusText(`${result.stdout}\n${result.stderr}`) ??
      (result.stderr ? classifyAuthFailure(result.stderr, result.stdout, 0) : "ready");
    return {
      backendId: CODEX_BACKEND_ID,
      status: mapped,
      authSummary: authSummaryForStatus(mapped),
      diagnostics: mapped === "ready" ? [] : [result.stderr.trim() || result.stdout.trim()].filter(Boolean)
    };
  } catch (error) {
    const execError = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number | string };
    if (isUnsupportedJsonFlag(execError)) {
      try {
        const result = await runExecWithConfigFallback(executable, ["login", "status"], options);
        const mapped =
          parseStatusText(`${result.stdout}\n${result.stderr}`) ??
          parseStatusJson(result.stdout) ??
          (result.stderr ? classifyAuthFailure(result.stderr, result.stdout, 0) : "ready");
        return {
          backendId: CODEX_BACKEND_ID,
          status: mapped,
          authSummary: authSummaryForStatus(mapped),
          diagnostics: mapped === "ready" ? [] : [result.stderr.trim() || result.stdout.trim()].filter(Boolean)
        };
      } catch (fallbackError) {
        const fallbackExecError = fallbackError as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number | string };
        const stderr = fallbackExecError.stderr ?? "";
        const stdout = fallbackExecError.stdout ?? "";
        const status = classifyAuthFailure(stderr, stdout, typeof fallbackExecError.code === "number" ? fallbackExecError.code : undefined);
        return {
          backendId: CODEX_BACKEND_ID,
          status,
          authSummary: authSummaryForStatus(status),
          diagnostics: [stderr.trim() || fallbackExecError.message || "Codex status probe failed."].filter(Boolean)
        };
      }
    }
    if (
      execError.code === "ENOENT" ||
      /unknown command|invalid command|unrecognized|not a codex command/i.test(String(execError.stderr ?? execError.message))
    ) {
      return null;
    }
    const stderr = execError.stderr ?? "";
    const stdout = execError.stdout ?? "";
    const status = classifyAuthFailure(stderr, stdout, typeof execError.code === "number" ? execError.code : undefined);
    return {
      backendId: CODEX_BACKEND_ID,
      status,
      authSummary: authSummaryForStatus(status),
      diagnostics: [stderr.trim() || execError.message || "Codex status probe failed."].filter(Boolean)
    };
  }
}

async function probeWithConnectionTest(executable: string, options: ProbeCodexAuthOptions): Promise<ModelBackendDetectionResult> {
  try {
    const result = await runExecWithConfigFallback(
      executable,
      [
        "exec",
        "--ephemeral",
        "--json",
        "--color",
        "never",
        "--skip-git-repo-check",
        "--ignore-rules",
        "--sandbox",
        "workspace-write",
        "--model",
        CODEX_CHATGPT_DEFAULT_MODEL,
        "-c",
        "sandbox_workspace_write.network_access=true",
        ...CODEX_FAST_SERVICE_TIER_ARGS
      ],
      options,
      CODEX_CONNECTION_TEST_PROMPT
    );
    const parsed = parseCodexExecJson(result.stdout, result.stderr);
    if (parsed.error) {
      const status = classifyAuthFailure(result.stderr, `${result.stdout}\n${parsed.error}`);
      return {
        backendId: CODEX_BACKEND_ID,
        status,
        authSummary: authSummaryForStatus(status),
        diagnostics: [parsed.error, result.stderr.trim()].filter(Boolean)
      };
    }
    if (validateRegisteredSchema("connection-test-v1", parsed.output)) {
      return {
        backendId: CODEX_BACKEND_ID,
        status: "ready",
        authSummary: authSummaryForStatus("ready"),
        diagnostics: []
      };
    }
    return {
      backendId: CODEX_BACKEND_ID,
      status: "error",
      authSummary: authSummaryForStatus("error"),
      diagnostics: ["Codex connection test did not return { ok: true } JSON."]
    };
  } catch (error) {
    const execError = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number | string };
    const stderr = execError.stderr ?? "";
    const stdout = execError.stdout ?? "";
    const status = classifyAuthFailure(stderr, stdout, typeof execError.code === "number" ? execError.code : undefined);
    return {
      backendId: CODEX_BACKEND_ID,
      status,
      authSummary: authSummaryForStatus(status),
      diagnostics: [stderr.trim() || execError.message || "Codex connection test failed."].filter(Boolean)
    };
  }
}

/**
 * Classifies Codex readiness without reading credentials or token files.
 * Prefers `codex login status --json`; falls back to a minimal `exec` connection-test prompt.
 */
export async function probeCodexAuth(
  executable: string,
  options: ProbeCodexAuthOptions = {}
): Promise<ModelBackendDetectionResult> {
  if (options.versionStatus?.status === "unsupported_version") {
    return {
      backendId: CODEX_BACKEND_ID,
      status: "unsupported_version",
      authSummary: authSummaryForStatus("unsupported_version"),
      diagnostics: [...options.versionStatus.diagnostics]
    };
  }

  const statusProbe = await probeWithStatusCommand(executable, options);
  if (statusProbe) return statusProbe;

  return probeWithConnectionTest(executable, options);
}
