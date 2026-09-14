import { AgentToolError, type AgentToolContext } from "../tool-registry";

export function runHasUserAnswerForNode(context: AgentToolContext, nodeId: string): boolean {
  const state = context.store.getState(context.runId);
  if (Object.prototype.hasOwnProperty.call(state.answers, nodeId)) return true;
  for (const value of Object.values(state.answers)) {
    if (typeof value === "string" && fieldAnswerMentionsNode(value, nodeId)) return true;
    if (Array.isArray(value) && value.some((item) => fieldAnswerMentionsNode(item, nodeId))) return true;
  }
  for (const question of state.pendingQuestions ?? []) {
    if (question.id === nodeId) return true;
    if (question.fields?.some((field) => field.id === nodeId)) return true;
  }
  return false;
}

export function assertUserProvidedValueGrounded(context: AgentToolContext, nodeId: string): void {
  if (runHasUserAnswerForNode(context, nodeId)) return;
  throw new AgentToolError(
    "USER_PROVIDED_VALUE_UNGROUNDED",
    `valueStatus user_provided_value requires a user answer in this run for node "${nodeId}". Write assumed numbers with valueStatus default_assumption and an explicit assumption note.`
  );
}

function fieldAnswerMentionsNode(value: string, nodeId: string): boolean {
  return value.split(";").some((part) => part.trim().startsWith(`${nodeId}:`));
}
