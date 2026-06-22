import type { VdtChangeSet, VdtProject, VdtWarning } from "@vdt-studio/vdt-core";
import { TASK_LIMITS } from "../tasks/registry";
import {
  suggestAlternativeOutputSchema,
  type SuggestAlternativeOutput
} from "../schemas/suggest-alternative";
import {
  assertChangeSetPreviewValid,
  mapAiWarnings
} from "./changeset-graph";
import { suggestAlternativeOutputToChangeSet } from "./to-changeset/suggest-alternative";

export interface ValidateSuggestAlternativeResult {
  output: SuggestAlternativeOutput;
  warnings: VdtWarning[];
}

export function validateSuggestAlternativeOutput(
  project: VdtProject,
  rawOutput: unknown,
  inputTargetNodeId: string
): ValidateSuggestAlternativeResult {
  const output = suggestAlternativeOutputSchema.parse(rawOutput);
  const warnings = [...mapAiWarnings(output.warnings)];

  if (output.targetNodeId !== inputTargetNodeId) {
    throw new Error(
      `Alternative output targetNodeId (${output.targetNodeId}) does not match requested node (${inputTargetNodeId}).`
    );
  }

  const existingIds = new Set(project.graph.nodes.map((node) => node.id));
  if (!existingIds.has(output.targetNodeId)) {
    throw new Error(`Target node does not exist in project: ${output.targetNodeId}`);
  }

  for (const node of output.nodes) {
    if (existingIds.has(node.id)) {
      throw new Error(`Proposed node id already exists in project: ${node.id}`);
    }
  }

  for (const nodeId of output.removeChildNodeIds) {
    if (!existingIds.has(nodeId)) {
      throw new Error(`Cannot remove unknown child node id: ${nodeId}`);
    }
    const isChild = project.graph.edges.some(
      (edge) => edge.sourceNodeId === output.targetNodeId && edge.targetNodeId === nodeId
    );
    if (!isChild) {
      throw new Error(`Node ${nodeId} is not a direct child of ${output.targetNodeId}.`);
    }
  }

  const maxAdditions = TASK_LIMITS.suggest_alternative.maxNodes ?? 15;
  if (output.nodes.length > maxAdditions) {
    throw new Error(`Alternative proposal exceeds max additions (${maxAdditions}).`);
  }

  return { output, warnings };
}

export function validateAndMapSuggestAlternative(
  project: VdtProject,
  rawOutput: unknown,
  inputTargetNodeId: string,
  backendId: string
): { changeSet: VdtChangeSet; output: SuggestAlternativeOutput } {
  const { output, warnings: semanticWarnings } = validateSuggestAlternativeOutput(
    project,
    rawOutput,
    inputTargetNodeId
  );
  const changeSet = suggestAlternativeOutputToChangeSet(output, { backendId });
  changeSet.warnings = [...changeSet.warnings, ...semanticWarnings];

  assertChangeSetPreviewValid(project, changeSet, "Suggest alternative proposal");
  return { changeSet, output };
}
