import type { ModelReasoningCapabilities } from "@vdt-studio/ai-harness/browser";
import { resolveExecutionCategory } from "./execution-category";
import type { ExecutionSettings } from "./execution-mode-catalog";
import type { PublicAgentExecutionBindingSummary } from "./agent-client";

/** Explicit, bounded admission. Endpoints and values are revalidated by the host. */
export function providerConnectionRequest(settings: ExecutionSettings, providerId: string, config: Record<string, unknown> = {}, includeReasoning = true): { providerId: string; providerConfig: Record<string, unknown> } | undefined {
  const category = resolveExecutionCategory(settings);
  if (category === "cli_subscriptions" || providerId === "mock") return undefined;
  if (category === "local_models") {
    if (!["ollama", "lm_studio", "vllm"].includes(String(config.backendId))) return undefined;
    return { providerId: "local_runner", providerConfig: {
      backendId: config.backendId, model: config.model,
      ...(includeReasoning && config.modelReasoning !== undefined ? { modelReasoning: config.modelReasoning } : {})
    } };
  }
  if (!["openai_compatible", "anthropic", "gemini", "azure_openai"].includes(providerId)) return undefined;
  if (typeof config.apiKey !== "string" || !config.apiKey.trim()) throw new Error("Add an API key in provider settings before connecting chat.");
  const fields = ["model", "apiKey", "baseUrl", "endpoint", "deployment", "apiVersion", "anthropicVersion"];
  return { providerId, providerConfig: {
    ...Object.fromEntries(fields.flatMap((key) => config[key] !== undefined ? [[key, config[key]]] : [])),
    ...(typeof config.maxTokens === "number" ? { maxTokens: Math.min(32768, Math.max(1, Math.floor(config.maxTokens))) } : {}),
    ...(includeReasoning && config.modelReasoning !== undefined ? { modelReasoning: config.modelReasoning } : {})
  } };
}

export async function prepareProviderAgentBinding(settings: ExecutionSettings, providerId: string, config: Record<string, unknown> | undefined, fetcher: typeof fetch = fetch): Promise<string | undefined> {
  const connection = providerConnectionRequest(settings, providerId, config);
  if (!connection) return undefined;
  const response = await fetcher("/api/agent/bindings/provider", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ operation: "admit", ...connection, ...(config?.enableResearch === true ? { enableResearch: true } : {}) })
  });
  const payload = await response.json() as { ok?: boolean; error?: string; binding?: PublicAgentExecutionBindingSummary };
  if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Provider chat admission failed.");
  const binding = payload.binding;
  const backend = connection.providerId === "local_runner" ? config?.backendId : providerId;
  if (!binding || binding.executionProfile !== "model_agent" || binding.backendId !== backend || binding.modelId !== config?.model
    || binding.modelReasoning !== config?.modelReasoning || !(binding.bindingId.startsWith("api_byok_session_") || (connection.providerId === "local_runner" && binding.bindingId.startsWith("local_model_")))) {
    throw new Error("Provider admission did not match the selected model and reasoning.");
  }
  return binding.bindingId;
}

export async function requestProviderModelCapabilities(connection: NonNullable<ReturnType<typeof providerConnectionRequest>>, signal?: AbortSignal, fetcher: typeof fetch = fetch) {
  const response = await fetcher("/api/agent/bindings/provider", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ operation: "capabilities", ...connection }), ...(signal ? { signal } : {})
  });
  const result = await response.json() as { ok?: boolean; modelId?: string; capabilities?: ModelReasoningCapabilities | null; error?: string };
  if (!response.ok || result.ok !== true || result.modelId !== connection.providerConfig.model) {
    throw Object.assign(new Error(result.error ?? "Could not connect to the selected model."), { status: response.status });
  }
  return result.capabilities ?? undefined;
}
