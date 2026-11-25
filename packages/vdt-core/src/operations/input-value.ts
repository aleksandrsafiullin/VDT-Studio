import { applyNodePatch } from "../changeset/node-patch";
import type { VdtNodePatch } from "../changeset/types";
import type { VdtNodeValueSource, VdtProject } from "../types";
import type { OperationContext } from "./context";

export type InputValueCommand = {
  nodeId: string;
  value: number | null;
  evidence?: VdtNodeValueSource | undefined;
};

export type InputValueOperationResult =
  | {
      status: "ok";
      project: VdtProject;
      patch: VdtNodePatch;
      result: { operationId: string; nodeId: string; value: number | null };
    }
  | { status: "error"; code: "NODE_NOT_FOUND" | "INPUT_VALUE_READ_ONLY" | "INVALID_INPUT_VALUE"; message: string };

export function applyInputValueOperation(
  project: VdtProject, { nodeId, value, evidence }: InputValueCommand, context: OperationContext
): InputValueOperationResult {
  const node = project.graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return { status: "error", code: "NODE_NOT_FOUND", message: `Node "${nodeId}" was not found.` };
  if (value !== null && !Number.isFinite(value)) {
    return { status: "error", code: "INVALID_INPUT_VALUE", message: "An input value must be finite." };
  }

  const patch: VdtNodePatch = value === null ? {
    clearInputValue: true,
    status: node.aiGenerated ? "needs_data" : node.status
  } : {
    value,
    baselineValue: value,
    status: evidence?.sourceTier === "default_assumption" ? "assumption" : node.aiGenerated ? "edited" : node.status,
    ...(evidence ? {
      valueSource: evidence,
      ...(evidence.sourceTier === "default_assumption" ? { valueStatus: "default_assumption" as const }
        : evidence.sourceTier === "user_input" ? { valueStatus: "user_provided_value" as const } : {})
    } : {})
  };
  return {
    status: "ok",
    project: {
      ...project,
      updatedAt: context.now,
      graph: {
        ...project.graph,
        nodes: project.graph.nodes.map((candidate) =>
          candidate.id === nodeId ? applyNodePatch(candidate, patch, context.now) : candidate
        )
      }
    },
    patch,
    result: { operationId: context.operationId, nodeId, value }
  };
}
