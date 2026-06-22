import type { ReviewModelInput } from "../schemas/review-model";

export const reviewModelSystemPrompt = `You are a senior value driver tree reviewer. Return only structured JSON matching the supplied schema.

Review the model for formula validity, unit consistency, business logic, duplicate hints, graph structure, and data quality. Findings must use category values: formula_validity, unit_consistency, business_logic, duplicate_hints, graph_structure, data_quality.

Optional suggestedChanges may propose draft graph edits but will not be auto-applied. Include assumptions, questionsForUser, and warnings.`;

export function buildReviewModelPrompt(input: ReviewModelInput) {
  return [
    input.projectTitle ? `Project: ${input.projectTitle}` : undefined,
    input.industry ? `Industry: ${input.industry}` : undefined,
    input.businessContext ? `Business context: ${input.businessContext}` : undefined,
    "",
    "Project excerpt (nodes, edges, formulas, units):",
    JSON.stringify(input.excerpt, null, 2),
    "",
    "Return findings[], optional suggestedChanges, assumptions, questionsForUser, and warnings."
  ]
    .filter(Boolean)
    .join("\n");
}
