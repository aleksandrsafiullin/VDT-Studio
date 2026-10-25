import { awaitProviderSettlement, readBoundedText } from "@vdt-studio/ai-harness/browser";
import { buildKpiSuggestionTaskInput, kpiCanonicalJson, kpiContentHash, materializeKpiSuggestion, validateKpiSuggestionModelOutput,
  type KpiSuggestionContext, type KpiSuggestionExecutionIdentity } from "@vdt-studio/vdt-core";
import { apiKeyScope } from "./api-key-persistence";
import { IndexedDbApiKeyVault, type ApiKeyVault } from "./api-key-vault";
import { resolveExecutionSettings } from "./execution-mode-resolver";
import { resolveVdtAppMode, type VdtAppMode } from "./app-mode";
import { createAiExecutionClient, resolveDesktopSmartExecution, type AiExecutionClient } from "./ai-execution-client";
import type { ExecutionSettings } from "./execution-mode-catalog";
import type { SmartCodexHostIdentity } from "./smart-kpi-host-identity";
import type { SmartKpiSchedulerOptions } from "./smart-kpi-scheduler";

const error = (code: string) => Object.assign(new Error(code === "CLEANUP_UNCONFIRMED" ? "Preparation transport cleanup is unconfirmed." : "Smart preparation could not complete."), { code });
export interface SmartKpiClientOptions {
  vault?: ApiKeyVault; fetch?: typeof fetch; appMode?: VdtAppMode; executionClient?: Pick<AiExecutionClient, "complete">;
  pairingToken?: string; now?: () => number;
  /** A stable descriptor admitted by the selected host/runner, never a model. */
  cliBinding?: SmartCodexHostIdentity;
}
export interface SmartKpiPreparedSelection {
  execution: KpiSuggestionExecutionIdentity;
  modelResolution: "exact" | "host_default_alias";
  prepare: SmartKpiSchedulerOptions["prepare"];
  /** Action-time settings/host admission check; never a model request. */
  revalidate(settings: ExecutionSettings): Promise<boolean>;
}

/** Resolve once per selected settings/credential change, before hover. Secrets
 * stay in this closure and the existing vault; scheduler/cache see only identity. */
export async function createSmartKpiPreparedSelection(settings: ExecutionSettings, options: SmartKpiClientOptions = {}): Promise<SmartKpiPreparedSelection> {
  const resolved = resolveExecutionSettings(settings), config = { ...resolved.providerConfig }, fetcher = options.fetch ?? globalThis.fetch;
  const local = resolved.providerId === "local_runner", backendId = local ? String(config.backendId ?? "") : resolved.providerId;
  const cli = backendId === "codex_subscription", mode = options.appMode ?? resolveVdtAppMode();
  if (resolved.providerId === "mock" || local && !["codex_subscription", "ollama", "lm_studio", "vllm"].includes(backendId)) throw error("SUGGESTIONS_UNAVAILABLE");
  const requestedTimeout = (settings.timeoutSec ?? (cli ? 30 : 15)) * 1000;
  if (!Number.isSafeInteger(requestedTimeout) || requestedTimeout <= 0) throw error("INVALID_TIMEOUT");
  const timeoutMs = Math.min(requestedTimeout, cli ? 30_000 : 15_000);
  config.timeoutMs = timeoutMs;
  let identity: KpiSuggestionExecutionIdentity, resolution: SmartKpiPreparedSelection["modelResolution"] = "exact", revalidateCredential = async () => {};
  if (local) {
    const runner = new URL(String(config.runnerUrl));
    if (!["http:", "https:"].includes(runner.protocol) || runner.username || runner.password || runner.search || runner.hash || !["localhost", "127.0.0.1", "[::1]"].includes(runner.hostname) || runner.pathname !== "/") throw error("SUGGESTIONS_UNAVAILABLE");
    if (options.pairingToken) config.pairingToken = options.pairingToken;
    if (cli) {
      let binding = options.cliBinding;
      if (!binding) {
        if (mode === "desktop" && !options.pairingToken) {
          binding = await resolveDesktopSmartExecution({ backendId: "codex_subscription", timeoutMs: Math.min(timeoutMs, 5000), ...(config.model ? { model: String(config.model) } : {}) });
        } else {
        // Native/paired hosts may supply their existing admitted binding. The
        // development host has a separate bounded metadata-only admission API.
        const admissionMs = Math.min(timeoutMs, 5_000), signal = AbortSignal.timeout(admissionMs + 1_500);
        const destination = options.pairingToken ? `${String(config.runnerUrl).replace(/\/$/, "")}/v1/smart-execution` : "/api/ai/suggestions/execution";
        const response = await awaitProviderSettlement(fetcher(destination, { method: "POST", redirect: "error", headers: { "content-type": "application/json", ...(options.pairingToken ? { authorization: `Bearer ${options.pairingToken}` } : {}) }, body: JSON.stringify({ backendId, timeoutMs: admissionMs, ...(config.model ? { model: config.model } : {}) }), signal }), signal);
        const payload = JSON.parse(await readBoundedText(response, 8 * 1024, "Smart identity", signal, true));
        if (!response.ok || !payload.ok) throw error(payload.error?.code === "CLEANUP_UNCONFIRMED" ? "CLEANUP_UNCONFIRMED" : "SUGGESTIONS_UNAVAILABLE");
        binding = payload.identity;
        }
      }
      if (!binding || binding.backendId !== backendId || !binding.modelId || !binding.requestModel || !binding.bindingVersion || !binding.credentialEpoch
        || !["exact", "host_default_alias"].includes(binding.modelResolution)
        || settings.cliModelSelection?.source === "custom" && binding.requestModel !== settings.cliModelSelection.customModel) throw error("STALE_EXECUTION");
      config.model = binding.requestModel; resolution = binding.modelResolution;
      identity = { mode: "cli", backendId, modelId: binding.modelId, bindingVersion: binding.bindingVersion, credentialEpoch: binding.credentialEpoch };
    } else {
      if (!config.model || typeof config.model !== "string") throw error("SUGGESTIONS_UNAVAILABLE");
      identity = { mode: "local_model", backendId, modelId: config.model,
        bindingVersion: await kpiContentHash(["smart-manifest-local-http.v1", backendId, config.runnerUrl ?? "managed", config.model]), credentialEpoch: "manifest-no-credential.v1" };
    }
  } else {
    const scope = apiKeyScope(settings), key = settings.apiKey, vault = options.vault ?? new IndexedDbApiKeyVault();
    if (!scope || !key || !vault.identity || !config.model) throw error("SUGGESTIONS_UNAVAILABLE");
    const credentialEpoch = await vault.identity(scope, key);
    revalidateCredential = async () => { try { if (await vault.identity!(scope, key) !== credentialEpoch) throw error("STALE_EXECUTION"); } catch { throw error("STALE_EXECUTION"); } };
    identity = { mode: "api", backendId, modelId: String(config.model), credentialEpoch,
      bindingVersion: await kpiContentHash(["smart-api-protocol.v1", scope, config.apiVersion ?? null, config.anthropicVersion ?? null]) };
  }
  const execution = Object.freeze(identity), key = kpiCanonicalJson(execution);
  const { cliBinding: _binding, ...readmitOptions } = options;
  return { execution, modelResolution: resolution, revalidate: async current => {
    try { return kpiCanonicalJson((await createSmartKpiPreparedSelection(current, cli ? readmitOptions : options)).execution) === key; }
    catch { return false; }
  }, prepare: async ({ context, execution: expected, signal }) => {
    if (kpiCanonicalJson(expected) !== key) throw error("STALE_EXECUTION");
    signal.throwIfAborted(); await revalidateCredential(); signal.throwIfAborted(); const input = buildKpiSuggestionTaskInput(context);
    let output: unknown;
    if (local && mode === "desktop") {
      // IPC complete remains pending until the same sidecar execution returns;
      // cancellation cannot release the slot on the ai_cancel write alone.
      const client = options.executionClient ?? createAiExecutionClient("desktop", fetcher);
      const result = await client.complete({ taskType: "suggest_incoming_kpis", input, providerId: "local_runner", providerConfig: config }, { signal });
      if (result.kind !== "suggestions") throw error("INVALID_RESPONSE"); output = result.result;
    } else output = await prepareSmartThroughHttp(fetcher, { input, providerId: resolved.providerId, providerConfig: config, timeoutMs }, signal);
    signal.throwIfAborted(); const validated = validateKpiSuggestionModelOutput(output);
    if (validated.status === "empty") return { status: "empty", reason: validated.rationale, limitations: validated.limitations };
    return materializeKpiSuggestion(output, context, { requestId: crypto.randomUUID(), proposalId: crypto.randomUUID(), now: new Date((options.now ?? Date.now)()).toISOString(), execution });
  } };
}

export async function prepareSmartThroughHttp(fetcher: typeof fetch, body: Record<string, unknown>, caller: AbortSignal): Promise<unknown> {
  caller.throwIfAborted(); const requestId = crypto.randomUUID(), controller = new AbortController();
  const duration = Number(body.timeoutMs), endGrace = 2_500;
  let terminal = false, timedOut = false, cancellation: Promise<void> | undefined;
  const reconcile = async () => {
    const end = Date.now() + endGrace;
    while (Date.now() < end) {
      try {
        const signal = AbortSignal.timeout(Math.max(1, end - Date.now()));
        const response = await awaitProviderSettlement(fetcher("/api/ai/suggestions/cancel", { method: "POST", redirect: "error", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId }), signal }), signal);
        const payload = JSON.parse(await readBoundedText(response, 8 * 1024, "Smart cancel", signal, true));
        if (payload.requestId === requestId && payload.cleanupConfirmed === true) { terminal = true; controller.abort(); return; }
        if (payload.cleanupConfirmed === false || payload.error?.code === "CLEANUP_UNCONFIRMED") throw error("CLEANUP_UNCONFIRMED");
        if (terminal) return;
        if (response.status !== 404) throw error("CLEANUP_UNCONFIRMED");
      } catch (failure) { if ((failure as { code?: string })?.code === "CLEANUP_UNCONFIRMED") throw failure; }
      if (terminal) return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    if (!terminal) throw error("CLEANUP_UNCONFIRMED");
  };
  const cancel = () => { cancellation ??= reconcile().catch(failure => { controller.abort(); throw failure; }); void cancellation.catch(() => {}); };
  caller.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => { timedOut = true; cancel(); }, duration);
  const hard = setTimeout(() => controller.abort(), duration + endGrace + 1_250);
  try {
    const response = await awaitProviderSettlement(fetcher("/api/ai/suggestions", { method: "POST", redirect: "error", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, requestId }), signal: controller.signal }), controller.signal);
    const payload = JSON.parse(await readBoundedText(response, 64 * 1024, "Smart preparation", controller.signal, true));
    if (payload.error?.code === "CLEANUP_UNCONFIRMED") throw error("CLEANUP_UNCONFIRMED");
    terminal = true; if (cancellation) await cancellation;
    if (caller.aborted || timedOut) throw error(timedOut ? "TIMEOUT" : "CANCELLED");
    if (!response.ok || !payload.ok) throw error(["SUGGESTIONS_UNAVAILABLE", "NOT_A_DECOMPOSITION"].includes(payload.error?.code) ? payload.error.code : "PREPARATION_FAILED");
    return validateKpiSuggestionModelOutput(payload.result);
  } catch (failure) {
    if ((failure as { code?: string })?.code === "CLEANUP_UNCONFIRMED") throw failure;
    if (!terminal) { cancel(); await cancellation; }
    if (caller.aborted || timedOut) throw error(timedOut ? "TIMEOUT" : "CANCELLED"); throw failure;
  } finally { clearTimeout(timer); clearTimeout(hard); caller.removeEventListener("abort", cancel); controller.abort(); }
}
