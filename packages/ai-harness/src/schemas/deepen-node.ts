import type { VdtProject } from "@vdt-studio/vdt-core";
import { z } from "zod";
import { TASK_LIMITS } from "../tasks/registry";
import {
  aiAssumptionsSchema,
  aiNodeIdSchema,
  aiQuestionsForUserSchema,
  aiVdtEdgeSchema,
  aiVdtNodeSchema,
  aiWarningsSchema
} from "./shared";

const deepenLimits = TASK_LIMITS.deepen_node;
const maxAdditions = deepenLimits.maxChanges?.maxAdditions ?? deepenLimits.maxNodes ?? 15;

export const deepenNodeContextSchema = z.object({
  goal: z.string().max(500).optional(),
  focusAreas: z.array(z.string().max(120)).max(10).optional(),
  maxSuggestions: z.number().int().min(1).max(maxAdditions).optional()
});

export const deepenNodeProjectNodeSummarySchema = z.object({
  id: aiNodeIdSchema,
  name: z.string().min(1).max(120),
  type: z.string().min(1).max(40),
  unit: z.string().max(80).optional(),
  formula: z.string().max(500).optional(),
  description: z.string().max(1_000).optional()
});

export const deepenNodeProjectEdgeSummarySchema = z.object({
  id: aiNodeIdSchema,
  sourceNodeId: aiNodeIdSchema,
  targetNodeId: aiNodeIdSchema,
  relation: z.string().min(1).max(40)
});

export const deepenNodeProjectExcerptSchema = z.object({
  rootNodeId: aiNodeIdSchema,
  targetNodeId: aiNodeIdSchema,
  nodes: z.array(deepenNodeProjectNodeSummarySchema).min(1).max(40),
  edges: z.array(deepenNodeProjectEdgeSummarySchema).max(80)
});

export const deepenNodeInputSchema = z.object({
  projectTitle: z.string().max(160).optional(),
  industry: z.string().max(160).optional(),
  businessContext: z.string().max(2_000).optional(),
  targetNodeId: aiNodeIdSchema,
  excerpt: deepenNodeProjectExcerptSchema,
  context: deepenNodeContextSchema.optional()
});

export const deepenNodeOutputSchema = z
  .object({
    targetNodeId: aiNodeIdSchema,
    nodes: z.array(aiVdtNodeSchema).min(1).max(maxAdditions),
    edges: z.array(aiVdtEdgeSchema).max(deepenLimits.maxEdges!),
    assumptions: aiAssumptionsSchema,
    questionsForUser: aiQuestionsForUserSchema,
    warnings: aiWarningsSchema
  })
  .superRefine((output, context) => {
    const nodeIds = new Set<string>();

    for (const node of output.nodes) {
      if (nodeIds.has(node.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["nodes"],
          message: `Duplicate proposed node id: ${node.id}`
        });
      }
      nodeIds.add(node.id);

      if (node.type === "root_kpi") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["nodes", node.id, "type"],
          message: "Deepen proposals cannot add root_kpi nodes."
        });
      }
    }

    const edgeIds = new Set<string>();
    const reachableIds = new Set([...nodeIds, output.targetNodeId]);

    for (const edge of output.edges) {
      if (edgeIds.has(edge.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["edges"],
          message: `Duplicate proposed edge id: ${edge.id}`
        });
      }
      edgeIds.add(edge.id);

      if (!reachableIds.has(edge.sourceNodeId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["edges", edge.id, "sourceNodeId"],
          message: `Edge source is not the target node or a proposed child: ${edge.sourceNodeId}`
        });
      }

      if (!reachableIds.has(edge.targetNodeId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["edges", edge.id, "targetNodeId"],
          message: `Edge target is not the target node or a proposed child: ${edge.targetNodeId}`
        });
      }
    }

    for (const node of output.nodes) {
      const hasParentEdge = output.edges.some(
        (edge) => edge.sourceNodeId === output.targetNodeId && edge.targetNodeId === node.id
      );
      if (!hasParentEdge) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["nodes", node.id],
          message: `Each proposed child must have an edge from targetNodeId (${output.targetNodeId}).`
        });
      }
    }
  });

export type DeepenNodeContext = z.infer<typeof deepenNodeContextSchema>;
export type DeepenNodeProjectExcerpt = z.infer<typeof deepenNodeProjectExcerptSchema>;
export type DeepenNodeInput = z.infer<typeof deepenNodeInputSchema>;
export type DeepenNodeOutput = z.infer<typeof deepenNodeOutputSchema>;

const EXCERPT_MAX_NODES = 40;

function summarizeNode(node: VdtProject["graph"]["nodes"][number]) {
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    ...(node.unit ? { unit: node.unit } : {}),
    ...(node.formula ? { formula: node.formula } : {}),
    ...(node.description ? { description: node.description } : {})
  };
}

function summarizeEdge(edge: VdtProject["graph"]["edges"][number]) {
  return {
    id: edge.id,
    sourceNodeId: edge.sourceNodeId,
    targetNodeId: edge.targetNodeId,
    relation: edge.relation
  };
}

/** Bounded excerpt: target node, ancestors, siblings, and existing children. */
export function buildDeepenNodeExcerpt(project: VdtProject, targetNodeId: string): DeepenNodeProjectExcerpt {
  const nodeById = new Map(project.graph.nodes.map((node) => [node.id, node]));
  const targetNode = nodeById.get(targetNodeId);
  if (!targetNode) {
    throw new Error(`Target node does not exist: ${targetNodeId}`);
  }

  const parentByChild = new Map<string, string>();
  for (const edge of project.graph.edges) {
    parentByChild.set(edge.targetNodeId, edge.sourceNodeId);
  }

  const ancestorIds: string[] = [];
  let cursor = targetNodeId;
  while (parentByChild.has(cursor)) {
    const parentId = parentByChild.get(cursor)!;
    ancestorIds.unshift(parentId);
    cursor = parentId;
  }

  const parentId = parentByChild.get(targetNodeId);
  const siblingIds = parentId
    ? project.graph.edges
        .filter((edge) => edge.sourceNodeId === parentId && edge.targetNodeId !== targetNodeId)
        .map((edge) => edge.targetNodeId)
    : [];

  const childIds = project.graph.edges
    .filter((edge) => edge.sourceNodeId === targetNodeId)
    .map((edge) => edge.targetNodeId);

  const orderedNodeIds = [...new Set([...ancestorIds, targetNodeId, ...siblingIds, ...childIds])].slice(
    0,
    EXCERPT_MAX_NODES
  );

  const includedIds = new Set(orderedNodeIds);
  const edges = project.graph.edges
    .filter((edge) => includedIds.has(edge.sourceNodeId) && includedIds.has(edge.targetNodeId))
    .map(summarizeEdge);

  return deepenNodeProjectExcerptSchema.parse({
    rootNodeId: project.rootNodeId,
    targetNodeId,
    nodes: orderedNodeIds.map((id) => summarizeNode(nodeById.get(id)!)),
    edges
  });
}

export function buildDeepenNodeInput(
  project: VdtProject,
  targetNodeId: string,
  context?: DeepenNodeContext
): DeepenNodeInput {
  return deepenNodeInputSchema.parse({
    projectTitle: project.name,
    industry: project.industry,
    businessContext: project.businessContext ?? project.description,
    targetNodeId,
    excerpt: buildDeepenNodeExcerpt(project, targetNodeId),
    ...(context ? { context } : {})
  });
}
