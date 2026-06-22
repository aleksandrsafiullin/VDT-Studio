import type { VdtProject } from "@vdt-studio/vdt-core";
import { z } from "zod";
import { TASK_LIMITS } from "../tasks/registry";
import { aiChangeSetDraftSchema, aiChangeSetDraftToVdtChangeSet } from "./change-set-draft";
import {
  aiAssumptionsSchema,
  aiNodeIdSchema,
  aiNodeTypeSchema,
  aiQuestionsForUserSchema,
  aiWarningsSchema
} from "./shared";
import { buildProjectSummaryExcerpt, projectExcerptSchema } from "./project-excerpt";

const limits = TASK_LIMITS.identify_missing_drivers;
const maxSuggestions = 10;

export const missingDriverSuggestionSchema = z.object({
  parentNodeId: aiNodeIdSchema,
  suggestedName: z.string().min(1).max(120),
  suggestedType: aiNodeTypeSchema,
  unit: z.string().max(80).optional(),
  rationale: z.string().min(1).max(1_000),
  suggestedNodeId: aiNodeIdSchema.optional()
});

export const identifyMissingDriversInputSchema = z.object({
  projectTitle: z.string().max(160).optional(),
  industry: z.string().max(160).optional(),
  businessContext: z.string().max(2_000).optional(),
  excerpt: projectExcerptSchema
});

export const identifyMissingDriversOutputSchema = z.object({
  missingDrivers: z.array(missingDriverSuggestionSchema).max(maxSuggestions),
  suggestedChanges: aiChangeSetDraftSchema.optional(),
  assumptions: aiAssumptionsSchema,
  questionsForUser: aiQuestionsForUserSchema,
  warnings: aiWarningsSchema
});

export type MissingDriverSuggestion = z.infer<typeof missingDriverSuggestionSchema>;
export type IdentifyMissingDriversInput = z.infer<typeof identifyMissingDriversInputSchema>;
export type IdentifyMissingDriversOutput = z.infer<typeof identifyMissingDriversOutputSchema>;

export interface IdentifyMissingDriversResult {
  missingDrivers: MissingDriverSuggestion[];
  assumptions: string[];
  questionsForUser: string[];
  warnings: IdentifyMissingDriversOutput["warnings"];
  suggestedChanges?: ReturnType<typeof aiChangeSetDraftToVdtChangeSet>;
}

export function buildIdentifyMissingDriversInput(project: VdtProject): IdentifyMissingDriversInput {
  return identifyMissingDriversInputSchema.parse({
    projectTitle: project.name,
    industry: project.industry,
    businessContext: project.businessContext ?? project.description,
    excerpt: buildProjectSummaryExcerpt(project)
  });
}
