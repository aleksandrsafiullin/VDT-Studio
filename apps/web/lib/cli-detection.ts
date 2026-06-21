import {
  getCliCatalogEntry,
  type CliAgentId,
  type ExecutionSettings
} from "./execution-mode-catalog";

export interface CliAgentDetectionLike {
  id: CliAgentId;
  alias: string | null;
}

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
  if (!selectedId) {
    return executionSettings;
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
