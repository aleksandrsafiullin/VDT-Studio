import type { VdtChangeSet, VdtProject, VdtWarning } from "@vdt-studio/vdt-core";
import { previewChangeSet, validateGraph, warning } from "@vdt-studio/vdt-core";
import { TASK_LIMITS } from "../tasks/registry";
import {
  deepenNodeOutputSchema,
  type DeepenNodeOutput
} from "../schemas/deepen-node";
import { deepenNodeOutputToChangeSet } from "./to-changeset/deepen-node";

export interface ValidateDeepenNodeResult {
  output: DeepenNodeOutput;
  warnings: VdtWarning[];
}

function normalizeUnit(value?: string) {
  const normalized = value?.trim().toLowerCase();
  return normalized && normalized !== "%" ? normalized : undefined;
}

export function validateDeepenNodeOutput(
  project: VdtProject,
  rawOutput: unknown,
  inputTargetNodeId: string
): ValidateDeepenNodeResult {
  const output = deepenNodeOutputSchema.parse(rawOutput);
  const warnings: VdtWarning[] = [];

  if (output.targetNodeId !== inputTargetNodeId) {
    throw new Error(
      `Deepen output targetNodeId (${output.targetNodeId}) does not match requested node (${inputTargetNodeId}).`
    );
  }

  const targetNode = project.graph.nodes.find((node) => node.id === output.targetNodeId);
  if (!targetNode) {
    throw new Error(`Deepen target node does not exist in project: ${output.targetNodeId}`);
  }

  const existingIds = new Set(project.graph.nodes.map((node) => node.id));
  for (const node of output.nodes) {
    if (existingIds.has(node.id)) {
      throw new Error(`Proposed node id already exists in project: ${node.id}`);
    }
  }

  const maxAdditions = TASK_LIMITS.deepen_node.maxChanges?.maxAdditions ?? TASK_LIMITS.deepen_node.maxNodes ?? 15;
  if (output.nodes.length > maxAdditions) {
    throw new Error(`Deepen proposal exceeds max additions (${maxAdditions}).`);
  }

  const parentUnit = normalizeUnit(targetNode.unit);
  for (const node of output.nodes) {
    const childUnit = normalizeUnit(node.unit);
    if (parentUnit && !childUnit && node.type !== "external_factor") {
      warnings.push(
        warning({
          severity: "warning",
          type: "unit_mismatch",
          message: `Child node ${node.name} has no unit while parent ${targetNode.name} uses ${targetNode.unit}.`,
          nodeId: node.id
        })
      );
    }
  }

  return { output, warnings };
}

export function validateDeepenNodeChangeSet(
  project: VdtProject,
  changeSet: VdtChangeSet
): { valid: boolean; warnings: VdtWarning[] } {
  const preview = previewChangeSet(project, changeSet);
  const validation = validateGraph(preview.graph, preview.rootNodeId);

  if (!validation.valid) {
    return {
      valid: false,
      warnings: [...validation.errors, ...validation.warnings]
    };
  }

  if (validation.warnings.length > 0) {
    return {
      valid: false,
      warnings: validation.warnings
    };
  }

  return { valid: true, warnings: [] };
}

export function validateAndMapDeepenNode(
  project: VdtProject,
  rawOutput: unknown,
  inputTargetNodeId: string,
  backendId: string
): { changeSet: VdtChangeSet; output: DeepenNodeOutput } {
  const { output, warnings: semanticWarnings } = validateDeepenNodeOutput(
    project,
    rawOutput,
    inputTargetNodeId
  );
  const changeSet = deepenNodeOutputToChangeSet(output, { backendId });
  changeSet.warnings = [...changeSet.warnings, ...semanticWarnings];

  const graphValidation = validateDeepenNodeChangeSet(project, changeSet);
  if (!graphValidation.valid) {
    const messages = graphValidation.warnings.map((entry) => entry.message).join("; ");
    throw new Error(`Deepen node proposal failed graph validation: ${messages}`);
  }

  return { changeSet, output };
}
