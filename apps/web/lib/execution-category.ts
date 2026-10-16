import {
  applyLocalRunnerPreset,
  getLocalRunnerPreset,
  LOCAL_RUNNER_PRESET_CATALOG,
  type CliAgentId,
  type ExecutionSettings,
  type LocalModelPresetId
} from "./execution-mode-catalog";
import { resolveCliCommandForAgent, type CliAgentDetectionLike } from "./cli-detection";

export type ExecutionCategory = "cli_subscriptions" | "local_models" | "byok";

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

export function selectExecutionCategory(
  settings: ExecutionSettings,
  category: ExecutionCategory,
  detections?: readonly CliAgentDetectionLike[],
  removedIds: readonly CliAgentId[] = []
): ExecutionSettings {
  const savedLocalModelSelection = resolveSavedLocalModelSelection(settings);
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
  return {
    ...applyLocalRunnerPreset(settings, savedLocalModelSelection.presetId),
    localModel: savedLocalModelSelection.model ?? getLocalRunnerPreset(savedLocalModelSelection.presetId).model,
    savedLocalModelSelection
  };
}

export function selectLocalModelPreset(settings: ExecutionSettings, presetId: LocalModelPresetId): ExecutionSettings {
  const previous = resolveSavedLocalModelSelection(settings);
  const model = previous.presetId === presetId ? previous.model : getLocalRunnerPreset(presetId).model;
  return {
    ...applyLocalRunnerPreset(settings, presetId),
    localModel: model,
    savedLocalModelSelection: { presetId, model }
  };
}
