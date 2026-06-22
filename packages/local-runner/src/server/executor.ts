import { execFile, spawn as nodeSpawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "node:child_process";
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  assertArgsSafe,
  extractBoundedJson,
  getSubscriptionCliAdapter,
  getRegisteredJsonSchema,
  isVdtSchemaId,
  validateRegisteredSchema,
  type VdtSchemaId
} from "@vdt-studio/model-bridge";
import { wrapSandbox } from "../sandbox";
import type { BackendManifest, CompletionRequest } from "../cli/types";

const advisoryStub = Object.freeze({
  assumptions: [] as string[],
  questionsForUser: [] as string[],
  warnings: [] as Record<string, unknown>[]
});

const MOCK_STUB_OUTPUT: Record<VdtSchemaId, Record<string, unknown>> = {
  "connection-test-v1": { ok: true },
  "generate-tree-v1": { projectTitle: "Mock tree", rootNodeId: "root", nodes: [{}], edges: [], ...advisoryStub },
  "deepen-node-v1": { targetNodeId: "node-1", nodes: [{}], edges: [], ...advisoryStub },
  "simplify-branch-v1": { branchRootNodeId: "node-1", nodeRemovals: [], edgeChanges: [], rationale: "Mock", ...advisoryStub },
  "suggest-alternative-v1": { targetNodeId: "node-1", nodes: [{}], edges: [], rationale: "Mock", ...advisoryStub },
  "suggest-formula-v1": { nodeId: "node-1", proposedFormula: "1", aiRationale: "Mock", confidence: 0.5, ...advisoryStub },
  "review-model-v1": { findings: [], ...advisoryStub },
  "check-units-v1": { unitFindings: [], ...advisoryStub },
  "identify-missing-drivers-v1": { missingDrivers: [], ...advisoryStub },
  "identify-duplicate-drivers-v1": { duplicateClusters: [], ...advisoryStub },
  "explain-node-v1": { nodeId: "node-1", explanation: "Mock", keyDrivers: [], assumptions: [], questionsForUser: [] },
  "explain-scenario-v1": { scenarioId: "scenario-1", narrative: "Mock", impactHighlights: [], assumptions: [], questionsForUser: [] },
  "generate-executive-summary-v1": { headline: "Mock", keyDrivers: [], risks: [], recommendations: [] }
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mockOutput(schemaId: VdtSchemaId, input: unknown): Record<string, unknown> {
  if (isRecord(input) && validateRegisteredSchema(schemaId, input)) return input;
  return MOCK_STUB_OUTPUT[schemaId];
}

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
  "PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL", "LC_CTYPE", "NO_COLOR",
  "VDT_FAKE_CURSOR_MODE", "VDT_FAKE_CODEX_MODE", "VDT_FAKE_CLAUDE_MODE", "VDT_FAKE_GEMINI_MODE", "VDT_FAKE_COPILOT_MODE"
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
        if (!info.isSymbolicLink() && !info.isFile()) continue;
        const resolved = await realpath(candidate);
        if (!path.isAbsolute(resolved)) continue;
        const resolvedInfo = await lstat(resolved);
        if (!resolvedInfo.isFile()) continue;
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

function isOsSandboxAvailable(profile: NonNullable<BackendManifest["safety"]["sandboxProfile"]>): boolean {
  if (profile === "darwin-v1") return process.platform === "darwin";
  return false;
}

function isSandboxCertified(manifest: BackendManifest): boolean {
  const profile = manifest.safety.sandboxProfile;
  if (!manifest.safety.requiresOsSandbox || profile === undefined) return false;
  return isOsSandboxAvailable(profile);
}

function assertManifestSafe(manifest: BackendManifest): void {
  if (manifest.kind !== "subscription_cli" && manifest.kind !== "custom_cli") return;
  if (manifest.cli?.args) assertArgsSafe(manifest.cli.args, { allowScopedTrust: manifest.safety.trustEphemeralWorkspace === true });
  const { certified, toolsDisabled, requiresOsSandbox } = manifest.safety;
  const sandboxCertified = isSandboxCertified(manifest);
  if (!certified || (!toolsDisabled && !sandboxCertified) || (requiresOsSandbox && !sandboxCertified)) {
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

async function localizeSandboxScripts(
  args: readonly string[],
  cwd: string,
  allowedReadPaths: string[]
): Promise<string[]> {
  const localized = [...args];
  for (let index = 0; index < localized.length; index += 1) {
    const arg = localized[index];
    if (typeof arg !== "string" || !path.isAbsolute(arg) || !/\.(?:mjs|cjs|js)$/i.test(arg)) continue;
    if (arg === cwd || arg.startsWith(`${cwd}${path.sep}`)) continue;
    const localScript = path.join(cwd, `script-${index}-${path.basename(arg)}`);
    await copyFile(arg, localScript);
    await chmod(localScript, 0o700);
    localized[index] = localScript;
    allowedReadPaths.push(localScript);
  }
  return localized;
}

function buildSubscriptionPrompt(request: CompletionRequest): string {
  return [
    `Return only JSON matching approved schema ${request.schemaId} for VDT task ${request.taskType}.`,
    "Do not include markdown fences or commentary.",
    JSON.stringify({
      schemaId: request.schemaId,
      taskType: request.taskType,
      input: request.input,
      ...(request.model ? { model: request.model } : {})
    })
  ].join("\n");
}

function providerAuthReadPaths(backendId: string, home: string | undefined): string[] {
  if (!home || !path.isAbsolute(home)) return [];
  if (backendId === "cursor_subscription") {
    return [
      path.join(home, ".cursor"),
      path.join(home, ".cursor-agent"),
      path.join(home, "Library", "Application Support", "Cursor")
    ];
  }
  if (backendId === "gemini_subscription") return [path.join(home, ".gemini")];
  if (backendId === "copilot_subscription") {
    return [path.join(home, ".copilot"), path.join(home, ".config", "github-copilot")];
  }
  return [];
}

async function probeExecutableVersion(executable: string, versionArgs: readonly string[]): Promise<string | undefined> {
  try {
    const result = await promisify(execFile)(executable, [...versionArgs], {
      encoding: "utf8",
      timeout: 5_000,
      maxBuffer: 64 * 1024,
      windowsHide: true,
      shell: false
    });
    const combined = `${result.stdout}\n${result.stderr}`.trim();
    return combined || undefined;
  } catch {
    return undefined;
  }
}

async function executeCli(
  manifest: BackendManifest,
  request: CompletionRequest,
  signal: AbortSignal,
  options: ExecutorOptions
): Promise<ExecutionResult> {
  assertManifestSafe(manifest);
  const adapter = manifest.kind === "subscription_cli" ? getSubscriptionCliAdapter(manifest.id) : undefined;
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
  const requestPath = path.join(cwd, "request.json");
  await writeFile(requestPath, payload, { encoding: "utf8", mode: 0o600, flag: "wx" });

  const promptPath = path.join(cwd, "prompt.txt");
  const prompt = buildSubscriptionPrompt(request);
  if (byteLength(prompt) > EXECUTION_LIMITS.maxPromptBytes) {
    throw Object.assign(new Error("Completion request exceeds the prompt limit."), { code: "PROMPT_TOO_LARGE" });
  }
  await writeFile(promptPath, prompt, { encoding: "utf8", mode: 0o600, flag: "wx" });

  const schemaPath = path.join(cwd, "schema.json");
  await writeFile(schemaPath, `${JSON.stringify(getRegisteredJsonSchema(request.schemaId as VdtSchemaId), null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx"
  });
  const outputPath = path.join(cwd, "last-message.json");
  const toolPolicyPath = path.join(cwd, "deny-all-tools.toml");
  await writeFile(
    toolPolicyPath,
    '[[rule]]\ntoolName = "*"\ndecision = "deny"\npriority = 999\n',
    { encoding: "utf8", mode: 0o600, flag: "wx" }
  );
  const promptText = await readFile(promptPath, "utf8");

  const staticArgs = manifest.cli?.args ?? [];
  const dynamicArgs = adapter
    ? adapter.buildArgs({
        ...(request.model ? { model: request.model } : {}),
        promptPath,
        promptText,
        schemaPath,
        outputPath,
        toolPolicyPath
      })
    : [];
  let command = executable;
  let providerExecutable = executable;
  let spawnArgs = [...staticArgs, ...dynamicArgs];
  assertArgsSafe(spawnArgs, { allowScopedTrust: manifest.safety.trustEphemeralWorkspace === true });

  const allowedReadPaths = [path.dirname(executable), ...providerAuthReadPaths(manifest.id, envSource.HOME)];
  const sandboxCertified = isSandboxCertified(manifest);

  if (/\.(?:mjs|cjs|js)$/i.test(executable) && options.resolveExecutable !== undefined) {
    const localScript = path.join(cwd, path.basename(executable));
    await copyFile(executable, localScript);
    await chmod(localScript, 0o700);
    command = process.execPath;
    providerExecutable = process.execPath;
    spawnArgs = [localScript, ...spawnArgs];
  } else if (sandboxCertified) {
    spawnArgs = await localizeSandboxScripts(spawnArgs, cwd, allowedReadPaths);
  }

  let finalArgs = spawnArgs;
  if (sandboxCertified) {
    const wrapped = wrapSandbox(command, spawnArgs, {
      profile: {
        tempCwd: cwd,
        repoCwd: process.cwd(),
        providerExecutable,
        ...(envSource.HOME && path.isAbsolute(envSource.HOME) ? { homeDir: envSource.HOME } : {}),
        ...(allowedReadPaths.length > 0 ? { allowedReadPaths } : {})
      }
    });
    if (wrapped.diagnostic) {
      throw Object.assign(
        new Error(`${manifest.label} requires an OS sandbox that is unavailable on this platform.`),
        { code: "UNSAFE_CONFIGURATION" }
      );
    }
    command = wrapped.command;
    finalArgs = wrapped.args;
  }

  const executableVersion =
    manifest.cli?.versionArgs?.length && !/\.(?:mjs|cjs|js)$/i.test(executable)
      ? await probeExecutableVersion(executable, manifest.cli.versionArgs)
      : undefined;

  const childEnv = safeEnvironment(envSource);
  if (manifest.id === "cursor_subscription") {
    childEnv.CURSOR_CONFIG_DIR = path.join(cwd, "cursor-config");
    childEnv.NODE_COMPILE_CACHE = path.join(cwd, "node-compile-cache");
  }
  const child = (options.spawn ?? ((spawnCommand, args, spawnOptions) =>
    nodeSpawn(spawnCommand, [...args], spawnOptions) as ChildProcessWithoutNullStreams))(
    command,
    finalArgs,
    { cwd, env: childEnv, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }
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
    if (adapter) {
      if (adapter.spawnHints?.stdin === "prompt") {
        child.stdin.end(promptText);
      } else {
        child.stdin.end();
      }
    } else {
      child.stdin.end(payload);
    }
    const exitCode = await completion;
    if (cancelled) {
      if (byteLength(stdout) > EXECUTION_LIMITS.maxStdoutBytes || byteLength(stderr) > EXECUTION_LIMITS.maxStderrBytes) {
        throw Object.assign(new Error("Backend output exceeded the configured limit."), { code: "OUTPUT_TOO_LARGE" });
      }
      if (signal.aborted) throw abortError();
      throw Object.assign(new Error("Backend timed out."), { code: "TIMEOUT" });
    }
    if (exitCode !== 0) {
      if (adapter) {
        try {
          adapter.parseOutput(stdout, stderr, request.schemaId as VdtSchemaId);
        } catch (error) {
          throw error;
        }
      }
      throw Object.assign(new Error(`Backend exited with code ${exitCode}; stderr contained ${byteLength(stderr)} bytes.`), {
        code: "BACKEND_EXIT_FAILED",
        exitCode
      });
    }
    assertLineLimit(stdout);
    if (byteLength(stdout) > EXECUTION_LIMITS.maxResultBytes && !adapter) {
      throw Object.assign(new Error("Backend result exceeds the configured limit."), { code: "OUTPUT_TOO_LARGE" });
    }
    const output = adapter
      ? adapter.parseOutput(stdout, stderr, request.schemaId as VdtSchemaId)
      : extractBoundedJson(stdout, EXECUTION_LIMITS.maxResultBytes);
    const schemaValid = validateRegisteredSchema(request.schemaId as VdtSchemaId, output);
    if (!schemaValid) throw Object.assign(new Error("Backend output failed registered schema validation."), { code: "SCHEMA_INVALID" });
    return {
      output,
      rawText: stdout,
      outputBytes: byteLength(stdout),
      schemaValid,
      exitCode,
      ...(executableVersion === undefined ? {} : { executableVersion })
    };
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
    const output = mockOutput(request.schemaId, request.input);
    const schemaValid = validateRegisteredSchema(request.schemaId, output);
    if (!schemaValid) throw Object.assign(new Error("Mock input failed registered schema validation."), { code: "SCHEMA_INVALID" });
    return { output, outputBytes: byteLength(JSON.stringify(output)), schemaValid };
  }
  if (manifest.kind === "local_http") return executeLocalHttp(manifest, request, signal, options);
  return executeCli(manifest, request, signal, options);
}
