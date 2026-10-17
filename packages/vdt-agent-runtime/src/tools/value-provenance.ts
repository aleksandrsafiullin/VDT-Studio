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

export function assertUserProvidedValueGrounded(
  context: AgentToolContext,
  nodeId: string,
  evidence?: { value?: number | undefined; quote?: string | undefined }
): void {
  if (runHasUserAnswerForNode(context, nodeId)) return;
  if (evidence && quoteGroundsValue(context, evidence)) return;
  const hints = evidence && Number.isFinite(evidence.value) ? sourceQuoteHints(context, evidence.value!) : [];
  throw new AgentToolError(
    "USER_PROVIDED_VALUE_UNGROUNDED",
    `valueStatus user_provided_value requires a user answer for node "${nodeId}" or a short VERBATIM single-quantity quote from the original user request in note (valueSource.note for update_node; source.note for excavation.write_input_value). Do not paraphrase or add an unquoted prefix.${hints.length ? ` Exact source excerpts for this number: ${JSON.stringify(hints)}. Choose the excerpt that matches this metric.` : ""} Use default_assumption only for an actual estimate, with an explicit assumption note.`
  );
}

function quoteGroundsValue(context: AgentToolContext, evidence: { value?: number | undefined; quote?: string | undefined }): boolean {
  const quote = evidence.quote?.trim();
  if (!quote || quote.length < 4 || quote.length > 300 || !/\p{L}/u.test(quote) || !Number.isFinite(evidence.value)) return false;
  const texts = userSourceTexts(context);
  // Notes may contain an explicitly quoted excerpt with surrounding attribution.
  // Only the verbatim excerpt can ground the value, never its surrounding prose.
  const excerpts = [quote, ...[...quote.matchAll(/["«“]([^"»”\n]+)["»”]/g)].map((match) => match[1]!)];
  return excerpts.some((excerpt) => {
    if (excerpt.length < 4 || !/\p{L}/u.test(excerpt)) return false;
    const numbers = [...excerpt.matchAll(numberPattern())].map((match) => numericValue(match[0]));
  // A short, single-quantity quote avoids accepting an unrelated number from
  // a copied paragraph. Interpretation of what that quantity represents stays
  // with the agent; tools cannot promote their own output to user evidence.
    if (numbers.length === 0 || numbers.some((value) => value !== evidence.value)) return false;
    return texts.some((text) => text.includes(excerpt));
  });
}

function numberPattern(): RegExp { return /[-+]?\d+(?:[.,]\d+)?(?:[eE][-+]?\d+)?/g; }
function numericValue(value: string): number { return Number(value.replace(",", ".")); }

function userSourceTexts(context: AgentToolContext): string[] {
  const state = context.store.getState(context.runId);
  return [state.request.input.prompt, state.request.input.businessContext,
    ...state.chatMessages.filter((message) => message.role === "user").map((message) => message.text)]
    .filter((text): text is string => typeof text === "string");
}

/** Diagnostic excerpts only: the model still chooses the number, metric and
 * interpretation. Never map these literal spans to node IDs or write values. */
function sourceQuoteHints(context: AgentToolContext, value: number): string[] {
  const hints = new Set<string>();
  for (const text of userSourceTexts(context)) {
    const matches = [...text.matchAll(numberPattern())];
    for (const [index, match] of matches.entries()) {
      if (numericValue(match[0]) !== value) continue;
      const start = match.index!;
      const after = start + match[0].length;
      const next = Math.min(matches[index + 1]?.index ?? text.length, after + 100);
      const right = text.slice(after, next).split(/[,;.!?\n]/u)[0]!;
      const excerpt = text.slice(start, after + right.length).trim();
      if (excerpt.length >= 4 && /\p{L}/u.test(excerpt)) hints.add(excerpt);
      if (hints.size === 4) return [...hints];
    }
  }
  return [...hints];
}

function fieldAnswerMentionsNode(value: string, nodeId: string): boolean {
  return value.split(";").some((part) => part.trim().startsWith(`${nodeId}:`));
}
