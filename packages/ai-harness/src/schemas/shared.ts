import { z } from "zod";
import { SHARED_REVIEW_ARRAY_LIMITS } from "../tasks/registry";

export const aiNodeIdSchema = z.string().regex(/^[a-z][a-z0-9_]*$/);

export const aiNodeTypeSchema = z.enum(["root_kpi", "calculated", "input", "assumption", "external_factor"]);

export const aiEdgeRelationSchema = z.enum([
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
  id: aiNodeIdSchema,
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(1_000),
  type: aiNodeTypeSchema,
  unit: z.string().max(80).optional(),
  formula: z.string().max(500).optional(),
  aiConfidence: z.number().min(0).max(1),
  aiRationale: z.string().min(1).max(1_000),
  controllability: z.enum(["high", "medium", "low", "none"]).optional(),
  materiality: z.enum(["high", "medium", "low", "unknown"]).optional(),
  fixedInScenario: z.boolean().optional()
});

export const aiVdtEdgeSchema = z.object({
  id: aiNodeIdSchema,
  sourceNodeId: aiNodeIdSchema,
  targetNodeId: aiNodeIdSchema,
  relation: aiEdgeRelationSchema,
  label: z.string().max(80).optional(),
  aiConfidence: z.number().min(0).max(1).optional()
});

export const aiModelWarningSchema = z.object({
  severity: z.enum(["info", "warning", "error"]).default("warning"),
  message: z.string().min(1).max(1_000),
  nodeId: z.string().optional(),
  edgeId: z.string().optional()
});

export const aiAssumptionsSchema = z
  .array(z.string().max(SHARED_REVIEW_ARRAY_LIMITS.maxAssumptionItemLength))
  .max(SHARED_REVIEW_ARRAY_LIMITS.maxAssumptions);

export const aiQuestionsForUserSchema = z
  .array(z.string().max(SHARED_REVIEW_ARRAY_LIMITS.maxQuestionItemLength))
  .max(SHARED_REVIEW_ARRAY_LIMITS.maxQuestions);

export const aiWarningsSchema = z.array(aiModelWarningSchema).max(SHARED_REVIEW_ARRAY_LIMITS.maxWarnings);

export type AiVdtNode = z.infer<typeof aiVdtNodeSchema>;
export type AiVdtEdge = z.infer<typeof aiVdtEdgeSchema>;
export type AiModelWarning = z.infer<typeof aiModelWarningSchema>;
