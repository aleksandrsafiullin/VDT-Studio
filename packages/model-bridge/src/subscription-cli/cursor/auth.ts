import { execFile, type ExecFileOptionsWithStringEncoding } from "node:child_process";
import { promisify } from "node:util";
import type { ModelBackendDetectionResult, ModelBackendStatus } from "../../contract";
import { validateRegisteredSchema } from "../../schema-registry";
import type { ExecFileProbe } from "../types";
import { parseCursorStreamJson } from "./parser";
import type { CursorVersionEvaluation } from "./version";
import { CURSOR_BACKEND_ID } from "./detection";

const execFileAsync = promisify(execFile);

export const CURSOR_CONNECTION_TEST_PROMPT =
  'Respond with only valid JSON matching {"ok":true}. No markdown, commentary, or extra keys.';

export interface ProbeCursorAuthOptions {
  signal?: AbortSignal | undefined;
  versionStatus?: CursorVersionEvaluation;
  execFileImpl?: ExecFileProbe;
  timeoutMs?: number;
}

type ExecResult = { stdout: string; stderr: string };

function classifyAuthFailure(stderr: string, stdout: string, exitCode?: number): ModelBackendStatus {
  const haystack = `${stderr}\n${stdout}`.toLowerCase();
  if (/rate.?limit|quota|too many requests|429/.test(haystack)) return "rate_limited";
  if (/login|sign.?in|authenticate|authentication|not logged|api.?key/.test(haystack)) return "authentication_required";
  if (exitCode === 0) return "error";
  return "error";
}

function authSummaryForStatus(status: ModelBackendStatus): string {
  switch (status) {
    case "ready":
      return "Cursor account is authenticated and ready.";
    case "authentication_required":
      return "Cursor sign-in required. Run `agent login` in a terminal.";
    case "rate_limited":
      return "Cursor account is rate limited. Try again later.";
    case "unsupported_version":
      return "Cursor Agent CLI version is not supported.";
    case "installed":
      return "Cursor Agent is installed; authentication was not verified.";
    case "error":
      return "Cursor Agent connection probe failed.";
    default:
      return "Cursor Agent status is unknown.";
  }
}

function parseStatusJson(stdout: string): ModelBackendStatus | undefined {
  try {
    const payload = JSON.parse(stdout.trim()) as unknown;
    if (typeof payload !== "object" || payload === null) return undefined;
    const record = payload as Record<string, unknown>;
    const loggedIn = record.loggedIn ?? record.logged_in ?? record.authenticated;
    if (loggedIn === true) return "ready";
    if (loggedIn === false) return "authentication_required";
    const status = typeof record.status === "string" ? record.status.toLowerCase() : "";
    if (status.includes("ready") || status.includes("authenticated")) return "ready";
    if (status.includes("login") || status.includes("auth")) return "authentication_required";
    if (status.includes("rate")) return "rate_limited";
    return undefined;
  } catch {
    return undefined;
  }
}

async function runExec(
  executable: string,
  args: readonly string[],
  options: ProbeCursorAuthOptions
): Promise<ExecResult> {
  const execImpl = options.execFileImpl ?? execFileAsync;
  const execOptions: ExecFileOptionsWithStringEncoding = {
    encoding: "utf8",
    timeout: options.timeoutMs ?? 15_000,
    maxBuffer: 512 * 1024,
    windowsHide: true,
    shell: false,
    signal: options.signal
  };
  const result = await execImpl(executable, [...args], execOptions);
  return { stdout: result.stdout, stderr: result.stderr };
}

async function probeWithStatusCommand(executable: string, options: ProbeCursorAuthOptions): Promise<ModelBackendDetectionResult | null> {
  try {
    const result = await runExec(executable, ["status", "--format", "json"], options);
    const mapped = parseStatusJson(result.stdout) ?? (result.stderr ? classifyAuthFailure(result.stderr, result.stdout, 0) : "ready");
    return {
      backendId: CURSOR_BACKEND_ID,
      status: mapped,
      authSummary: authSummaryForStatus(mapped),
      diagnostics: mapped === "ready" ? [] : [result.stderr.trim() || result.stdout.trim()].filter(Boolean)
    };
  } catch (error) {
    const execError = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number | string };
    if (execError.code === "ENOENT" || /unknown command|invalid command|unrecognized/i.test(String(execError.stderr ?? execError.message))) {
      return null;
    }
    const stderr = execError.stderr ?? "";
    const stdout = execError.stdout ?? "";
    const status = classifyAuthFailure(stderr, stdout, typeof execError.code === "number" ? execError.code : undefined);
    return {
      backendId: CURSOR_BACKEND_ID,
      status,
      authSummary: authSummaryForStatus(status),
      diagnostics: [stderr.trim() || execError.message || "Cursor status probe failed."].filter(Boolean)
    };
  }
}

async function probeWithConnectionTest(executable: string, options: ProbeCursorAuthOptions): Promise<ModelBackendDetectionResult> {
  try {
    const result = await runExec(
      executable,
      ["--print", "--output-format", "stream-json", "--stream-partial-output", CURSOR_CONNECTION_TEST_PROMPT],
      options
    );
    const parsed = parseCursorStreamJson(result.stdout);
    if (parsed.error) {
      const status = classifyAuthFailure(result.stderr, `${result.stdout}\n${parsed.error}`);
      return {
        backendId: CURSOR_BACKEND_ID,
        status,
        authSummary: authSummaryForStatus(status),
        diagnostics: [parsed.error, result.stderr.trim()].filter(Boolean)
      };
    }
    if (validateRegisteredSchema("connection-test-v1", parsed.output)) {
      return {
        backendId: CURSOR_BACKEND_ID,
        status: "ready",
        authSummary: authSummaryForStatus("ready"),
        diagnostics: []
      };
    }
    return {
      backendId: CURSOR_BACKEND_ID,
      status: "error",
      authSummary: authSummaryForStatus("error"),
      diagnostics: ["Cursor connection test did not return { ok: true } JSON."]
    };
  } catch (error) {
    const execError = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number | string };
    const stderr = execError.stderr ?? "";
    const stdout = execError.stdout ?? "";
    const status = classifyAuthFailure(stderr, stdout, typeof execError.code === "number" ? execError.code : undefined);
    return {
      backendId: CURSOR_BACKEND_ID,
      status,
      authSummary: authSummaryForStatus(status),
      diagnostics: [stderr.trim() || execError.message || "Cursor connection test failed."].filter(Boolean)
    };
  }
}

/**
 * Classifies Cursor readiness without reading credentials, tokens, or ~/.cursor files.
 * Prefers `agent status --format json`; falls back to a minimal `--print` connection-test prompt.
 */
export async function probeCursorAuth(
  executable: string,
  options: ProbeCursorAuthOptions = {}
): Promise<ModelBackendDetectionResult> {
  if (options.versionStatus?.status === "unsupported_version") {
    return {
      backendId: CURSOR_BACKEND_ID,
      status: "unsupported_version",
      authSummary: authSummaryForStatus("unsupported_version"),
      diagnostics: [...options.versionStatus.diagnostics]
    };
  }

  const statusProbe = await probeWithStatusCommand(executable, options);
  if (statusProbe) return statusProbe;

  return probeWithConnectionTest(executable, options);
}
