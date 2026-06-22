import type { VdtProject } from "@vdt-studio/vdt-core";
import { z } from "zod";
import { TASK_LIMITS } from "../tasks/registry";
import {
  aiAssumptionsSchema,
  aiNodeIdSchema,
  aiQuestionsForUserSchema,
  aiWarningsSchema
} from "./shared";
import { buildNodeNeighborhoodExcerpt, projectExcerptSchema } from "./project-excerpt";

export const suggestFormulaContextSchema = z.object({
  goal: z.string().max(500).optional(),
  preferredStyle: z.enum(["additive", "multiplicative", "ratio", "custom"]).optional()
});

export const suggestFormulaInputSchema = z.object({
  projectTitle: z.string().max(160).optional(),
  industry: z.string().max(160).optional(),
  businessContext: z.string().max(2_000).optional(),
  nodeId: aiNodeIdSchema,
  excerpt: projectExcerptSchema,
  context: suggestFormulaContextSchema.optional()
});

export const suggestFormulaOutputSchema = z.object({
  nodeId: aiNodeIdSchema,
  proposedFormula: z.string().min(1).max(500),
  proposedUnit: z.string().max(80).optional(),
  aiRationale: z.string().min(1).max(1_000),
  confidence: z.number().min(0).max(1),
  assumptions: aiAssumptionsSchema,
  questionsForUser: aiQuestionsForUserSchema,
  warnings: aiWarningsSchema
});

export type SuggestFormulaContext = z.infer<typeof suggestFormulaContextSchema>;
export type SuggestFormulaInput = z.infer<typeof suggestFormulaInputSchema>;
export type SuggestFormulaOutput = z.infer<typeof suggestFormulaOutputSchema>;

export function buildSuggestFormulaInput(
  project: VdtProject,
  nodeId: string,
  context?: SuggestFormulaContext
): SuggestFormulaInput {
  return suggestFormulaInputSchema.parse({
    projectTitle: project.name,
    industry: project.industry,
    businessContext: project.businessContext ?? project.description,
    nodeId,
    excerpt: buildNodeNeighborhoodExcerpt(project, nodeId),
    ...(context ? { context } : {})
  });
}

export function getSuggestFormulaUpstreamIds(excerpt: z.infer<typeof projectExcerptSchema>, nodeId: string) {
  const childIds = excerpt.edges
    .filter((edge) => edge.sourceNodeId === nodeId)
    .map((edge) => edge.targetNodeId);
  return new Set(childIds);
}
