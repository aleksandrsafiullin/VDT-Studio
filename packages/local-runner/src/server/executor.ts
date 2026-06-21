import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  extractBoundedJson,
  isVdtSchemaId,
  validateRegisteredSchema,
  type VdtSchemaId
} from "@vdt-studio/model-bridge";
import type { BackendManifest, CompletionRequest } from "../cli/types";

export const EXECUTION_LIMITS = Object.freeze({
  maxPromptBytes: 512 * 1024,
  maxLineBytes: 1024 * 1024,
  maxStdoutBytes: 4 * 1024 * 1024,
  maxStderrBytes: 1024 * 1024,
  maxResultBytes: 1024 * 1024,
  timeoutMs: 120_000,
  killGraceMs: 3_000
});

const ALLOWED_ENV_KEYS = [
  "PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL", "LC_CTYPE", "NO_COLOR"
] as const;

export interface ExecutionResult {
  output: unknown;
  rawText?: string;
  outputBytes: number;
  schemaValid: boolean;
  exitCode?: number;
  executableVersion?: string;
}

export interface ExecutorOptions {
  env?: NodeJS.ProcessEnv;
  tempRoot?: string;
  fetch?: typeof globalThis.fetch;
  spawn?: (command: string, args: readonly string[], options: SpawnOptionsWithoutStdio) => ChildProcessWithoutNullStreams;
  resolveExecutable?: (manifest: BackendManifest, env: NodeJS.ProcessEnv) => Promise<string>;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function abortError(message = "Completion was cancelled."): Error {
  return Object.assign(new Error(message), { name: "AbortError", code: "CANCELLED" });
}

function safeEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const key of ALLOWED_ENV_KEYS) {
    const value = source[key];
    if (value !== undefined) result[key] = value;
  }
  result.NO_COLOR = "1";
  return result;
}

async function defaultResolveExecutable(manifest: BackendManifest, env: NodeJS.ProcessEnv): Promise<string> {
  const cli = manifest.cli;
  if (!cli) throw Object.assign(new Error("Backend has no executable manifest."), { code: "INVALID_MANIFEST" });
  const pathValue = env.PATH ?? "";
  for (const alias of cli.executableAliases) {
    if (alias.includes("\0") || path.basename(alias) !== alias || alias === "." || alias === "..") continue;
    for (const directory of pathValue.split(path.delimiter).filter((entry) => path.isAbsolute(entry))) {
      const candidate = path.resolve(directory, alias);
      try {
        const info = await lstat(candidate);
        if (info.isSymbolicLink() || !info.isFile()) continue;
        const resolved = await realpath(candidate);
        if (!path.isAbsolute(resolved)) continue;
        const projectRoot = path.resolve(process.cwd());
        if (resolved === projectRoot || resolved.startsWith(`${projectRoot}${path.sep}`)) continue;
        return resolved;
      } catch {
        // Continue probing reviewed aliases only.
      }
    }
  }
  throw Object.assign(new Error(`${manifest.label} executable was not found as a regular non-symlink file on PATH.`), {
    code: "BACKEND_NOT_INSTALLED"
  });
}

function assertManifestSafe(manifest: BackendManifest): void {
  if (manifest.kind !== "subscription_cli" && manifest.kind !== "custom_cli") return;
  if (!manifest.safety.certified || !manifest.safety.toolsDisabled || manifest.safety.requiresOsSandbox) {
    throw Object.assign(new Error(`${manifest.label} is not certified for isolated execution.`), {
      code: "UNSAFE_CONFIGURATION"
    });
  }
}

function assertLineLimit(value: string): void {
  for (const line of value.split(/\r?\n/)) {
    if (byteLength(line) > EXECUTION_LIMITS.maxLineBytes) {
      throw Object.assign(new Error("Backend output line exceeds the configured limit."), { code: "OUTPUT_LINE_TOO_LARGE" });
    }
  }
}

async function executeCli(
  manifest: BackendManifest,
  request: CompletionRequest,
  signal: AbortSignal,
  options: ExecutorOptions
): Promise<ExecutionResult> {
  assertManifestSafe(manifest);
  const envSource = options.env ?? process.env;
  const executable = await (options.resolveExecutable ?? defaultResolveExecutable)(manifest, envSource);
  if (!path.isAbsolute(executable) || executable.includes("\0")) {
    throw Object.assign(new Error("Resolved executable must be an absolute path without NUL bytes."), { code: "UNSAFE_EXECUTABLE" });
  }

  const payload = JSON.stringify({
    requestId: request.requestId,
    taskType: request.taskType,
    schemaId: request.schemaId,
    input: request.input,
    ...(request.model ? { model: request.model } : {})
  });
  if (byteLength(payload) > EXECUTION_LIMITS.maxPromptBytes) {
    throw Object.assign(new Error("Completion request exceeds the prompt limit."), { code: "PROMPT_TOO_LARGE" });
  }

  const tempRoot = options.tempRoot ?? os.tmpdir();
  await mkdir(tempRoot, { recursive: true });
  const cwd = await mkdtemp(path.join(tempRoot, "vdt-run-"));
  await chmod(cwd, 0o700);
  await writeFile(path.join(cwd, "request.json"), payload, { encoding: "utf8", mode: 0o600, flag: "wx" });

  const child = (options.spawn ?? ((command, args, spawnOptions) =>
    nodeSpawn(command, [...args], spawnOptions) as ChildProcessWithoutNullStreams))(
    executable,
    manifest.cli?.args ?? [],
    { cwd, env: safeEnvironment(envSource), shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }
  );

  let stdout = "";
  let stderr = "";
  let timeout: NodeJS.Timeout | undefined;
  let forceKill: NodeJS.Timeout | undefined;
  let cancelled = false;
  let outputLimitExceeded = false;

  const terminate = () => {
    cancelled = true;
    child.kill("SIGTERM");
    forceKill = setTimeout(() => child.kill("SIGKILL"), EXECUTION_LIMITS.killGraceMs);
    forceKill.unref?.();
  };
  signal.addEventListener("abort", terminate, { once: true });
  const effectiveTimeout = Math.min(request.timeoutMs ?? EXECUTION_LIMITS.timeoutMs, EXECUTION_LIMITS.timeoutMs);
  timeout = setTimeout(terminate, effectiveTimeout);
  timeout.unref?.();

  const completion = new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
      if (byteLength(stdout) > EXECUTION_LIMITS.maxStdoutBytes) {
        outputLimitExceeded = true;
        terminate();
      }
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
      if (byteLength(stderr) > EXECUTION_LIMITS.maxStderrBytes) {
        outputLimitExceeded = true;
        terminate();
      }
    });
    child.once("close", (code) => resolve(code ?? -1));
  });

  try {
    if (signal.aborted) terminate();
    child.stdin.end(payload);
    const exitCode = await completion;
    if (cancelled) {
      if (byteLength(stdout) > EXECUTION_LIMITS.maxStdoutBytes || byteLength(stderr) > EXECUTION_LIMITS.maxStderrBytes) {
        throw Object.assign(new Error("Backend output exceeded the configured limit."), { code: "OUTPUT_TOO_LARGE" });
      }
      if (signal.aborted) throw abortError();
      throw Object.assign(new Error("Backend timed out."), { code: "TIMEOUT" });
    }
    if (exitCode !== 0) {
      throw Object.assign(new Error(`Backend exited with code ${exitCode}; stderr contained ${byteLength(stderr)} bytes.`), {
        code: "BACKEND_EXIT_FAILED",
        exitCode
      });
    }
    assertLineLimit(stdout);
    if (byteLength(stdout) > EXECUTION_LIMITS.maxResultBytes) {
      throw Object.assign(new Error("Backend result exceeds the configured limit."), { code: "OUTPUT_TOO_LARGE" });
    }
    const output = extractBoundedJson(stdout, EXECUTION_LIMITS.maxResultBytes);
    const schemaValid = validateRegisteredSchema(request.schemaId as VdtSchemaId, output);
    if (!schemaValid) throw Object.assign(new Error("Backend output failed registered schema validation."), { code: "SCHEMA_INVALID" });
    return { output, rawText: stdout, outputBytes: byteLength(stdout), schemaValid, exitCode };
  } catch (error) {
    if (outputLimitExceeded) {
      throw Object.assign(new Error("Backend output exceeded the configured limit."), { code: "OUTPUT_TOO_LARGE" });
    }
    throw error;
  } finally {
    signal.removeEventListener("abort", terminate);
    if (timeout) clearTimeout(timeout);
    if (forceKill) clearTimeout(forceKill);
    await rm(cwd, { recursive: true, force: true });
  }
}

async function readBoundedResponse(response: Response): Promise<string> {
  if (response.redirected) throw Object.assign(new Error("Provider redirects are disabled."), { code: "REDIRECT_BLOCKED" });
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > EXECUTION_LIMITS.maxStdoutBytes) {
    throw Object.assign(new Error("Provider response exceeds the configured limit."), { code: "OUTPUT_TOO_LARGE" });
  }
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > EXECUTION_LIMITS.maxStdoutBytes) {
      await reader.cancel();
      throw Object.assign(new Error("Provider response exceeds the configured limit."), { code: "OUTPUT_TOO_LARGE" });
    }
    chunks.push(chunk.value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function executeLocalHttp(
  manifest: BackendManifest,
  request: CompletionRequest,
  signal: AbortSignal,
  options: ExecutorOptions
): Promise<ExecutionResult> {
  if (!manifest.localHttp) throw Object.assign(new Error("Backend has no local HTTP manifest."), { code: "INVALID_MANIFEST" });
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, Math.min(request.timeoutMs ?? EXECUTION_LIMITS.timeoutMs, EXECUTION_LIMITS.timeoutMs));
  timeout.unref?.();
  let response: Response;
  let rawResponse: string;
  try {
    response = await (options.fetch ?? fetch)(`${manifest.localHttp.baseUrl}/chat/completions`, {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: request.model ?? manifest.localHttp.defaultModel,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: `Return one JSON object for VDT task ${request.taskType} matching approved schema ${request.schemaId}.` },
          { role: "user", content: JSON.stringify(request.input) }
        ]
      })
    });
    rawResponse = await readBoundedResponse(response);
    assertLineLimit(rawResponse);
  } catch (error) {
    if (controller.signal.aborted) {
      if (signal.aborted) throw abortError();
      throw Object.assign(new Error("Local provider timed out."), { code: "TIMEOUT" });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
  if (!response.ok) throw Object.assign(new Error(`Local provider failed with status ${response.status}.`), { code: "LOCAL_HTTP_FAILED" });
  const envelope = JSON.parse(rawResponse) as { choices?: Array<{ message?: { content?: unknown } }> };
  const content = envelope.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw Object.assign(new Error("Local provider response did not contain message content."), { code: "INVALID_PROVIDER_RESPONSE" });
  const output = extractBoundedJson(content, EXECUTION_LIMITS.maxResultBytes);
  const schemaValid = validateRegisteredSchema(request.schemaId as VdtSchemaId, output);
  if (!schemaValid) throw Object.assign(new Error("Backend output failed registered schema validation."), { code: "SCHEMA_INVALID" });
  return { output, outputBytes: byteLength(content), schemaValid };
}

export async function executeCompletion(
  manifest: BackendManifest,
  request: CompletionRequest,
  signal: AbortSignal,
  options: ExecutorOptions = {}
): Promise<ExecutionResult> {
  if (!isVdtSchemaId(request.schemaId)) throw Object.assign(new Error("Unknown schemaId."), { code: "UNKNOWN_SCHEMA" });
  if (signal.aborted) throw abortError();
  const prompt = JSON.stringify({
    requestId: request.requestId,
    taskType: request.taskType,
    schemaId: request.schemaId,
    input: request.input,
    ...(request.model ? { model: request.model } : {})
  });
  if (byteLength(prompt) > EXECUTION_LIMITS.maxPromptBytes) {
    throw Object.assign(new Error("Completion request exceeds the prompt limit."), { code: "PROMPT_TOO_LARGE" });
  }
  if (manifest.kind === "mock") {
    const output = request.schemaId === "connection-test-v1"
      ? { ok: true }
      : request.input;
    const schemaValid = validateRegisteredSchema(request.schemaId, output);
    if (!schemaValid) throw Object.assign(new Error("Mock input failed registered schema validation."), { code: "SCHEMA_INVALID" });
    return { output, outputBytes: byteLength(JSON.stringify(output)), schemaValid };
  }
  if (manifest.kind === "local_http") return executeLocalHttp(manifest, request, signal, options);
  return executeCli(manifest, request, signal, options);
}
