/** Keys accepted by agentQuestionSchema.strict() on each user.ask question object. */
export const AGENT_QUESTION_SCHEMA_KEYS = new Set([
  "id",
  "question",
  "reason",
  "required",
  "expectedAnswerType",
  "answerKind",
  "options",
  "fields",
  "freeTextAllowed",
  "placeholder",
  "defaultValue"
]);

export const AGENT_QUESTION_WHEN_TO_ASK =
  "Ask only for missing data, a required business choice, scope conflict, ambiguous logic, low confidence, or formula ambiguity. When one of those applies, use user.ask with 1-5 precise questions.";

export const AGENT_QUESTION_OBJECT_CONTRACT =
  "Each question object may use only: required id, question, reason, required; optional expectedAnswerType (text|number|single_choice|multi_choice), answerKind (text|number|single_choice|multi_choice|field_group), options (string or {id,label,value,revealsFields?,requiresFreeText?}), fields ({id,label,kind text|number,unit?,required?,placeholder?}), freeTextAllowed, placeholder, defaultValue. No other keys permitted — use expectedAnswerType for answer type, never type, responseType, or label.";

export const AGENT_QUESTION_PRESENTATION_HINTS =
  "Prefer single_choice/multi_choice with concrete labelled options and always leave an escape hatch via freeTextAllowed:true or an option with requiresFreeText:true. Use fields/revealsFields for follow-up numbers. Mark required honestly and give a short reason.";

export const AGENT_QUESTION_WRITEBACK_PROMPT_RULE =
  "Numeric answers from the user in this run must be written into the model promptly. vdt.add_driver can set baselineValue at creation but cannot set valueStatus or valueSource; follow with vdt.update_node to set value, baselineValue, valueStatus \"user_provided_value\", and a valueSource recording that the user supplied them in this run. An assumed number must be written with valueStatus \"default_assumption\" and an explicit note naming it as an assumption — never with user-supplied or researched provenance, and never presented as measured or benchmarked. Asking without recording is a failure.";

/** Native CLI web search is not research.search_web and is not a user answer.
 * Reuse default_assumption rather than inventing a valueStatus: the number is
 * unverified and must not inherit user_provided_value or product-research
 * provenance. */
export const AGENT_NATIVE_WEB_SEARCH_PROVENANCE_PROMPT_RULE =
  "A number obtained from the agent's own native web search is not a user answer and is not a research.search_web citation. Write it with valueStatus default_assumption and a valueSource whose sourceTier is native_web_search and whose note states it came from the agent's own web search and was not verified through research.search_web. Never use user_provided_value, and never present it as measured, benchmarked, or product-researched evidence.";

export const NATIVE_WEB_SEARCH_EVENT_CODE = "NATIVE_WEB_SEARCH" as const;

export const AGENT_QUESTION_PROMPT_RULE = [
  AGENT_QUESTION_WHEN_TO_ASK,
  AGENT_QUESTION_OBJECT_CONTRACT,
  AGENT_QUESTION_PRESENTATION_HINTS,
  AGENT_QUESTION_WRITEBACK_PROMPT_RULE
].join(" ");

/** Range and composition together: control calls are enforced as singleton batches. */
export const CHECKPOINT_ACTION_BATCH_CONTRACT_PROMPT_RULE =
  "Use action_batch for 1-6 sequential VDT calls via batch.calls or calls. user.ask, approval.request, and run.request_finish must each be the only call in their batch.";

/** Finishing is a closing move after a calculable tree, not an opening batch. */
export const CHECKPOINT_FINISH_ORDER_PROMPT_RULE =
  "Call run.request_finish only after the tree is built and vdt.calculate has produced a finite rootValue — never as an opening move. Use final only after a successful run.request_finish receipt, citing that exact finishReceiptId.";

/** Legal checkpoint-turn action.type values. Alias names such as tool_call are
 * parser-tolerated but must not be emitted. */
export const CHECKPOINT_ACTION_TYPE_PROMPT_RULE =
  `action.type must be exactly one of: action_batch, user.ask, or final. Never invent names such as tool_call or tool_calls. ${CHECKPOINT_ACTION_BATCH_CONTRACT_PROMPT_RULE} Use user.ask only for 1-5 questions. ${CHECKPOINT_FINISH_ORDER_PROMPT_RULE}`;

/** Shared across legacy decisions, Model Agent, and every checkpoint-session CLI. */
export const AGENT_RESEARCH_UNCONFIGURED_PROMPT_RULE =
  "If research.search_web returns RESEARCH_PROVIDER_NOT_CONFIGURED or RESEARCH_DISABLED_BY_USER, do not retry that tool. Call user.ask for the missing process details, or write assumed numbers with valueStatus default_assumption and an explicit assumption note.";

export const AGENT_RESEARCH_PROVIDER_FAILED_PROMPT_RULE =
  "If research.search_web returns RESEARCH_PROVIDER_AUTH_FAILED, RESEARCH_PROVIDER_FAILED, or RESEARCH_PROVIDER_BAD_RESPONSE, do not retry that tool. Those failures are terminal for research this run. Call user.ask, or write assumed numbers with valueStatus default_assumption and an explicit assumption note.";

export const AGENT_FINISH_MISSING_VALUE_PROMPT_RULE =
  "run.request_finish rejects any vdt.calculate missing_value error and requires a finite rootValue. Write this run's user answers onto leaf inputs before calling it. Do not finish with unpopulated leaves. An assumed leaf must use valueStatus default_assumption and an explicit assumption note — never user_provided_value or researched provenance. A leaf sourced from native web search uses the same default_assumption status with valueSource.sourceTier native_web_search.";

export const CHECKPOINT_RESPONSE_ENVELOPE_PROMPT_RULE =
  "Return exactly one bare JSON object. No markdown fences, no language tags, and no prose before or after the object.";
