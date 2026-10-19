import type { ExecutionSettings } from "./execution-mode-catalog";
import { resolveExecutionCategory } from "./execution-category";

/** Explicit admission, separate from immutable run requests. This function
 * never persists credentials or admits arbitrary provider endpoints. */
export async function prepareOpenAiAgentBinding(
  settings: ExecutionSettings,
  providerId: string,
  config: Record<string, unknown> | undefined,
  fetcher: typeof fetch = fetch
): Promise<string | undefined> {
  if (resolveExecutionCategory(settings) !== "byok" || providerId !== "openai_compatible") return undefined;
  const baseUrl = typeof config?.baseUrl === "string" ? config.baseUrl.replace(/\/+$/, "") : "https://api.openai.com/v1";
  if (baseUrl !== "https://api.openai.com/v1") return undefined;
  const model = typeof config?.model === "string" ? config.model : settings.model;
  const apiKey = typeof config?.apiKey === "string" ? config.apiKey : settings.apiKey;
  if (!model || !apiKey?.trim()) throw new Error("Enter an OpenAI model and API key before starting the agent.");
  const response = await fetcher("/api/agent/bindings/openai", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, apiKey, ...(typeof config?.maxTokens === "number" ? { maxTokens: config.maxTokens } : {}),...(config?.enableResearch===true?{enableResearch:true}:{}) })
  });
  const payload = await response.json() as { ok?: boolean; error?: string; binding?: { bindingId?: string; executionProfile?: string; backendId?: string; modelId?: string } };
  if (!response.ok || payload.ok !== true) throw new Error(payload.error ?? "OpenAI agent admission failed.");
  const binding = payload.binding;
  if (!binding?.bindingId?.startsWith("openai_byok_session_") || binding.executionProfile !== "model_agent"
    || binding.backendId !== "openai_compatible" || binding.modelId !== model)
    throw new Error("OpenAI agent admission did not match the selected model.");
  return binding.bindingId;
}
