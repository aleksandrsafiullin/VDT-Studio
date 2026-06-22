import type { VdtProject } from "@vdt-studio/vdt-core";
import { z } from "zod";
import { TASK_LIMITS } from "../tasks/registry";
import { aiChangeSetDraftSchema, aiChangeSetDraftToVdtChangeSet } from "./change-set-draft";
import { aiAssumptionsSchema, aiNodeIdSchema, aiQuestionsForUserSchema, aiWarningsSchema } from "./shared";
import { buildProjectSummaryExcerpt, projectExcerptSchema } from "./project-excerpt";

const limits = TASK_LIMITS.review_model;
const maxFindings = limits.maxFindings ?? 40;

export const reviewModelFindingCategorySchema = z.enum([
  "formula_validity",
  "unit_consistency",
  "business_logic",
  "duplicate_hints",
  "graph_structure",
  "data_quality"
]);

export const reviewModelFindingSchema = z.object({
  severity: z.enum(["info", "warning", "error"]),
  category: reviewModelFindingCategorySchema,
  message: z.string().min(1).max(1_000),
  nodeId: aiNodeIdSchema.optional(),
  edgeId: aiNodeIdSchema.optional()
});

export const reviewModelInputSchema = z.object({
  projectTitle: z.string().max(160).optional(),
  industry: z.string().max(160).optional(),
  businessContext: z.string().max(2_000).optional(),
  excerpt: projectExcerptSchema
});

export const reviewModelOutputSchema = z.object({
  findings: z.array(reviewModelFindingSchema).max(maxFindings),
  suggestedChanges: aiChangeSetDraftSchema.optional(),
  assumptions: aiAssumptionsSchema,
  questionsForUser: aiQuestionsForUserSchema,
  warnings: aiWarningsSchema
});

export type ReviewModelFinding = z.infer<typeof reviewModelFindingSchema>;
export type ReviewModelInput = z.infer<typeof reviewModelInputSchema>;
export type ReviewModelOutput = z.infer<typeof reviewModelOutputSchema>;

export interface ReviewModelResult {
  findings: ReviewModelFinding[];
  assumptions: string[];
  questionsForUser: string[];
  warnings: ReviewModelOutput["warnings"];
  suggestedChanges?: ReturnType<typeof aiChangeSetDraftToVdtChangeSet>;
}

export function buildReviewModelInput(project: VdtProject): ReviewModelInput {
  return reviewModelInputSchema.parse({
    projectTitle: project.name,
    industry: project.industry,
    businessContext: project.businessContext ?? project.description,
    excerpt: buildProjectSummaryExcerpt(project)
  });
}
