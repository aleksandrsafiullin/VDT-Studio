import type { ExecutiveSummaryInput } from "../schemas/executive-summary";

export const executiveSummarySystemPrompt = `You are a senior operations strategy analyst preparing an executive briefing. Return only structured JSON matching the supplied schema.

Summarize the value driver model for executives: headline, keyDrivers, risks, and recommendations. Be concise and decision-oriented.`;

export function buildExecutiveSummaryPrompt(input: ExecutiveSummaryInput) {
  return [
    input.projectTitle ? `Project: ${input.projectTitle}` : undefined,
    input.industry ? `Industry: ${input.industry}` : undefined,
    input.businessContext ? `Business context: ${input.businessContext}` : undefined,
    input.rootValue !== undefined ? `Root KPI value: ${input.rootValue}` : undefined,
    input.topDrivers?.length ? `Top drivers: ${JSON.stringify(input.topDrivers)}` : undefined,
    "",
    "Project excerpt:",
    JSON.stringify(input.excerpt, null, 2),
    "",
    "Return headline, keyDrivers, risks, and recommendations."
  ]
    .filter(Boolean)
    .join("\n");
}
