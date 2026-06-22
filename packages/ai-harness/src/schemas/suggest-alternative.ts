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
import { buildNodeNeighborhoodExcerpt, projectExcerptSchema } from "./project-excerpt";

const limits = TASK_LIMITS.suggest_alternative;
const maxNodes = limits.maxNodes ?? 15;
const maxEdges = limits.maxEdges ?? 20;
const maxRemovals = limits.maxChanges?.maxDeletions ?? 5;

export const suggestAlternativeContextSchema = z.object({
  goal: z.string().max(500).optional(),
  constraints: z.array(z.string().max(200)).max(10).optional()
});

export const suggestAlternativeInputSchema = z.object({
  projectTitle: z.string().max(160).optional(),
  industry: z.string().max(160).optional(),
  businessContext: z.string().max(2_000).optional(),
  targetNodeId: aiNodeIdSchema,
  excerpt: projectExcerptSchema,
  context: suggestAlternativeContextSchema.optional()
});

export const suggestAlternativeTargetPatchSchema = z.object({
  formula: z.string().max(500).optional(),
  unit: z.string().max(80).optional(),
  description: z.string().max(1_000).optional(),
  aiRationale: z.string().max(1_000).optional()
});

export const suggestAlternativeOutputSchema = z
  .object({
    targetNodeId: aiNodeIdSchema,
    removeChildNodeIds: z.array(aiNodeIdSchema).max(maxRemovals).default([]),
    nodes: z.array(aiVdtNodeSchema).min(1).max(maxNodes),
    edges: z.array(aiVdtEdgeSchema).max(maxEdges),
    targetNodePatch: suggestAlternativeTargetPatchSchema.optional(),
    rationale: z.string().min(1).max(2_000),
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
          message: "Alternative proposals cannot add root_kpi nodes."
        });
      }
    }

    const removalSet = new Set(output.removeChildNodeIds);
    if (removalSet.has(output.targetNodeId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["removeChildNodeIds"],
        message: "Cannot remove the target node."
      });
    }

    for (const nodeId of output.removeChildNodeIds) {
      if (nodeIds.has(nodeId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["removeChildNodeIds"],
          message: `Cannot remove and add the same node id: ${nodeId}`
        });
      }
    }

    const reachableIds = new Set([...nodeIds, output.targetNodeId]);
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

    for (const edge of output.edges) {
      if (!reachableIds.has(edge.sourceNodeId) || !reachableIds.has(edge.targetNodeId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["edges", edge.id],
          message: `Edge endpoints must be targetNodeId or proposed children: ${edge.id}`
        });
      }
    }
  });

export type SuggestAlternativeContext = z.infer<typeof suggestAlternativeContextSchema>;
export type SuggestAlternativeInput = z.infer<typeof suggestAlternativeInputSchema>;
export type SuggestAlternativeOutput = z.infer<typeof suggestAlternativeOutputSchema>;

export function buildSuggestAlternativeInput(
  project: VdtProject,
  targetNodeId: string,
  context?: SuggestAlternativeContext
): SuggestAlternativeInput {
  return suggestAlternativeInputSchema.parse({
    projectTitle: project.name,
    industry: project.industry,
    businessContext: project.businessContext ?? project.description,
    targetNodeId,
    excerpt: buildNodeNeighborhoodExcerpt(project, targetNodeId),
    ...(context ? { context } : {})
  });
}
