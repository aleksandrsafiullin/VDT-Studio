import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { HarnessDefinition } from "./catalog";
import { findExecutableOnPath } from "../detection";
import { credentialFileMetadata, credentialRootVariables, resolveCredentialRoot, vibeKeyringMetadata, type HarnessCredentialMetadataOptions, type VibeCredentialSource } from "./credential-metadata";
export type { HarnessCredentialMetadataOptions, VibeCredentialSource } from "./credential-metadata";

const fail = (code: string, message: string) => Object.assign(new Error(message), { code });
const record = (v: unknown): Record<string, any> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, any> : {};
export interface HarnessModel { id: string; label?: string }
export interface HarnessRpcOptions { executable: string; cwd: string; environment: NodeJS.ProcessEnv; maxBytes?: number }

/** One owned subprocess and one upstream logical session. Tool telemetry is
 * never executable authority; all VDT actions use the checkpoint/Gateway port. */
export class HarnessRpcSession {
  private child?: ChildProcessWithoutNullStreams;
  private pending = new Map<number, { method: string; resolve: (v: any) => void; reject: (e: Error) => void }>();
  private nextId = 1;
  private buffer = "";
  private decoder = new TextDecoder("utf-8", { fatal: true });
  private closed?: Promise<void>;
  private closeResolve = () => {};
  private stopped = false;
  private cleanupUnconfirmed = false;
  private streamText = "";
  private streamBytes = 0;
  private promptInboundBytes = 0;
  private promptInFlight = false;
  private violation: Error | undefined;
  private piMessageFailure: Error | undefined;
  private piTerminalFailure: Error | undefined;
  private sessionId?: string;
  private sessionResult: Record<string, any> = {};
  private initResult: Record<string, any> = {};
  private initialModelId: string | undefined;
  private piState: Record<string, any> = {};
  private piModels: HarnessModel[] = [];
  private piReasoning: (boolean | string | number)[] = [];
  private piCompletion: { resolve: (value: Record<string, any>) => void; reject: (error: Error) => void } | undefined;
  constructor(readonly definition: HarnessDefinition, private options: HarnessRpcOptions) {}

  async open(signal: AbortSignal, existingSessionId?: string): Promise<{ sessionId: string; models: HarnessModel[] }> {
    signal.throwIfAborted();
    const js = /\.[cm]?js$/.test(this.options.executable);
    this.child = spawn(js ? process.execPath : this.options.executable, js ? [this.options.executable, ...this.definition.args] : [...this.definition.args], {
      cwd: this.options.cwd, env: this.options.environment, shell: false, detached: process.platform !== "win32", windowsHide: true, stdio: ["pipe", "pipe", "pipe"]
    });
    const child = this.child;
    this.closed = new Promise(resolve => { this.closeResolve = resolve; });
    child.on("error", () => { this.rejectPending(fail("HARNESS_PROCESS_FAILED", "The harness process could not start.")); this.closeResolve(); });
    child.stdin.on("error", () => this.rejectPending(fail("HARNESS_PROCESS_FAILED", "The harness input stream closed.")));
    child.on("close", () => { this.stopped = true; this.closeResolve(); this.rejectPending(fail("HARNESS_PROCESS_EXITED", "The harness process exited before completing its request.")); });
    let stderrBytes = 0;
    child.stderr.on("data", (chunk: Buffer) => { stderrBytes += chunk.length; if (stderrBytes > 256 * 1024) { this.violation = fail("OUTPUT_TOO_LARGE", "Harness diagnostics exceeded the bound."); this.kill("SIGTERM"); } });
    child.stdout.on("data", (chunk: Buffer) => {
      try {
        // Count the complete wire stream, including private thinking and
        // protocol/status events. A short final answer cannot bypass the
        // prompt budget by preceding it with arbitrarily many small frames.
        if (this.promptInFlight) {
          this.promptInboundBytes += chunk.length;
          if (this.promptInboundBytes > (this.options.maxBytes ?? 1024 * 1024)) throw fail("OUTPUT_TOO_LARGE", "Harness response stream exceeded its bound.");
        }
        this.buffer += this.decoder.decode(chunk, { stream: true });
        let split;
        while ((split = this.buffer.indexOf("\n")) !== -1) {
          const line = this.buffer.slice(0, split); this.buffer = this.buffer.slice(split + 1);
          if (Buffer.byteLength(line) > (this.options.maxBytes ?? 1024 * 1024)) throw fail("OUTPUT_TOO_LARGE", "Harness protocol frame exceeded its bound.");
          if (line.trim()) this.receive(JSON.parse(line));
        }
        if (Buffer.byteLength(this.buffer) > (this.options.maxBytes ?? 1024 * 1024)) throw fail("OUTPUT_TOO_LARGE", "Harness protocol frame exceeded its bound.");
      } catch (e) { this.rejectPending(e instanceof Error && "code" in e ? e : fail("INVALID_RESPONSE", "Invalid harness protocol frame.")); this.kill("SIGTERM"); }
    });
    child.stdout.on("end", () => { try { this.buffer += this.decoder.decode(); if (this.buffer.trim()) this.receive(JSON.parse(this.buffer)); } catch { this.rejectPending(fail("INVALID_RESPONSE", "Incomplete harness protocol frame.")); } });
    if (this.definition.transport === "pi-rpc") {
      // Pi's RPC process owns one in-memory conversation (--no-session). The
      // checkpoint host keeps it alive between turns; a lost process cannot be
      // replaced by an unrelated conversation under the old binding.
      if (existingSessionId) throw fail("RECOVERY_REQUIRED", "The Pi conversation process is no longer available.");
      this.piState = record(await this.boundedRequest("get_state", {}, signal));
      this.sessionId = this.piState.sessionId;
      this.validateSessionId(this.sessionId);
      const available = record(await this.boundedRequest("get_available_models", {}, signal));
      if (!Array.isArray(available.models)) throw fail("INVALID_RESPONSE", "Pi did not return its configured model catalog.");
      this.piModels = available.models.slice(0, 200).flatMap((m: any) => typeof m.provider === "string" && typeof m.id === "string" && m.provider && m.id && !/[\x00-\x20]/.test(m.provider + m.id) && (m.provider + m.id).length <= 255 ? [{ id: `${m.provider}/${m.id}`, label: String(m.name ?? m.id).slice(0, 256) }] : []);
      await this.refreshPiReasoning(signal);
      return { sessionId: this.sessionId!, models: this.models() };
    }
    const method = this.definition.transport === "vdt-jsonl" ? "vdt/initialize" : "initialize";
    this.initResult = record(await this.boundedRequest(method, { protocolVersion: 1, clientInfo: { name: "vdt-studio", version: "1" }, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } }, signal));
    if (this.initResult.protocolVersion !== 1) throw fail("UNSUPPORTED_PROTOCOL", "The harness must implement protocol version 1.");
    if (this.definition.transport === "vdt-jsonl" && (!this.initResult.capabilities?.agentSession || !this.initResult.capabilities?.structuredCompletion || !this.initResult.capabilities?.cancellation)) throw fail("HARNESS_CAPABILITY_MISSING", "The JSONL adapter must support sessions, structured completion, and acknowledged cancellation.");
    if (this.definition.id === "grok-build" || this.definition.baseHarness === "grok-build") {
      // xAI documents cached_token for a pre-authenticated CLI. Never switch to
      // an API key or begin an interactive browser flow inside a task.
      if (!Array.isArray(this.initResult.authMethods) || !this.initResult.authMethods.some((m: any) => m.id === "cached_token")) throw fail("AUTH_REQUIRED", "Sign in with grok login before connecting Grok Build.");
      await this.boundedRequest("authenticate", { methodId: "cached_token", _meta: { headless: true } }, signal);
    }
    this.sessionResult = record(await this.boundedRequest(existingSessionId ? "session/load" : "session/new", { cwd: this.options.cwd, mcpServers: [], ...(existingSessionId ? { sessionId: existingSessionId } : {}) }, signal));
    const id = this.sessionResult.sessionId;
    this.validateSessionId(id);
    if (existingSessionId && id !== existingSessionId) throw fail("SESSION_MISMATCH", "The harness returned a changed session ID.");
    this.sessionId = id;
    const modelConfig = (Array.isArray(this.sessionResult.configOptions) ? this.sessionResult.configOptions : []).find((c: any) => c.category === "model" || c.id === "model" || c.id === "model_id");
    this.initialModelId = modelConfig?.currentValue ?? this.sessionResult.models?.currentModelId;
    return { sessionId: id, models: this.models() };
  }
  private validateSessionId(id: unknown): void {
    if (typeof id !== "string" || !id || id.length > 512 || /[\x00-\x1f]/.test(id)) throw fail("SESSION_MISMATCH", "The harness returned an invalid session ID.");
  }
  models(): HarnessModel[] {
    if (this.definition.transport === "pi-rpc") return this.piModels.map(m => ({ ...m }));
    const config = (this.sessionResult.configOptions ?? []).find((c: any) => c.category === "model" || c.id === "model" || c.id === "model_id");
    const values = config?.options ?? this.sessionResult.models?.availableModels ?? [];
    const flattened = values.flatMap((v: any) => Array.isArray(v.options) ? v.options : [v]);
    const seen = new Set<string>();
    return flattened.slice(0, 200).flatMap((v: any) => { const id = v.value ?? v.modelId ?? v.id; if (typeof id !== "string" || !id.trim() || id.startsWith("-") || id.length > 256 || seen.has(id)) return []; seen.add(id); return [{ id, label: String(v.name ?? v.label ?? id).slice(0, 256) }]; });
  }
  async selectModel(model: string | undefined, signal: AbortSignal): Promise<void> {
    if (!model || model === "auto" || model === "host_default") return;
    if (this.definition.transport === "pi-rpc") {
      const exact = this.piModels.find(m => m.id === model);
      if (!exact) throw fail("MODEL_MISMATCH", "Choose an exact provider/model from Pi's configured catalog.");
      const separator = model.indexOf("/"), provider = model.slice(0, separator), modelId = model.slice(separator + 1);
      const selected = record(await this.boundedRequest("set_model", { provider, modelId }, signal));
      if (selected.provider !== provider || selected.id !== modelId) throw fail("MODEL_MISMATCH", "Pi did not accept the exact selected provider and model.");
      this.piState.model = selected;
      await this.refreshPiReasoning(signal);
      return;
    }
    const config = (this.sessionResult.configOptions ?? []).find((c: any) => c.category === "model" || c.id === "model" || c.id === "model_id");
    const result = record(await this.boundedRequest(config ? "session/set_config_option" : "session/set_model", { sessionId: this.sessionId, ...(config ? { configId: config.id, value: model } : { modelId: model }) }, signal));
    const selected = config && Array.isArray(result.configOptions) ? result.configOptions.find((c: any) => c.id === config.id)?.currentValue : result.modelId;
    if (selected !== undefined && selected !== model) throw fail("MODEL_MISMATCH", "The harness did not accept the exact selected model.");
    if (Array.isArray(result.configOptions)) this.sessionResult.configOptions = result.configOptions;
    this.sessionResult.selectedModelId = model;
  }
  private reasoningConfig(): Record<string, any> | undefined {
    return (Array.isArray(this.sessionResult.configOptions) ? this.sessionResult.configOptions : []).find((c: any) => c.category === "thought_level" || c.category === "reasoning" || /^(?:reasoning(?:_effort)?|thinking(?:_level)?|effort)$/i.test(String(c.id)));
  }
  private normalizedReasoning(value: unknown): boolean | string | number | undefined {
    return typeof value === "string" && /^(?:off|none|disabled|false)$/i.test(value) ? false : typeof value === "boolean" || typeof value === "string" || typeof value === "number" && Number.isFinite(value) ? value : undefined;
  }
  /** Metadata advertised by the selected upstream model; never inferred from a
   * provider's brand or the absence of a control. */
  reasoningValues(): (boolean | string | number)[] {
    if (this.definition.transport === "pi-rpc") return [...this.piReasoning];
    const config = this.reasoningConfig();
    const values = config?.type === "boolean" ? [false, true] : Array.isArray(config?.options) ? config.options.flatMap((v: any) => Array.isArray(v.options) ? v.options : [v]).map((v: any) => this.normalizedReasoning(v.value)) : [];
    if (!config && this.selectedModelIsNonReasoning()) return [false];
    return [...new Set(values.filter((v: unknown): v is boolean | string | number => v !== undefined))].slice(0, 64) as (boolean | string | number)[];
  }
  private selectedModelIsNonReasoning(): boolean {
    const modelId = this.sessionResult.selectedModelId ?? this.sessionResult.models?.currentModelId;
    const model = (Array.isArray(this.sessionResult.models?.availableModels) ? this.sessionResult.models.availableModels : []).find((m: any) => m.modelId === modelId || m.id === modelId);
    return Boolean(model && (model.reasoning === false || model.supportsReasoning === false));
  }
  async selectReasoning(value: boolean | string | number | undefined, signal: AbortSignal): Promise<void> {
    if (value === undefined) return;
    const requested = this.normalizedReasoning(value);
    if (!this.reasoningValues().includes(requested!)) throw fail("REASONING_UNSUPPORTED", "The selected harness/model does not advertise this reasoning setting. Choose a supported level or Provider default.");
    if (this.definition.transport === "pi-rpc") {
      const level = requested === false ? "off" : String(requested);
      await this.boundedRequest("set_thinking_level", { level }, signal);
      this.piState = record(await this.boundedRequest("get_state", {}, signal));
      if (this.piState.thinkingLevel !== level) throw fail("REASONING_MISMATCH", "Pi did not accept the exact thinking level.");
      return;
    }
    const config = this.reasoningConfig();
    if (!config && requested === false && this.selectedModelIsNonReasoning()) return;
    const options = config?.type === "boolean" ? [{ value: false }, { value: true }] : config?.options?.flatMap((v: any) => Array.isArray(v.options) ? v.options : [v]);
    const upstream = options?.find((o: any) => this.normalizedReasoning(o.value) === requested)?.value;
    if (!config || upstream === undefined) throw fail("REASONING_UNSUPPORTED", "The harness has no matching reasoning control.");
    const result = record(await this.boundedRequest("session/set_config_option", { sessionId: this.sessionId, configId: config.id, value: upstream }, signal));
    const accepted = Array.isArray(result.configOptions) ? result.configOptions.find((c: any) => c.id === config.id) : undefined;
    if (!accepted || accepted.currentValue !== upstream) throw fail("REASONING_MISMATCH", "The harness did not confirm the exact reasoning setting.");
    this.sessionResult.configOptions = result.configOptions;
  }
  private async refreshPiReasoning(signal: AbortSignal): Promise<void> {
    const response = record(await this.boundedRequest("get_available_thinking_levels", {}, signal));
    if (!Array.isArray(response.levels) || response.levels.some((v: unknown) => typeof v !== "string")) throw fail("UNSUPPORTED_PROTOCOL", "Pi must advertise the selected model's thinking levels.");
    this.piReasoning = [...new Set(response.levels.slice(0, 64).map((level: string) => this.normalizedReasoning(level)!))];
  }
  /** Current Vibe's non-secret auth/source extension describes its configured
   * default provider. A different selected model may use another provider, so
   * that case must retain the conservative credential-store metadata check. */
  async credentialSource(signal: AbortSignal): Promise<VibeCredentialSource | undefined> {
    if ((this.definition.baseHarness ?? this.definition.id) !== "vibe") return undefined;
    if (this.sessionResult.selectedModelId !== undefined && this.sessionResult.selectedModelId !== this.initialModelId) return undefined;
    let status: Record<string, any>;
    try { status = record(await this.boundedRequest("_auth/status", {}, signal)); }
    catch (e) { if ((e as { code?: string })?.code === "HARNESS_RPC_FAILED") return undefined; throw e; }
    if (status.authenticated !== true) return undefined;
    return ({ process_env: "env", vibe_home_env_file: "file", os_keyring: "keyring", auth_not_required: "none" } as const)[status.authState as "process_env" | "vibe_home_env_file" | "os_keyring" | "auth_not_required"];
  }
  async prompt(prompt: string, signal: AbortSignal, structured?: { schemaId: string; schema: unknown; input: unknown }): Promise<string> {
    if (!this.sessionId) throw fail("SESSION_MISSING", "A harness session is required.");
    if (this.promptInFlight) throw fail("HARNESS_BUSY", "A harness prompt is already in progress.");
    signal.throwIfAborted();
    this.streamText = ""; this.streamBytes = 0; this.violation = undefined;
    this.piMessageFailure = undefined; this.piTerminalFailure = undefined;
    this.promptInboundBytes = 0; this.promptInFlight = true;
    const pi = this.definition.transport === "pi-rpc";
    const method = structured && this.definition.transport === "vdt-jsonl" ? "vdt/complete" : "session/prompt";
    // Install the Pi completion listener before writing prompt: an immediate
    // acceptance is not completion and even agent_end can precede more work.
    const settled = pi ? new Promise<Record<string, any>>((resolve, reject) => { this.piCompletion = { resolve, reject }; }) : undefined;
    const operation = pi ? this.request("prompt", { message: prompt }).then(result => {
      if (result?.disposition !== "started") throw fail("INCOMPLETE_RESPONSE", "Pi did not start an independent prompt.");
      return settled!;
    }) : this.request(method, { sessionId: this.sessionId, ...(method === "vdt/complete" ? { ...structured, instructions: prompt } : { prompt: [{ type: "text", text: prompt }] }) });
    // A startup failure can reject both the prompt command and its event waiter.
    if (settled) void settled.catch(() => {});
    // Keep the actual prompt request alive until its terminal acknowledgement.
    // Killing an ACP viewer alone does not prove a background daemon stopped.
    let cancelled = false, cleanupTimer: NodeJS.Timeout | undefined;
    const interrupted = new Promise<never>((_, reject) => {
      const cancel = () => {
        if (cancelled) return; cancelled = true;
        if (pi) {
          // Pi abort waits until idle, but queued messages could restart work.
          // Clear them first, then require the successful abort and idle state.
          void this.request("clear_queue", {}).then(() => this.request("abort", {})).then(() => this.request("get_state", {})).then(state => {
            if (state?.isStreaming === false && state?.isCompacting === false && state?.pendingMessageCount === 0) this.piCompletion?.resolve({ stopReason: "cancelled" });
          }).catch(() => { /* the bounded cancellation grace reports uncertainty */ });
        } else this.notify("session/cancel", { sessionId: this.sessionId });
        cleanupTimer = setTimeout(() => { this.cleanupUnconfirmed = true; reject(fail("CLEANUP_UNCONFIRMED", "The harness did not acknowledge cancellation; execution is quarantined.")); }, 1250);
      };
      signal.addEventListener("abort", cancel, { once: true });
      this.removeAbort = () => signal.removeEventListener("abort", cancel);
      if (signal.aborted) cancel();
    });
    try {
      const result = record(await Promise.race([operation, interrupted]));
      if (cancelled) throw fail("CANCELLED", "Harness request cancelled.");
      if (this.violation) throw this.violation;
      if (this.piTerminalFailure) throw this.piTerminalFailure;
      if (this.piMessageFailure) throw this.piMessageFailure;
      if (result.stopReason && result.stopReason !== "end_turn") throw fail(result.stopReason === "refusal" ? "PROVIDER_REFUSAL" : "INCOMPLETE_RESPONSE", "The harness did not complete the requested response.");
      return method === "vdt/complete" ? JSON.stringify(result.output) : this.streamText || (typeof result.text === "string" ? result.text : "");
    } catch (e) {
      if (cancelled && (e as { code?: string })?.code !== "CANCELLED") { this.cleanupUnconfirmed = true; throw fail("CLEANUP_UNCONFIRMED", "Harness request termination was not acknowledged."); }
      throw e;
    } finally { this.removeAbort?.(); this.removeAbort = undefined; this.piCompletion = undefined; this.promptInFlight = false; if (cleanupTimer) clearTimeout(cleanupTimer); }
  }
  private removeAbort: (() => void) | undefined;
  private async boundedRequest(method: string, params: unknown, signal: AbortSignal): Promise<any> {
    signal.throwIfAborted();
    let abort = () => {};
    const interrupted = new Promise<never>((_, reject) => { abort = () => reject(fail("CANCELLED", "Harness metadata request cancelled.")); signal.addEventListener("abort", abort, { once: true }); });
    try { return await Promise.race([this.request(method, params), interrupted]); }
    finally { signal.removeEventListener("abort", abort); }
  }
  private request(method: string, params: unknown): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => { this.pending.set(id, { method, resolve, reject }); this.write(this.definition.transport === "pi-rpc" ? { id: String(id), type: method, ...record(params) } : { jsonrpc: "2.0", id, method, params }); });
  }
  private write(value: unknown) { if (!this.child || this.stopped) { this.rejectPending(fail("HARNESS_PROCESS_EXITED", "Harness process is unavailable.")); return; } this.child.stdin.write(JSON.stringify(value) + "\n"); }
  private notify(method: string, params: unknown) { this.write({ jsonrpc: "2.0", method, params }); }
  private receive(value: unknown) {
    const v = record(value);
    if (this.definition.transport === "pi-rpc") { this.receivePi(v); return; }
    if (v.jsonrpc !== "2.0") throw fail("INVALID_RESPONSE", "Expected JSON-RPC 2.0 from the harness.");
    if (v.method) {
      if (v.method === "session/update") {
        if (v.params?.sessionId !== this.sessionId) return;
        const u = record(v.params?.update);
        if (u.sessionUpdate === "config_option_update" && Array.isArray(u.configOptions)) this.sessionResult.configOptions = u.configOptions;
        if (u.sessionUpdate === "agent_message_chunk" && u.content?.type === "text") {
          this.streamBytes += Buffer.byteLength(String(u.content.text));
          if (this.streamBytes > (this.options.maxBytes ?? 1024 * 1024)) throw fail("OUTPUT_TOO_LARGE", "Harness output exceeded its bound.");
          this.streamText += String(u.content.text);
        }
        if (["tool_call", "tool_call_update"].includes(u.sessionUpdate)) this.violation = fail("TOOL_ACTIVITY_REJECTED", "Native tool activity is unavailable in the VDT checkpoint/completion profile.");
      } else if (v.id !== undefined) {
        if (v.method === "session/request_permission") { this.violation = fail("TOOL_ACTIVITY_REJECTED", "Harness requested a native tool permission."); this.write({ jsonrpc: "2.0", id: v.id, result: { outcome: { outcome: "cancelled" } } }); }
        else this.write({ jsonrpc: "2.0", id: v.id, error: { code: -32601, message: "Unsupported host capability" } });
      }
      return;
    }
    const pending = this.pending.get(v.id); if (!pending) return;
    this.pending.delete(v.id);
    if (v.error) {
      pending.reject(this.providerError(v.error.message));
    } else pending.resolve(v.result);
  }
  private providerError(value: unknown): Error {
    const message = String(value ?? "");
    const code = /auth|login|credential|api.?key/i.test(message) ? "AUTH_REQUIRED" : /quota|limit|429|credit/i.test(message) ? "RATE_LIMITED" : "HARNESS_RPC_FAILED";
    return fail(code, code === "AUTH_REQUIRED" ? "Sign in with the provider CLI, then retry." : code === "RATE_LIMITED" ? "The provider reported an account or request limit." : "The harness rejected the protocol request.");
  }
  private receivePi(v: Record<string, any>): void {
    if (typeof v.type !== "string") throw fail("INVALID_RESPONSE", "Expected a typed Pi RPC record.");
    if (v.type === "response") {
      const id = typeof v.id === "string" && /^\d+$/.test(v.id) ? Number(v.id) : v.id;
      const pending = this.pending.get(id);
      if (!pending) return;
      if (v.command !== pending.method || typeof v.success !== "boolean") throw fail("INVALID_RESPONSE", "Pi returned a mismatched command response.");
      this.pending.delete(id);
      if (!v.success) pending.reject(this.providerError(v.error)); else pending.resolve(v.data ?? {});
      return;
    }
    const event = record(v.assistantMessageEvent);
    if (["tool_execution_start", "tool_execution_update", "tool_execution_end", "extension_ui_request"].includes(v.type) || /^toolcall_/.test(String(event.type))) this.violation = fail("TOOL_ACTIVITY_REJECTED", "Pi native tools and extension UI are unavailable in the VDT checkpoint/completion profile.");
    if (v.type === "message_start" && v.message?.role === "assistant") {
      // A retry/overflow recovery starts a fresh assistant message. Earlier
      // partial JSON and recoverable provider errors are not its final answer.
      // Native-tool violations and total wire bytes remain sticky for the run.
      this.streamText = "";
      this.piMessageFailure = undefined;
    }
    if (v.type === "message_update" && event.type === "text_delta" && typeof event.delta === "string") {
      this.streamBytes += Buffer.byteLength(event.delta);
      if (this.streamBytes > (this.options.maxBytes ?? 1024 * 1024)) throw fail("OUTPUT_TOO_LARGE", "Pi output exceeded its bound.");
      this.streamText += event.delta;
    }
    if (v.type === "message_update" && event.type === "error") this.piMessageFailure = this.providerError(event.error?.errorMessage ?? event.error);
    if (v.type === "extension_error") this.piTerminalFailure ??= this.providerError(v.error);
    if (v.type === "auto_retry_end" && v.success === false) this.piTerminalFailure ??= this.providerError(v.finalError ?? v.error);
    if (v.type === "compaction_end" && !v.result && (v.aborted === true || typeof v.errorMessage === "string")) this.piTerminalFailure ??= v.aborted === true ? fail("INCOMPLETE_RESPONSE", "Pi compaction was aborted.") : this.providerError(v.errorMessage);
    if (v.type === "message_end" && v.message?.role === "assistant") {
      const message = v.message;
      // message_end contains the authoritative final assistant content. Delta
      // text is only a preview and can be partial or replaced during recovery.
      if (Array.isArray(message.content)) this.streamText = message.content.filter((c: any) => c.type === "text" && typeof c.text === "string").map((c: any) => c.text).join("");
      if (message.stopReason === "toolUse" || Array.isArray(message.content) && message.content.some((c: any) => c.type === "toolCall")) this.violation = fail("TOOL_ACTIVITY_REJECTED", "Pi requested native tool use.");
      if (["error", "aborted", "length"].includes(message.stopReason)) this.piMessageFailure = message.stopReason === "error" ? this.providerError(message.errorMessage) : fail("INCOMPLETE_RESPONSE", "Pi did not complete its assistant response.");
    }
    if (v.type === "agent_settled") this.piCompletion?.resolve({ stopReason: v.aborted === true ? "cancelled" : "end_turn" });
    // agent_end is deliberately not terminal: current Pi may automatically
    // retry, compact, or run follow-ups before emitting agent_settled.
  }
  private rejectPending(e: Error) { for (const p of this.pending.values()) p.reject(e); this.pending.clear(); this.piCompletion?.reject(e); }
  private kill(signal: NodeJS.Signals) { if (!this.child?.pid || this.stopped) return; try { if (process.platform !== "win32") process.kill(-this.child.pid, signal); else this.child.kill(signal); } catch { /* already exited */ } }
  async close(): Promise<void> {
    if (!this.child) return;
    this.child.stdin.end();
    this.kill("SIGTERM");
    let force: NodeJS.Timeout | undefined, deadline: NodeJS.Timeout | undefined;
    try { await Promise.race([this.closed, new Promise<never>((_, reject) => { force = setTimeout(() => this.kill("SIGKILL"), 250); deadline = setTimeout(() => reject(fail("CLEANUP_UNCONFIRMED", "Harness process cleanup is unconfirmed.")), 1250); })]); }
    finally { if (force) clearTimeout(force); if (deadline) clearTimeout(deadline); this.rejectPending(fail("CANCELLED", "Harness session closed.")); }
    if (this.cleanupUnconfirmed) throw fail("CLEANUP_UNCONFIRMED", "Background harness cancellation is unconfirmed.");
  }
}

/** Shared lifecycle port: ACP/VDT JSONL and Pi RPC use the same bounded owned
 * subprocess, session, model, reasoning and acknowledged-cancellation surface.
 * Pi command/event shapes follow OpenDesign's pi-rpc adapter; terminal handling
 * follows current pi.dev RPC (agent_settled rather than agent_end). */
export function createHarnessSession(h: HarnessDefinition, options: HarnessRpcOptions): HarnessRpcSession {
  return new HarnessRpcSession(h, options);
}

export async function resolveHarnessExecutable(h: HarnessDefinition, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const selected = path.isAbsolute(h.command) ? h.command : (await findExecutableOnPath([h.command], env.PATH ? { path: env.PATH } : {}))?.executable;
  if (!selected) throw fail("BACKEND_NOT_INSTALLED", "The selected harness executable was not found.");
  const executable = await realpath(selected);
  if (!path.isAbsolute(executable) || executable === path.parse(executable).root) throw fail("UNSAFE_EXECUTABLE", "The harness executable must resolve to an absolute file.");
  return executable;
}
export function harnessEnvironment(h: HarnessDefinition, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { NODE_ENV: env.NODE_ENV ?? "production" };
  for (const name of ["PATH", "HOME", "USER", "TMPDIR", "TEMP", "TMP", "SystemRoot", "LANG", "LC_ALL", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS"]) if (env[name]) result[name] = env[name];
  if (env.NODE_ENV === "test") for (const [name, value] of Object.entries(env)) if (name.startsWith("VDT_FAKE_") && value) result[name] = value;
  for (const [name, ref] of Object.entries(h.environmentRefs ?? {})) { if (!env[ref]) throw fail("HARNESS_ENV_MISSING", `Host environment variable ${ref} is not configured.`); result[name] = env[ref]; }
  // These documented locations select the user's existing account/config, not
  // a new payment provider. Tool/resource disabling stays in the owned argv.
  const base = h.baseHarness ?? h.id;
  for (const name of credentialRootVariables[base] ?? []) {
    if (!result[name] && env[name]) result[name] = env[name];
    if (result[name]) result[name] = resolveCredentialRoot(result[name]!, result);
  }
  // Preserve Vibe's documented shell-first source rather than silently
  // falling through to a different .env/keyring account. Only the official
  // child receives it; it is never returned to a browser or an API adapter.
  if (base === "vibe" && !result.MISTRAL_API_KEY && env.MISTRAL_API_KEY) result.MISTRAL_API_KEY = env.MISTRAL_API_KEY;
  if (base === "pi") result.PI_SKIP_VERSION_CHECK = "1";
  if (h.id === "opencode" || h.baseHarness === "opencode") result.OPENCODE_CONFIG_CONTENT = JSON.stringify({ permission: { "*": "deny" }, mcp: {}, plugin: [] });
  return result;
}
export async function withHarnessSession<T>(h: HarnessDefinition, signal: AbortSignal, use: (session: HarnessRpcSession) => Promise<T>, options: { env?: NodeJS.ProcessEnv; executable?: string; maxBytes?: number } = {}): Promise<T> {
  signal.throwIfAborted();
  const executable = options.executable ?? await resolveHarnessExecutable(h, options.env);
  const environment = harnessEnvironment(h, options.env);
  const cwd = await mkdtemp(path.join(tmpdir(), "vdt-harness-")); await chmod(cwd, 0o700);
  const session = createHarnessSession(h, { executable, cwd, environment, ...(options.maxBytes ? { maxBytes: options.maxBytes } : {}) });
  let retained = false;
  try { signal.throwIfAborted(); await session.open(signal); return await use(session); }
  catch (e) { if ((e as { code?: string })?.code === "CLEANUP_UNCONFIRMED") retained = true; throw e; }
  finally {
    try { await session.close(); }
    catch (e) {
      retained = true;
      await writeFile(path.join(cwd, "cleanup-status.json"), JSON.stringify({ harnessId: h.id, status: "cleanup_unconfirmed", observedAt: new Date().toISOString() }), { mode: 0o600 }).catch(() => {});
      throw Object.assign(e as Error, { retainedDirectory: cwd });
    } finally { if (!retained) await rm(cwd, { recursive: true, force: true }); }
  }
}
export async function probeHarnessModels(h: HarnessDefinition, signal: AbortSignal, env: NodeJS.ProcessEnv = process.env): Promise<HarnessModel[]> {
  return withHarnessSession(h, signal, async session => session.models(), { env });
}
export function harnessOpaqueIdentity(h: HarnessDefinition, executable: string, version: string, env: NodeJS.ProcessEnv = process.env, metadata: HarnessCredentialMetadataOptions = {}) {
  const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
  const childEnv = harnessEnvironment(h, env), base = h.baseHarness ?? h.id;
  const authFiles = harnessCredentialFiles[base] ?? [];
  const roots = Object.fromEntries((credentialRootVariables[base] ?? []).map(name => [name, childEnv[name] ?? null]));
  const prefix = ({ kimi: [".kimi-code/", childEnv.KIMI_CODE_HOME], vibe: [".vibe/", childEnv.VIBE_HOME], qwen: [".qwen/", childEnv.QWEN_HOME], "grok-build": [".grok/", childEnv.GROK_HOME], pi: [".pi/agent/", childEnv.PI_CODING_AGENT_DIR] } as Record<string, [string, string | undefined]>)[base];
  const resolveFile = (name: string) => prefix?.[1] && name.startsWith(prefix[0]) ? path.join(prefix[1], name.slice(prefix[0].length)) : base === "kilo" && name.startsWith(".local/share/kilo/") ? path.join(childEnv.XDG_DATA_HOME ?? path.join(childEnv.HOME ?? "", ".local/share"), "kilo", name.slice(".local/share/kilo/".length)) : base === "kilo" && name.startsWith(".config/kilo/") ? path.join(childEnv.XDG_CONFIG_HOME ?? path.join(childEnv.HOME ?? "", ".config"), "kilo", name.slice(".config/kilo/".length)) : path.join(childEnv.HOME ?? "", name);
  const files = authFiles.map(resolveFile);
  if (base === "kilo" && childEnv.KILO_CONFIG_DIR) files.push(...["kilo.json", "kilo.jsonc"].map(name => path.join(childEnv.KILO_CONFIG_DIR!, name)));
  const authMetadata = files.map(credentialFileMetadata);
  let storeMetadata: readonly unknown[] | null = null;
  if (base === "vibe" && !["env", "file", "none"].includes(metadata.vibeCredentialSource ?? "unknown")) {
    try { storeMetadata = vibeKeyringMetadata(childEnv, metadata); }
    catch (e) {
      if (metadata.purpose !== "chat" || (e as { code?: string })?.code !== "CREDENTIAL_IDENTITY_UNVERIFIED") throw e;
      // A chat canary is not a reusable Smart proposal/cache admission. Keep
      // its existing unqualified account boundary without inventing a verified
      // keyring generation or denying otherwise working provider sessions.
      storeMetadata = ["keyring-generation-unverified"];
    }
  }
  const privateCredentialFingerprint = hash([childEnv.HOME, roots, authMetadata, metadata.vibeCredentialSource ?? null, storeMetadata, base === "vibe" ? childEnv.MISTRAL_API_KEY ?? null : null, ...Object.values(h.environmentRefs ?? {}).map(name => env[name] ?? "")]);
  // Metadata callers can verify different credential-source scopes. A chat
  // refresh with no hint must not evict a verified env/file Smart epoch when
  // no credentials changed (nor can that unverified epoch qualify Smart).
  const epochScope = `${h.id}:${metadata.purpose ?? "smart"}:${metadata.vibeCredentialSource ?? "unknown"}`;
  const prior = credentialEpochs.get(epochScope);
  const entry = prior?.fingerprint === privateCredentialFingerprint ? prior : { fingerprint: privateCredentialFingerprint, epoch: randomUUID() };
  credentialEpochs.set(epochScope, entry);
  return { bindingVersion: hash([h, executable, version, roots]), credentialEpoch: entry.epoch };
}
const credentialEpochs = new Map<string, { fingerprint: string; epoch: string }>();
const harnessCredentialFiles: Record<string, readonly string[]> = {
  copilot: [".config/github-copilot/config.json"],
  opencode: [".local/share/opencode/auth.json", ".config/opencode/opencode.json", ".config/opencode/opencode.jsonc"],
  hermes: [".hermes/auth.json", ".hermes/.env", ".hermes/config.yaml"],
  kiro: [".kiro/settings/cli.json"],
  kimi: [".kimi-code/credentials", ".kimi-code/config.toml"],
  vibe: [".vibe/.env", ".vibe/config.toml"],
  kilo: [".local/share/kilo/auth.json", ".config/kilo/kilo.json", ".config/kilo/kilo.jsonc"],
  qwen: [".qwen/settings.json", ".qwen/oauth_creds.json", ".qwen/.env", ".env"],
  "grok-build": [".grok/auth.json", ".grok/config.toml"],
  pi: [".pi/agent/auth.json", ".pi/agent/models.json", ".pi/agent/settings.json"]
};
