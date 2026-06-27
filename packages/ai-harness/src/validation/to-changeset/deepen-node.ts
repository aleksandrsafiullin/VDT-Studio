import type { VdtChangeSet } from "@vdt-studio/vdt-core";
import { nowIso, warning } from "@vdt-studio/vdt-core";
import type { DeepenNodeOutput } from "../../schemas/deepen-node";

export function deepenNodeOutputToChangeSet(
  output: DeepenNodeOutput,
  options: { backendId: string; changeSetId?: string }
): VdtChangeSet {
  const childIds = new Set(output.nodes.map((node) => node.id));
  const additions = output.nodes.map((node) => {
    const parentEdge = output.edges.find(
      (edge) => edge.sourceNodeId === output.targetNodeId && edge.targetNodeId === node.id
    );

    return {
      id: `add_${node.id}`,
      nodeId: node.id,
      parentNodeId: output.targetNodeId,
      relation: parentEdge?.relation ?? "positive_driver",
      name: node.name,
      description: node.description,
      type: node.type,
      unit: node.unit,
      formula: node.formula,
      aiConfidence: node.aiConfidence,
      aiRationale: node.aiRationale,
      controllability: node.controllability,
      materiality: node.materiality,
      fixedInScenario: node.fixedInScenario
    };
  });

  const edgeChanges = output.edges
    .filter((edge) => !(edge.sourceNodeId === output.targetNodeId && childIds.has(edge.targetNodeId)))
    .map((edge) => ({
      id: `edge_add_${edge.id}`,
      action: "add" as const,
      edge: {
        id: edge.id,
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId,
        relation: edge.relation,
        label: edge.label,
        aiGenerated: true,
        aiConfidence: edge.aiConfidence
      }
    }));

  return {
    id: options.changeSetId ?? `changeset_deepen_${output.targetNodeId}`,
    taskType: "deepen_node",
    backendId: options.backendId,
    createdAt: nowIso(),
    additions,
    updates: [],
    deletions: [],
    edgeChanges,
    assumptions: output.assumptions,
    questions: output.questionsForUser,
    warnings: output.warnings.map((item) =>
      warning({
        severity: item.severity,
        type: "weak_business_logic",
        message: item.message,
        nodeId: item.nodeId,
        edgeId: item.edgeId
      })
    )
  };
}
