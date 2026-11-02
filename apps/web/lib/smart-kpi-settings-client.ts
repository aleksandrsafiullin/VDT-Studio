import { awaitProviderSettlement, isModelReasoningValue, readBoundedText, type ModelReasoningValue } from "@vdt-studio/ai-harness/browser";
import { createAiExecutionClient, resolveDesktopSmartExecution } from "./ai-execution-client";
import { resolveVdtAppMode, type VdtAppMode } from "./app-mode";
import type { ExecutionSettings } from "./execution-mode-catalog";
import { resolveExecutionCategory } from "./execution-category";
import { resolveExecutionSettings } from "./execution-mode-resolver";
import { providerConnectionRequest, requestProviderModelCapabilities } from "./provider-agent-binding";
import { resolveSmartKpiSettings } from "./smart-kpi-settings";
import { loadProviderModelCatalog, normalizeProviderModelIds, providerModelSource } from "./provider-model-catalog";

function pairedRunnerUrl(config: Record<string, unknown>): string {
  const url = new URL(String(config.runnerUrl));
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash
    || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.pathname !== "/") {
    throw new Error("The paired runner must use a valid loopback URL.");
  }
  return url.origin;
}

/** A paired host's catalog must never fall back to this web/desktop host. */
export async function loadSmartKpiModelCatalog(settings: ExecutionSettings, signal: AbortSignal, options: {
  pairingToken?: string | undefined; appMode?: VdtAppMode; fetcher?: typeof fetch;
} = {}): Promise<string[]> {
  const effective = resolveSmartKpiSettings(settings), { source, apiKey } = providerModelSource(effective);
  const fetcher = options.fetcher ?? fetch;
  if (source.category !== "byok" && options.pairingToken) {
    const config = resolveExecutionSettings(effective).providerConfig ?? {}, backendId = String(config.backendId ?? "");
    const target = `${pairedRunnerUrl(config)}/v1/backends/${encodeURIComponent(backendId)}/models`;
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(16_500)]);
    const response = await awaitProviderSettlement(fetcher(target, { method: "GET", redirect: "error", headers: { authorization: `Bearer ${options.pairingToken}` }, signal: deadline }), deadline);
    const payload = JSON.parse(await readBoundedText(response, 256 * 1024, "Suggested KPI model catalog", deadline, true));
    if (!response.ok || !payload.ok || payload.backendId !== backendId || !Array.isArray(payload.models)) throw new Error("Could not load models from the selected paired runner.");
    return normalizeProviderModelIds(payload.models.map((value: unknown) => typeof value === "string" ? value : value && typeof value === "object" && "id" in value ? value.id : undefined));
  }
  return loadProviderModelCatalog(source, apiKey, { signal, fetcher, client: createAiExecutionClient(options.appMode ?? resolveVdtAppMode(), fetcher) });
}

/** Metadata only: no prompt and no requested reasoning value. Unsupported Off
 * must not prevent discovering an explicit supported alternative. */
export async function loadSmartKpiReasoningValues(settings: ExecutionSettings, signal: AbortSignal, options: {
  pairingToken?: string | undefined; appMode?: VdtAppMode; fetcher?: typeof fetch;
} = {}): Promise<ModelReasoningValue[] | undefined> {
  const effective = resolveSmartKpiSettings(settings), execution = resolveExecutionSettings(effective);
  const config = execution.providerConfig ?? {}, fetcher = options.fetcher ?? fetch;
  if (resolveExecutionCategory(effective) === "byok") {
    const connection = providerConnectionRequest(effective, execution.providerId, config, false);
    if (!connection) return undefined;
    return (await requestProviderModelCapabilities(connection, signal, fetcher, "suggested_kpi"))?.values;
  }
  const backendId = String(config.backendId ?? ""), model = typeof config.model === "string" ? config.model : undefined;
  if ((options.appMode ?? resolveVdtAppMode()) === "desktop" && !options.pairingToken) {
    const identity = await resolveDesktopSmartExecution({ backendId, timeoutMs: 5000, ...(model ? { model } : {}) }, { signal });
    return identity.reasoningValues?.filter(isModelReasoningValue);
  }
  const target = options.pairingToken ? `${pairedRunnerUrl(config)}/v1/smart-execution` : "/api/ai/suggestions/execution";
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(6500)]);
  const response = await awaitProviderSettlement(fetcher(target, {
    method: "POST", redirect: "error", headers: { "content-type": "application/json", ...(options.pairingToken ? { authorization: `Bearer ${options.pairingToken}` } : {}) },
    body: JSON.stringify({ backendId, timeoutMs: 5000, ...(model ? { model } : {}) }), signal: deadline
  }), deadline);
  const payload = JSON.parse(await readBoundedText(response, 8 * 1024, "Suggested KPI model options", deadline, true));
  if (!response.ok || !payload.ok || payload.identity?.backendId !== backendId || model && payload.identity?.requestModel !== model) {
    throw new Error("Could not check reasoning options. Verify the selected CLI and model.");
  }
  return Array.isArray(payload.identity?.reasoningValues) ? payload.identity.reasoningValues.filter(isModelReasoningValue) : undefined;
}

export const isReasoningOffValue = (value: ModelReasoningValue) => value === false || value === 0 || ["none", "off", "disabled"].includes(String(value));
export function smartReasoningLabel(value: ModelReasoningValue | undefined): string {
  if (value === undefined) return "Provider default";
  if (isReasoningOffValue(value)) return "Off";
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (typeof value === "number") return `${value.toLocaleString()} tokens`;
  return ({ xhigh: "Extra high" } as Record<string, string>)[value] ?? value.charAt(0).toUpperCase() + value.slice(1);
}
