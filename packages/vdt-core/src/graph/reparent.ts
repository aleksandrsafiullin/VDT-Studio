import type { VdtChangeSet } from "../changeset/types";
import type { VdtEdgeRelation, VdtProject } from "../types";

export interface ReparentBranchInput {
  nodeId: string;
  parentNodeId: string;
  fromParentNodeId?: string | undefined;
  relation?: VdtEdgeRelation | undefined;
}

export function prepareBranchReparent(
  project: VdtProject,
  input: ReparentBranchInput,
  metadata: Pick<VdtChangeSet, "id" | "backendId" | "createdAt">
): { ok: true; fromParentNodeId: string; changeSet: VdtChangeSet } | { ok: false; code: string; message: string } {
  if (input.nodeId === project.rootNodeId) {
    return { ok: false, code: "ROOT_NODE_PROTECTED", message: "The root KPI cannot be moved." };
  }
  const { nodes, edges } = project.graph;
  if (!nodes.some(node => node.id === input.nodeId) || !nodes.some(node => node.id === input.parentNodeId)) {
    return { ok: false, code: "NODE_NOT_FOUND", message: "Both the branch node and its new parent must exist." };
  }
  const descendants = new Set<string>();
  const queue = [input.nodeId];
  while (queue.length) {
    const nodeId = queue.pop()!;
    if (descendants.has(nodeId)) continue;
    descendants.add(nodeId);
    queue.push(...edges.filter(edge => edge.sourceNodeId === nodeId).map(edge => edge.targetNodeId));
  }
  if (descendants.has(input.parentNodeId)) {
    return { ok: false, code: "HIERARCHY_CYCLE", message: "The new parent is inside the moved branch." };
  }
  const incoming = edges.filter(edge => edge.targetNodeId === input.nodeId);
  const candidates = input.fromParentNodeId
    ? incoming.filter(edge => edge.sourceNodeId === input.fromParentNodeId)
    : incoming;
  if (candidates.length !== 1) {
    return { ok: false, code: "AMBIGUOUS_PARENT", message: "Specify the exact current fromParentNodeId; exactly one matching edge is required." };
  }
  const old = candidates[0]!;
  if (old.sourceNodeId === input.parentNodeId && (!input.relation || input.relation === old.relation)) {
    return { ok: false, code: "PARENT_UNCHANGED", message: "This node already has that parent and edge relation." };
  }

  const target = incoming.find(edge => edge.id !== old.id && edge.sourceNodeId === input.parentNodeId);
  const edgeChanges: VdtChangeSet["edgeChanges"] = target
    ? [{ id: `remove_${old.id}`, action: "remove", edgeId: old.id }]
    : [{ id: `move_${old.id}`, action: "update", edgeId: old.id, patch: {
      sourceNodeId: input.parentNodeId, ...(input.relation ? { relation: input.relation } : {})
    } }];
  if (target && input.relation) {
    edgeChanges.push({ id: `relation_${target.id}`, action: "update", edgeId: target.id, patch: { relation: input.relation } });
  }
  return {
    ok: true, fromParentNodeId: old.sourceNodeId,
    changeSet: {
      ...metadata, taskType: "generate_tree", edgeChanges,
      additions: [], updates: [], deletions: [], assumptions: [], questions: [], warnings: []
    }
  };
}
