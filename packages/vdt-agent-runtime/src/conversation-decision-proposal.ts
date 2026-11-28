import { createHash } from "node:crypto";
import type { VdtAgentQuestion } from "@vdt-studio/vdt-agent";
import type { ConversationScope } from "@vdt-studio/storage";
import type { AgentChatMessage } from "./types";

export function normalizeTopic(text: string): string {
  const normalized = text.trim().toLowerCase().replace(/^the\s+/i, "").replace(/[_\s]+/g, " ").replace(/[.!]$/, "");
  return normalized === "выпуском" || normalized === "выпуск" ? "output" : normalized;
}

export function safeTopic(topic: string): boolean {
  return /^[\p{L}\p{N}][\p{L}\p{N} /-]*$/u.test(topic)
    && !/\b(?:token|password|secret|api[ _-]?key|authorization|formula|equation)\b/iu.test(topic);
}

// Conversation carryover excludes credential-shaped strings, attachment and
// tool payloads, and links. Managed binding egress rules still apply.
export function safeContextText(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string" || !value.trim() || value.length > limit
    || /https?:\/\/|file:\/\/|bearer\s+\S+|(?:token|password|secret|api[ _-]?key|authorization)\s*[:=]|\bsk-[\w-]{12,}/i.test(value)) return;
  return value.trim();
}

export function safeDecisionValue(value: unknown): string | undefined {
  const text = safeContextText(value, 400);
  if (!text || /(?:^=|\{[^}]+\}|\[[^\]]+\]|\w\s+[-+*/=]\s+\w|[×÷])/u.test(text)) return;
  return text;
}

const PROPOSAL_PREFIX = "confirm_workspace_decision_";
export const CONFIRM_DECISION_OPTION = "confirm_decision";

export interface ConversationDecisionProposal {
  topic: string;
  value: string;
  evidenceQuote: string;
}

/** Call only with the actual current, submitted user message from the run store.
 * A verbatim excerpt provides grounding, while the submitted choice establishes intent. */
export function confirmConversationDecisionProposal(
  source: Pick<AgentChatMessage, "id" | "runId" | "role" | "kind" | "text" | "answers">,
  proposal: ConversationDecisionProposal,
  language: "en" | "ru",
  scope?: ConversationScope
): VdtAgentQuestion | undefined {
  if (source.role !== "user" || (source.kind !== "instruction" && source.kind !== "answer")) return;
  const evidence = source.kind === "instruction" ? [source.text] : source.answers?.slice(0, 12).flatMap(answer => [
    answer.freeText, ...Object.values(answer.fields ?? {}).slice(0, 12).filter(value => typeof value === "string")
  ]) ?? [];
  const proposedTopic = safeContextText(proposal.topic, 64);
  const value = safeDecisionValue(proposal.value);
  const quote = safeContextText(proposal.evidenceQuote, 400);
  if (!proposedTopic || !value || value.length > 120 || !quote || !quote.includes(value)
    || !evidence.some(text => safeContextText(text, 2_000)?.includes(quote))) return;
  const topic = normalizeTopic(proposedTopic);
  if (!safeTopic(topic)) return;
  const digest = createHash("sha256").update(JSON.stringify([scope?.projectId, scope?.vdtId, scope?.conversationId, source.runId, source.id, topic, value, quote])).digest("hex").slice(0, 32);
  const ru = language === "ru";
  return {
    id: PROPOSAL_PREFIX + digest,
    question: ru ? `Как определить «${topic}» для этого дерева?` : `How do you define ${topic}?`,
    reason: ru ? "Подтвердите, следует ли сохранить предложенное определение для этого дерева." : "Confirm whether to carry this definition forward in this tree.",
    required: true,
    expectedAnswerType: "single_choice",
    freeTextAllowed: false,
    options: [
      { id: CONFIRM_DECISION_OPTION, label: value, value },
      { id: "reject_decision", label: ru ? "Не сохранять это определение" : "Do not save this definition", value: "reject" }
    ]
  };
}

export function isConversationDecisionConfirmation(questionId: string): boolean {
  return questionId.startsWith(PROPOSAL_PREFIX);
}

export function isReservedConfirmationQuestionId(questionId: string): boolean {
  return isConversationDecisionConfirmation(questionId) || questionId.startsWith("skill-method-");
}
