import { AgentToolError, type AgentToolContext } from "../tool-registry";
import { explicitQuotedInputUnit, literalUserNumberSpans, USER_VALUE_QUOTE_LIMITS } from "../value-provenance-contract";

type QuoteEvidence = { value?: number | undefined; quote?: string | undefined };

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
  evidence?: QuoteEvidence
): void {
  if (runHasUserAnswerForNode(context, nodeId)) return;
  if (evidence && quoteGroundsValue(context, evidence)) return;
  const hints = evidence && Number.isFinite(evidence.value) ? sourceQuoteHints(context, evidence.value!) : [];
  throw new AgentToolError(
    "USER_PROVIDED_VALUE_UNGROUNDED",
    `valueStatus user_provided_value requires a user answer for node "${nodeId}" or a short VERBATIM single-quantity quote from the original user request in note (valueSource.note for update_node; source.note for excavation.write_input_value). Do not paraphrase or add an unquoted prefix.${hints.length ? ` Exact source excerpts for this number: ${JSON.stringify(hints)}. Choose the excerpt that matches this metric.` : ""} Use default_assumption only for an actual estimate, with an explicit assumption note.`
  );
}

export function quoteGroundsValue(context: AgentToolContext, evidence: QuoteEvidence): boolean {
  return groundedQuoteExcerpts(context, evidence).length > 0;
}

/** Use only the text that proves the value. Attribution outside the exact
 * excerpt cannot supply a unit. */
export function groundedQuotedInputUnit(context: AgentToolContext, evidence: QuoteEvidence, currencyContext?: string): string | undefined {
  const units = new Set(groundedQuoteExcerpts(context, evidence)
    .filter((excerpt) => literalUserNumberSpans(excerpt).length === 1)
    .map((excerpt) => explicitQuotedInputUnit(excerpt, currencyContext)));
  return units.size === 1 ? units.values().next().value : undefined;
}

function groundedQuoteExcerpts(context: AgentToolContext, evidence: QuoteEvidence): string[] {
  const quote = evidence.quote?.trim();
  if (!quote || quote.length < USER_VALUE_QUOTE_LIMITS.minCharacters || quote.length > USER_VALUE_QUOTE_LIMITS.maxCharacters || !/\p{L}/u.test(quote) || !Number.isFinite(evidence.value)) return [];
  const sources = userSourceTexts(context).map((text) => ({ text, numbers: literalUserNumberSpans(text) }));
  // Notes may contain an explicitly quoted excerpt with surrounding attribution.
  // Only the verbatim excerpt can ground the value, never its surrounding prose.
  const excerpts = [quote, ...[...quote.matchAll(/["«“]([^"»”\n]+)["»”]/g)].map((match) => match[1]!)];
  return excerpts.filter((excerpt) => {
    if (excerpt.length < USER_VALUE_QUOTE_LIMITS.minCharacters || !/\p{L}/u.test(excerpt)) return false;
    return sources.some(({ text, numbers }) => {
      for (let start = text.indexOf(excerpt); start !== -1; start = text.indexOf(excerpt, start + 1)) {
        const end = start + excerpt.length;
        const overlapping = numbers.filter((number) => number.start < end && number.end > start);
        if (overlapping.length && overlapping.every((number) =>
          number.start >= start && number.end <= end && number.value === evidence.value)) return true;
      }
      return false;
    });
  });
}

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
    const matches = literalUserNumberSpans(text);
    for (const [index, match] of matches.entries()) {
      if (match.value !== value) continue;
      const next = Math.min(matches[index + 1]?.start ?? text.length, match.end + 100);
      const right = text.slice(match.end, next).split(/[,;.!?\n]/u)[0]!;
      const excerpt = text.slice(match.start, match.end + right.length).trim();
      if (excerpt.length >= 4 && /\p{L}/u.test(excerpt)) hints.add(excerpt);
      if (hints.size === 4) return [...hints];
    }
  }
  return [...hints];
}

function fieldAnswerMentionsNode(value: string, nodeId: string): boolean {
  return value.split(";").some((part) => part.trim().startsWith(`${nodeId}:`));
}
