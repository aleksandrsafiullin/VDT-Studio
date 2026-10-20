import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { KPI_SUGGESTION_LIMITS as limits, KPI_SUGGESTION_MODEL_JSON_SCHEMA, SMART_KPI_INSTRUCTION,
  validateKpiSuggestionModelOutput, validateKpiSuggestionTaskInput } from "@vdt-studio/vdt-core";
import { selectSmartCodexExecutable, readCodexSmartDefaultModel, SMART_CODEX_DISABLED_FEATURES } from "@vdt-studio/model-bridge/node";
import type { BackendManifest, CompletionRequest } from "../cli/types";
import type { ExecutionResult, ExecutorOptions } from "./executor";

const fail = (code: string, message: string) => Object.assign(new Error(message), { code });
const bytes = (v: string) => Buffer.byteLength(v, "utf8");
const abortError = () => Object.assign(new Error("Smart suggestion preparation was cancelled."), { code: "CANCELLED", name: "AbortError" });

/** We own the HTTP operation/reader, not the remote model server. An ignored
 * AbortSignal cannot release a preparation lane while that operation is live. */
async function awaitHttpSettlement<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  let timer: NodeJS.Timeout | undefined, abort = () => {};
  const unknown = new Promise<never>((_, reject) => {
    abort = () => { timer ??= setTimeout(() => reject(fail("CLEANUP_UNCONFIRMED", "Smart HTTP request closure could not be confirmed.")), 1_250); };
  });
  signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort();
  try { return await Promise.race([operation, unknown]); }
  finally { if (timer) clearTimeout(timer); signal.removeEventListener("abort", abort); }
}

/** Bound reads and even non-cooperative fake transports; late results never win. */
export async function readSmartResponse(response: Response, signal: AbortSignal, maxBytes = 64 * 1024): Promise<unknown> {
  if (Number(response.headers.get("content-length")) > maxBytes) { if (response.body) await awaitHttpSettlement(response.body.cancel(), AbortSignal.abort()); throw fail("OUTPUT_TOO_LARGE", "Smart response envelope exceeds its bound."); }
  const reader = response.body?.getReader();
  if (!reader) throw fail("INVALID_RESPONSE", "Smart provider returned no response body.");
  let rejectAbort: (reason: unknown) => void = () => {};
  const interrupted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  let closure: Promise<void> | undefined;
  const abort = () => {
    closure ??= awaitHttpSettlement(reader.cancel(), AbortSignal.abort());
    void closure.then(() => rejectAbort(abortError()), rejectAbort);
  };
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  let size = 0, text = "", reachedEof = false; const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    while (true) {
      const next = await Promise.race([reader.read(), interrupted]); if (next.done) { reachedEof = true; break; }
      size += next.value.byteLength; if (size > maxBytes) { closure ??= awaitHttpSettlement(reader.cancel(), AbortSignal.abort()); await closure; throw fail("OUTPUT_TOO_LARGE", "Smart response envelope exceeds its bound."); }
      text += decoder.decode(next.value, { stream: true });
    }
    if (closure) { await closure; throw abortError(); }
    text += decoder.decode(); return JSON.parse(text);
  } finally {
    signal.removeEventListener("abort", abort);
    // Malformed UTF-8/read failures are also early exits from a live body.
    if (!reachedEof) closure ??= awaitHttpSettlement(reader.cancel(), AbortSignal.abort());
    if (closure) await closure;
    try { reader.releaseLock(); } catch { /* cancelled pending read */ }
  }
}

async function fetchSmart(fetcher: typeof fetch, url: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
  signal.throwIfAborted();
  return awaitHttpSettlement(fetcher(url, { ...init, signal, redirect: "error" }), signal);
}

export function parseSmartCodexOutput(stdout: string): unknown {
  if (bytes(stdout) > 64 * 1024) throw fail("OUTPUT_TOO_LARGE", "Smart CLI stream exceeds its bound.");
  try { const direct = JSON.parse(stdout); return validateKpiSuggestionModelOutput(direct); } catch { /* Require the closed event vocabulary below. */ }
  let text: string | undefined, started = 0, completed = 0;
  for (const line of stdout.split(/\r?\n/).filter(v => v.trim())) {
    let event: Record<string, unknown>;
    try { event = JSON.parse(line); } catch { throw fail("INVALID_RESPONSE", "Smart CLI returned an invalid event."); }
    if (event.type === "thread.started") continue;
    if (event.type === "turn.started") { if (++started > 1) throw fail("TOOL_ACTIVITY_REJECTED", "Smart CLI attempted more than one turn."); continue; }
    if (event.type === "turn.completed") { if (++completed > 1) throw fail("TOOL_ACTIVITY_REJECTED", "Smart CLI attempted more than one turn."); continue; }
    if (event.type === "turn.failed" || event.type === "error") throw fail("BACKEND_FAILED", "Smart CLI completion failed.");
    if (["item.started", "item.updated", "item.completed"].includes(String(event.type)) && event.item && typeof event.item === "object") {
      const item = event.item as Record<string, unknown>;
      if (!["agent_message", "assistant_message", "reasoning"].includes(String(item.type))) throw fail("TOOL_ACTIVITY_REJECTED", "Smart CLI reported tool or filesystem activity.");
      if (event.type === "item.completed" && item.type !== "reasoning" && typeof item.text === "string") text = item.text;
      continue;
    }
    throw fail("TOOL_ACTIVITY_REJECTED", "Smart CLI reported an unknown or unauthorized event.");
  }
  if (!text || completed !== 1) throw fail("INVALID_RESPONSE", "Smart CLI returned no completed structured assistant output.");
  return validateKpiSuggestionModelOutput(JSON.parse(text));
}

async function localCompletion(manifest: BackendManifest, model: string, prompt: string, signal: AbortSignal, options: ExecutorOptions): Promise<unknown> {
  const base = manifest.localHttp!.baseUrl.replace(/\/$/, ""), native = manifest.id === "ollama";
  const body = native ? { model, stream: false, think: false, format: KPI_SUGGESTION_MODEL_JSON_SCHEMA,
    options: { num_predict: limits.outputTokens, num_ctx: 8192 }, messages: [{ role: "system", content: SMART_KPI_INSTRUCTION }, { role: "user", content: prompt }] }
    : { model, max_tokens: limits.outputTokens, temperature: 0, response_format: { type: "json_schema", json_schema: { name: "smart_kpi", strict: true, schema: KPI_SUGGESTION_MODEL_JSON_SCHEMA } },
      messages: [{ role: "system", content: SMART_KPI_INSTRUCTION }, { role: "user", content: prompt }] };
  const serialized = JSON.stringify(body);
  if (bytes(serialized) > limits.inputBytes) throw fail("INPUT_TOO_LARGE", "Final Smart provider envelope exceeds 24 KiB.");
  const response = await fetchSmart(options.fetch ?? fetch, native ? `${base.replace(/\/v1$/, "")}/api/chat` : `${base}/chat/completions`,
    { method: "POST", headers: { "content-type": "application/json" }, body: serialized }, signal);
  const payload = await readSmartResponse(response, signal) as { message?: { content?: string; tool_calls?: unknown[] }; done?: boolean; done_reason?: string; choices?: Array<{ message?: { content?: string; tool_calls?: unknown[]; function_call?: unknown; refusal?: unknown }; finish_reason?: string }> };
  if (!response.ok) throw fail("BACKEND_FAILED", `Smart local provider failed with status ${response.status}.`);
  const message = native ? payload.message : payload.choices?.[0]?.message;
  if (message?.tool_calls?.length) throw fail("TOOL_ACTIVITY_REJECTED", "Smart provider returned a tool call.");
  if (payload.done_reason === "length" || payload.choices?.[0]?.finish_reason === "length") throw fail("OUTPUT_TOO_LARGE", "Smart completion exhausted its token budget.");
  if (native ? payload.done !== true || payload.done_reason !== "stop" : payload.choices?.length !== 1 || payload.choices[0]?.finish_reason !== "stop" || payload.choices[0].message?.function_call || payload.choices[0].message?.refusal) throw fail("INVALID_RESPONSE", "Smart local provider did not acknowledge a completed tool-free response.");
  if (typeof message?.content !== "string" || bytes(message.content) > limits.outputBytes) throw fail("OUTPUT_TOO_LARGE", "Smart output is missing or exceeds 16 KiB.");
  return validateKpiSuggestionModelOutput(JSON.parse(message.content));
}

async function cliCompletion(manifest: BackendManifest, model: string, prompt: string, signal: AbortSignal, options: ExecutorOptions): Promise<unknown> {
  const source = options.env ?? process.env;
  const selectedModel = model === "auto" ? await readCodexSmartDefaultModel(source) : model;
  const probeEnv: NodeJS.ProcessEnv = { NODE_ENV: source.NODE_ENV ?? "production", ...Object.fromEntries(["PATH", "HOME", "USER", "TMPDIR", "LANG"].flatMap(k => source[k] ? [[k, source[k]!]] : [])) };
  const selected = options.resolveExecutable ? await options.resolveExecutable(manifest, source) : (await selectSmartCodexExecutable(source, signal))?.executable;
  signal.throwIfAborted(); if (!selected) throw fail("BACKEND_NOT_INSTALLED", "Selected Codex CLI is unavailable.");
  const executable = await realpath(selected);
  if (!path.isAbsolute(executable) || executable.startsWith(`${path.resolve(process.cwd())}${path.sep}`)) throw fail("UNSAFE_EXECUTABLE", "Smart CLI executable must be host-owned outside the workspace.");
  const tempRoot = options.tempRoot ?? os.tmpdir(); await mkdir(tempRoot, { recursive: true });
  const cwd = await mkdtemp(path.join(tempRoot, "vdt-smart-")); await chmod(cwd, 0o700);
  let child: ChildProcessWithoutNullStreams | undefined, retained = false;
  try {
    const home = path.join(cwd, "codex-home"); await mkdir(home, { mode: 0o700 });
    // Only credential/catalog artifacts; never user config, hooks, MCP or rules.
    const authRoot = source.CODEX_HOME ?? (source.HOME ? path.join(source.HOME, ".codex") : undefined);
    if (authRoot) for (const name of ["auth.json", "installation_id", "models_cache.json"]) {
      try { await copyFile(path.join(authRoot, name), path.join(home, name)); await chmod(path.join(home, name), 0o600); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    }
    const schemaPath = path.join(cwd, "schema.json"); await writeFile(schemaPath, JSON.stringify(KPI_SUGGESTION_MODEL_JSON_SCHEMA), { mode: 0o600, flag: "wx" });
    const args = ["exec", "--strict-config", "--ephemeral", "--json", "--color", "never", "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules", "--sandbox", "read-only",
      ...SMART_CODEX_DISABLED_FEATURES.flatMap(feature => ["--disable", feature]), "-c", 'web_search="disabled"', "-c", "tools.update_plan.enabled=false", "-c", "tools.experimental_request_user_input.enabled=false",
      "-c", "sandbox_workspace_write.network_access=false", "--output-schema", schemaPath, ...(selectedModel ? ["--model", selectedModel] : []), "-C", cwd, "-"];
    signal.throwIfAborted();
    const js = /\.(?:cjs|mjs|js)$/.test(executable);
    child = (options.spawn ?? ((file, argv, config) => spawn(file, [...argv], config)))(js ? process.execPath : executable, js ? [executable, ...args] : args,
      { cwd, env: { ...probeEnv, HOME: cwd, CODEX_HOME: home }, shell: false, detached: process.platform !== "win32", windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }) as ChildProcessWithoutNullStreams;
    const running = child; let stdout = "", stdoutBytes = 0, stderr = 0, failure: Error | undefined, killTimer: NodeJS.Timeout | undefined, cleanupTimer: NodeJS.Timeout | undefined;
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const kill = (sig: NodeJS.Signals) => { if (!running.pid) return; try { if (process.platform !== "win32") process.kill(-running.pid, sig); else running.kill(sig); } catch { /* already exited */ } };
    let rejectCleanup: (error: Error) => void = () => {};
    const stop = () => {
      kill("SIGTERM"); killTimer ??= setTimeout(() => kill("SIGKILL"), 250);
      cleanupTimer ??= setTimeout(() => {
        retained = true; running.stdin.destroy(); running.stdout.destroy(); running.stderr.destroy(); running.unref();
        rejectCleanup(Object.assign(fail("CLEANUP_UNCONFIRMED", "Smart CLI cleanup could not be confirmed; execution is quarantined."), { retainedDirectory: cwd }));
      }, 1_250);
    };
    const abort = () => { failure ??= abortError(); stop(); }; signal.addEventListener("abort", abort, { once: true });
    try {
      await new Promise<void>((resolve, reject) => {
        rejectCleanup = reject;
        running.on("error", error => { failure = error; stop(); });
        running.stdin.on("error", error => { if (!["EPIPE", "ERR_STREAM_DESTROYED"].includes((error as NodeJS.ErrnoException).code ?? "")) { failure = error; stop(); } });
        running.stdout.on("data", (chunk: Buffer) => {
          stdoutBytes += chunk.byteLength;
          if (stdoutBytes > 64 * 1024) { failure = fail("OUTPUT_TOO_LARGE", "Smart CLI output exceeded its bound."); stop(); return; }
          try { stdout += decoder.decode(chunk, { stream: true }); }
          catch { failure = fail("INVALID_RESPONSE", "Smart CLI returned malformed UTF-8."); stop(); return; }
          // Reject reported tools immediately, before a later assistant result.
          for (const line of stdout.split(/\r?\n/).slice(0, -1)) {
            try { const e = JSON.parse(line); if (String(e.type).startsWith("item.") && e.item && !["agent_message", "assistant_message", "reasoning"].includes(e.item.type)) { failure = fail("TOOL_ACTIVITY_REJECTED", "Smart CLI reported tool activity."); stop(); } } catch { /* final parser handles malformed frames */ }
          }
        });
        running.stderr.on("data", (chunk: Buffer) => { stderr += chunk.byteLength; if (stderr > 8192) { failure = fail("OUTPUT_TOO_LARGE", "Smart CLI stderr exceeded its bound."); stop(); } });
        running.once("close", code => {
          if (cleanupTimer) clearTimeout(cleanupTimer); kill("SIGKILL");
          if (!failure) { try { stdout += decoder.decode(); } catch { failure = fail("INVALID_RESPONSE", "Smart CLI returned malformed UTF-8."); } }
          if (failure) reject(failure); else if (code !== 0) reject(fail("BACKEND_FAILED", "Smart CLI completion failed.")); else resolve();
        });
        if (signal.aborted) abort(); running.stdin.end(prompt);
      });
      return parseSmartCodexOutput(stdout);
    } finally { signal.removeEventListener("abort", abort); if (killTimer) clearTimeout(killTimer); if (cleanupTimer) clearTimeout(cleanupTimer); }
  } finally {
    // Spawn/stream promise above settles only after close; this run owns cwd.
    if (!retained) await rm(cwd, { recursive: true, force: true });
  }
}

export async function executeSmartSuggestion(manifest: BackendManifest, request: CompletionRequest, caller: AbortSignal, options: ExecutorOptions): Promise<ExecutionResult> {
  const controller = new AbortController(), abort = () => controller.abort();
  caller.addEventListener("abort", abort, { once: true }); if (caller.aborted) abort();
  const duration = Math.min(request.timeoutMs ?? Infinity, manifest.kind === "local_http" ? limits.apiTimeoutMs : limits.cliTimeoutMs);
  let timedOut = false; const timer = setTimeout(() => { timedOut = true; controller.abort(); }, duration);
  try {
    const wrapped = request.input && typeof request.input === "object" && "data" in request.input ? (request.input as { data: unknown }).data : request.input;
    const input = validateKpiSuggestionTaskInput(wrapped);
    const prompt = `${SMART_KPI_INSTRUCTION}\nResponse budget: at most ${limits.outputTokens} tokens.\n${JSON.stringify({ input, schema: KPI_SUGGESTION_MODEL_JSON_SCHEMA })}`;
    if (bytes(JSON.stringify(request)) > limits.inputBytes || bytes(prompt) > limits.inputBytes) throw fail("INPUT_TOO_LARGE", "Final Smart runner envelope exceeds 24 KiB.");
    if (manifest.kind !== "mock" && (!request.model || request.model.startsWith("-") || /[\x00-\x20]/.test(request.model))) throw fail("SUGGESTIONS_UNAVAILABLE", "An explicit host-selected model is required for Smart suggestions.");
    let output: unknown;
    if (manifest.kind === "mock") output = { status: "empty", rationale: "Deterministic empty suggestion fixture.", limitations: [], groups: [] };
    else if (manifest.kind === "local_http" && manifest.localHttp) output = await localCompletion(manifest, request.model!, JSON.stringify(input), controller.signal, options);
    else if (manifest.id === "codex_subscription") output = await cliCompletion(manifest, request.model!, prompt, controller.signal, options);
    else throw fail("SUGGESTIONS_UNAVAILABLE", "This adapter has no reviewed one-call Smart suggestion policy.");
    controller.signal.throwIfAborted(); validateKpiSuggestionModelOutput(output);
    return { output, outputBytes: bytes(JSON.stringify(output)), schemaValid: true, repaired: false };
  } catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "CLEANUP_UNCONFIRMED") throw error; if (timedOut) throw fail("TIMEOUT", "Smart suggestion preparation timed out."); if (caller.aborted) throw abortError(); throw error; }
  finally { clearTimeout(timer); caller.removeEventListener("abort", abort); }
}
