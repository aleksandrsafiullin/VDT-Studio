import type { IdentifyMissingDriversInput } from "../schemas/identify-missing-drivers";

export const identifyMissingDriversSystemPrompt = `You are a senior operations strategy analyst. Return only structured JSON matching the supplied schema.

Identify likely missing drivers in the value driver tree. Each suggestion must reference an existing parentNodeId from the excerpt. Keep suggestions bounded (max 10). Optional suggestedChanges may draft additions but will not be auto-applied.`;

export function buildIdentifyMissingDriversPrompt(input: IdentifyMissingDriversInput) {
  return [
    input.projectTitle ? `Project: ${input.projectTitle}` : undefined,
    input.industry ? `Industry: ${input.industry}` : undefined,
    input.businessContext ? `Business context: ${input.businessContext}` : undefined,
    "",
    "Project excerpt:",
    JSON.stringify(input.excerpt, null, 2),
    "",
    "Return missingDrivers[], optional suggestedChanges, assumptions, questionsForUser, and warnings."
  ]
    .filter(Boolean)
    .join("\n");
}
