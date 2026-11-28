import { builtinHarness } from "@vdt-studio/model-bridge/harness-catalog";
import type { ExecutionExpectation } from "@vdt-studio/vdt-agent-runtime";

const localHttpBackends = ["ollama", "lm_studio", "vllm"];
const apiProviders = ["openai_compatible", "anthropic", "azure_openai", "gemini"];

/** Client assertions narrow the requested selection. The receiving host owns admission. */
export function taskExecutionAssertion(providerId: unknown, providerConfig: unknown): { expectedExecution?: ExecutionExpectation } {
  if (typeof providerId !== "string" || !providerConfig || typeof providerConfig !== "object") return {};
  const config = providerConfig as Record<string, unknown>;
  const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
  const modelId = text(providerId === "azure_openai" ? config.deployment : undefined) || text(config.model);
  if (!modelId || modelId.length > 160) return {};
  const selection = { profileVersion: 1, modelId, modelRevision: null } as const;
  if (providerId === "local_runner") {
    const backendId = text(config.backendId);
    // Pairing authenticates a connection, while its host identity and model
    // revision are unavailable to this browser contract.
    if (config.pairingToken) return {};
    if (localHttpBackends.includes(backendId)) return { expectedExecution: { ...selection, mode: "legacy", providerId: backendId } };
    if (builtinHarness(backendId)) return { expectedExecution: { ...selection, mode: "cli_subscription", providerId: backendId } };
    return {};
  }
  const endpoint = text(providerId === "azure_openai" ? config.endpoint : undefined) || text(config.baseUrl);
  if (!apiProviders.includes(providerId) || !text(config.apiKey)) return {};
  let target: URL;
  try { target = new URL(endpoint); } catch { return {}; }
  if (target.protocol !== "https:" || target.username || target.password) return {};
  return { expectedExecution: { ...selection, mode: "api_keys", providerId } };
}
