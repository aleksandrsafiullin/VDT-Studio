import {
  getCliCatalogEntry,
  getGatewayPreset,
  getLocalRunnerPreset,
  type CliAgentId,
  type CliModelSelection,
  type ExecutionSettings
} from "./execution-mode-catalog";
import { resolveExecutionCategory } from "./execution-category";

export interface ExecutionModeSummary {
  modeLabel: string;
  primary: string;
  secondary?: string | undefined;
}

const PROTOCOL_LABELS = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  azure: "Azure OpenAI",
  gemini: "Google Gemini"
} as const;

function resolveCliModelLabel(
  agentId: CliAgentId | undefined,
  selection: CliModelSelection | undefined,
  localModel?: string | undefined
): string | undefined {
  if (selection?.source === "custom" && selection.customModel?.trim()) {
    return selection.customModel.trim();
  }

  if (localModel?.trim()) {
    return localModel.trim();
  }

  if (agentId) {
    return "Provider default";
  }

  return undefined;
}

export function formatExecutionModeSummary(settings: ExecutionSettings): ExecutionModeSummary {
  if (settings.executionMode === "local_cli") {
    const presetId = settings.localRunnerPresetId ?? "ollama_openai";
    const preset = getLocalRunnerPreset(presetId);
    if (resolveExecutionCategory(settings) === "cli_subscriptions") {
      const agent = settings.selectedCliAgentId ? getCliCatalogEntry(settings.selectedCliAgentId) : undefined;
      const model = resolveCliModelLabel(
        settings.selectedCliAgentId,
        settings.cliModelSelection,
        undefined
      );
      return {
        modeLabel: "CLI subscriptions",
        primary: agent?.displayName ?? "Choose a CLI",
        secondary: model
      };
    }

    return {
      modeLabel: "Local models",
      primary: preset.runnerProviderId === "local_http_stub" ? preset.label : getLocalRunnerPreset("ollama_openai").label,
      secondary: settings.localModel?.trim() || preset.model
    };
  }

  if (settings.useMockProvider || settings.gatewayPresetId === "mock") {
    return {
      modeLabel: "API keys",
      primary: "Runtime not configured",
      secondary: "Select a real provider"
    };
  }

  const presetId = settings.gatewayPresetId ?? "openai-default";
  const preset = getGatewayPreset(presetId);
  const protocol = settings.byokProtocol ?? preset.protocol;
  const protocolLabel = PROTOCOL_LABELS[protocol];
  const model = settings.model?.trim() || preset.model;

  return {
    modeLabel: "API keys",
    primary: `${protocolLabel} · ${preset.label}`,
    secondary: model
  };
}
