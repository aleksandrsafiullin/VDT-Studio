import type { VdtProject } from "@vdt-studio/vdt-core";
import { z } from "zod";
import { TASK_LIMITS } from "../tasks/registry";
import { aiChangeSetDraftSchema, aiChangeSetDraftToVdtChangeSet } from "./change-set-draft";
import { aiAssumptionsSchema, aiNodeIdSchema, aiQuestionsForUserSchema, aiWarningsSchema } from "./shared";
import { buildProjectSummaryExcerpt, projectExcerptSchema } from "./project-excerpt";

const maxClusters = 5;

export const duplicateDriverClusterSchema = z
  .object({
    nodeIds: z.array(aiNodeIdSchema).min(2).max(10),
    similarityReason: z.string().min(1).max(1_000),
    mergeSuggestion: z.string().max(1_000).optional()
  })
  .superRefine((cluster, context) => {
    const unique = new Set(cluster.nodeIds);
    if (unique.size !== cluster.nodeIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nodeIds"],
        message: "Duplicate node ids within a cluster are not allowed."
      });
    }
  });

export const identifyDuplicateDriversInputSchema = z.object({
  projectTitle: z.string().max(160).optional(),
  industry: z.string().max(160).optional(),
  businessContext: z.string().max(2_000).optional(),
  excerpt: projectExcerptSchema
});

export const identifyDuplicateDriversOutputSchema = z.object({
  duplicateClusters: z.array(duplicateDriverClusterSchema).max(maxClusters),
  suggestedChanges: aiChangeSetDraftSchema.optional(),
  assumptions: aiAssumptionsSchema,
  questionsForUser: aiQuestionsForUserSchema,
  warnings: aiWarningsSchema
});

export type DuplicateDriverCluster = z.infer<typeof duplicateDriverClusterSchema>;
export type IdentifyDuplicateDriversInput = z.infer<typeof identifyDuplicateDriversInputSchema>;
export type IdentifyDuplicateDriversOutput = z.infer<typeof identifyDuplicateDriversOutputSchema>;

export interface IdentifyDuplicateDriversResult {
  duplicateClusters: DuplicateDriverCluster[];
  assumptions: string[];
  questionsForUser: string[];
  warnings: IdentifyDuplicateDriversOutput["warnings"];
  suggestedChanges?: ReturnType<typeof aiChangeSetDraftToVdtChangeSet>;
}

export function buildIdentifyDuplicateDriversInput(project: VdtProject): IdentifyDuplicateDriversInput {
  return identifyDuplicateDriversInputSchema.parse({
    projectTitle: project.name,
    industry: project.industry,
    businessContext: project.businessContext ?? project.description,
    excerpt: buildProjectSummaryExcerpt(project)
  });
}
