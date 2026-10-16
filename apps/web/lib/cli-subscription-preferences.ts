import { CLI_AGENT_IDS, type CliAgentId, type ExecutionSettings } from "./execution-mode-catalog";
import { resolveCliCommandForAgent, type CliAgentDetectionLike } from "./cli-detection";

const FALLBACK_PRIORITY: readonly CliAgentId[] = ["cursor-agent", "codex", "claude", "gemini", "copilot"];

export function normalizeRemovedCliAgentIds(value: unknown): CliAgentId[] {
  if (!Array.isArray(value)) return [];
  return CLI_AGENT_IDS.filter((id) => value.includes(id));
}

/** Removal changes this browser's choices, never provider accounts or installed software. */
export function reconcileRemovedCliSelections(
  settings: ExecutionSettings,
  removedIds: readonly CliAgentId[],
  detections: readonly CliAgentDetectionLike[] = [],
  modelsByAgent: Partial<Record<CliAgentId, ExecutionSettings["cliModelSelection"]>> = {}
): ExecutionSettings {
  let next = settings;
  if (settings.selectedCliAgentId && removedIds.includes(settings.selectedCliAgentId)) {
    const replacementId = FALLBACK_PRIORITY.find((id) =>
      !removedIds.includes(id) && detections.some((agent) => agent.id === id && agent.installed && agent.status === "ready")
    );
    next = {
      ...next,
      selectedCliAgentId: replacementId,
      command: replacementId ? resolveCliCommandForAgent(replacementId, detections) : undefined,
      cliModelSelection: replacementId ? modelsByAgent[replacementId] ?? { source: "agent_default" } : { source: "agent_default" }
    };
  }
  if (settings.memoryCliAgentId && removedIds.includes(settings.memoryCliAgentId)) {
    next = { ...next, memoryModelMode: "same_as_chat", memoryCliAgentId: undefined };
  }
  return next;
}
