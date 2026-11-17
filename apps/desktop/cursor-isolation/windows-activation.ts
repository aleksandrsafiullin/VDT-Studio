import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { CURSOR_CLI_EGRESS_HOSTS, startCursorCliEgress } from "../../web/lib/cursor-cli-egress";
import { assertCursorCheckpointVendorConfig, cursorCheckpointVendorPolicyHash } from "../../../packages/model-bridge/src/agent-engines/cursor-checkpoint-vendor-policy";
import type {
  CursorCheckpointIsolationIdentity,
  CursorCheckpointIsolationRunner,
  CursorCheckpointQualificationEvidence,
  CursorResumeCheckpointEnvironmentFactory
} from "../../../packages/model-bridge/src/agent-engines/cursor-resume-checkpoint-engine";
import type { CursorResumeProcessRequest, CursorResumeProcessResult } from "../../../packages/model-bridge/src/agent-engines/cursor-resume-checkpoint-transport";
import { WindowsCursorWorkerClient, wireObject, workerError } from "./windows-worker-client";
import { createCursorModelActivations, type CursorActivationEvidence } from "./activation-profile";

type WindowsCursorProfile = CursorActivationEvidence & {
  readonly payloadRoot: string;
  readonly systemRoot: string;
  readonly privateRoot: string;
  readonly workerExecutableHash: string;
  readonly proxyPreloadHash: string;
  readonly egressPolicyHash: string;
};

type Scope = {
  readonly worker: WindowsCursorWorkerClient;
  readonly workspace: string;
  readonly state: string;
  readonly identity: CursorCheckpointIsolationIdentity;
  close(): Promise<void>;
};

// Defined only by the reviewed private packaging input. The standard artifact
// has no bundled activation or manifest entry.
declare const __VDT_WINDOWS_CURSOR_PROFILE__: WindowsCursorProfile;

const windowsPath = path.win32;
const SHA = /^sha256:[a-f0-9]{64}$/;
const CLI_VERSION = /^\d{4}\.\d{2}\.\d{2}-[a-f0-9]{7,40}$/;
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,511}$/;
const MAX_PROMPT = 1024 * 1024;
const MAX_OUTPUT = 4 * 1024 * 1024;
const WORKER_START_TIMEOUT = 30_000;
const MAX_RUN_TIMEOUT = 10 * 60_000;

function boundary(message: string): Error {
  return workerError("CURSOR_CHECKPOINT_UNSAFE_ENVIRONMENT", message);
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function normalPath(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z]:\\[^:]+$/.test(value)
    && !/[\x00-\x1f\x7f/]/.test(value) && windowsPath.normalize(value) === value;
}

function samePath(first: string, second: string): boolean {
  return windowsPath.relative(first, second) === "";
}

function descendant(parent: string, child: string): boolean {
  const relative = windowsPath.relative(parent, child);
  return relative !== "" && relative !== ".." && !relative.startsWith("..\\") && !windowsPath.isAbsolute(relative);
}

async function canonicalDirectory(directory: unknown): Promise<string> {
  if (!normalPath(directory)) throw boundary("The Windows Cursor directory is invalid.");
  const info = await lstat(directory).catch(() => undefined);
  const canonical = await realpath(directory).catch(() => undefined);
  if (!info?.isDirectory() || !canonical || !samePath(directory, canonical)) {
    throw boundary("The Windows Cursor directory escaped its canonical location.");
  }
  return canonical;
}

async function verifyAsset(file: string, expected: string): Promise<void> {
  try {
    if (!SHA.test(expected) || !(await lstat(file)).isFile() || !samePath(await realpath(file), file)) throw new Error();
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    if (`sha256:${hash.digest("hex")}` !== expected) throw new Error();
  } catch {
    throw boundary("The Windows Cursor runtime resources do not match the packaged profile.");
  }
}

function parseIdentity(frame: Record<string, unknown>): CursorCheckpointIsolationIdentity {
  if (typeof frame.cliVersion !== "string" || !CLI_VERSION.test(frame.cliVersion)
    || typeof frame.payloadHash !== "string" || !SHA.test(frame.payloadHash)
    || typeof frame.policyHash !== "string" || !SHA.test(frame.policyHash)) {
    throw boundary("The Windows Cursor worker supplied an invalid identity.");
  }
  return Object.freeze({
    cliVersion: frame.cliVersion,
    payloadHash: frame.payloadHash,
    policyHash: frame.policyHash,
    vendorPolicyHash: cursorCheckpointVendorPolicyHash("disabled")
  });
}

function requireIdentity(current: CursorCheckpointIsolationIdentity, expected: CursorCheckpointIsolationIdentity): void {
  if (current.cliVersion !== expected.cliVersion || current.payloadHash !== expected.payloadHash
    || current.policyHash !== expected.policyHash || current.vendorPolicyHash !== expected.vendorPolicyHash) {
    throw workerError("CURSOR_CHECKPOINT_QUALIFICATION_MISMATCH", "The Windows Cursor worker identity changed.");
  }
}

function checkRunRequest(request: CursorResumeProcessRequest, scope: Scope, executable: string, model: string): void {
  const state = request.environment.HOME;
  const required = ["--print", "--output-format", "stream-json", "--stream-partial-output", "--mode", "ask",
    "--workspace", scope.workspace, "--trust", "--model", model];
  const additional = request.args.slice(required.length);
  if (request.executable !== executable || request.cwd !== scope.workspace || state !== scope.state
    || !required.every((arg, index) => request.args[index] === arg)
    || !(additional.length === 0 || additional.length === 2 && additional[0] === "--resume"
      && SESSION_ID.test(additional[1] ?? ""))
    || !Number.isSafeInteger(request.timeoutMs) || request.timeoutMs < 1 || request.timeoutMs > MAX_RUN_TIMEOUT
    || !Number.isSafeInteger(request.maxOutputBytes) || request.maxOutputBytes < 1 || request.maxOutputBytes > MAX_OUTPUT
    || Buffer.byteLength(request.stdin) > MAX_PROMPT || request.stdin.includes("\0")) {
    throw boundary("The Windows Cursor run did not match its exclusive scope.");
  }
}

function parseRun(frame: Record<string, unknown>, maximum: number): CursorResumeProcessResult {
  if (!wireObject(frame, ["op", "ok", "id", "exitCode", "stdout", "stderr"])
    || typeof frame.exitCode !== "number" || !Number.isInteger(frame.exitCode)
    || typeof frame.stdout !== "string" || typeof frame.stderr !== "string"
    || Buffer.byteLength(frame.stdout) + Buffer.byteLength(frame.stderr) > maximum) {
    throw workerError("SECURITY_BOUNDARY_BREACH", "The Windows Cursor worker returned invalid run data.");
  }
  // Model checkpoint data goes to the existing parser. Worker diagnostics are
  // withheld from the transport, which may otherwise display arbitrary text.
  return { exitCode: frame.exitCode, signal: null, stdout: frame.stdout, stderr: "" };
}

export async function createPackagedCursorActivation() {
  const profile = __VDT_WINDOWS_CURSOR_PROFILE__;
  return createCursorModelActivations(profile, evidence => createActivation(profile, evidence));
}

async function createActivation(profile: WindowsCursorProfile, evidence: CursorCheckpointQualificationEvidence) {
  if (process.platform !== "win32" || process.arch !== "x64" || evidence.platform.os !== process.platform
    || evidence.platform.arch !== process.arch || evidence.platform.runtimeVersion !== process.version
    || profile.egressPolicyHash !== sha256(JSON.stringify(CURSOR_CLI_EGRESS_HOSTS))) {
    throw boundary("The bundled Windows Cursor profile does not match this host.");
  }
  // Tauri resolves its resource directory with Windows' extended-path prefix.
  // Node realpath returns the ordinary drive path used by the asset checks.
  const resourcePath = __dirname.startsWith("\\\\?\\") ? __dirname.slice(4) : __dirname;
  const [systemRoot, privateRoot, payloadRoot, resourceRoot] = await Promise.all([
    canonicalDirectory(profile.systemRoot), canonicalDirectory(profile.privateRoot), canonicalDirectory(profile.payloadRoot),
    canonicalDirectory(resourcePath)
  ]);
  if (descendant(payloadRoot, privateRoot) || descendant(privateRoot, payloadRoot) || samePath(payloadRoot, privateRoot)) {
    throw boundary("The Windows Cursor profile and vendor payload overlap.");
  }
  const executable = windowsPath.join(payloadRoot, "index.js");
  const workerDirectory = windowsPath.join(resourceRoot, "windows-cursor-worker");
  const workerExecutable = windowsPath.join(workerDirectory, "vdt-windows-cursor-worker.exe");
  const preloadFile = windowsPath.join(workerDirectory, "proxy-preload.cjs");
  const active = new Map<string, Scope>();
  const reserved = new Set<string>();

  async function startWorker(): Promise<WindowsCursorWorkerClient> {
    await Promise.all([
      verifyAsset(workerExecutable, profile.workerExecutableHash), verifyAsset(preloadFile, profile.proxyPreloadHash)
    ]);
    return new WindowsCursorWorkerClient(spawn(workerExecutable, [], {
      cwd: workerDirectory,
      env: { SystemRoot: systemRoot, WINDIR: systemRoot, TEMP: privateRoot, TMP: privateRoot },
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    }));
  }

  const runner: CursorCheckpointIsolationRunner = {
    async measureIdentity(target) {
      if (target !== executable) throw boundary("The Windows Cursor executable did not match the approved payload.");
      const worker = await startWorker();
      try {
        const frame = await worker.request({
          op: "measure", version: 1, payloadRoot, cliVersion: evidence.cliVersion
        }, AbortSignal.timeout(WORKER_START_TIMEOUT));
        if (!wireObject(frame, ["op", "ok", "cliVersion", "payloadHash", "policyHash"])) {
          throw boundary("The Windows Cursor worker returned an invalid measurement.");
        }
        return parseIdentity(frame);
      } finally {
        await worker.close();
      }
    },

    async runQualified(request, identity) {
      const scope = active.get(request.cwd);
      if (!scope) throw boundary("The Windows Cursor run has no live native session scope.");
      requireIdentity(scope.identity, identity);
      checkRunRequest(request, scope, executable, evidence.modelId);
      await assertCursorCheckpointVendorConfig(request, identity.vendorPolicyHash);
      const id = randomUUID();
      try {
        const frame = await scope.worker.request({
          op: "run", id, args: request.args, stdin: request.stdin, timeoutMs: request.timeoutMs,
          maxOutputBytes: request.maxOutputBytes, vendorPolicyHash: identity.vendorPolicyHash
        }, AbortSignal.any([request.signal, AbortSignal.timeout(request.timeoutMs + 3_000)]));
        return parseRun(frame, request.maxOutputBytes);
      } catch (error) {
        await scope.close();
        throw error;
      }
    }
  };

  const sessionEnvironmentFactory: CursorResumeCheckpointEnvironmentFactory = async ({ binding, recovery, signal }) => {
    if (signal.aborted) throw workerError("CURSOR_CHECKPOINT_CANCELLED");
    // The native process owns and deletes its temporary scope. A different
    // process cannot reopen or manufacture the prior opaque vendor session.
    if (recovery) throw workerError("RECOVERY_REQUIRED", "The original Windows Cursor worker is unavailable.");
    if (reserved.has(binding.runId)) throw boundary("The Windows Cursor session already owns a native scope.");
    reserved.add(binding.runId);
    let broker: Awaited<ReturnType<typeof startCursorCliEgress>> | undefined;
    let worker: WindowsCursorWorkerClient | undefined;
    try {
      const sessionBroker = broker = await startCursorCliEgress();
      const sessionWorker = worker = await startWorker();
      const frame = await sessionWorker.request({
        op: "open", version: 1, payloadRoot, cliVersion: evidence.cliVersion, payloadHash: evidence.payloadHash,
        policyHash: evidence.policyHash, model: evidence.modelId, brokerPort: sessionBroker.port
      }, AbortSignal.any([signal, AbortSignal.timeout(WORKER_START_TIMEOUT)]));
      if (!wireObject(frame, ["op", "ok", "workspacePath", "statePath", "cliVersion", "payloadHash", "policyHash"])) {
        throw boundary("The Windows Cursor worker returned an invalid session scope.");
      }
      const identity = parseIdentity(frame);
      requireIdentity(identity, evidence);
      const [workspace, state] = await Promise.all([
        canonicalDirectory(frame.workspacePath), canonicalDirectory(frame.statePath)
      ]);
      const scopeRoot = windowsPath.dirname(workspace);
      if (!descendant(privateRoot, scopeRoot) || !samePath(windowsPath.dirname(state), scopeRoot)
        || samePath(workspace, state) || active.has(workspace)) {
        throw boundary("The Windows Cursor worker returned a conflicting or out-of-scope directory.");
      }
      if (signal.aborted) throw workerError("CURSOR_CHECKPOINT_CANCELLED");
      let cleanup: Promise<void> | undefined;
      const scope: Scope = {
        worker: sessionWorker, workspace, state, identity,
        close() {
          active.delete(workspace);
          cleanup ??= sessionWorker.close().finally(async () => {
            reserved.delete(binding.runId);
            await sessionBroker.close();
          });
          return cleanup;
        }
      };
      active.set(workspace, scope);
      return {
        environmentId: `win-cursor-${sha256(binding.runId).slice(7)}`,
        privateWorkspacePath: workspace,
        privateStatePath: state,
        forbiddenRoots: [payloadRoot, systemRoot, resourceRoot],
        preauthorizeEmptyWorkspace: true,
        close: scope.close
      };
    } catch (error) {
      try {
        await worker?.close();
      } finally {
        await broker?.close();
        reserved.delete(binding.runId);
      }
      throw error;
    }
  };

  return Object.freeze({ evidence, executable, runner, sessionEnvironmentFactory });
}
