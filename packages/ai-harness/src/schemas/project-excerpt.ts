import type { VdtProject } from "@vdt-studio/vdt-core";
import { z } from "zod";
import { aiNodeIdSchema } from "./shared";

export const projectNodeSummarySchema = z.object({
  id: aiNodeIdSchema,
  name: z.string().min(1).max(120),
  type: z.string().min(1).max(40),
  unit: z.string().max(80).optional(),
  formula: z.string().max(500).optional(),
  description: z.string().max(1_000).optional()
});

export const projectEdgeSummarySchema = z.object({
  id: aiNodeIdSchema,
  sourceNodeId: aiNodeIdSchema,
  targetNodeId: aiNodeIdSchema,
  relation: z.string().min(1).max(40)
});

export const projectExcerptSchema = z.object({
  rootNodeId: aiNodeIdSchema,
  focusNodeId: aiNodeIdSchema,
  nodes: z.array(projectNodeSummarySchema).min(1).max(40),
  edges: z.array(projectEdgeSummarySchema).max(80)
});

export type ProjectNodeSummary = z.infer<typeof projectNodeSummarySchema>;
export type ProjectEdgeSummary = z.infer<typeof projectEdgeSummarySchema>;
export type ProjectExcerpt = z.infer<typeof projectExcerptSchema>;

const EXCERPT_MAX_NODES = 40;

function summarizeNode(node: VdtProject["graph"]["nodes"][number]): ProjectNodeSummary {
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    ...(node.unit ? { unit: node.unit } : {}),
    ...(node.formula ? { formula: node.formula } : {}),
    ...(node.description ? { description: node.description } : {})
  };
}

function summarizeEdge(edge: VdtProject["graph"]["edges"][number]): ProjectEdgeSummary {
  return {
    id: edge.id,
    sourceNodeId: edge.sourceNodeId,
    targetNodeId: edge.targetNodeId,
    relation: edge.relation
  };
}

function parentByChildMap(project: VdtProject) {
  const parentByChild = new Map<string, string>();
  for (const edge of project.graph.edges) {
    parentByChild.set(edge.targetNodeId, edge.sourceNodeId);
  }
  return parentByChild;
}

/** Target node, ancestors, siblings, and direct children. */
export function buildNodeNeighborhoodExcerpt(project: VdtProject, focusNodeId: string): ProjectExcerpt {
  const nodeById = new Map(project.graph.nodes.map((node) => [node.id, node]));
  if (!nodeById.has(focusNodeId)) {
    throw new Error(`Focus node does not exist: ${focusNodeId}`);
  }

  const parentByChild = parentByChildMap(project);
  const ancestorIds: string[] = [];
  let cursor = focusNodeId;
  while (parentByChild.has(cursor)) {
    const parentId = parentByChild.get(cursor)!;
    ancestorIds.unshift(parentId);
    cursor = parentId;
  }

  const parentId = parentByChild.get(focusNodeId);
  const siblingIds = parentId
    ? project.graph.edges
        .filter((edge) => edge.sourceNodeId === parentId && edge.targetNodeId !== focusNodeId)
        .map((edge) => edge.targetNodeId)
    : [];

  const childIds = project.graph.edges
    .filter((edge) => edge.sourceNodeId === focusNodeId)
    .map((edge) => edge.targetNodeId);

  const orderedNodeIds = [...new Set([...ancestorIds, focusNodeId, ...siblingIds, ...childIds])].slice(
    0,
    EXCERPT_MAX_NODES
  );
  const includedIds = new Set(orderedNodeIds);
  const edges = project.graph.edges
    .filter((edge) => includedIds.has(edge.sourceNodeId) && includedIds.has(edge.targetNodeId))
    .map(summarizeEdge);

  return projectExcerptSchema.parse({
    rootNodeId: project.rootNodeId,
    focusNodeId,
    nodes: orderedNodeIds.map((id) => summarizeNode(nodeById.get(id)!)),
    edges
  });
}

/** Branch root plus all descendants reachable within the excerpt cap. */
export function buildBranchExcerpt(project: VdtProject, branchRootNodeId: string): ProjectExcerpt {
  const nodeById = new Map(project.graph.nodes.map((node) => [node.id, node]));
  if (!nodeById.has(branchRootNodeId)) {
    throw new Error(`Branch root node does not exist: ${branchRootNodeId}`);
  }

  const childrenByParent = new Map<string, string[]>();
  for (const edge of project.graph.edges) {
    const siblings = childrenByParent.get(edge.sourceNodeId) ?? [];
    siblings.push(edge.targetNodeId);
    childrenByParent.set(edge.sourceNodeId, siblings);
  }

  const orderedNodeIds: string[] = [];
  const queue = [branchRootNodeId];
  const visited = new Set<string>();

  while (queue.length > 0 && orderedNodeIds.length < EXCERPT_MAX_NODES) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);
    orderedNodeIds.push(nodeId);
    for (const childId of childrenByParent.get(nodeId) ?? []) {
      if (!visited.has(childId)) {
        queue.push(childId);
      }
    }
  }

  const includedIds = new Set(orderedNodeIds);
  const edges = project.graph.edges
    .filter((edge) => includedIds.has(edge.sourceNodeId) && includedIds.has(edge.targetNodeId))
    .map(summarizeEdge);

  return projectExcerptSchema.parse({
    rootNodeId: project.rootNodeId,
    focusNodeId: branchRootNodeId,
    nodes: orderedNodeIds.map((id) => summarizeNode(nodeById.get(id)!)),
    edges
  });
}

/** Bounded project summary for review and executive summary tasks. */
export function buildProjectSummaryExcerpt(project: VdtProject, maxNodes = 40): ProjectExcerpt {
  const nodes = project.graph.nodes.slice(0, maxNodes).map(summarizeNode);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = project.graph.edges
    .filter((edge) => nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId))
    .map(summarizeEdge);

  return projectExcerptSchema.parse({
    rootNodeId: project.rootNodeId,
    focusNodeId: project.rootNodeId,
    nodes,
    edges
  });
}
