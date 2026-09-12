import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readdir, realpath } from "node:fs/promises";
import path from "node:path";

export const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
export const DEFAULT_MAX_PROMPT_BYTES = 1024 * 1024;
export const DEFAULT_MAX_LINES = 100_000;
export const DEFAULT_TIMEOUT_MS = 180_000;

export const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
export const SAFE_HASH = /^sha256:[a-f0-9]{64}$/;
export const SAFE_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,511}$/;

export interface CheckpointCredentialEnvironmentEntry {
  readonly name: string;
  readonly value: string;
}

export interface CheckpointProcessRequest {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly stdin: string;
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
}

export interface CheckpointProcessResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CheckpointProcessRunner {
  run(request: CheckpointProcessRequest): Promise<CheckpointProcessResult>;
}

export interface CheckpointPrivateEnvironment {
  readonly environmentId: string;
  readonly privateWorkspacePath: string;
  readonly privateStatePath: string;
  readonly trustedSubscriptionAuthHomePath?: string;
  readonly preauthorizeEmptyWorkspace?: boolean;
  readonly forbiddenRoots: readonly string[];
  readonly credentialEnvironment?: readonly CheckpointCredentialEnvironmentEntry[];
  close?(): void | Promise<void>;
}

export function checkpointTransportError(code: string, message: string, details: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(message), { code, ...details });
}

export function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

export function hashText(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

export function positiveInteger(value: number | undefined, fallback: number, field: string, errorPrefix: string): number {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected <= 0) {
    throw checkpointTransportError(`${errorPrefix}_CONFIGURATION_INVALID`, `${field} must be a positive integer.`);
  }
  return selected;
}

export function sanitizeProcessMessage(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (!trimmed || /api.?key|authorization|cookie|password|secret|token/i.test(trimmed)) return fallback;
  return trimmed.slice(0, 500);
}

export function assertSessionId(value: unknown, field: string, errorPrefix: string): asserts value is string {
  if (
    typeof value !== "string"
    || !value.trim()
    || value.length > 512
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw checkpointTransportError(`${errorPrefix}_SESSION_INVALID`, `${field} is invalid.`);
  }
}

export function canonicalPathContains(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function canonicalDirectory(value: string, field: string, errorPrefix: string): Promise<string> {
  if (!path.isAbsolute(value) || value === path.parse(value).root || value.includes("\0")) {
    throw checkpointTransportError(`${errorPrefix}_UNSAFE_ENVIRONMENT`, `${field} must be a non-root absolute path.`);
  }
  const stat = await lstat(value).catch(() => undefined);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) {
    throw checkpointTransportError(`${errorPrefix}_UNSAFE_ENVIRONMENT`, `${field} must be an existing non-symlink directory.`);
  }
  return realpath(value);
}

export async function assertPrivateCheckpointEnvironment(
  environment: CheckpointPrivateEnvironment,
  open: boolean,
  errorPrefix: string,
  cliLabel: string
): Promise<{ workspace: string; state: string; authHome?: string }> {
  if (!SAFE_ID.test(environment.environmentId)) {
    throw checkpointTransportError(`${errorPrefix}_UNSAFE_ENVIRONMENT`, "environmentId is invalid.");
  }
  if (environment.forbiddenRoots.length === 0) {
    throw checkpointTransportError(`${errorPrefix}_UNSAFE_ENVIRONMENT`, "At least one forbidden repository/project root is required.");
  }
  const workspace = await canonicalDirectory(environment.privateWorkspacePath, "privateWorkspacePath", errorPrefix);
  const state = await canonicalDirectory(environment.privateStatePath, "privateStatePath", errorPrefix);
  const authHome = environment.trustedSubscriptionAuthHomePath
    ? await canonicalDirectory(environment.trustedSubscriptionAuthHomePath, "trustedSubscriptionAuthHomePath", errorPrefix)
    : undefined;
  if (environment.preauthorizeEmptyWorkspace && !authHome) {
    throw checkpointTransportError(
      `${errorPrefix}_UNSAFE_ENVIRONMENT`,
      "Preauthorizing a private workspace requires an explicit trusted subscription auth home."
    );
  }
  if (canonicalPathContains(workspace, state) || canonicalPathContains(state, workspace)) {
    throw checkpointTransportError(`${errorPrefix}_UNSAFE_ENVIRONMENT`, "Private workspace and state directories must not overlap.");
  }
  const workspaceEntries = await readdir(workspace);
  if (workspaceEntries.length > 0) {
    throw checkpointTransportError(
      "SECURITY_BOUNDARY_BREACH",
      `${cliLabel} checkpoint workspace is not empty; the run was stopped before execution.`
    );
  }
  if (open && (await readdir(state)).length > 0) {
    throw checkpointTransportError(
      `${errorPrefix}_UNSAFE_ENVIRONMENT`,
      `${cliLabel} checkpoint state directory must be empty when the logical session opens.`
    );
  }
  for (const root of environment.forbiddenRoots) {
    const canonicalRoot = await canonicalDirectory(root, "forbiddenRoots[]", errorPrefix);
    if (
      canonicalPathContains(canonicalRoot, workspace)
      || canonicalPathContains(workspace, canonicalRoot)
      || canonicalPathContains(canonicalRoot, state)
      || canonicalPathContains(state, canonicalRoot)
    ) {
      throw checkpointTransportError(
        `${errorPrefix}_UNSAFE_ENVIRONMENT`,
        `${cliLabel} checkpoint private paths overlap a forbidden repository, project or database root.`
      );
    }
  }
  return { workspace, state, ...(authHome ? { authHome } : {}) };
}

export function containsCredentialLeak(
  value: string,
  entries: readonly CheckpointCredentialEnvironmentEntry[]
): boolean {
  return entries.some((entry) => entry.value.length >= 8 && value.includes(entry.value));
}

export function environmentFingerprint(environmentId: string, errorPrefix: string): string {
  if (!SAFE_ID.test(environmentId)) {
    throw checkpointTransportError(`${errorPrefix}_UNSAFE_ENVIRONMENT`, "environmentId is invalid.");
  }
  return hashText(environmentId);
}

export class NodeCheckpointProcessRunner implements CheckpointProcessRunner {
  constructor(
    private readonly errorPrefix: string,
    private readonly cliLabel: string
  ) {}

  run(request: CheckpointProcessRequest): Promise<CheckpointProcessResult> {
    if (request.signal.aborted) {
      return Promise.reject(checkpointTransportError(`${this.errorPrefix}_CANCELLED`, `${this.cliLabel} checkpoint process was cancelled.`));
    }
    return new Promise<CheckpointProcessResult>((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(request.executable, [...request.args], {
          cwd: request.cwd,
          env: { ...request.environment } as NodeJS.ProcessEnv,
          stdio: ["pipe", "pipe", "pipe"],
          shell: false,
          windowsHide: true
        });
      } catch (error) {
        reject(checkpointTransportError(
          `${this.errorPrefix}_PROCESS_ERROR`,
          error instanceof Error ? error.message : `${this.cliLabel} checkpoint process could not start.`
        ));
        return;
      }

      let stdout = Buffer.alloc(0);
      let stderr = Buffer.alloc(0);
      let settled = false;
      const terminate = (code: string, message: string) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
        reject(checkpointTransportError(code, message));
      };
      const append = (target: "stdout" | "stderr", chunk: Buffer | string) => {
        const incoming = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        if ((target === "stdout" ? stdout.byteLength : stderr.byteLength) + incoming.byteLength > request.maxOutputBytes) {
          terminate(`${this.errorPrefix}_OUTPUT_TOO_LARGE`, `${this.cliLabel} checkpoint process output exceeded its limit.`);
          return;
        }
        if (target === "stdout") stdout = Buffer.concat([stdout, incoming]);
        else stderr = Buffer.concat([stderr, incoming]);
      };
      const onAbort = () => terminate(`${this.errorPrefix}_CANCELLED`, `${this.cliLabel} checkpoint process was cancelled.`);
      const timer = setTimeout(
        () => terminate(`${this.errorPrefix}_TIMEOUT`, `${this.cliLabel} checkpoint process timed out.`),
        request.timeoutMs
      );
      const cleanup = () => {
        clearTimeout(timer);
        request.signal.removeEventListener("abort", onAbort);
      };
      request.signal.addEventListener("abort", onAbort, { once: true });
      child.stdout.on("data", (chunk: Buffer | string) => append("stdout", chunk));
      child.stderr.on("data", (chunk: Buffer | string) => append("stderr", chunk));
      child.once("error", (error) => terminate(`${this.errorPrefix}_PROCESS_ERROR`, `${this.cliLabel} checkpoint process failed: ${error.message}`));
      child.once("exit", (exitCode, exitSignal) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({
          exitCode,
          signal: exitSignal,
          stdout: stdout.toString("utf8"),
          stderr: stderr.toString("utf8")
        });
      });
      child.stdin.on("error", (error) => terminate(`${this.errorPrefix}_WRITE_FAILED`, `${this.cliLabel} checkpoint stdin failed: ${error.message}`));
      child.stdin.end(request.stdin, "utf8");
    });
  }
}
