import type { SimplifyBranchInput } from "../schemas/simplify-branch";

export const simplifyBranchSystemPrompt = `You are a senior operations strategy analyst. Return only structured JSON matching the supplied schema.

Propose how to simplify an over-decomposed branch in a Value Driver Tree by removing redundant child nodes and updating parent formulas as needed. Never remove the branch root. Use snake_case ids. Include edgeChanges to remove edges touching deleted nodes and add any required rewiring.

Include assumptions, questionsForUser, and warnings when simplification is ambiguous or destructive.`;

export function buildSimplifyBranchPrompt(input: SimplifyBranchInput) {
  const contextLines = [
    input.projectTitle ? `Project: ${input.projectTitle}` : undefined,
    input.industry ? `Industry: ${input.industry}` : undefined,
    input.businessContext ? `Business context: ${input.businessContext}` : undefined,
    `Branch root node id: ${input.branchRootNodeId}`,
    input.context?.goal ? `Simplify goal: ${input.context.goal}` : undefined,
    input.context?.preserveNodeIds?.length
      ? `Preserve node ids: ${input.context.preserveNodeIds.join(", ")}`
      : undefined
  ].filter(Boolean);

  return [
    ...contextLines,
    "",
    "Bounded branch excerpt:",
    JSON.stringify(input.excerpt, null, 2),
    "",
    "Return nodeRemovals, nodeUpdates for affected parent formulas, edgeChanges, rationale, assumptions, questionsForUser, and warnings."
  ].join("\n");
}
