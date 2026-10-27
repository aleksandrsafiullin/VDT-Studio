import type { ReasoningEffort } from "@vdt-studio/model-bridge";
import type { AgentExecutionBindingSelection } from "./agent-client";
import { resolveExecutionCategory } from "./execution-category";
import type { ExecutionSettings } from "./execution-mode-catalog";
import { resolveExecutionSettings } from "./execution-mode-resolver";

export const REASONING_LABELS: Record<ReasoningEffort, string> = {
  none: "None", minimal: "Minimal", low: "Low", medium: "Medium", high: "High",
  xhigh: "Extra high", max: "Max", ultra: "Ultra"
};

export function reasoningSliderSteps(efforts: readonly ReasoningEffort[]): Array<ReasoningEffort | undefined> {
  return [undefined, ...(Object.keys(REASONING_LABELS) as ReasoningEffort[]).filter((effort) => efforts.includes(effort))];
}

export function composerModelOptions(settings: ExecutionSettings, catalog: AgentExecutionBindingSelection | undefined, detected: readonly string[] = [], providerModels: readonly string[] = []) {
  const category = resolveExecutionCategory(settings);
  const execution = resolveExecutionSettings(settings);
  const backendId = execution.providerConfig?.backendId ?? execution.providerId;
  const matching = catalog?.bindings.filter((binding) => binding.backendId === backendId &&
    binding.executionProfile === (category === "cli_subscriptions" ? "external_cli_agent" : "model_agent")) ?? [];
  const selectedModel = category === "cli_subscriptions"
    ? settings.cliModelSelection?.source === "custom" ? settings.cliModelSelection.customModel ?? "auto" : "auto"
    : String(execution.providerConfig?.model ?? settings.model ?? "");
  const ids = [...new Set([
    ...(category !== "cli_subscriptions" && selectedModel ? [selectedModel] : []),
    ...(category === "cli_subscriptions" && matching.some((binding) => !binding.reasoningEffort) ? ["auto"] : []),
    ...(category === "cli_subscriptions" ? detected : []),
    ...(category === "cli_subscriptions" ? matching.filter((binding) => !binding.reasoningEffort).map((binding) => binding.modelId) : providerModels),
    ...(selectedModel ? [selectedModel] : [])
  ])];
  return {
    category, selectedModel,
    models: ids.map((id) => ({
      id, label: category === "cli_subscriptions" && id === "auto" ? "Provider default" : id,
      available: category !== "cli_subscriptions" || matching.some((binding) => (binding.modelId === id || id === "auto") && !binding.reasoningEffort)
    })),
    reasoningEfforts: [...new Set(matching.filter((binding) => binding.modelId === selectedModel)
      .flatMap((binding) => binding.reasoningEffort ? [binding.reasoningEffort] : []))]
  };
}
