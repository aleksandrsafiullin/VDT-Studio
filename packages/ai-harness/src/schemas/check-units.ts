import type { VdtProject } from "@vdt-studio/vdt-core";
import { z } from "zod";
import { TASK_LIMITS } from "../tasks/registry";
import {
  aiAssumptionsSchema,
  aiNodeIdSchema,
  aiQuestionsForUserSchema,
  aiWarningsSchema
} from "./shared";
import { buildProjectSummaryExcerpt, projectExcerptSchema } from "./project-excerpt";

const limits = TASK_LIMITS.check_units;
const maxFindings = limits.maxFindings ?? 40;

export const checkUnitsFindingSchema = z.object({
  nodeId: aiNodeIdSchema,
  expectedUnit: z.string().max(80).optional(),
  actualUnit: z.string().max(80).optional(),
  severity: z.enum(["info", "warning", "error"]),
  message: z.string().min(1).max(1_000)
});

export const checkUnitsInputSchema = z.object({
  projectTitle: z.string().max(160).optional(),
  industry: z.string().max(160).optional(),
  businessContext: z.string().max(2_000).optional(),
  excerpt: projectExcerptSchema
});

export const checkUnitsOutputSchema = z.object({
  unitFindings: z.array(checkUnitsFindingSchema).max(maxFindings),
  assumptions: aiAssumptionsSchema,
  questionsForUser: aiQuestionsForUserSchema,
  warnings: aiWarningsSchema
});

export type CheckUnitsFinding = z.infer<typeof checkUnitsFindingSchema>;
export type CheckUnitsInput = z.infer<typeof checkUnitsInputSchema>;
export type CheckUnitsOutput = z.infer<typeof checkUnitsOutputSchema>;

export interface CheckUnitsResult {
  unitFindings: CheckUnitsFinding[];
  assumptions: string[];
  questionsForUser: string[];
  warnings: CheckUnitsOutput["warnings"];
}

export function buildCheckUnitsInput(project: VdtProject): CheckUnitsInput {
  return checkUnitsInputSchema.parse({
    projectTitle: project.name,
    industry: project.industry,
    businessContext: project.businessContext ?? project.description,
    excerpt: buildProjectSummaryExcerpt(project)
  });
}
