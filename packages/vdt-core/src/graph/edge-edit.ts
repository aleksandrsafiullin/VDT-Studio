import type { VdtChangeSet, VdtEdgeChange } from "../changeset/types";
import type { VdtEdgeRelation, VdtProject } from "../types";
import { uniqueId } from "../builder/ids";

export const GRAPH_EDGE_RELATIONS = [
  "formula_dependency", "contextual_influence", "positive_driver", "negative_driver",
  "additive_component", "subtractive_component", "multiplicative_driver", "divisive_driver"
] as const satisfies readonly VdtEdgeRelation[];

export type EdgeEditCommand =
  | { kind: "add"; sourceNodeId: string; targetNodeId: string; relation: VdtEdgeRelation; label?: string | undefined }
  | { kind: "set_relation"; edgeId: string; relation: VdtEdgeRelation }
  | { kind: "remove"; edgeId: string };

export function prepareEdgeEdit(
  project: VdtProject,
  command: EdgeEditCommand,
  metadata: Pick<VdtChangeSet, "id" | "backendId" | "createdAt">,
  options?: { aiGenerated?: boolean }
): { ok: true; edgeId: string; sourceNodeId: string; targetNodeId: string; changeSet: VdtChangeSet }
  | { ok: false; code: string; message: string } {
  if (command.kind !== "remove" && !GRAPH_EDGE_RELATIONS.includes(command.relation)) {
    return { ok: false, code: "INVALID_EDGE_RELATION", message: "Choose a supported link relation." };
  }
  const { nodes, edges } = project.graph;
  let change: VdtEdgeChange;
  let sourceNodeId: string;
  let targetNodeId: string;
  let edgeId: string;
  if (command.kind === "add") {
    ({ sourceNodeId, targetNodeId } = command);
    if (!nodes.some(node => node.id === sourceNodeId)) {
      return { ok: false, code: "SOURCE_NOT_FOUND", message: `Source node "${sourceNodeId}" was not found.` };
    }
    if (!nodes.some(node => node.id === targetNodeId)) {
      return { ok: false, code: "TARGET_NOT_FOUND", message: `Target node "${targetNodeId}" was not found.` };
    }
    if (targetNodeId === project.rootNodeId) {
      return { ok: false, code: "ROOT_NODE_PROTECTED", message: "The root KPI cannot have an incoming link." };
    }
    if (edges.some(edge => edge.sourceNodeId === sourceNodeId && edge.targetNodeId === targetNodeId)) {
      return { ok: false, code: "DUPLICATE_EDGE", message: "These KPIs are already linked in that direction." };
    }
    const children = new Map<string, string[]>();
    for (const edge of edges) {
      const targets = children.get(edge.sourceNodeId) ?? [];
      targets.push(edge.targetNodeId);
      children.set(edge.sourceNodeId, targets);
    }
    const visited = new Set<string>();
    const pending = [targetNodeId];
    while (pending.length > 0) {
      const nodeId = pending.pop()!;
      if (nodeId === sourceNodeId) {
        return { ok: false, code: "HIERARCHY_CYCLE", message: "The new link would create a visual cycle." };
      }
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);
      for (const child of children.get(nodeId) ?? []) pending.push(child);
    }
    edgeId = uniqueId(`edge_${sourceNodeId}_${targetNodeId}`, new Set(edges.map(edge => edge.id)));
    const aiGenerated = options?.aiGenerated ?? false;
    change = {
      id: `add_${edgeId}`, action: "add", edge: {
        id: edgeId, sourceNodeId, targetNodeId, relation: command.relation,
        ...(command.label !== undefined ? { label: command.label } : {}),
        aiGenerated, ...(aiGenerated ? { aiConfidence: 0.7 } : {})
      }
    };
  } else {
    const matches = edges.filter(edge => edge.id === command.edgeId);
    if (matches.length !== 1) {
      return { ok: false, code: matches.length ? "AMBIGUOUS_EDGE" : "EDGE_NOT_FOUND",
        message: matches.length ? "The edge ID is duplicated in this draft." : "This link no longer exists." };
    }
    const edge = matches[0]!;
    ({ id: edgeId, sourceNodeId, targetNodeId } = edge);
    if (command.kind === "set_relation" && command.relation === edge.relation) {
      return { ok: false, code: "EDGE_UNCHANGED", message: "The link already uses that relation." };
    }
    change = command.kind === "remove"
      ? { id: `remove_${edgeId}`, action: "remove", edgeId }
      : { id: `relation_${edgeId}`, action: "update", edgeId, patch: { relation: command.relation } };
  }
  return {
    ok: true, edgeId, sourceNodeId, targetNodeId,
    changeSet: { ...metadata, taskType: "generate_tree", edgeChanges: [change], additions: [], updates: [],
      deletions: [], assumptions: [], questions: [], warnings: [] }
  };
}
