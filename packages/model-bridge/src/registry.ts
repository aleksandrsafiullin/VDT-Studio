import type { ModelBackendCapabilities, ModelBackendMode } from "./contract";

export interface ModelBackendDefinition {
  id: string;
  label: string;
  mode: ModelBackendMode;
  capabilities: ModelBackendCapabilities;
  releaseStatus: "supported" | "beta" | "alpha" | "experimental" | "beta-blocked" | "experimental-disabled";
}

const capabilities = (
  value: ModelBackendCapabilities
): ModelBackendCapabilities => Object.freeze({ ...value });

const cloud = capabilities({
  structuredOutput: true,
  streaming: true,
  modelSelection: true,
  accountBasedUsage: false,
  localExecution: false,
  toolsCanBeDisabled: true,
  requiresOsSandbox: false
});

const localHttp = capabilities({
  structuredOutput: true,
  streaming: true,
  modelSelection: true,
  accountBasedUsage: false,
  localExecution: true,
  toolsCanBeDisabled: true,
  requiresOsSandbox: false
});

const subscription = (requiresOsSandbox: boolean) => capabilities({
  structuredOutput: true,
  streaming: true,
  modelSelection: true,
  accountBasedUsage: true,
  localExecution: true,
  toolsCanBeDisabled: !requiresOsSandbox,
  requiresOsSandbox
});

export const MODEL_BACKEND_DEFINITIONS: readonly ModelBackendDefinition[] = Object.freeze([
  { id: "mock", label: "Mock", mode: "api", capabilities: cloud, releaseStatus: "supported" },
  { id: "openai_compatible", label: "OpenAI-compatible API", mode: "api", capabilities: cloud, releaseStatus: "supported" },
  { id: "anthropic", label: "Anthropic API", mode: "api", capabilities: cloud, releaseStatus: "supported" },
  { id: "gemini_api", label: "Gemini API", mode: "api", capabilities: cloud, releaseStatus: "supported" },
  { id: "azure_openai", label: "Azure OpenAI", mode: "api", capabilities: cloud, releaseStatus: "supported" },
  { id: "alibaba_coding_plan", label: "Alibaba Cloud Coding Plan", mode: "api", capabilities: cloud, releaseStatus: "beta" },
  { id: "ollama", label: "Ollama", mode: "local_http", capabilities: localHttp, releaseStatus: "supported" },
  { id: "lm_studio", label: "LM Studio", mode: "local_http", capabilities: localHttp, releaseStatus: "supported" },
  { id: "vllm", label: "vLLM", mode: "local_http", capabilities: localHttp, releaseStatus: "beta" },
  {
    id: "cursor_subscription",
    label: "Cursor Agent",
    mode: "subscription_cli",
    capabilities: subscription(true),
    releaseStatus: "beta-blocked"
  },
  { id: "codex_subscription", label: "Codex CLI", mode: "subscription_cli", capabilities: subscription(false), releaseStatus: "alpha" },
  { id: "claude_subscription", label: "Claude Code", mode: "subscription_cli", capabilities: subscription(false), releaseStatus: "alpha" },
  { id: "gemini_subscription", label: "Gemini CLI", mode: "subscription_cli", capabilities: subscription(true), releaseStatus: "experimental" },
  { id: "copilot_subscription", label: "GitHub Copilot CLI", mode: "subscription_cli", capabilities: subscription(true), releaseStatus: "experimental" },
  { id: "custom_cli", label: "Custom JSON CLI", mode: "custom_cli", capabilities: subscription(true), releaseStatus: "experimental-disabled" }
]);

const registry = new Map(MODEL_BACKEND_DEFINITIONS.map((backend) => [backend.id, backend]));

if (registry.size !== MODEL_BACKEND_DEFINITIONS.length) {
  throw new Error("Model backend registry contains duplicate ids.");
}

export function getModelBackendDefinition(id: string): ModelBackendDefinition {
  const backend = registry.get(id);
  if (!backend) throw new Error(`Unknown model backend: ${id}`);
  return backend;
}

export function listModelBackendDefinitions(mode?: ModelBackendMode): readonly ModelBackendDefinition[] {
  return mode ? MODEL_BACKEND_DEFINITIONS.filter((backend) => backend.mode === mode) : MODEL_BACKEND_DEFINITIONS;
}
