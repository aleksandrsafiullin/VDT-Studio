import { execFile, spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, lstat, mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";

export const CODEX_SELECTION_LIMITS = Object.freeze({
  maxDirectories: 128,
  maxCandidates: 8,
  concurrency: 2,
  versionTimeoutMs: 1_500,
  terminationGraceMs: 1_250,
  taskkillTimeoutMs: 1_000,
  maxVersionBytes: 64 * 1024
});

export interface CodexExecutableSelectionOptions {
  path?: string;
  platform?: NodeJS.Platform;
  pathExt?: string;
  env?: NodeJS.ProcessEnv;
  /** Trusted host override; an explicit PATH otherwise disables app discovery. */
  applicationDirectories?: readonly string[];
  executableCheck?: (candidate: string) => Promise<boolean>;
  versionProbe?: (executable: string, args: readonly string[]) => Promise<{ stdout: string; stderr: string }>;
  signal?: AbortSignal;
  /** Smart execution must retain evidence and quarantine if close is unknown. */
  requireConfirmedCleanup?: boolean;
}

export interface SelectedCodexExecutable {
  executable: string;
  alias: "codex";
  version: string | null;
  error?: string;
}

interface Version {
  core: number[];
  prerelease: string[];
}

function versionOf(value: string | null): Version | undefined {
  const match = value?.match(/^(?:codex(?:-cli)?\s+)?v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return undefined;
  const core = match.slice(1, 4).map(Number);
  const prerelease = match[4]?.split(".") ?? [];
  if (core.some((part) => !Number.isSafeInteger(part)) || prerelease.some((part) => /^0\d+$/.test(part))) return undefined;
  return { core, prerelease };
}

function compareVersions(left: Version, right: Version): number {
  for (let index = 0; index < 3; index += 1) {
    const difference = left.core[index]! - right.core[index]!;
    if (difference) return difference;
  }
  if (!left.prerelease.length || !right.prerelease.length) return Number(!left.prerelease.length) - Number(!right.prerelease.length);
  for (let index = 0; index < Math.max(left.prerelease.length, right.prerelease.length); index += 1) {
    const a = left.prerelease[index];
    const b = right.prerelease[index];
    if (a === b) continue;
    if (a === undefined || b === undefined) return a === undefined ? -1 : 1;
    const aNumeric = /^\d+$/.test(a);
    const bNumeric = /^\d+$/.test(b);
    if (aNumeric && bNumeric) return a.length !== b.length ? a.length - b.length : a < b ? -1 : 1;
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return a < b ? -1 : 1;
  }
  return 0;
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function currentWorkspaceRoot(): Promise<string> {
  const cwd = await realpath(process.cwd());
  let root = cwd;
  let directory = cwd;
  for (let level = 0; level < 12; level += 1) {
    if (await lstat(path.join(directory, ".git")).catch(() => undefined) ||
        await lstat(path.join(directory, "pnpm-workspace.yaml")).catch(() => undefined)) root = directory;
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return root;
}

async function candidatesOnPath(options: CodexExecutableSelectionOptions): Promise<string[]> {
  const platform = options.platform ?? process.platform;
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const env = options.env ?? process.env;
  const appDirectories = options.applicationDirectories ?? (platform === "darwin" && options.path === undefined
    ? ["/Applications", ...(env.HOME && path.posix.isAbsolute(env.HOME) ? [path.posix.join(env.HOME, "Applications")] : [])]
      .map((directory) => path.posix.join(directory, "ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS"))
    : []);
  const directories = [...(options.path ?? env.PATH ?? "").split(platform === "win32" ? ";" : ":"), ...appDirectories]
    .filter((directory) => pathApi.isAbsolute(directory) && !directory.includes("\0"))
    .slice(0, CODEX_SELECTION_LIMITS.maxDirectories);
  const extensions = platform === "win32"
    ? ["", ...(options.pathExt ?? env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").map((part) => part.trim().toLowerCase())]
    : [""];
  const workspace = await currentWorkspaceRoot();
  const seen = new Set<string>();
  for (const directory of directories) {
    for (const extension of extensions) {
      if (!/^(?:|\.[a-z0-9]+)$/.test(extension)) continue;
      const candidate = pathApi.join(directory, `codex${extension}`);
      if (inside(workspace, candidate)) continue;
      try {
        const info = await lstat(candidate);
        if (!info.isFile() && !info.isSymbolicLink()) continue;
        const resolved = await realpath(candidate);
        if (!path.isAbsolute(resolved) || inside(workspace, resolved) || !(await lstat(resolved)).isFile()) continue;
        await access(resolved, constants.X_OK);
        if (options.executableCheck && !await options.executableCheck(candidate)) continue;
        seen.add(resolved);
        if (seen.size >= CODEX_SELECTION_LIMITS.maxCandidates) return [...seen];
      } catch {
        // Only reviewed executable names resolving to regular files outside the workspace are eligible.
      }
    }
  }
  return [...seen];
}

function versionEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { NODE_ENV: source.NODE_ENV ?? "production" };
  for (const key of ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL", "LC_CTYPE", "SystemRoot", "WINDIR"]) {
    if (source[key] !== undefined) result[key] = source[key];
  }
  return result;
}

async function probeVersion(executable: string, cwd: string, env: NodeJS.ProcessEnv, options: CodexExecutableSelectionOptions): Promise<{ stdout: string; stderr: string }> {
  options.signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ["--version"], {
      cwd, env, shell: false, windowsHide: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let bytes = 0;
    let failure: Error | undefined;
    let settled = false;
    let terminating = false;
    let termination: Promise<void> = Promise.resolve();
    let terminationDeadline: NodeJS.Timeout | undefined;
    const stdoutDecoder = new StringDecoder("utf8"), stderrDecoder = new StringDecoder("utf8");
    const abort = () => { failure ??= Object.assign(new Error("Codex CLI version probe cancelled."), { code: "CANCELLED", name: "AbortError" }); terminate(); };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
      if (terminationDeadline) clearTimeout(terminationDeadline);
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
      if (error) reject(error);
      else resolve({ stdout: stdout + stdoutDecoder.end(), stderr: stderr + stderrDecoder.end() });
    };
    const terminate = () => {
      if (terminating) return;
      terminating = true;
      // A dead parent or escaped descendant can keep inherited pipes open indefinitely.
      // Settlement must therefore be independent of both exit and close events.
      terminationDeadline = setTimeout(() => {
        finish(options.requireConfirmedCleanup
          ? Object.assign(new Error("Codex CLI probe cleanup could not be confirmed."), { code: "CLEANUP_UNCONFIRMED", retainedDirectory: cwd })
          : failure ?? new Error("Codex CLI version probe cleanup timed out."));
      }, CODEX_SELECTION_LIMITS.terminationGraceMs);
      if (!child.pid) return;
      if (process.platform === "win32") {
        const taskkill = path.win32.join(process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows", "System32", "taskkill.exe");
        termination = new Promise((done) => {
          let completed = false;
          let killer: ReturnType<typeof execFile> | undefined;
          const complete = () => {
            if (completed) return;
            completed = true;
            clearTimeout(killerDeadline);
            killer?.kill("SIGKILL");
            killer?.stdout?.destroy();
            killer?.stderr?.destroy();
            killer?.unref();
            child.kill("SIGKILL");
            done();
          };
          const killerDeadline = setTimeout(complete, CODEX_SELECTION_LIMITS.taskkillTimeoutMs);
          try {
            killer = execFile(taskkill, ["/pid", String(child.pid), "/T", "/F"], {
              timeout: CODEX_SELECTION_LIMITS.taskkillTimeoutMs, killSignal: "SIGKILL", maxBuffer: 1024, windowsHide: true, shell: false
            }, complete);
          } catch {
            complete();
          }
        });
      } else {
        try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
      }
    };
    const timeout = setTimeout(() => {
      failure ??= new Error("Codex CLI version probe timed out.");
      terminate();
    }, CODEX_SELECTION_LIMITS.versionTimeoutMs);
    const collect = (chunk: Buffer, stream: "stdout" | "stderr") => {
      if (failure || settled) return;
      bytes += chunk.length;
      if (bytes > CODEX_SELECTION_LIMITS.maxVersionBytes) {
        failure = new Error("Codex CLI version output exceeded the limit.");
        terminate();
      } else if (stream === "stdout") stdout += stdoutDecoder.write(chunk);
      else stderr += stderrDecoder.write(chunk);
    };
    child.stdout.on("data", (chunk: Buffer) => collect(chunk, "stdout"));
    child.stderr.on("data", (chunk: Buffer) => collect(chunk, "stderr"));
    child.once("error", () => {
      failure ??= new Error("Codex CLI version probe failed.");
      terminate();
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      // Version wrappers may fork: clean the owned POSIX group even after a successful parent exits.
      if (process.platform !== "win32") terminate();
      void termination.then(() => finish(failure ?? (code !== 0 ? new Error("Codex CLI version probe failed.") : undefined)));
    });
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
  });
}

/** Shared by detection and execution. No installation, configuration edits, model calls or app-specific paths. */
export async function selectCodexExecutable(options: CodexExecutableSelectionOptions = {}): Promise<SelectedCodexExecutable | null> {
  options.signal?.throwIfAborted();
  const candidates = await candidatesOnPath(options);
  if (!candidates.length) return null;
  const cwd = await mkdtemp(path.join(os.tmpdir(), "vdt-codex-selection-"));
  let retained = false;
  try {
    const env = versionEnvironment(options.env ?? process.env);
    const results: SelectedCodexExecutable[] = [];
    let next = 0;
    const probes = await Promise.allSettled(Array.from({ length: Math.min(candidates.length, CODEX_SELECTION_LIMITS.concurrency) }, async () => {
      while (next < candidates.length) {
        options.signal?.throwIfAborted();
        const index = next++;
        const executable = candidates[index]!;
        try {
          const result = options.versionProbe
            ? await options.versionProbe(executable, ["--version"])
            : await probeVersion(executable, cwd, env, options);
          const raw = `${result.stdout}\n${result.stderr}`.trim().split(/\r?\n/, 1)[0]?.trim().slice(0, 160) || null;
          const version = versionOf(raw) ? raw : null;
          results[index] = {
            executable, alias: "codex", version,
            ...(version ? {} : { error: "Codex CLI version was not recognized." })
          };
        } catch (error) {
          if (options.requireConfirmedCleanup && error && typeof error === "object" && "code" in error && error.code === "CLEANUP_UNCONFIRMED") { retained = true; throw error; }
          if (options.signal?.aborted) throw error;
          results[index] = { executable, alias: "codex", version: null, error: "Codex CLI version probe failed." };
        }
      }
    }));
    const rejected = probes.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    if (rejected.length) throw rejected.find(result => result.reason?.code === "CLEANUP_UNCONFIRMED")?.reason ?? rejected[0]!.reason;
    let selected = results[0]!;
    for (const result of results.slice(1)) {
      const version = versionOf(result.version);
      const current = versionOf(selected.version);
      if (version && (!current || compareVersions(version, current) > 0)) selected = result;
    }
    return selected;
  } finally {
    if (!retained) await rm(cwd, { recursive: true, force: true });
  }
}
