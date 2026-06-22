import type { CheckUnitsInput } from "../schemas/check-units";

export const checkUnitsSystemPrompt = `You are a dimensional analysis specialist for value driver trees. Return only structured JSON matching the supplied schema.

Identify unit consistency issues across nodes with formulas and units. Reference node ids from the excerpt. Include assumptions, questionsForUser, and warnings.`;

export function buildCheckUnitsPrompt(input: CheckUnitsInput) {
  return [
    input.projectTitle ? `Project: ${input.projectTitle}` : undefined,
    input.industry ? `Industry: ${input.industry}` : undefined,
    input.businessContext ? `Business context: ${input.businessContext}` : undefined,
    "",
    "Project excerpt (nodes with formulas and units):",
    JSON.stringify(input.excerpt, null, 2),
    "",
    "Return unitFindings[], assumptions, questionsForUser, and warnings."
  ]
    .filter(Boolean)
    .join("\n");
}
