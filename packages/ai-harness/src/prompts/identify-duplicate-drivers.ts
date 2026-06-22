import type { IdentifyDuplicateDriversInput } from "../schemas/identify-duplicate-drivers";

export const identifyDuplicateDriversSystemPrompt = `You are a senior operations strategy analyst. Return only structured JSON matching the supplied schema.

Identify clusters of duplicate or near-duplicate drivers. Each cluster must list at least two distinct node ids from the excerpt with no self-duplicates. Keep clusters bounded (max 5). Optional suggestedChanges may draft merge/simplify edits but will not be auto-applied.`;

export function buildIdentifyDuplicateDriversPrompt(input: IdentifyDuplicateDriversInput) {
  return [
    input.projectTitle ? `Project: ${input.projectTitle}` : undefined,
    input.industry ? `Industry: ${input.industry}` : undefined,
    input.businessContext ? `Business context: ${input.businessContext}` : undefined,
    "",
    "Project excerpt:",
    JSON.stringify(input.excerpt, null, 2),
    "",
    "Return duplicateClusters[], optional suggestedChanges, assumptions, questionsForUser, and warnings."
  ]
    .filter(Boolean)
    .join("\n");
}
