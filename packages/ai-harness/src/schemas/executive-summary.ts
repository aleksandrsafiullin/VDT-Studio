import type { VdtProject } from "@vdt-studio/vdt-core";
import { z } from "zod";
import { TASK_LIMITS } from "../tasks/registry";
import { buildProjectSummaryExcerpt, projectExcerptSchema } from "./project-excerpt";

const limits = TASK_LIMITS.generate_executive_summary;
const maxTextBytes = limits.maxTextSectionBytes ?? 8 * 1024;

export const executiveSummaryInputSchema = z.object({
  projectTitle: z.string().max(160).optional(),
  industry: z.string().max(160).optional(),
  businessContext: z.string().max(2_000).optional(),
  excerpt: projectExcerptSchema,
  rootValue: z.number().optional(),
  topDrivers: z
    .array(
      z.object({
        nodeId: z.string(),
        name: z.string(),
        contributionSummary: z.string().max(300).optional()
      })
    )
    .max(10)
    .optional()
});

export const executiveSummaryOutputSchema = z.object({
  headline: z.string().min(1).max(maxTextBytes),
  keyDrivers: z.array(z.string().max(300)).max(15),
  risks: z.array(z.string().max(300)).max(15),
  recommendations: z.array(z.string().max(300)).max(15)
});

export type ExecutiveSummaryInput = z.infer<typeof executiveSummaryInputSchema>;
export type ExecutiveSummaryOutput = z.infer<typeof executiveSummaryOutputSchema>;

export interface ExecutiveSummaryResult extends ExecutiveSummaryOutput {}

export function buildExecutiveSummaryInput(
  project: VdtProject,
  options?: { rootValue?: number; topDrivers?: ExecutiveSummaryInput["topDrivers"] }
): ExecutiveSummaryInput {
  return executiveSummaryInputSchema.parse({
    projectTitle: project.name,
    industry: project.industry,
    businessContext: project.businessContext ?? project.description,
    excerpt: buildProjectSummaryExcerpt(project),
    ...(options?.rootValue !== undefined ? { rootValue: options.rootValue } : {}),
    ...(options?.topDrivers ? { topDrivers: options.topDrivers } : {})
  });
}
