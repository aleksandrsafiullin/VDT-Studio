import { z } from "zod";

const nodeTypeSchema = z.enum(["root_kpi", "calculated", "input", "assumption", "external_factor"]);
const relationSchema = z.enum([
  "positive_driver",
  "negative_driver",
  "multiplicative_driver",
  "divisive_driver",
  "additive_component",
  "subtractive_component",
  "contextual_influence",
  "formula_dependency"
]);

export const aiVdtNodeSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/),
  name: z.string().min(1),
  description: z.string().min(1),
  type: nodeTypeSchema,
  unit: z.string().optional(),
  formula: z.string().optional(),
  aiConfidence: z.number().min(0).max(1),
  aiRationale: z.string().min(1),
  controllability: z.enum(["high", "medium", "low", "none"]).optional(),
  materiality: z.enum(["high", "medium", "low", "unknown"]).optional()
});

export const aiVdtEdgeSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/),
  sourceNodeId: z.string().regex(/^[a-z][a-z0-9_]*$/),
  targetNodeId: z.string().regex(/^[a-z][a-z0-9_]*$/),
  relation: relationSchema,
  label: z.string().optional(),
  aiConfidence: z.number().min(0).max(1).optional()
});

export const aiModelWarningSchema = z.object({
  severity: z.enum(["info", "warning", "error"]).default("warning"),
  message: z.string().min(1),
  nodeId: z.string().optional(),
  edgeId: z.string().optional()
});

export const generateVdtOutputSchema = z
  .object({
    projectTitle: z.string().min(1),
    rootNodeId: z.string().regex(/^[a-z][a-z0-9_]*$/),
    nodes: z.array(aiVdtNodeSchema).min(1),
    edges: z.array(aiVdtEdgeSchema),
    assumptions: z.array(z.string()),
    questionsForUser: z.array(z.string()),
    warnings: z.array(aiModelWarningSchema)
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
export type AiVdtNode = z.infer<typeof aiVdtNodeSchema>;
export type AiVdtEdge = z.infer<typeof aiVdtEdgeSchema>;
export type AiModelWarning = z.infer<typeof aiModelWarningSchema>;
