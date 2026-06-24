import {
  CLI_CATALOG,
  getCliCatalogEntry,
  type CliAgentId,
  type ExecutionSettings
} from "./execution-mode-catalog";

export interface CliAgentDetectionLike {
  id: CliAgentId;
  installed?: boolean | undefined;
  alias: string | null;
  status?: string | undefined;
}

const CLI_AUTO_SELECT_PRIORITY: readonly CliAgentId[] = ["cursor-agent", "codex", "claude", "gemini", "copilot"];

export function resolveCliCommandForAgent(
  agentId: CliAgentId,
  detectionAgents?: readonly CliAgentDetectionLike[]
): string {
  const catalog = getCliCatalogEntry(agentId);
  const detection = detectionAgents?.find((agent) => agent.id === agentId);
  return detection?.alias ?? catalog.primaryCommand;
}

export function patchSelectedCliCommandAfterRescan(
  executionSettings: ExecutionSettings,
  detectionAgents: readonly CliAgentDetectionLike[],
  rescannedAgentId?: CliAgentId
): ExecutionSettings {
  const selectedId = executionSettings.selectedCliAgentId;
  const usableAgents = detectionAgents.filter((agent) =>
    agent.installed !== false &&
    agent.status !== "not_installed" &&
    agent.status !== "unavailable"
  );
  const selectedAgent = selectedId ? usableAgents.find((agent) => agent.id === selectedId) : undefined;

  if (!selectedId || (!selectedAgent && rescannedAgentId === undefined)) {
    const preferredId =
      CLI_AUTO_SELECT_PRIORITY.find((id) => usableAgents.some((agent) => agent.id === id)) ??
      CLI_CATALOG.find((entry) => usableAgents.some((agent) => agent.id === entry.id))?.id;
    if (!preferredId) {
      return executionSettings;
    }
    const command = resolveCliCommandForAgent(preferredId, detectionAgents);
    if (
      executionSettings.selectedCliAgentId === preferredId &&
      executionSettings.command === command &&
      executionSettings.localRunnerPresetId === "custom_cli_json" &&
      executionSettings.runnerProviderId === "cli_stub"
    ) {
      return executionSettings;
    }
    return {
      ...executionSettings,
      executionMode: "local_cli",
      selectedCliAgentId: preferredId,
      localRunnerPresetId: "custom_cli_json",
      runnerProviderId: "cli_stub",
      command,
      cliModelSelection: executionSettings.cliModelSelection ?? { source: "agent_default" }
    };
  }

  if (rescannedAgentId !== undefined && rescannedAgentId !== selectedId) {
    return executionSettings;
  }

  const command = resolveCliCommandForAgent(selectedId, detectionAgents);
  if (executionSettings.command === command) {
    return executionSettings;
  }

  return { ...executionSettings, command };
}

export function mergeCliDetectionAgents<T extends CliAgentDetectionLike>(
  existingAgents: readonly T[] | undefined,
  nextAgent: T,
  agentId: CliAgentId
): T[] {
  const existing = existingAgents ?? [];
  const hasAgent = existing.some((agent) => agent.id === agentId);
  return hasAgent
    ? existing.map((agent) => (agent.id === agentId ? nextAgent : agent))
    : [...existing, nextAgent];
}
