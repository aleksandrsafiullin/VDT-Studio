import type { VdtProject } from "../types";
import type { VdtChangeSet, VdtChangeSetDiff } from "./types";

function uniqueSorted(values: string[]) {
  return [...new Set(values)].sort();
}

export function diffChangeSet(project: VdtProject, changeSet: VdtChangeSet): VdtChangeSetDiff {
  const existingNodeIds = new Set(project.graph.nodes.map((node) => node.id));
  const existingEdgeIds = new Set(project.graph.edges.map((edge) => edge.id));

  const addedNodeIds = changeSet.additions.map((addition) => addition.nodeId);
  const updatedNodeIds = changeSet.updates
    .map((update) => update.nodeId)
    .filter((nodeId) => existingNodeIds.has(nodeId));
  const removedNodeIds = changeSet.deletions
    .map((deletion) => deletion.nodeId)
    .filter((nodeId) => existingNodeIds.has(nodeId));

  const addedEdgeIds: string[] = [];
  const updatedEdgeIds: string[] = [];
  const removedEdgeIds: string[] = [];

  for (const addition of changeSet.additions) {
    addedEdgeIds.push(`edge_${addition.parentNodeId}_${addition.nodeId}`);
  }

  for (const change of changeSet.edgeChanges) {
    if (change.action === "add") {
      addedEdgeIds.push(change.edge.id);
    } else if (change.action === "update" && existingEdgeIds.has(change.edgeId)) {
      updatedEdgeIds.push(change.edgeId);
    } else if (change.action === "remove" && existingEdgeIds.has(change.edgeId)) {
      removedEdgeIds.push(change.edgeId);
    }
  }

  return {
    addedNodeIds: uniqueSorted(addedNodeIds),
    updatedNodeIds: uniqueSorted(updatedNodeIds),
    removedNodeIds: uniqueSorted(removedNodeIds),
    addedEdgeIds: uniqueSorted(addedEdgeIds),
    updatedEdgeIds: uniqueSorted(updatedEdgeIds),
    removedEdgeIds: uniqueSorted(removedEdgeIds)
  };
}
