import type { VdtChangeSet, VdtProject, VdtWarning } from "@vdt-studio/vdt-core";
import { warning } from "@vdt-studio/vdt-core";
import { TASK_LIMITS } from "../tasks/registry";
import {
  simplifyBranchOutputSchema,
  type SimplifyBranchOutput
} from "../schemas/simplify-branch";
import {
  assertChangeSetPreviewValid,
  mapAiWarnings
} from "./changeset-graph";
import { simplifyBranchOutputToChangeSet } from "./to-changeset/simplify-branch";

export interface ValidateSimplifyBranchResult {
  output: SimplifyBranchOutput;
  warnings: VdtWarning[];
}

export function validateSimplifyBranchOutput(
  project: VdtProject,
  rawOutput: unknown,
  inputBranchRootNodeId: string
): ValidateSimplifyBranchResult {
  const output = simplifyBranchOutputSchema.parse(rawOutput);
  const warnings: VdtWarning[] = [...mapAiWarnings(output.warnings)];

  if (output.branchRootNodeId !== inputBranchRootNodeId) {
    throw new Error(
      `Simplify output branchRootNodeId (${output.branchRootNodeId}) does not match requested node (${inputBranchRootNodeId}).`
    );
  }

  const excerptNodeIds = new Set(
    project.graph.nodes.map((node) => node.id)
  );

  if (!excerptNodeIds.has(output.branchRootNodeId)) {
    throw new Error(`Branch root node does not exist in project: ${output.branchRootNodeId}`);
  }

  const maxRemovals = TASK_LIMITS.simplify_branch.maxChanges?.maxDeletions ?? 5;
  if (output.nodeRemovals.length > maxRemovals) {
    throw new Error(`Simplify proposal exceeds max removals (${maxRemovals}).`);
  }

  for (const removal of output.nodeRemovals) {
    if (!excerptNodeIds.has(removal.nodeId)) {
      throw new Error(`Removal targets unknown node id: ${removal.nodeId}`);
    }
    if (removal.nodeId === project.rootNodeId) {
      throw new Error("Cannot remove the project root node.");
    }
    if (removal.mergeIntoNodeId && !excerptNodeIds.has(removal.mergeIntoNodeId)) {
      throw new Error(`Merge target does not exist: ${removal.mergeIntoNodeId}`);
    }
  }

  for (const update of output.nodeUpdates) {
    if (!excerptNodeIds.has(update.nodeId)) {
      throw new Error(`Update targets unknown node id: ${update.nodeId}`);
    }
  }

  if (output.nodeRemovals.length === 0 && output.nodeUpdates.length === 0 && output.edgeChanges.length === 0) {
    warnings.push(
      warning({
        severity: "info",
        type: "weak_business_logic",
        message: "Simplify proposal contains no structural changes."
      })
    );
  }

  return { output, warnings };
}

export function validateAndMapSimplifyBranch(
  project: VdtProject,
  rawOutput: unknown,
  inputBranchRootNodeId: string,
  backendId: string
): { changeSet: VdtChangeSet; output: SimplifyBranchOutput } {
  const { output, warnings: semanticWarnings } = validateSimplifyBranchOutput(
    project,
    rawOutput,
    inputBranchRootNodeId
  );
  const changeSet = simplifyBranchOutputToChangeSet(output, { backendId });
  changeSet.warnings = [...changeSet.warnings, ...semanticWarnings];

  assertChangeSetPreviewValid(project, changeSet, "Simplify branch proposal");
  return { changeSet, output };
}
