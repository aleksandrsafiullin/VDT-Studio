import { localHttpFetch } from "./local-http-admission";
import type { LocalHttpSelection } from "@vdt-studio/model-bridge";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CHAT_STARTER_INSTRUCTION, CHAT_STARTER_LIMITS, CHAT_STARTER_OUTPUT_SCHEMA, chatStarterTimeoutMs, validateChatStarterInput, validateChatStarterOutput } from "@vdt-studio/vdt-core";
import { assertKpiSuggestionSkillIntegrity, KPI_SUGGESTION_LIMITS as limits, KPI_SUGGESTION_MODEL_JSON_SCHEMA, SMART_KPI_INSTRUCTION, kpiSuggestionPromptInput,
  validateKpiSuggestionModelOutput, validateKpiSuggestionTaskInput } from "@vdt-studio/vdt-core";
import { selectSmartCodexExecutable, readCodexSmartDefaultModel, readCodexSmartReasoningValues, SMART_CODEX_DISABLED_FEATURES, SMART_CODEX_CODE_MODE_CONFIG } from "@vdt-studio/model-bridge/local-runtime";
import { FAST_LOCAL_REASONING, isCheckpointReasoningEffort, parseLocalModelReasoningCapabilities, resolveLocalReasoning, type LocalModelReasoningCapabilities } from "@vdt-studio/model-bridge";
import type { BackendManifest, CompletionRequest } from "../cli/types";
import type { ExecutionResult, ExecutorOptions } from "./executor";
import { executeCli } from "./executor";
import { executeHarnessCompletion } from "./harness-completion";

const fail = (code: string, message: string) => Object.assign(new Error(message), { code });
const bytes = (v: string) => Buffer.byteLength(v, "utf8");
const abortError = () => Object.assign(new Error("Smart suggestion preparation was cancelled."), { code: "CANCELLED", name: "AbortError" });
const codexItemError = (item: Record<string, unknown>) => /reasoning|thinking|effort/i.test(String(item.message ?? ""))
  ? fail("REASONING_UNSUPPORTED", "The selected model rejected the requested reasoning setting. Choose a supported level or Provider default.")
  : /Code Mode is unavailable because code-mode host is disabled/i.test(String(item.message ?? ""))
  ? fail("SUGGESTIONS_UNAVAILABLE", "The selected Codex model requires Code Mode, which is disabled for read-only Suggested KPI. Select a compatible model.")
  : fail("BACKEND_FAILED", "Smart CLI reported a provider/configuration error.");

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

export function parseSmartCodexOutput(stdout: string, reasoningDisabled = false, validate: (value: unknown) => unknown = validateKpiSuggestionModelOutput): unknown {
  if (bytes(stdout) > 64 * 1024) throw fail("OUTPUT_TOO_LARGE", "Smart CLI stream exceeds its bound.");
  try { const direct = JSON.parse(stdout); return validate(direct); } catch { /* Require the closed event vocabulary below. */ }
  let text: string | undefined, started = 0, completed = 0;
  for (const line of stdout.split(/\r?\n/).filter(v => v.trim())) {
    let event: Record<string, unknown>;
    try { event = JSON.parse(line); } catch { throw fail("INVALID_RESPONSE", "Smart CLI returned an invalid event."); }
    if (event.type === "thread.started") continue;
    if (event.type === "turn.started") { if (++started > 1) throw fail("TOOL_ACTIVITY_REJECTED", "Smart CLI attempted more than one turn."); continue; }
    if (event.type === "turn.completed") { if (++completed > 1) throw fail("TOOL_ACTIVITY_REJECTED", "Smart CLI attempted more than one turn."); continue; }
    if (event.type === "turn.failed" || event.type === "error") {
      const detail = event.error && typeof event.error === "object" ? event.error as Record<string, unknown> : event;
      throw codexItemError(detail);
    }
    if (["item.started", "item.updated", "item.completed"].includes(String(event.type)) && event.item && typeof event.item === "object") {
      const item = event.item as Record<string, unknown>;
      if (item.type === "error") throw codexItemError(item);
      if (reasoningDisabled && item.type === "reasoning") throw fail("REASONING_UNSUPPORTED", "The provider returned reasoning despite the disabled setting.");
      if (!["agent_message", "assistant_message", "reasoning"].includes(String(item.type))) throw fail("TOOL_ACTIVITY_REJECTED", "Smart CLI reported tool or filesystem activity.");
      if (event.type === "item.completed" && item.type !== "reasoning" && typeof item.text === "string") text = item.text;
      continue;
    }
    throw fail("TOOL_ACTIVITY_REJECTED", "Smart CLI reported an unknown or unauthorized event.");
  }
  if (!text || completed !== 1) throw fail("INVALID_RESPONSE", "Smart CLI returned no completed structured assistant output.");
  return validate(JSON.parse(text));
}

export async function readLocalSmartReasoningCapabilities(manifest: BackendManifest, model: string, signal: AbortSignal, options: ExecutorOptions = {}, selection?: LocalHttpSelection, task = "suggest_incoming_kpis", allowMissing = false): Promise<LocalModelReasoningCapabilities | undefined> {
  if (!manifest.localHttp || !["ollama", "lm_studio", "vllm"].includes(manifest.id)) throw fail("SUGGESTIONS_UNAVAILABLE", "The selected host has no reviewed local-model metadata source.");
  if (!model || model.length > 160 || model.startsWith("-") || /[\x00-\x20]/.test(model)) throw fail("INVALID_MODEL", "An explicit bounded model ID is required.");
  const base = manifest.localHttp.baseUrl.replace(/\/$/, ""), native = manifest.id === "ollama";
  const response = await fetchSmart(localHttpFetch(manifest, task, model, options, selection), native ? `${base.replace(/\/v1$/, "")}/api/show` : `${base}/models/${encodeURIComponent(model)}`,
    native ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model }) } : { method: "GET" }, signal);
  if (!response.ok) {
    if (response.body) await awaitHttpSettlement(response.body.cancel(), AbortSignal.abort());
    if (allowMissing && [404, 405].includes(response.status)) return undefined;
    throw fail("REASONING_UNSUPPORTED", "The selected local server did not expose model reasoning capabilities.");
  }
  return parseLocalModelReasoningCapabilities(await readSmartResponse(response, signal), manifest.id);
}

const kpiCompletionContract = {
  instruction: SMART_KPI_INSTRUCTION,
  schema: KPI_SUGGESTION_MODEL_JSON_SCHEMA as Record<string, unknown>,
  schemaName: "smart_kpi",
  outputTokens: Number(limits.outputTokens),
  validate: validateKpiSuggestionModelOutput as (value: unknown) => unknown
};

const starterCompletionContract: typeof kpiCompletionContract = {
  instruction: CHAT_STARTER_INSTRUCTION,
  schema: CHAT_STARTER_OUTPUT_SCHEMA,
  schemaName: "chat_starters",
  outputTokens: CHAT_STARTER_LIMITS.outputTokens,
  validate: validateChatStarterOutput
};

async function localCompletion(manifest: BackendManifest, model: string, prompt: string, signal: AbortSignal, options: ExecutorOptions, modelReasoning: CompletionRequest["modelReasoning"], hasSelectedSkill = false, contract = kpiCompletionContract, selection?: LocalHttpSelection): Promise<unknown> {
  const base = manifest.localHttp!.baseUrl.replace(/\/$/, ""), native = manifest.id === "ollama";
  const task = contract === starterCompletionContract ? "suggest_chat_starters" : "suggest_incoming_kpis";
  const fetcher = localHttpFetch(manifest, task, model, options, selection);
  let reasoning: Record<string, unknown> = native && contract === starterCompletionContract ? { think: false } : {};
  if (modelReasoning !== undefined) {
    const capabilities = await readLocalSmartReasoningCapabilities(manifest, model, signal, options, selection, task, modelReasoning === FAST_LOCAL_REASONING);
    const effective = resolveLocalReasoning(capabilities, modelReasoning);
    if (!effective.supported) throw fail("REASONING_UNSUPPORTED", "The selected local model does not advertise this reasoning setting. Choose Provider default.");
    if (effective.value !== undefined && (native || effective.value !== false)) {
      reasoning = native ? { think: effective.value } : { reasoning_effort: effective.value };
    }
  }
  const body = native ? { model, stream: false, ...reasoning, format: contract.schema,
    options: { num_predict: contract.outputTokens, num_ctx: hasSelectedSkill ? 32768 : 8192 }, messages: [{ role: "system", content: contract.instruction }, { role: "user", content: prompt }] }
    : { model, ...reasoning, ...(reasoning.reasoning_effort === undefined ? { max_tokens: contract.outputTokens, temperature: 0 } : { max_completion_tokens: contract.outputTokens }), response_format: { type: "json_schema", json_schema: { name: contract.schemaName, strict: true, schema: contract.schema } },
      messages: [{ role: "system", content: contract.instruction }, { role: "user", content: prompt }] };
  const serialized = JSON.stringify(body);
  if (bytes(serialized) > limits.inputBytes) throw fail("INPUT_TOO_LARGE", "Final Smart provider envelope exceeds its bounded input allowance.");
  const response = await fetchSmart(fetcher, native ? `${base.replace(/\/v1$/, "")}/api/chat` : `${base}/chat/completions`,
    { method: "POST", headers: { "content-type": "application/json" }, body: serialized }, signal);
  const payload = await readSmartResponse(response, signal) as { error?: string; message?: { content?: string; thinking?: string; reasoning_content?: string; tool_calls?: unknown[] }; done?: boolean; done_reason?: string; choices?: Array<{ message?: { content?: string; thinking?: string; reasoning_content?: string; tool_calls?: unknown[]; function_call?: unknown; refusal?: unknown }; finish_reason?: string }> };
  if (!response.ok) {
    if (response.status === 400 && modelReasoning !== undefined && typeof payload.error === "string" && /think|reasoning|effort/i.test(payload.error) && /support|invalid|disable/i.test(payload.error)) throw fail("REASONING_UNSUPPORTED", "The local provider rejected the selected reasoning setting.");
    throw fail("BACKEND_FAILED", `Smart local provider failed with status ${response.status}.`);
  }
  const message = native ? payload.message : payload.choices?.[0]?.message;
  if ((modelReasoning === false || reasoning.think === false) && (message?.thinking?.trim() || message?.reasoning_content?.trim())) throw fail("REASONING_UNSUPPORTED", "The local provider returned reasoning despite the disabled setting.");
  if (message?.tool_calls?.length) throw fail("TOOL_ACTIVITY_REJECTED", "Smart provider returned a tool call.");
  if (payload.done_reason === "length" || payload.choices?.[0]?.finish_reason === "length") throw fail("OUTPUT_TOO_LARGE", "Smart completion exhausted its token budget.");
  if (native ? payload.done !== true || payload.done_reason !== "stop" : payload.choices?.length !== 1 || payload.choices[0]?.finish_reason !== "stop" || payload.choices[0].message?.function_call || payload.choices[0].message?.refusal) throw fail("INVALID_RESPONSE", "Smart local provider did not acknowledge a completed tool-free response.");
  if (typeof message?.content !== "string" || bytes(message.content) > limits.outputBytes) throw fail("OUTPUT_TOO_LARGE", "Smart output is missing or exceeds 16 KiB.");
  return contract.validate(JSON.parse(message.content));
}

async function cliCompletion(manifest: BackendManifest, model: string, prompt: string, signal: AbortSignal, options: ExecutorOptions, modelReasoning: CompletionRequest["modelReasoning"], contract = kpiCompletionContract): Promise<unknown> {
  const source = options.env ?? process.env;
  const starter = contract === starterCompletionContract;
  const selectedModel = model === "auto" ? await readCodexSmartDefaultModel(source) : model;
  const advertised = modelReasoning !== undefined || starter
    ? await readCodexSmartReasoningValues(source, selectedModel) : [];
  const selectedReasoning = starter
    ? ([false, "minimal", "low"] as const).find(value => advertised.includes(value))
    : modelReasoning;
  const effort = selectedReasoning === false ? "none" : selectedReasoning;
  if (effort !== undefined && !isCheckpointReasoningEffort(effort)) throw fail("REASONING_UNSUPPORTED", "Unsupported Codex reasoning setting.");
  if (modelReasoning !== undefined && !advertised.includes(modelReasoning === "none" ? false : modelReasoning)) throw fail("REASONING_UNSUPPORTED", "The selected Codex model does not advertise this reasoning setting. Refresh its model catalog or choose Provider default.");
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
    const schemaPath = path.join(cwd, "schema.json"); await writeFile(schemaPath, JSON.stringify(contract.schema), { mode: 0o600, flag: "wx" });
    const starterArgs: string[] = [];
    if (starter) {
      const instructionsPath = path.join(cwd, "instructions.txt");
      await writeFile(instructionsPath, contract.instruction, { mode: 0o600, flag: "wx" });
      starterArgs.push("-c", `model_instructions_file=${JSON.stringify(instructionsPath)}`);
    }
    const args = ["exec", "--strict-config", "--ephemeral", "--json", "--color", "never", "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules", "--sandbox", "read-only",
      ...SMART_CODEX_DISABLED_FEATURES.flatMap(feature => ["--disable", feature]), ...SMART_CODEX_CODE_MODE_CONFIG.flatMap(config => ["-c", config]), "-c", 'web_search="disabled"', "-c", "tools.update_plan.enabled=false", "-c", "tools.experimental_request_user_input.enabled=false",
      "-c", "sandbox_workspace_write.network_access=false", ...(effort === undefined ? [] : ["-c", `model_reasoning_effort=${JSON.stringify(effort)}`]), ...starterArgs, "--output-schema", schemaPath, ...(selectedModel ? ["--model", selectedModel] : []), "-C", cwd, "-"];
    signal.throwIfAborted();
    const js = /\.(?:cjs|mjs|js)$/.test(executable);
    child = (options.spawn ?? ((file, argv, config) => spawn(file, [...argv], config)))(js ? process.execPath : executable, js ? [executable, ...args] : args,
      { cwd, env: { ...probeEnv, HOME: cwd, CODEX_HOME: home }, shell: false, detached: process.platform !== "win32", windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }) as ChildProcessWithoutNullStreams;
    const running = child; let stdout = "", stdoutBytes = 0, stderr = 0, failure: Error | undefined, killTimer: NodeJS.Timeout | undefined, cleanupTimer: NodeJS.Timeout | undefined;
    let stoppedAfterStarter = false;
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
          let terminal = false;
          for (const line of stdout.split(/\r?\n/).slice(0, -1)) {
            try {
              const event = JSON.parse(line);
              if (String(event.type).startsWith("item.") && event.item && !["agent_message", "assistant_message", "reasoning"].includes(event.item.type)) {
                failure = event.item.type === "error" ? codexItemError(event.item) : fail("TOOL_ACTIVITY_REJECTED", "Smart CLI reported tool activity.");
                stop();
                return;
              }
              if (event.type === "turn.completed") terminal = true;
            } catch { /* final parser handles malformed frames */ }
          }
          if (starter && terminal && !failure && !stoppedAfterStarter && process.platform !== "win32" && running.pid) {
            // The one allowed turn is done. End the owned group and still wait
            // for close so that the next task never overlaps its cleanup.
            try {
              parseSmartCodexOutput(stdout.slice(0, stdout.lastIndexOf("\n") + 1), effort === "none", contract.validate);
              stoppedAfterStarter = true;
            } catch (error) {
              failure = error instanceof Error ? error : fail("INVALID_RESPONSE", "Invalid chat starter response.");
            }
            stop();
          }
        });
        running.stderr.on("data", (chunk: Buffer) => { stderr += chunk.byteLength; if (stderr > 8192) { failure = fail("OUTPUT_TOO_LARGE", "Smart CLI stderr exceeded its bound."); stop(); } });
        running.once("close", (code, exitSignal) => {
          if (cleanupTimer) clearTimeout(cleanupTimer); kill("SIGKILL");
          if (!failure) { try { stdout += decoder.decode(); } catch { failure = fail("INVALID_RESPONSE", "Smart CLI returned malformed UTF-8."); } }
          const plannedStop = stoppedAfterStarter && (exitSignal === "SIGTERM" || exitSignal === "SIGKILL");
          if (failure) reject(failure); else if (code !== 0 && !plannedStop) reject(fail("BACKEND_FAILED", "Smart CLI completion failed.")); else resolve();
        });
        if (signal.aborted) abort(); running.stdin.end(prompt);
      });
      return parseSmartCodexOutput(stdout, effort === "none", contract.validate);
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
    await assertKpiSuggestionSkillIntegrity(input.context);
    const modelInput = kpiSuggestionPromptInput(input);
    const prompt = `${SMART_KPI_INSTRUCTION}\nResponse budget: at most ${limits.outputTokens} tokens.\n${JSON.stringify({ input: modelInput, schema: KPI_SUGGESTION_MODEL_JSON_SCHEMA })}`;
    if (bytes(JSON.stringify(request)) > limits.inputBytes || bytes(prompt) > limits.inputBytes) throw fail("INPUT_TOO_LARGE", "Final Smart runner envelope exceeds its bounded input allowance.");
    if (manifest.kind !== "mock" && (!request.model || request.model.startsWith("-") || /[\x00-\x20]/.test(request.model))) throw fail("SUGGESTIONS_UNAVAILABLE", "An explicit host-selected model is required for Smart suggestions.");
    let output: unknown;
    if (manifest.kind === "mock") output = { status: "empty", rationale: "Deterministic empty suggestion fixture.", limitations: [], groups: [] };
    else if (manifest.kind === "local_http" && manifest.localHttp) output = await localCompletion(manifest, request.model!, JSON.stringify(modelInput), controller.signal, options, request.modelReasoning, Boolean(input.context.selectedSkill), kpiCompletionContract, request.localHttpSelection);
    else if (manifest.id === "codex_subscription") output = await cliCompletion(manifest, request.model!, prompt, controller.signal, options, request.modelReasoning);
    else if (manifest.harness?.transport !== "native" && manifest.harness) output = (await executeHarnessCompletion(manifest, { ...request, input: modelInput }, controller.signal, options)).output;
    else if (manifest.kind === "subscription_cli") output = (await executeCli(manifest, { ...request, input: modelInput }, controller.signal, options)).output;
    else throw fail("SUGGESTIONS_UNAVAILABLE", "This adapter has no reviewed one-call Smart suggestion policy.");
    controller.signal.throwIfAborted(); validateKpiSuggestionModelOutput(output);
    return { output, outputBytes: bytes(JSON.stringify(output)), schemaValid: true, repaired: false };
  } catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "CLEANUP_UNCONFIRMED") throw error; if (timedOut) throw fail("TIMEOUT", "Smart suggestion preparation timed out."); if (caller.aborted) throw abortError(); throw error; }
  finally { clearTimeout(timer); caller.removeEventListener("abort", abort); }
}

/** Read-only one-shot completion with the same native safety controls as Smart KPI. */
export async function executeChatStarters(manifest: BackendManifest, request: CompletionRequest, caller: AbortSignal, options: ExecutorOptions): Promise<ExecutionResult> {
  const wrapped = request.input && typeof request.input === "object" && "data" in request.input
    ? (request.input as { data: unknown }).data : request.input;
  const input = validateChatStarterInput(wrapped);
  const maxTimeoutMs = chatStarterTimeoutMs(manifest.id);
  const timeoutMs = Math.min(request.timeoutMs ?? maxTimeoutMs, maxTimeoutMs);
  const deadline = AbortSignal.timeout(timeoutMs);
  const signal = AbortSignal.any([caller, deadline]);
  // Provider default is portable and avoids applying the chat's high-effort preference.
  const completion = { ...request, input, timeoutMs };
  delete completion.modelReasoning;
  let output: unknown;
  try {
    if (manifest.kind === "local_http") {
      output = await localCompletion(manifest, request.model ?? manifest.localHttp!.defaultModel, JSON.stringify(input),
        signal, options, undefined, false, starterCompletionContract, request.localHttpSelection);
    } else if (manifest.id === "codex_subscription") {
      output = await cliCompletion(manifest, request.model ?? "auto", JSON.stringify(input), signal, options, undefined, starterCompletionContract);
    } else if (manifest.harness && manifest.harness.transport !== "native") {
      output = (await executeHarnessCompletion(manifest, completion, signal, options)).output;
    } else {
      output = (await executeCli(manifest, completion, signal, options)).output;
    }
    signal.throwIfAborted();
  } catch (error) {
    if ((error as { code?: string })?.code === "CLEANUP_UNCONFIRMED") throw error;
    if (caller.aborted) throw abortError();
    if (deadline.aborted) throw fail("TIMEOUT", "Chat starter generation timed out.");
    throw error;
  }
  const validated = validateChatStarterOutput(output);
  return { output: validated, outputBytes: bytes(JSON.stringify(validated)), schemaValid: true, repaired: false };
}
