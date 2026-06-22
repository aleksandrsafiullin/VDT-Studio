import type { VdtChangeSet, VdtEdgeChange } from "@vdt-studio/vdt-core";
import { nowIso, warning } from "@vdt-studio/vdt-core";
import type { SimplifyBranchOutput } from "../../schemas/simplify-branch";
import { mapAiWarnings } from "../changeset-graph";

export function simplifyBranchOutputToChangeSet(
  output: SimplifyBranchOutput,
  options: { backendId: string; changeSetId?: string }
): VdtChangeSet {
  const deletions = output.nodeRemovals.map((removal) => ({
    id: `del_${removal.nodeId}`,
    nodeId: removal.nodeId,
    cascadeEdges: true
  }));

  const updates = output.nodeUpdates.map((update) => ({
    id: `update_${update.nodeId}`,
    nodeId: update.nodeId,
    patch: {
      ...(update.name ? { name: update.name } : {}),
      ...(update.description ? { description: update.description } : {}),
      ...(update.type ? { type: update.type } : {}),
      ...(update.unit ? { unit: update.unit } : {}),
      ...(update.formula ? { formula: update.formula } : {}),
      ...(update.aiRationale ? { aiRationale: update.aiRationale } : {})
    }
  }));

  const edgeChanges: VdtEdgeChange[] = output.edgeChanges.map((change) => {
    if (change.action === "add") {
      return {
        id: change.id,
        action: "add" as const,
        edge: {
          ...change.edge,
          aiGenerated: true
        }
      };
    }
    if (change.action === "remove") {
      return {
        id: change.id,
        action: "remove" as const,
        edgeId: change.edgeId
      };
    }
    return {
      id: change.id,
      action: "update" as const,
      edgeId: change.edgeId,
      patch: change.patch
    } as VdtEdgeChange;
  });

  const destructiveWarnings =
    output.nodeRemovals.length > 0
      ? [
          warning({
            severity: "warning",
            type: "weak_business_logic",
            message: `Simplification removes ${output.nodeRemovals.length} node(s) from the branch.`
          })
        ]
      : [];

  return {
    id: options.changeSetId ?? `changeset_simplify_${output.branchRootNodeId}`,
    taskType: "simplify_branch",
    backendId: options.backendId,
    createdAt: nowIso(),
    additions: [],
    updates,
    deletions,
    edgeChanges,
    assumptions: output.assumptions,
    questions: output.questionsForUser,
    warnings: [...mapAiWarnings(output.warnings), ...destructiveWarnings]
  };
}
