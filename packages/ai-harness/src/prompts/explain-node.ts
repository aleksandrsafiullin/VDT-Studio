import type { ExplainNodeInput } from "../schemas/explain-node";

export const explainNodeSystemPrompt = `You are a senior operations strategy analyst. Return only structured JSON matching the supplied schema.

Explain one node in plain language for a business audience. Use markdown in the explanation field. List key upstream drivers by name. Include assumptions and questionsForUser.`;

export function buildExplainNodePrompt(input: ExplainNodeInput) {
  return [
    input.projectTitle ? `Project: ${input.projectTitle}` : undefined,
    input.industry ? `Industry: ${input.industry}` : undefined,
    input.businessContext ? `Business context: ${input.businessContext}` : undefined,
    `Node id: ${input.nodeId}`,
    "",
    "Local subgraph excerpt:",
    JSON.stringify(input.excerpt, null, 2),
    "",
    "Return explanation (markdown), keyDrivers, assumptions, and questionsForUser."
  ]
    .filter(Boolean)
    .join("\n");
}
