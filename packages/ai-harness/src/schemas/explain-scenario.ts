import type { VdtProject } from "@vdt-studio/vdt-core";
import { z } from "zod";
import { TASK_LIMITS } from "../tasks/registry";
import { aiNodeIdSchema } from "./shared";

const limits = TASK_LIMITS.explain_scenario;
const maxTextBytes = limits.maxTextSectionBytes ?? 8 * 1024;

export const explainScenarioImpactHighlightSchema = z.object({
  nodeId: aiNodeIdSchema,
  baselineValue: z.number().optional(),
  scenarioValue: z.number().optional(),
  delta: z.number().optional(),
  message: z.string().min(1).max(500)
});

export const explainScenarioInputSchema = z.object({
  projectTitle: z.string().max(160).optional(),
  industry: z.string().max(160).optional(),
  businessContext: z.string().max(2_000).optional(),
  scenarioId: aiNodeIdSchema,
  scenarioName: z.string().max(160),
  scenarioDescription: z.string().max(1_000).optional(),
  overrides: z
    .array(
      z.object({
        nodeId: aiNodeIdSchema,
        value: z.number(),
        reason: z.string().max(500).optional()
      })
    )
    .max(30),
  calculationSummary: z.object({
    rootNodeId: aiNodeIdSchema,
    baselineRootValue: z.number().optional(),
    scenarioRootValue: z.number().optional(),
    rootDelta: z.number().optional(),
    nodeValues: z
      .array(
        z.object({
          nodeId: aiNodeIdSchema,
          baselineValue: z.number().optional(),
          scenarioValue: z.number().optional()
        })
      )
      .max(40)
  })
});

export const explainScenarioOutputSchema = z.object({
  scenarioId: aiNodeIdSchema,
  narrative: z.string().min(1).max(maxTextBytes),
  impactHighlights: z.array(explainScenarioImpactHighlightSchema).max(20),
  assumptions: z.array(z.string().max(500)).max(30),
  questionsForUser: z.array(z.string().max(500)).max(30)
});

export type ExplainScenarioInput = z.infer<typeof explainScenarioInputSchema>;
export type ExplainScenarioOutput = z.infer<typeof explainScenarioOutputSchema>;

export interface ExplainScenarioResult extends ExplainScenarioOutput {}

export function buildExplainScenarioInput(
  project: VdtProject,
  scenarioId: string,
  calculationSummary: ExplainScenarioInput["calculationSummary"]
): ExplainScenarioInput {
  const scenario = project.scenarios.find((entry) => entry.id === scenarioId);
  if (!scenario) {
    throw new Error(`Scenario does not exist: ${scenarioId}`);
  }

  return explainScenarioInputSchema.parse({
    projectTitle: project.name,
    industry: project.industry,
    businessContext: project.businessContext ?? project.description,
    scenarioId,
    scenarioName: scenario.name,
    scenarioDescription: scenario.description,
    overrides: scenario.overrides,
    calculationSummary
  });
}
