import { createAiExecutionClient, type AiExecutionClient } from "./ai-execution-client";
import { resolveExecutionCategory, type ExecutionCategory } from "./execution-category";
import type { CliAgentId, ExecutionSettings } from "./execution-mode-catalog";
import { resolveExecutionSettings } from "./execution-mode-resolver";

export interface ProviderModelSource {
  category: ExecutionCategory;
  providerId: string;
  cliAgentId?: CliAgentId | undefined;
  backendId?: string | undefined;
  providerConfig: Record<string, unknown>;
}

/** Model/effort changes do not change the catalog's account/endpoint identity.
 * The credential stays in memory separately; it is never a cache/storage key. */
export function providerModelSource(settings: ExecutionSettings): { source: ProviderModelSource; apiKey?: string | undefined } {
  const execution = resolveExecutionSettings(settings);
  const config = execution.providerConfig ?? {};
  const providerConfig = Object.fromEntries(
    ["baseUrl", "endpoint", "anthropicVersion", "apiVersion"].flatMap((key) => config[key] !== undefined ? [[key, config[key]]] : [])
  );
  return {
    source: {
      category: resolveExecutionCategory(settings), providerId: execution.providerId,
      cliAgentId: settings.selectedCliAgentId,
      backendId: typeof config.backendId === "string" ? config.backendId : undefined,
      providerConfig
    },
    apiKey: typeof config.apiKey === "string" ? config.apiKey : undefined
  };
}

export function normalizeProviderModelIds(values: readonly unknown[]): string[] {
  return [...new Set(values.flatMap((value) => {
    if (typeof value !== "string") return [];
    const id = value.trim();
    return id && id.length <= 160 && !/[\u0000-\u001f\u007f]/.test(id) ? [id] : [];
  }))].slice(0, 1000);
}

export async function loadByokModelCatalog(
  execution: { providerId: string; providerConfig?: Record<string, unknown> | undefined },
  options: { fetcher?: typeof fetch; signal?: AbortSignal | undefined } = {}
): Promise<string[]> {
  if (execution.providerId === "azure_openai") {
    throw new Error("Azure requires a deployment name. Enter your deployment manually.");
  }
  if (execution.providerId === "mock") return [];
  if (typeof execution.providerConfig?.apiKey !== "string" || !execution.providerConfig.apiKey.trim()) {
    throw new Error("Add an API key in provider settings to load models.");
  }
  const response = await (options.fetcher ?? fetch)("/api/ai/generate-vdt", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ operation: "list_models", ...execution }), ...(options.signal ? { signal: options.signal } : {})
  }).catch(() => {
    options.signal?.throwIfAborted();
    throw new Error("Could not reach the provider model catalog. Reopen to try again.");
  });
  const payload = await response.json() as { ok?: boolean; models?: unknown; error?: unknown };
  if (!response.ok || !payload.ok || !Array.isArray(payload.models)) {
    // Do not display arbitrary remote text that could echo credentials.
    const upstreamStatus = typeof payload.error === "string" ? payload.error.match(/model discovery failed with status (\d{3})\./)?.[1] : undefined;
    if (upstreamStatus === "401" || upstreamStatus === "403") {
      throw new Error(`The provider rejected model-list access (HTTP ${upstreamStatus}). Check the saved API key and account access.`);
    }
    if (upstreamStatus) throw new Error(`Provider model discovery failed (HTTP ${upstreamStatus}). Check provider settings.`);
    if (typeof payload.error === "string" && /model discovery timed out\.$/.test(payload.error)) {
      throw new Error("Provider model discovery timed out. Reopen to try again.");
    }
    throw new Error(`Could not load provider models (HTTP ${response.status}). Check provider settings.`);
  }
  return normalizeProviderModelIds(payload.models);
}

export async function loadProviderModelCatalog(source: ProviderModelSource, apiKey?: string, options: {
  client?: Pick<AiExecutionClient, "detectSubscriptionClis" | "listModels">;
  fetcher?: typeof fetch;
  signal?: AbortSignal | undefined;
} = {}): Promise<string[]> {
  options.signal?.throwIfAborted();
  if (source.category === "byok") {
    return loadByokModelCatalog({ providerId: source.providerId, providerConfig: { ...source.providerConfig, ...(apiKey ? { apiKey } : {}) } }, options);
  }
  const client = options.client ?? createAiExecutionClient();
  try {
    if (source.category === "cli_subscriptions") {
      if (!source.cliAgentId) return [];
      const result = await client.detectSubscriptionClis(source.cliAgentId);
      options.signal?.throwIfAborted();
      const ready = result.agents.find((agent) => agent.id === source.cliAgentId)?.status === "ready";
      return ready ? normalizeProviderModelIds(result.modelsByAgent[source.cliAgentId] ?? []) : [];
    }
    if (!source.backendId) return [];
    const result = await client.listModels(source.backendId);
    options.signal?.throwIfAborted();
    return normalizeProviderModelIds(result.map((model) => model.id));
  } catch {
    options.signal?.throwIfAborted();
    throw new Error(source.category === "cli_subscriptions"
      ? "Could not load CLI models. Check sign-in in provider settings."
      : "Could not load local models. Start the model server and reopen this menu.");
  }
}
