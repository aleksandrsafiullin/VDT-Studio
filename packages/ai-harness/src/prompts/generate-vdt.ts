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
    "Use snake_case node ids. Formula references must use node ids."
  ].join("\n");
}
