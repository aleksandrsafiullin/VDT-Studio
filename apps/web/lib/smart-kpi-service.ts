import { getHarnessDefinition } from "@vdt-studio/model-bridge/node";
import { AnthropicProvider, AzureOpenAiProvider, GeminiProvider, OpenAiCompatibleProvider, ProviderHttpError, runSuggestIncomingKpis, isModelReasoningValue, type ModelReasoningValue, type AiProvider } from "@vdt-studio/ai-harness";
import { providerModelCapabilities, validatedReasoningConfig, type ProviderConnection } from "../app/api/agent/runs/provider-model-capabilities";
import { KPI_SUGGESTION_LIMITS, validateKpiSuggestionTaskInput, smartAssert, smartRecord, smartString, type KpiSuggestionModelOutput } from "@vdt-studio/vdt-core";
import { assertCurrentSmartKpiSkill } from "./smart-kpi-skill-host";
import { resolveProviderTarget, type ProxyProvider } from "./provider-target-security";
import { fetchPinnedProvider } from "./pinned-provider-fetch";
import { createManagedAwareAiProvider } from "../app/api/agent/runs/managed-ai-provider";
import { resolveTrustedStorageWriteMode } from "../app/api/vdt/storage-write-adapter";

/** No defaults or env credentials. Config already comes from the selected UI
 * destination; only model/destination/protocol credentials are admitted. */
export interface SmartKpiServiceRequest { input: unknown; providerId: string; providerConfig?: Record<string, unknown>; timeoutMs?: number; requestId?: string }
export type SmartKpiServiceDependencies = { provider?: (request: SmartKpiServiceRequest, signal: AbortSignal) => Promise<AiProvider> };

type TrackedPreparation = { controller: AbortController; done: Promise<void>; workspaceId: string; executionKey: string; errorCode?: string; completedAt?: number; cleanupReconciled?: true };
const host = globalThis as typeof globalThis & { __vdtSmartPreparations?: Map<string, TrackedPreparation> };
const tracked = () => host.__vdtSmartPreparations ??= new Map();
const requestIdValid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

/** Process-local cancellation capability; holds no prompt, project or key. */
export async function cancelSmartKpiPreparation(requestId: string): Promise<{ requestId: string; cleanupConfirmed: boolean; errorCode?: string }> {
  smartAssert(requestIdValid(requestId), "INVALID_REQUEST_ID", "A valid preparation ID is required.");
  const entry = tracked().get(requestId);
  smartAssert(entry, "RUN_NOT_FOUND", "Smart preparation was not found.");
  entry.controller.abort(); await entry.done;
  return { requestId, cleanupConfirmed: entry.errorCode !== "CLEANUP_UNCONFIRMED" || entry.cleanupReconciled === true, ...(entry.errorCode ? { errorCode: entry.errorCode } : {}) };
}

/** Privileged host hook only; no HTTP/model endpoint accepts this assertion. */
export function confirmSmartKpiHostCleanup(requestId: string, receipt: { terminalCleanupConfirmedByHost: true }): void {
  const entry = tracked().get(requestId);
  if (receipt.terminalCleanupConfirmedByHost === true && entry?.completedAt !== undefined && entry.errorCode === "CLEANUP_UNCONFIRMED") entry.cleanupReconciled = true;
}

export async function prepareSmartKpiResponse(raw: SmartKpiServiceRequest, caller: AbortSignal, requestUrl: string, deps: SmartKpiServiceDependencies = {}): Promise<KpiSuggestionModelOutput> {
  const input = validateKpiSuggestionTaskInput(raw.input), workspaceId = input.context.workspaceId;
  if (raw.requestId === undefined) raw = { ...raw, requestId: crypto.randomUUID() };
  smartAssert(requestIdValid(raw.requestId), "INVALID_REQUEST_ID", "A valid preparation ID is required.");
  let destination = "managed";
  try { const url = raw.providerConfig?.baseUrl ?? raw.providerConfig?.endpoint ?? raw.providerConfig?.runnerUrl; if (typeof url === "string") destination = new URL(url).origin; } catch { destination = "invalid_destination"; }
  const executionKey = JSON.stringify([raw.providerId, raw.providerConfig?.backendId ?? null, raw.providerConfig?.model ?? null, destination]);
  const entries = tracked();
  const disposable = (entry: TrackedPreparation) => entry.completedAt !== undefined && (entry.errorCode !== "CLEANUP_UNCONFIRMED" || entry.cleanupReconciled === true);
  for (const [id, entry] of entries) if (disposable(entry) && Date.now() - entry.completedAt! > 5 * 60_000) entries.delete(id);
  smartAssert(![...entries.values()].some(entry => entry.workspaceId === workspaceId && entry.completedAt === undefined), "PREPARATION_IN_PROGRESS", "Workspace preparation is still active.");
  smartAssert(![...entries.values()].some(entry => entry.workspaceId === workspaceId && entry.executionKey === executionKey && entry.errorCode === "CLEANUP_UNCONFIRMED" && !entry.cleanupReconciled), "CLEANUP_UNCONFIRMED", "Workspace execution remains quarantined.");
  smartAssert(!entries.has(raw.requestId), "DUPLICATE_REQUEST_ID", "Preparation ID is already owned.");
  if (entries.size >= 32) { const completed = [...entries].find(([, entry]) => disposable(entry)); if (completed) entries.delete(completed[0]); }
  smartAssert(entries.size < 32, "PREPARATION_CAPACITY", "Preparation capacity reached.");
  const controller = new AbortController(), abort = () => controller.abort();
  caller.addEventListener("abort", abort, { once: true }); if (caller.aborted) abort();
  let finish = () => {}; const done = new Promise<void>(resolve => { finish = resolve; });
  const entry: TrackedPreparation = { controller, done, workspaceId, executionKey }; entries.set(raw.requestId, entry);
  try { return await prepareResponse(raw, controller.signal, requestUrl, deps); }
  catch (error) { entry.errorCode = error && typeof error === "object" && "code" in error ? String(error.code) : "PREPARATION_FAILED"; throw error; }
  finally { caller.removeEventListener("abort", abort); entry.completedAt = Date.now(); finish(); }
}

async function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted(); let interrupt: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => { interrupt = () => reject(new DOMException("aborted", "AbortError")); });
  signal.addEventListener("abort", interrupt, { once: true });
  try { return await Promise.race([operation, aborted]); } finally { signal.removeEventListener("abort", interrupt); }
}

export async function selectedProvider(request: SmartKpiServiceRequest, signal: AbortSignal, requestUrl: string, maxEnvelopeBytes = KPI_SUGGESTION_LIMITS.inputBytes): Promise<AiProvider> {
  const config = request.providerConfig ?? {};
  smartRecord(config, ["baseUrl", "endpoint", "model", "deployment", "apiVersion", "anthropicVersion", "apiKey", "maxTokens", "backendId", "runnerUrl", "pairingToken", "timeoutMs", "modelReasoning"], []);
  smartAssert(config.modelReasoning === undefined || isModelReasoningValue(config.modelReasoning), "INVALID_REASONING", "Invalid selected reasoning value.");
  const text = (key: string, max = 2048) => { smartString(config[key], max); return config[key] as string; };
  if (request.providerId === "local_runner") {
    const backendId = text("backendId", 160), model = text("model", 160);
    smartAssert(["ollama", "lm_studio", "vllm"].includes(backendId) || getHarnessDefinition(backendId)?.capabilities.structuredCompletion, "SUGGESTIONS_UNAVAILABLE", "This selected adapter has no one-call Smart policy.");
    smartAssert(!config.baseUrl && !config.endpoint && !config.apiKey, "INVALID_PROVIDER", "Local endpoints are manifest-owned.");
    smartAssert(config.pairingToken || resolveTrustedStorageWriteMode(), "SUGGESTIONS_UNAVAILABLE", "Local suggestions require a trusted host or paired runner.");
    return createManagedAwareAiProvider({ providerId: "local_runner", providerConfig: { ...config, backendId, model, timeoutMs: request.timeoutMs } }, requestUrl);
  }
  const model = text("model", 160), apiKey = text("apiKey", 8192);
  const pinnedFetch = (provider: ProxyProvider): typeof fetch => async (raw, init) => {
    const body = String(init?.body ?? "");
    smartAssert(new TextEncoder().encode(body).byteLength <= maxEnvelopeBytes, "INPUT_TOO_LARGE", "Final AI request exceeds its size limit.");
    signal.throwIfAborted();
    const target = await resolveProviderTarget(String(raw), provider);
    signal.throwIfAborted();
    const requestSignal = init?.signal ? AbortSignal.any([signal, init.signal]) : signal;
    return fetchPinnedProvider(target, { method: init?.method ?? "GET", headers: new Headers(init?.headers), body, signal: requestSignal });
  };
  const timeoutMs = request.timeoutMs ?? 15_000;
  const fetcher = pinnedFetch(request.providerId === "gemini" ? "google" : request.providerId === "anthropic" ? "anthropic" : request.providerId === "azure_openai" ? "azure" : "openai");
  const reasoning = await smartReasoningConfig(request, config.modelReasoning as ModelReasoningValue | undefined, fetcher);
  if (request.providerId === "openai_compatible") return new OpenAiCompatibleProvider({ baseUrl: text("baseUrl"), model, apiKey, timeoutMs, fetch: fetcher, ...reasoning });
  if (request.providerId === "anthropic") return new AnthropicProvider({ baseUrl: text("baseUrl"), model, apiKey, timeoutMs, fetch: fetcher, ...reasoning, ...(config.anthropicVersion ? { anthropicVersion: text("anthropicVersion", 160) } : {}) });
  if (request.providerId === "gemini") return new GeminiProvider({ baseUrl: text("baseUrl"), model, apiKey, timeoutMs, fetch: fetcher, ...reasoning });
  if (request.providerId === "azure_openai") return new AzureOpenAiProvider({ endpoint: text("endpoint"), deployment: text("deployment", 160), apiKey,
    apiVersion: text("apiVersion", 160), timeoutMs, fetch: fetcher, ...reasoning });
  throw Object.assign(new Error("Selected provider is unavailable for Smart suggestions."), { code: "SUGGESTIONS_UNAVAILABLE" });
}

export async function smartReasoningConfig(request: SmartKpiServiceRequest, value: ModelReasoningValue | undefined, fetcher: typeof fetch): Promise<Record<string, unknown>> {
  if (value === undefined) return {};
  const config = request.providerConfig ?? {}, model = String(config.model ?? "");
  // These direct OpenAI models have no reasoning feature to disable. Do not
  // send an unsupported reasoning parameter to an ordinary text model.
  if (value === false && request.providerId === "openai_compatible" && String(config.baseUrl).replace(/\/$/, "") === "https://api.openai.com/v1"
    && /^(?:gpt-3\.5|gpt-4(?:[.-]|$)|chatgpt-4o)/.test(model)) return {};
  let capabilities;
  try { capabilities = await providerModelCapabilities({ providerId: request.providerId, providerConfig: config } as ProviderConnection, fetcher, "suggested_kpi"); }
  catch (error) { throw Object.assign(new Error("Reasoning capabilities could not be verified. Choose Provider default or refresh this model."), { code: "REASONING_UNSUPPORTED", cause: error }); }
  if (value === false) {
    if (request.providerId === "anthropic" && capabilities?.values.includes(false)) return { disableThinking: true };
    const disabled = capabilities?.values.find(option => option === false || option === 0 || ["none", "off", "disabled"].includes(String(option)));
    if (disabled === undefined) throw Object.assign(new Error("This model does not advertise a way to disable reasoning. Choose Provider default or another model."), { code: "REASONING_UNSUPPORTED" });
    if (disabled === false && capabilities!.parameter === "reasoning_effort") return {};
    return validatedReasoningConfig(capabilities, disabled);
  }
  try { return validatedReasoningConfig(capabilities, value); }
  catch (error) { throw Object.assign(new Error("The model cannot honor the selected reasoning level."), { code: "REASONING_UNSUPPORTED", cause: error }); }
}

async function prepareResponse(raw: SmartKpiServiceRequest, caller: AbortSignal, requestUrl: string, deps: SmartKpiServiceDependencies = {}): Promise<KpiSuggestionModelOutput> {
  smartRecord(raw, ["input", "providerId", "providerConfig", "timeoutMs", "requestId"], ["input", "providerId"]); smartString(raw.providerId, 160);
  const input = validateKpiSuggestionTaskInput(raw.input), cli = raw.providerId === "local_runner" && String(raw.providerConfig?.backendId).endsWith("_subscription");
  const requested = raw.timeoutMs ?? raw.providerConfig?.timeoutMs ?? (cli ? 30_000 : 15_000);
  smartAssert(typeof requested === "number" && Number.isSafeInteger(requested) && requested > 0, "INVALID_TIMEOUT", "Smart timeout must be a positive integer.");
  const duration = Math.min(requested, cli ? 30_000 : 15_000), controller = new AbortController(); let timedOut = false;
  const abort = () => controller.abort(); caller.addEventListener("abort", abort, { once: true }); if (caller.aborted) abort();
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, duration);
  try {
    controller.signal.throwIfAborted();
    await assertCurrentSmartKpiSkill(input.context);
    controller.signal.throwIfAborted();
    const selected = { ...raw, timeoutMs: duration };
    const provider = await abortable(deps.provider ? deps.provider(selected, controller.signal) : selectedProvider(selected, controller.signal, requestUrl), controller.signal);
    controller.signal.throwIfAborted();
    const operation = runSuggestIncomingKpis(provider, input, { signal: controller.signal,
      maxTokens: typeof raw.providerConfig?.maxTokens === "number" ? Math.min(raw.providerConfig.maxTokens, 2048) : 2048 });
    // Managed/paired execution waits for the remote owned-process close/cleanup.
    const result = await operation;
    controller.signal.throwIfAborted();
    await assertCurrentSmartKpiSkill(input.context);
    controller.signal.throwIfAborted();
    return result;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "CLEANUP_UNCONFIRMED") throw error;
    if (timedOut) throw Object.assign(new Error("Smart suggestion preparation timed out."), { code: "TIMEOUT" });
    if (caller.aborted) throw Object.assign(new Error("Smart suggestion preparation was cancelled."), { code: "CANCELLED", name: "AbortError" });
    if ((error as { code?: string })?.code === "unsupported_reasoning") throw Object.assign(new Error("The provider rejected the selected reasoning setting."), { code: "REASONING_UNSUPPORTED" });
    if (error instanceof ProviderHttpError) {
      const code = error.code === "insufficient_quota" ? "PROVIDER_QUOTA" : error.code === "model_not_found" ? "PROVIDER_MODEL_UNAVAILABLE"
        : error.status === 401 || error.status === 403 ? "PROVIDER_AUTH" : error.status === 429 ? "PROVIDER_RATE_LIMIT" : "PROVIDER_REQUEST_REJECTED";
      throw Object.assign(new Error("The selected provider rejected Smart preparation."), { code });
    }
    throw error;
  } finally { clearTimeout(timer); caller.removeEventListener("abort", abort); }
}
