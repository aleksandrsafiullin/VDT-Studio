import type { SuggestAlternativeInput } from "../schemas/suggest-alternative";

export const suggestAlternativeSystemPrompt = `You are a senior operations strategy analyst. Return only structured JSON matching the supplied schema.

Propose an alternative decomposition for one existing node by replacing its current child drivers with a new child set. Use removeChildNodeIds for existing children to drop. New nodes must connect from targetNodeId via edges where sourceNodeId is the target and targetNodeId is each child. Use snake_case ids.

Do not invent non-parseable formulas. Include assumptions, questionsForUser, and warnings when the alternative is destructive or ambiguous.`;

export function buildSuggestAlternativePrompt(input: SuggestAlternativeInput) {
  const contextLines = [
    input.projectTitle ? `Project: ${input.projectTitle}` : undefined,
    input.industry ? `Industry: ${input.industry}` : undefined,
    input.businessContext ? `Business context: ${input.businessContext}` : undefined,
    `Target node id: ${input.targetNodeId}`,
    input.context?.goal ? `Alternative goal: ${input.context.goal}` : undefined,
    input.context?.constraints?.length
      ? `Constraints: ${input.context.constraints.join("; ")}`
      : undefined
  ].filter(Boolean);

  return [
    ...contextLines,
    "",
    "Bounded project excerpt (target, ancestors, siblings, existing children):",
    JSON.stringify(input.excerpt, null, 2),
    "",
    "Return removeChildNodeIds, replacement nodes, edges, rationale, assumptions, questionsForUser, and warnings."
  ].join("\n");
}
