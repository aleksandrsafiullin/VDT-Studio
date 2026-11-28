import {
  applyLocalRunnerPreset,
  DEFAULT_EXECUTION_SETTINGS,
  getLocalRunnerPreset,
  LOCAL_RUNNER_PRESET_CATALOG,
  type CliAgentId,
  type ExecutionSettings,
  type LocalModelPresetId
} from "./execution-mode-catalog";
import { resolveCliCommandForAgent, type CliAgentDetectionLike } from "./cli-detection";
import { modelReasoningKey } from "@vdt-studio/ai-harness/browser";
import { FAST_LOCAL_REASONING } from "@vdt-studio/model-bridge/reasoning";
import { resolveExecutionSettings } from "./execution-mode-resolver";

export type ExecutionCategory = "cli_subscriptions" | "local_models" | "byok";

export function configureLocalReasoning(previous: ExecutionSettings, next: ExecutionSettings): ExecutionSettings {
  if (resolveExecutionCategory(next) !== "local_models") return next;
  const keyFor = (settings: ExecutionSettings) => {
    const { providerId, providerConfig } = resolveExecutionSettings(settings);
    return modelReasoningKey(providerId, providerConfig);
  };
  const saved = rememberConfiguredLocalModelSelection(previous);
  const oldLocal = resolveExecutionCategory(previous) === "local_models" ? previous
    : saved ? { ...applyLocalRunnerPreset(previous, saved.presetId), localModel: saved.model } : undefined;
  const oldKey = oldLocal ? keyFor(oldLocal) : undefined;
  const newKey = keyFor(next);
  if (newKey === oldKey || Object.hasOwn(next.modelReasoningBySource ?? {}, newKey)) return next;
  const choices = { ...next.modelReasoningBySource };
  if (oldKey && !Object.hasOwn(choices, oldKey)) choices[oldKey] = null;
  return {
    ...next,
    localFastDefaultsByModel: { ...Object.fromEntries(Object.entries(next.localFastDefaultsByModel ?? {}).slice(-127)), [newKey]: true },
    modelReasoningBySource: { ...Object.fromEntries(Object.entries(choices).slice(-126)), [newKey]: FAST_LOCAL_REASONING }
  };
}

export function resolveExecutionCategory(settings: ExecutionSettings): ExecutionCategory {
  if (settings.executionMode === "byok") return "byok";
  const preset = getLocalRunnerPreset(settings.localRunnerPresetId ?? "ollama_openai");
  // Mirror the runtime resolver's legacy cli_stub + HTTP-preset reconciliation.
  return (settings.runnerProviderId ?? preset.runnerProviderId) === "cli_stub" && preset.runnerProviderId !== "local_http_stub"
    ? "cli_subscriptions"
    : "local_models";
}

export function resolveSavedLocalModelSelection(settings: ExecutionSettings): NonNullable<ExecutionSettings["savedLocalModelSelection"]> {
  const presets = LOCAL_RUNNER_PRESET_CATALOG.filter((preset) => preset.runnerProviderId === "local_http_stub");
  const activePreset = presets.find((preset) => preset.id === settings.localRunnerPresetId);
  if (activePreset) return { presetId: activePreset.id as LocalModelPresetId, model: settings.localModel ?? activePreset.model };
  const saved = settings.savedLocalModelSelection;
  if (saved && presets.some((preset) => preset.id === saved.presetId)) {
    return { presetId: saved.presetId, model: typeof saved.model === "string" ? saved.model : undefined };
  }
  const inferred = presets.find((preset) => preset.baseUrl === settings.localBaseUrl);
  const preset = inferred ?? getLocalRunnerPreset("ollama_openai");
  return { presetId: preset.id as LocalModelPresetId, model: settings.localModel ?? preset.model };
}

export function rememberConfiguredLocalModelSelection(settings: ExecutionSettings): ExecutionSettings["savedLocalModelSelection"] {
  if (settings.savedLocalModelSelection || resolveExecutionCategory(settings) === "local_models"
    || settings.localModel && settings.localModel !== DEFAULT_EXECUTION_SETTINGS.localModel
    || settings.localBaseUrl && settings.localBaseUrl !== DEFAULT_EXECUTION_SETTINGS.localBaseUrl
    || settings.localRunnerPresetId && !["ollama_openai", "custom_cli_json"].includes(settings.localRunnerPresetId)) {
    return resolveSavedLocalModelSelection(settings);
  }
  return undefined;
}

export function selectExecutionCategory(
  settings: ExecutionSettings,
  category: ExecutionCategory,
  detections?: readonly CliAgentDetectionLike[],
  removedIds: readonly CliAgentId[] = []
): ExecutionSettings {
  const savedLocalModelSelection = rememberConfiguredLocalModelSelection(settings);
  if (category === "byok") return { ...settings, executionMode: "byok", savedLocalModelSelection };
  if (category === "cli_subscriptions") {
    const agentId = settings.selectedCliAgentId && !removedIds.includes(settings.selectedCliAgentId)
      ? settings.selectedCliAgentId : undefined;
    return {
      ...settings,
      executionMode: "local_cli",
      localRunnerPresetId: "custom_cli_json",
      runnerProviderId: "cli_stub",
      selectedCliAgentId: agentId,
      command: agentId ? resolveCliCommandForAgent(agentId, detections) : undefined,
      savedLocalModelSelection
    };
  }
  const local = resolveSavedLocalModelSelection(settings);
  return configureLocalReasoning(settings, {
    ...applyLocalRunnerPreset(settings, local.presetId),
    localModel: local.model ?? getLocalRunnerPreset(local.presetId).model,
    savedLocalModelSelection: local
  });
}

export function selectLocalModelPreset(settings: ExecutionSettings, presetId: LocalModelPresetId): ExecutionSettings {
  const previous = resolveSavedLocalModelSelection(settings);
  const model = previous.presetId === presetId ? previous.model : getLocalRunnerPreset(presetId).model;
  return configureLocalReasoning(settings, {
    ...applyLocalRunnerPreset(settings, presetId),
    localModel: model,
    savedLocalModelSelection: { presetId, model }
  });
}
