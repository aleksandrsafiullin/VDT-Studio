import {
  getCliCatalogEntry,
  getGatewayPreset,
  getLocalRunnerPreset,
  type CliAgentId,
  type CliModelSelection,
  type ExecutionSettings
} from "./execution-mode-catalog";

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
    return getCliCatalogEntry(agentId).primaryCommand;
  }

  return undefined;
}

export function formatExecutionModeSummary(settings: ExecutionSettings): ExecutionModeSummary {
  if (settings.executionMode === "local_cli") {
    const presetId = settings.localRunnerPresetId ?? "ollama_openai";
    const preset = getLocalRunnerPreset(presetId);
    let runnerProviderId = settings.runnerProviderId ?? preset.runnerProviderId;
    if (runnerProviderId === "cli_stub" && preset.runnerProviderId === "local_http_stub") {
      runnerProviderId = "local_http_stub";
    }

    if (runnerProviderId === "cli_stub" && settings.selectedCliAgentId) {
      const agent = getCliCatalogEntry(settings.selectedCliAgentId);
      const model = resolveCliModelLabel(
        settings.selectedCliAgentId,
        settings.cliModelSelection,
        undefined
      );
      return {
        modeLabel: "Local CLI",
        primary: agent.displayName,
        secondary: model
      };
    }

    return {
      modeLabel: "Local CLI",
      primary: preset.label,
      secondary: settings.localModel?.trim() || preset.model
    };
  }

  if (settings.useMockProvider || settings.gatewayPresetId === "mock") {
    return {
      modeLabel: "BYOK",
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
    modeLabel: "BYOK",
    primary: `${protocolLabel} · ${preset.label}`,
    secondary: model
  };
}
