import type { GenerateVdtInput } from "../types";

export const generateVdtSystemPrompt = `You are a senior operations strategy analyst. Return only structured JSON that matches the supplied schema. Build a Value Driver Tree as a left-to-right visual decomposition from root KPI to drivers. Use formulas for calculable nodes and never invent non-parseable formula syntax.`;

export function buildGenerateVdtPrompt(input: GenerateVdtInput) {
  return [
    `Root KPI: ${input.rootKpi}`,
    `Industry: ${input.industry || "Not specified"}`,
    `Business context: ${input.businessContext || "Not specified"}`,
    `Unit: ${input.unit || "Not specified"}`,
    `Time period: ${input.timePeriod || "Not specified"}`,
    `Business goal: ${input.goal || "Not specified"}`,
    `Desired level of detail: ${input.levelOfDetail || "medium"}`,
    "",
    "Return nodes, edges, formulas, units, explanations, confidence scores, assumptions, questions and warnings.",
    "Use snake_case node ids. Formula references must use node ids.",
    "Edges encode the visual decomposition direction, not the mathematical influence direction: sourceNodeId is always the parent closer to the root KPI and targetNodeId is its child driver. Every non-external node must be reachable by following edges outward from rootNodeId.",
    "Required JSON shape:",
    '{"projectTitle":"...","rootNodeId":"root_kpi_id","nodes":[{"id":"root_kpi_id","name":"...","description":"...","type":"root_kpi","unit":"...","formula":"optional","aiConfidence":0.9,"aiRationale":"...","controllability":"high|medium|low|none","materiality":"high|medium|low|unknown","fixedInScenario":"optional boolean; true for inputs that cannot change in a scenario (e.g. calendar hours)"}],"edges":[{"id":"edge_root_to_driver","sourceNodeId":"root_kpi_id","targetNodeId":"driver_id","relation":"positive_driver|negative_driver|multiplicative_driver|divisive_driver|additive_component|subtractive_component|contextual_influence|formula_dependency","label":"optional","aiConfidence":0.9}],"assumptions":[],"questionsForUser":[],"warnings":[{"severity":"info|warning|error","message":"...","nodeId":"optional","edgeId":"optional"}]}'
  ].join("\n");
}
