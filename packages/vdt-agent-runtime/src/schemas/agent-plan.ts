import { z } from "zod";

const boundedString = (max: number) => z.string().trim().max(max);
const nonEmptyString = (max: number) => z.string().trim().min(1).max(max);

const nodeTypeSchema = z.enum(["root_kpi", "calculated", "input", "assumption", "external_factor", "data_mapped"]);
const edgeRelationSchema = z.enum([
  "positive_driver",
  "negative_driver",
  "multiplicative_driver",
  "divisive_driver",
  "additive_component",
  "subtractive_component",
  "contextual_influence",
  "formula_dependency"
]);

export const agentPlanSchema = z.object({
  buildIntent: z.object({
    rootKpi: nonEmptyString(200),
    industry: boundedString(160),
    businessContext: boundedString(2_000),
    unit: boundedString(80),
    timePeriod: boundedString(80),
    goal: boundedString(1_000)
  }),
  selectedSkillIds: z.array(nonEmptyString(160)).max(10),
  skillRationale: nonEmptyString(2_000),
  extractedInputs: z.array(z.object({
    id: nonEmptyString(160),
    label: nonEmptyString(160),
    value: z.union([z.string().trim().max(500), z.number().finite()]),
    unit: boundedString(80),
    sourceText: boundedString(500)
  })).max(80),
  missingInputs: z.array(z.object({
    id: nonEmptyString(160),
    question: nonEmptyString(500),
    reason: nonEmptyString(1_000),
    required: z.boolean()
  })).max(40),
  driverPlan: z.array(z.object({
    id: nonEmptyString(160),
    parentNodeId: nonEmptyString(160),
    name: nonEmptyString(200),
    type: nodeTypeSchema,
    unit: boundedString(80),
    relation: edgeRelationSchema,
    formula: boundedString(500),
    description: boundedString(1_000),
    value: z.union([z.string().trim().max(500), z.number().finite()]),
    assumptions: z.array(boundedString(300)).max(20)
  })).max(80),
  rootFormula: boundedString(500),
  assumptions: z.array(boundedString(300)).max(250),
  questionsForUser: z.array(boundedString(500)).max(250),
  warnings: z.array(z.object({
    severity: z.enum(["info", "warning", "error"]).optional(),
    message: nonEmptyString(1_000),
    nodeId: boundedString(160).optional(),
    edgeId: boundedString(160).optional()
  })).max(250),
  confidence: z.number().finite().min(0).max(1)
});

export type AgentPlan = z.infer<typeof agentPlanSchema>;
