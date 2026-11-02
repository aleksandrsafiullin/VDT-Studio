import { isHarnessId, BUILTIN_HARNESS_IDS } from "@vdt-studio/model-bridge/harness-catalog";
import { type CliAgentId, type ExecutionSettings } from "./execution-mode-catalog";
import { resolveCliCommandForAgent, type CliAgentDetectionLike } from "./cli-detection";

const FALLBACK_PRIORITY: readonly CliAgentId[] = BUILTIN_HARNESS_IDS;

export function normalizeRemovedCliAgentIds(value: unknown): CliAgentId[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(isHarnessId))].sort((a, b) => { const order: readonly string[] = BUILTIN_HARNESS_IDS; return (order.indexOf(a) < 0 ? 100 : order.indexOf(a)) - (order.indexOf(b) < 0 ? 100 : order.indexOf(b)); });
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
