import type { VdtProject } from "@vdt-studio/vdt-core";
import { TASK_LIMITS } from "../tasks/registry";
import {
  explainNodeOutputSchema,
  type ExplainNodeResult,
  type ExplainNodeOutput
} from "../schemas/explain-node";
import { assertTextSectionLength } from "./changeset-graph";

export function validateExplainNodeOutput(
  project: VdtProject,
  rawOutput: unknown,
  inputNodeId: string
): ExplainNodeResult {
  const output = explainNodeOutputSchema.parse(rawOutput);
  const maxBytes = TASK_LIMITS.explain_node.maxTextSectionBytes ?? 8 * 1024;

  if (output.nodeId !== inputNodeId) {
    throw new Error(
      `Explain node output nodeId (${output.nodeId}) does not match requested node (${inputNodeId}).`
    );
  }

  if (!project.graph.nodes.some((node) => node.id === output.nodeId)) {
    throw new Error(`Explained node does not exist in project: ${output.nodeId}`);
  }

  assertTextSectionLength(output.explanation, maxBytes, "explanation");

  if (output.keyDrivers.length === 0) {
    throw new Error("Explain node output must include at least one key driver.");
  }

  return output;
}

export type { ExplainNodeOutput };
