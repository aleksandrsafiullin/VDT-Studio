import type { DeepenNodeInput } from "../schemas/deepen-node";

export const deepenNodeSystemPrompt = `You are a senior operations strategy analyst. Return only structured JSON matching the supplied schema.

Propose deeper drivers for one existing node in a Value Driver Tree. New nodes must decompose the target node further without duplicating existing drivers in the excerpt. Use snake_case ids. Child nodes must connect to targetNodeId via edges where sourceNodeId is the target and targetNodeId is the child.

Do not invent non-parseable formulas. Prefer input or calculated child nodes with plausible units aligned to the parent. Include assumptions, questions, and warnings when business context is ambiguous.`;

export function buildDeepenNodePrompt(input: DeepenNodeInput) {
  const contextLines = [
    input.projectTitle ? `Project: ${input.projectTitle}` : undefined,
    input.industry ? `Industry: ${input.industry}` : undefined,
    input.businessContext ? `Business context: ${input.businessContext}` : undefined,
    `Target node id: ${input.targetNodeId}`,
    input.context?.goal ? `Deepen goal: ${input.context.goal}` : undefined,
    input.context?.focusAreas?.length
      ? `Focus areas: ${input.context.focusAreas.join(", ")}`
      : undefined,
    input.context?.maxSuggestions ? `Max suggestions: ${input.context.maxSuggestions}` : undefined
  ].filter(Boolean);

  return [
    ...contextLines,
    "",
    "Bounded project excerpt (target, ancestors, siblings, existing children):",
    JSON.stringify(input.excerpt, null, 2),
    "",
    "Return child node proposals, edges from targetNodeId to each child, assumptions, questionsForUser, and warnings.",
    "Required JSON shape:",
    '{"targetNodeId":"existing_node_id","nodes":[{"id":"child_id","name":"...","description":"...","type":"input|calculated|assumption|external_factor","unit":"optional","formula":"optional","aiConfidence":0.8,"aiRationale":"...","controllability":"high|medium|low|none","materiality":"high|medium|low|unknown","fixedInScenario":"optional boolean; true when the input cannot change in a scenario"}],"edges":[{"id":"edge_target_child","sourceNodeId":"existing_node_id","targetNodeId":"child_id","relation":"positive_driver|negative_driver|multiplicative_driver|divisive_driver|additive_component|subtractive_component|contextual_influence|formula_dependency","label":"optional","aiConfidence":0.8}],"assumptions":[],"questionsForUser":[],"warnings":[{"severity":"info|warning|error","message":"...","nodeId":"optional","edgeId":"optional"}]}'
  ].join("\n");
}
