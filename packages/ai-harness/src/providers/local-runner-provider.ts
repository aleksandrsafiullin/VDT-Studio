import { randomUUID } from "node:crypto";
import { schemaIdForTask } from "@vdt-studio/model-bridge";
import type { AiProvider, AiTaskType, LocalRunnerProviderConfig } from "../types";
import { awaitProviderAbort, awaitProviderSettlement, readBoundedText } from "./provider-utils";

export function localRunnerOfflineMessage(runnerUrl: string): string {
  const normalized = runnerUrl.replace(/\/$/, "");
  return `Local runner is offline at ${normalized}. Start it with vdt runner start and pair this browser session.`;
}

export function isLocalRunnerConnectionFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.message.startsWith("Local runner is offline")) return true;
  if (!(error instanceof TypeError)) return false;
  const message = error.message.toLowerCase();
  const cause = error.cause;
  const causeMessage = cause instanceof Error ? cause.message.toLowerCase() : String(cause ?? "").toLowerCase();
  const causeCode = cause && typeof cause === "object" && "code" in cause ? String(cause.code ?? "") : "";
  return message === "fetch failed" || message.includes("econnrefused") || causeMessage.includes("econnrefused") || causeCode === "ECONNREFUSED" || causeCode === "ENOTFOUND";
}

interface CompletionResponse {
  ok: boolean;
  output?: unknown;
  error?: { code?: string; message?: string };
}

export class LocalRunnerProvider implements AiProvider {
  id = "local_runner";
  name = "Local Runner";
  type = "local_runner" as const;

  constructor(private readonly config: LocalRunnerProviderConfig) {}

  async completeStructured<TInput, TOutput>(params: {
    taskType: AiTaskType;
    input: TInput;
    schema: unknown;
    systemPrompt: string;
    userPrompt: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
  }): Promise<TOutput> {
    if (params.taskType === "suggest_incoming_kpis") return this.completeSmart(params) as Promise<TOutput>;
    const runnerUrl = this.config.runnerUrl.replace(/\/$/, "");
    const requestId = randomUUID();
    const cancel = () => { void fetch(`${runnerUrl}/v1/completions/${requestId}/cancel`, { method: "POST", redirect: "error",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.config.pairingToken}`, origin: this.config.origin }, body: "{}" }).catch(() => {}); };
    params.signal?.throwIfAborted();
    params.signal?.addEventListener("abort", cancel, { once: true });
    const connectionTest = Boolean(params.input && typeof params.input === "object" && "probe" in params.input);
    let response: Response;
    try {
      response = await fetch(`${runnerUrl}/v1/completions`, {
        method: "POST",
        redirect: "error",
        ...(params.signal ? { signal: params.signal } : {}),
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.config.pairingToken}`,
          origin: this.config.origin
        },
        body: JSON.stringify({
          requestId,
          backendId: this.config.backendId,
          taskType: params.taskType,
          schemaId: connectionTest ? "connection-test-v1" : schemaIdForTask(params.taskType),
          input: connectionTest
            ? { probe: true }
            : {
                data: params.input,
                systemPrompt: params.systemPrompt,
                userPrompt: compactRunnerPrompt(params.taskType, params.userPrompt)
              },
          ...(params.model ?? this.config.model ? { model: params.model ?? this.config.model } : {}),
          ...(this.config.timeoutMs ? { timeoutMs: this.config.timeoutMs } : {})
        })
      });
    } catch (error) {
      params.signal?.removeEventListener("abort", cancel);
      if (isLocalRunnerConnectionFailure(error)) throw new Error(localRunnerOfflineMessage(runnerUrl));
      throw error;
    }

    let payload: CompletionResponse;
    try { payload = (await response.json()) as CompletionResponse; params.signal?.throwIfAborted(); }
    finally { params.signal?.removeEventListener("abort", cancel); }
    if (!response.ok || !payload.ok) {
      const detail = payload.error?.message ?? `status ${response.status}`;
      throw new Error(`Local runner request failed: ${detail}`);
    }
    if (payload.output === undefined) throw new Error("Local runner response did not include structured output.");
    return payload.output as TOutput;
  }

  private async completeSmart<TInput>(params: { taskType: AiTaskType; input: TInput; systemPrompt: string; userPrompt: string; model?: string; signal?: AbortSignal }): Promise<unknown> {
    const runnerUrl = this.config.runnerUrl.replace(/\/$/, ""), requestId = randomUUID();
    params.signal?.throwIfAborted();
    const headers = { "content-type": "application/json", authorization: `Bearer ${this.config.pairingToken}`, origin: this.config.origin };
    const controller = new AbortController();
    const timeoutMs = Math.min(this.config.timeoutMs ?? 30_000, this.config.backendId === "codex_subscription" ? 30_000 : 15_000);
    const body = JSON.stringify({ requestId, backendId: this.config.backendId, taskType: params.taskType, schemaId: schemaIdForTask(params.taskType),
      input: { data: params.input, systemPrompt: params.systemPrompt, userPrompt: compactRunnerPrompt(params.taskType, params.userPrompt) }, model: params.model ?? this.config.model, timeoutMs });
    if (new TextEncoder().encode(body).byteLength > 24 * 1024) throw new Error("Smart runner request exceeds its bound.");
    const unknown = () => Object.assign(new Error("Remote cleanup could not be confirmed; Smart execution is quarantined."), { code: "CLEANUP_UNCONFIRMED" });
    let cancellation: Promise<void> | undefined, terminal = false, timedOut = false;
    const reconcile = async () => {
      // The HTTP cancel endpoint waits for Smart's executor close. A lost or
      // out-of-order request must be reconciled by ID before this lane releases.
      const end = Date.now() + 2_500;
      while (Date.now() < end) {
        try {
          const signal = AbortSignal.timeout(Math.max(1, end - Date.now()));
          const response = await awaitProviderAbort(fetch(`${runnerUrl}/v1/completions/${requestId}/cancel`, { method: "POST", redirect: "error", headers, body: "{}", signal }), signal);
          const payload = JSON.parse(await readBoundedText(response, 8 * 1024, "Smart cancel", signal, true));
          if (payload.cleanupConfirmed === true && payload.requestId === requestId && ["succeeded", "failed", "cancelled"].includes(payload.status)) { terminal = true; controller.abort(); return; }
          if (payload.error?.code === "CLEANUP_UNCONFIRMED") throw unknown();
          if (response.status !== 404) throw unknown();
        } catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "CLEANUP_UNCONFIRMED") throw error; }
        if (terminal) return;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      if (!terminal) { controller.abort(); throw unknown(); }
    };
    const cancel = () => { cancellation ??= reconcile().catch(error => { controller.abort(); throw error; }); void cancellation.catch(() => {}); };
    const abort = () => cancel(); params.signal?.addEventListener("abort", abort, { once: true });
    const deadline = setTimeout(() => { timedOut = true; cancel(); }, timeoutMs);
    // Lost completion/cancel envelopes are bounded too. Unconfirmed cleanup is
    // a quarantine error, never a timeout that silently releases the lane.
    const transportDeadline = setTimeout(() => controller.abort(), timeoutMs + 3_000);
    try {
      const response = await awaitProviderSettlement(fetch(`${runnerUrl}/v1/completions`, { method: "POST", redirect: "error", headers, body, signal: controller.signal }), controller.signal);
      const payload = JSON.parse(await readBoundedText(response, 64 * 1024, "Smart runner", controller.signal, true));
      if (!payload.ok && !payload.run && ["PREPARATION_IN_PROGRESS", "PREPARATION_CAPACITY", "UNSUPPORTED_CONTRACT", "UNKNOWN_BACKEND"].includes(payload.error?.code)) {
        terminal = true; throw Object.assign(new Error("Smart runner admission rejected."), { code: payload.error.code });
      }
      if (payload.run?.requestId !== requestId || !["succeeded", "failed", "cancelled"].includes(payload.run?.status)) throw new Error("Smart runner did not acknowledge terminal execution.");
      if (payload.error?.code === "CLEANUP_UNCONFIRMED") throw unknown();
      terminal = true;
      if (cancellation) await cancellation;
      if (params.signal?.aborted || timedOut) throw Object.assign(new Error("Smart runner preparation stopped."), { code: timedOut ? "TIMEOUT" : "CANCELLED", name: "AbortError" });
      if (!response.ok || !payload.ok || payload.output === undefined) throw Object.assign(new Error("Smart runner preparation failed."), { code: payload.error?.code ?? "PREPARATION_FAILED" });
      return payload.output;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "CLEANUP_UNCONFIRMED") throw error;
      if (!terminal) { cancel(); await cancellation; }
      if (params.signal?.aborted || timedOut) throw Object.assign(new Error("Smart runner preparation stopped."), { code: timedOut ? "TIMEOUT" : "CANCELLED", name: "AbortError" });
      throw error;
    } finally {
      clearTimeout(deadline); clearTimeout(transportDeadline); params.signal?.removeEventListener("abort", abort);
      controller.abort();
    }
  }
}

function compactRunnerPrompt(taskType: AiTaskType, userPrompt: string): string {
  if (taskType === "suggest_incoming_kpis" || taskType === "agent_decision" || taskType === "orchestrator_first_response") {
    return "Use input.data as the canonical VDT context and return only the requested structured response.";
  }
  return userPrompt;
}
