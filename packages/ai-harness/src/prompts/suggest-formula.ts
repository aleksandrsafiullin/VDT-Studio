import type { SuggestFormulaInput } from "../schemas/suggest-formula";

export const suggestFormulaSystemPrompt = `You are a senior operations strategy analyst. Return only structured JSON matching the supplied schema.

Suggest a parseable formula for one existing node using upstream driver node ids from the excerpt. Prefer formulas that reference direct child drivers when the node is calculated. Include aiRationale, confidence, assumptions, questionsForUser, and warnings.`;

export function buildSuggestFormulaPrompt(input: SuggestFormulaInput) {
  const contextLines = [
    input.projectTitle ? `Project: ${input.projectTitle}` : undefined,
    input.industry ? `Industry: ${input.industry}` : undefined,
    input.businessContext ? `Business context: ${input.businessContext}` : undefined,
    `Target node id: ${input.nodeId}`,
    input.context?.goal ? `Formula goal: ${input.context.goal}` : undefined,
    input.context?.preferredStyle ? `Preferred style: ${input.context.preferredStyle}` : undefined
  ].filter(Boolean);

  return [
    ...contextLines,
    "",
    "Bounded node excerpt (target, ancestors, siblings, children):",
    JSON.stringify(input.excerpt, null, 2),
    "",
    "Return proposedFormula, optional proposedUnit, aiRationale, confidence, assumptions, questionsForUser, and warnings."
  ].join("\n");
}
