import type {
  AgentExecutionBindingSelection,
  PublicAgentExecutionBindingSummary,
  VdtAgentPublicStartRequest
} from "@/lib/agent-client";
import type { ExecutionSettings } from "@/lib/execution-mode-catalog";

export const NO_EXECUTION_BINDING_MESSAGE =
  "No server-managed execution binding is available. Enable Model Agent or select a registered binding.";

const CLI_AGENT_DISPLAY_NAMES: Record<string, string> = {
  cursor_subscription: "Cursor",
  codex_subscription: "Codex",
  claude_subscription: "Claude",
  gemini_subscription: "Gemini",
  copilot_subscription: "Copilot"
};

export function formatNoExternalExecutionBindingMessage(backendId?: string): string {
  const label = backendId ? CLI_AGENT_DISPLAY_NAMES[backendId] ?? "CLI" : "CLI";
  return `${label} CLI is installed, but no qualified server-managed ${label} session binding is available. This run was not started; legacy per-decision CLI fallback is disabled.`;
}

export const NO_EXTERNAL_EXECUTION_BINDING_MESSAGE = formatNoExternalExecutionBindingMessage();

type CommonAgentStartRequest = Omit<
  VdtAgentPublicStartRequest,
  "executionBindingId" | "providerId" | "providerConfig"
>;

export function resolveExecutionBindingId(
  bindings: AgentExecutionBindingSelection,
  executionSettings: ExecutionSettings,
  providerId: string,
  providerConfig: Record<string, unknown> | undefined
): string | null {
  if (executionSettings.executionMode === "local_cli") {
    const backendId = typeof providerConfig?.backendId === "string" ? providerConfig.backendId.trim() : "";
    const modelId = typeof providerConfig?.model === "string" ? providerConfig.model.trim() : "";
    if (!backendId) return null;
    return (
      bindings.bindings.find(
        (binding) =>
          binding.executionProfile === "external_cli_agent"
          && binding.backendId === backendId
          && (!modelId || binding.modelId === modelId)
      )?.bindingId ?? null
    );
  }

  const modelBindings = bindings.bindings.filter(
    (binding): binding is PublicAgentExecutionBindingSummary =>
      binding.executionProfile === "model_agent"
  );
  const backendMatch = modelBindings.find((binding) => binding.backendId === providerId);
  return backendMatch?.bindingId ?? null;
}

export function buildAgentPublicStartRequest(
  commonRequest: CommonAgentStartRequest,
  executionSettings: ExecutionSettings,
  bindings: AgentExecutionBindingSelection,
  options: {
    explicitBindingId?: string | undefined;
    providerId: string;
    providerConfig?: Record<string, unknown> | undefined;
  }
): VdtAgentPublicStartRequest {
  const explicitBindingId = options.explicitBindingId?.trim();
  if (explicitBindingId) {
    return { ...commonRequest, executionBindingId: explicitBindingId };
  }

  const bindingId = resolveExecutionBindingId(
    bindings,
    executionSettings,
    options.providerId,
    options.providerConfig
  );
  if (bindingId) {
    return { ...commonRequest, executionBindingId: bindingId };
  }

  if (executionSettings.executionMode === "local_cli") {
    const backendId = typeof options.providerConfig?.backendId === "string"
      ? options.providerConfig.backendId.trim()
      : undefined;
    throw new Error(formatNoExternalExecutionBindingMessage(backendId));
  }

  throw new Error(NO_EXECUTION_BINDING_MESSAGE);
}
