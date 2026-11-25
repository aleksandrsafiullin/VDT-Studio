import type { VdtNodePatch } from "../changeset/types";
import { calculateGraph } from "../formula/calculate";
import { getGoalSeekTargets } from "../formula/goal-seek";
import { getDecompositionContextGroupIds } from "../graph/decomposition";
import type { GraphCalculationResult, VdtGoalSeek, VdtProject } from "../types";
import { readNodeBaselineValue } from "../utils";

export type BackCalculationCommand = { nodeId: string; setting: VdtGoalSeek | null };
type BackCalculationError = {
  status: "error";
  code: "NODE_NOT_FOUND" | "GOAL_SEEK_OCCUPIED" | "GOAL_SEEK_INELIGIBLE" | "INVALID_GOAL_SEEK_TARGET";
  message: string;
};

export function inspectBackCalculation(project: VdtProject, nodeId: string, existingCalculation?: GraphCalculationResult) {
  const node = project.graph.nodes.find(candidate => candidate.id === nodeId);
  if (!node) return { status: "error", code: "NODE_NOT_FOUND", message: `KPI "${nodeId}" was not found.` } as const;

  const targets = getGoalSeekTargets(project.graph, node.id);
  const other = project.graph.nodes.find(candidate => candidate.id !== node.id && candidate.goalSeek);
  const eligible = node.id !== project.rootNodeId && node.status !== "rejected" && targets.length > 0
    && !getDecompositionContextGroupIds(project.graph, project.rootNodeId).has(node.id);
  const target = project.graph.nodes.find(candidate => candidate.id === node.goalSeek?.targetNodeId);
  const calculation = existingCalculation ?? calculateGraph(project);
  return {
    status: "ok",
    node,
    eligible,
    blockingKpi: other,
    targets,
    setting: node.goalSeek,
    target,
    value: calculation.values[node.id],
    targetBaseline: target ? calculation.values[target.id] : undefined,
    sourceValue: readNodeBaselineValue(node),
    issues: [...calculation.errors, ...calculation.warnings].filter(issue => issue.nodeId === node.id)
  } as const;
}

export function prepareBackCalculationPatch(project: VdtProject, command: BackCalculationCommand):
  BackCalculationError | { status: "ok"; patch: VdtNodePatch; changed: boolean } {
  const { nodeId, setting } = command;
  const node = project.graph.nodes.find(candidate => candidate.id === nodeId);
  if (!node) return { status: "error", code: "NODE_NOT_FOUND", message: `KPI "${nodeId}" was not found.` };
  if (!setting) return { status: "ok", patch: { clearGoalSeek: true }, changed: !!node.goalSeek };
  const other = project.graph.nodes.find(candidate => candidate.id !== nodeId && candidate.goalSeek);
  if (other) {
    return { status: "error", code: "GOAL_SEEK_OCCUPIED", message: `“${other.name}” already uses back-calculation. Disable it there to choose this KPI.` };
  }
  if (nodeId === project.rootNodeId || node.status === "rejected"
    || getDecompositionContextGroupIds(project.graph, project.rootNodeId).has(nodeId)) {
    return { status: "error", code: "GOAL_SEEK_INELIGIBLE", message: "Choose an incoming KPI used in an output formula." };
  }
  // A previously saved target may be unavailable. Keep the setting editable
  // while the calculation explains what needs repair.
  const validTarget = setting.targetNodeId === node.goalSeek?.targetNodeId
    || getGoalSeekTargets(project.graph, nodeId).some(candidate => candidate.id === setting.targetNodeId);
  if (!Number.isFinite(setting.targetValue) || !validTarget) {
    return { status: "error", code: "INVALID_GOAL_SEEK_TARGET", message: "Choose an output formula that depends on this KPI and enter a finite actual value." };
  }
  return {
    status: "ok",
    patch: { goalSeek: { targetNodeId: setting.targetNodeId, targetValue: setting.targetValue } },
    changed: node.goalSeek?.targetNodeId !== setting.targetNodeId || node.goalSeek.targetValue !== setting.targetValue
  };
}
