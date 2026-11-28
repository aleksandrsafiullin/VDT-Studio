import { builtinHarness } from "@vdt-studio/model-bridge/harness-catalog";
import type {
  AgentExecutionBindingSelection,
  PublicAgentExecutionBindingSummary,
  VdtAgentPublicStartRequest
} from "@/lib/agent-client";
import type { ExecutionSettings } from "@/lib/execution-mode-catalog";
import { isAdaptiveReasoningOffer, validAdaptiveReasoningPolicy } from "@/app/api/agent/runs/adaptive-reasoning";
import { resolveExecutionCategory } from "@/lib/execution-category";

export const NO_EXECUTION_BINDING_MESSAGE =
  "No server-managed execution binding is available. Enable Model Agent or select a registered binding.";

const CLI_AGENT_DISPLAY_NAMES: Record<string, string> = {
  cursor_subscription: "Cursor",
  codex_subscription: "Codex",
  claude_subscription: "Claude",
  copilot_subscription: "Copilot"
};
const LOCAL_MODEL_BACKEND_IDS = new Set(["ollama", "lm_studio", "vllm"]);

export function formatNoExternalExecutionBindingMessage(backendId?: string): string {
  const label = backendId ? CLI_AGENT_DISPLAY_NAMES[backendId] ?? builtinHarness(backendId)?.name ?? "CLI" : "CLI";
  return `${label} CLI is installed, but no qualified server-managed ${label} session binding is available. This run was not started; legacy per-decision CLI fallback is disabled.`;
}

export const NO_EXTERNAL_EXECUTION_BINDING_MESSAGE = formatNoExternalExecutionBindingMessage();

export function formatNoLocalModelExecutionBindingMessage(backendId?: string): string {
  const label = ({ ollama: "Ollama", lm_studio: "LM Studio", vllm: "vLLM" } as Record<string, string>)[backendId ?? ""] ?? "the selected local model";
  return `${label} chat is unavailable for the selected model. Start the local model server, install or load the model, and refresh models in Settings. Local model chat must be enabled on this host. This run was not started.`;
}

type CommonAgentStartRequest = Omit<
  VdtAgentPublicStartRequest,
  "executionBindingId" | "expectedExecution" | "providerId" | "providerConfig"
>;

export function resolveExecutionBindingId(
  bindings: AgentExecutionBindingSelection,
  executionSettings: ExecutionSettings,
  providerId: string,
  providerConfig: Record<string, unknown> | undefined
): string | null {
  const category = resolveExecutionCategory(executionSettings);
  if (category !== "byok") {
    const backendId = typeof providerConfig?.backendId === "string" ? providerConfig.backendId.trim() : "";
    const modelId = typeof providerConfig?.model === "string" ? providerConfig.model.trim() : "";
    if (!backendId) return null;
    if (category === "local_models" && !LOCAL_MODEL_BACKEND_IDS.has(backendId)) return null;
    return (
      bindings.bindings.find(
        (binding) =>
          !isAdaptiveReasoningOffer(binding.bindingId) && binding.adaptiveReasoning === undefined
          && binding.executionProfile === (category === "cli_subscriptions" ? "external_cli_agent" : "model_agent")
          && binding.backendId === backendId
          && (!modelId || binding.modelId === modelId)
          && (category !== "cli_subscriptions" || binding.reasoningEffort === executionSettings.cliModelSelection?.reasoningEffort)
          && (category !== "local_models" || binding.modelReasoning === providerConfig?.modelReasoning)
      )?.bindingId ?? null
    );
  }

  const modelBindings = bindings.bindings.filter(
    (binding): binding is PublicAgentExecutionBindingSummary =>
      !isAdaptiveReasoningOffer(binding.bindingId) && binding.adaptiveReasoning === undefined
      && binding.executionProfile === "model_agent"
  );
  const modelId = typeof providerConfig?.model === "string" ? providerConfig.model.trim() : "";
  const backendMatch = modelBindings.find((binding) => binding.backendId === providerId && (!modelId || binding.modelId === modelId) && binding.modelReasoning === providerConfig?.modelReasoning);
  return backendMatch?.bindingId ?? null;
}

export function resolveVerifiedLocalModelBinding(
  bindings: AgentExecutionBindingSelection,
  settings: ExecutionSettings,
  config: Record<string, unknown> | undefined
): PublicAgentExecutionBindingSummary | undefined {
  if (resolveExecutionCategory(settings) !== "local_models") return undefined;
  return bindings.bindings.find(binding =>
    !isAdaptiveReasoningOffer(binding.bindingId) && binding.adaptiveReasoning === undefined
    && binding.admission?.mode === "local"
    && binding.backendId === config?.backendId
    && binding.modelId === config?.model
    && binding.modelReasoning === config?.modelReasoning
  );
}

export function buildAgentPublicStartRequest(
  commonRequest: CommonAgentStartRequest,
  executionSettings: ExecutionSettings,
  bindings: AgentExecutionBindingSelection,
  options: {
    explicitBindingId?: string | undefined;
    admittedBinding?: PublicAgentExecutionBindingSummary | undefined;
    providerId: string;
    providerConfig?: Record<string, unknown> | undefined;
  }
): VdtAgentPublicStartRequest {
  const explicitBindingId = options.admittedBinding?.bindingId ?? options.explicitBindingId?.trim();
  const bindingId = explicitBindingId || resolveExecutionBindingId(
    bindings,
    executionSettings,
    options.providerId,
    options.providerConfig
  );
  const category = resolveExecutionCategory(executionSettings);
  if (bindingId) {
    const binding = options.admittedBinding ?? bindings.bindings.find((entry) => entry.bindingId === bindingId);
    const admission = binding?.admission;
    if (isAdaptiveReasoningOffer(bindingId)
      && (!options.admittedBinding || !validAdaptiveReasoningPolicy(binding?.adaptiveReasoning) || admission?.mode !== "legacy")) {
      throw new Error("Refresh the scoped Ollama admission before starting an adaptive run.");
    }
    if (!admission) return { ...commonRequest, executionBindingId: bindingId };

    const { mode, profileVersion, providerId, modelId, modelRevision } = admission;
    const modeMatches = category === "local_models" ? mode === "local" || mode === "legacy"
      : category === "cli_subscriptions" ? mode === "cli_subscription"
        : mode === "api_keys" || (mode === "legacy" && providerId === "mock");
    const explicitApple = Boolean((options.admittedBinding || options.explicitBindingId)
      && binding.appleIdentity && providerId === "apple_foundation_models" && mode === "local");
    if ((!modeMatches && !explicitApple) || providerId !== binding.backendId || modelId !== binding.modelId) {
      throw new Error("The selected execution mode and model no longer match the host binding. Refresh the connection.");
    }
    return {
      ...commonRequest,
      executionBindingId: bindingId,
      expectedExecution: { mode, profileVersion, providerId, modelId, modelRevision }
    };
  }

  if (category !== "byok") {
    const backendId = typeof options.providerConfig?.backendId === "string"
      ? options.providerConfig.backendId.trim()
      : undefined;
    throw new Error(category === "cli_subscriptions"
      ? formatNoExternalExecutionBindingMessage(backendId)
      : formatNoLocalModelExecutionBindingMessage(backendId));
  }

  throw new Error(NO_EXECUTION_BINDING_MESSAGE);
}
