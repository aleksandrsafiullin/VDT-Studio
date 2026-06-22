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

const generateTreeLimits = TASK_LIMITS.generate_tree;

export const generateVdtOutputSchema = z
  .object({
    projectTitle: z.string().min(1).max(160),
    rootNodeId: aiNodeIdSchema,
    nodes: z.array(aiVdtNodeSchema).min(1).max(generateTreeLimits.maxNodes!),
    edges: z.array(aiVdtEdgeSchema).max(generateTreeLimits.maxEdges!),
    assumptions: aiAssumptionsSchema,
    questionsForUser: aiQuestionsForUserSchema,
    warnings: aiWarningsSchema
  })
  .superRefine((output, context) => {
    const nodeIds = new Set(output.nodes.map((node) => node.id));

    if (!nodeIds.has(output.rootNodeId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rootNodeId"],
        message: "Root node must exist in nodes."
      });
    }

    for (const edge of output.edges) {
      if (!nodeIds.has(edge.sourceNodeId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["edges", edge.id, "sourceNodeId"],
          message: `Edge source does not exist: ${edge.sourceNodeId}`
        });
      }

      if (!nodeIds.has(edge.targetNodeId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["edges", edge.id, "targetNodeId"],
          message: `Edge target does not exist: ${edge.targetNodeId}`
        });
      }
    }
  });

export type GenerateVdtOutput = z.infer<typeof generateVdtOutputSchema>;

export type { AiVdtNode, AiVdtEdge, AiModelWarning } from "./shared";
export { aiVdtNodeSchema, aiVdtEdgeSchema, aiModelWarningSchema } from "./shared";
