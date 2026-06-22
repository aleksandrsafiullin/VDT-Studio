import type { ExplainScenarioInput } from "../schemas/explain-scenario";

export const explainScenarioSystemPrompt = `You are a senior operations strategy analyst. Return only structured JSON matching the supplied schema.

Explain a scenario using the precomputed calculation summary (deterministic numbers). Do not invent values — use only those provided. Write a narrative and impact highlights tied to node ids.`;

export function buildExplainScenarioPrompt(input: ExplainScenarioInput) {
  return [
    input.projectTitle ? `Project: ${input.projectTitle}` : undefined,
    input.industry ? `Industry: ${input.industry}` : undefined,
    input.businessContext ? `Business context: ${input.businessContext}` : undefined,
    `Scenario: ${input.scenarioName} (${input.scenarioId})`,
    input.scenarioDescription ? `Description: ${input.scenarioDescription}` : undefined,
    "",
    "Scenario overrides:",
    JSON.stringify(input.overrides, null, 2),
    "",
    "Precomputed calculation summary:",
    JSON.stringify(input.calculationSummary, null, 2),
    "",
    "Return narrative, impactHighlights, assumptions, and questionsForUser."
  ]
    .filter(Boolean)
    .join("\n");
}
