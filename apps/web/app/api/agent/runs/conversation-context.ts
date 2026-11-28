import { randomUUID } from "node:crypto";
import type { AgentChatMessage, VdtAgentStartRequest } from "@vdt-studio/vdt-agent-runtime";
import { VdtStorageError, type MessageRecord, type VdtDatabase } from "@vdt-studio/storage";
import { loadScopedConversationMessages, openAgentRunPersistenceDatabase } from "./persistence";
import { PUBLIC_AGENT_SNAPSHOT_TARGET_BYTES, type PublicAgentRunSnapshot } from "./public-snapshot";
import {
  CONFIRM_DECISION_OPTION, isConversationDecisionConfirmation, normalizeTopic, readInstructionDecision, safeContextText, safeDecisionValue
} from "./conversation-context-decisions";
import { resolveTrustedStorageWriteMode } from "../../vdt/storage-write-adapter";

const MAX_PENDING_QUESTIONS = 64;
const MAX_DECISIONS = 8;
const MAX_QUESTIONS = 4;
const MAX_CONTEXT_BYTES = 8_192;

type Source = { messageId: string; runId: string };
type Decision = {
  topic: string;
  value: string;
  source: Source;
  confirmedBy: "instruction" | "submitted_answer";
  supersedes?: Source | undefined;
};
type Question = { id: string; text: string; source: Source; options: Map<string, string> };

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function entries(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function conversationDecisionProjection() {
  const questions = new Map<string, Question>();
  const decisions = new Map<string, Decision>();
  const sources = new Map<string, Source>();
  const remember = (topic: string, value: string, source: Source, confirmedBy: Decision["confirmedBy"]) => {
    const priorSource = sources.get(topic);
    sources.set(topic, source);
    decisions.delete(topic);
    decisions.set(topic, { topic, value, source, confirmedBy, ...(priorSource && { supersedes: priorSource }) });
    if (decisions.size > MAX_DECISIONS) decisions.delete(decisions.keys().next().value!);
  };

  function visit(message: MessageRecord) {
    if (!message.agentRunId) return;
    const source = { messageId: message.id, runId: message.agentRunId };
    const context = message.runContext;
    if (message.role === "user" && context?.kind === "instruction") {
      const decision = readInstructionDecision(message.content, object(context.decision));
      if (decision) {
        remember(decision.topic, decision.value, source, "instruction");
        for (const [key, question] of questions) if (questionTopic(question.text) === decision.topic) questions.delete(key);
      }
    }

    if (message.role === "assistant" && context?.kind === "question") {
      for (const item of entries(context.questions).slice(0, 12)) {
        const question = object(item);
        const questionText = safeContextText(question.question, 300);
        if (typeof question.id !== "string" || question.id.length > 128 || !questionText) continue;
        const options = new Map<string, string>();
        for (const [index, optionItem] of entries(question.options).slice(0, 12).entries()) {
          const option = object(optionItem);
          const id = typeof optionItem === "string" ? optionItem : String(option.id || `option_${index}`);
          const label = safeContextText(typeof optionItem === "string" ? optionItem : option.label, 120);
          if (label) options.set(id, label);
        }
        const key = JSON.stringify([source.runId, question.id]);
        questions.delete(key);
        questions.set(key, { id: question.id, text: questionText, source, options });
        if (questions.size > MAX_PENDING_QUESTIONS) questions.delete(questions.keys().next().value!);
      }
    }

    if (message.role === "user" && context?.kind === "answer") {
      for (const item of entries(context.answers).slice(0, 12)) {
        const answer = object(item);
        const key = JSON.stringify([source.runId, answer.questionId]);
        const question = questions.get(key);
        if (!question) continue;
        const optionIds = entries(answer.selectedOptionIds);
        if (isConversationDecisionConfirmation(question.id)) {
          const value = optionIds.length === 1 && optionIds[0] === CONFIRM_DECISION_OPTION
            ? safeDecisionValue(question.options.get(CONFIRM_DECISION_OPTION)) : undefined;
          if (value) remember(questionTopic(question.text), value, source, "submitted_answer");
          questions.delete(key);
          continue;
        }
        const selected = optionIds.flatMap((id) => {
          const label = typeof id === "string" ? question.options.get(id) : undefined;
          return label ? [label] : [];
        });
        const fields = Object.entries(object(answer.fields)).flatMap(([name, value]) =>
          typeof value === "number" || typeof value === "string" ? [`${name}: ${value}`] : []);
        const freeText = typeof answer.freeText === "string" ? answer.freeText : undefined;
        const value = safeDecisionValue([freeText, ...selected, ...fields].filter(Boolean).join("; "));
        if (!value) continue;
        questions.delete(key);
        remember(questionTopic(question.text), value, source, "submitted_answer");
      }
    }
  }

  function finish(scope?: { projectId: string; vdtId: string; conversationId: string }) {
    const resolved = [...decisions.values()];
    const unresolved = [...questions.values()].slice(-MAX_QUESTIONS).map(({ id, text, source }) => ({ id, text, source }));
    if (!resolved.length && !unresolved.length) return;
    const context = {
      ...(scope && { scope }),
      policy: "Use the current VDT revision for existing formulas and values. Honor current user instructions and active user-confirmed decisions. A superseded source is historical. Treat unresolved questions as questions.",
      decisions: resolved,
      unresolvedQuestions: unresolved
    };
    while (Buffer.byteLength(JSON.stringify(context)) > MAX_CONTEXT_BYTES) {
      if (unresolved.length) unresolved.shift();
      else resolved.shift();
    }
    return context;
  }

  return { visit, finish };
}

export function deriveConversationContext(messages: readonly MessageRecord[]): VdtAgentStartRequest["conversationContext"] {
  const projection = conversationDecisionProjection();
  messages.forEach(projection.visit);
  return projection.finish();
}

function questionTopic(text: string): string {
  const subject = text.match(/^(?:how do you define|what (?:does|is))\s+(.+?)(?:\s+mean)?\?$/i)?.[1]
    ?? text.match(/^Как определить «(.+?)» для этого дерева\?$/iu)?.[1];
  return normalizeTopic(subject ?? text);
}

export function bindStartConversation(database: VdtDatabase, request: VdtAgentStartRequest): void {
  const priorRunId = request.priorConversationRunId;
  delete request.priorConversationRunId;
  const workspace = request.workspace;
  if (!workspace?.vdtId) return;
  let conversationId = request.conversationId;
  if (priorRunId) {
    const previousRun = database.getAgentRun(priorRunId);
    if (!previousRun || previousRun.vdtId !== workspace.vdtId || previousRun.projectId !== workspace.projectId || !previousRun.conversationId) {
      throw new VdtStorageError("VDT_NOT_FOUND", "Conversation not found for this VDT.");
    }
    conversationId = previousRun.conversationId;
  }
  request.conversationId = conversationId ?? `conversation_${randomUUID()}`;
  if (conversationId) {
    if (!database.getConversation(conversationId)) {
      throw new VdtStorageError("VDT_NOT_FOUND", "Conversation not found for this VDT.");
    }
    const scope = { projectId: workspace.projectId, vdtId: workspace.vdtId, conversationId };
    const projection = conversationDecisionProjection();
    database.visitScopedConversationDecisionMessages(scope, projection.visit);
    request.conversationContext = projection.finish(scope);
  }

  // A visible editor draft keeps the usual expected-head admission check.
  // Reopened callers without a draft can use the active saved revision.
  if (request.input.project || (!conversationId && request.mode === "generate_vdt")) return;
  const activeRevisionId = database.getVdtRevisionHead(workspace.vdtId)?.activeRevisionId;
  if (activeRevisionId) {
    const revision = database.getVdtRevision(activeRevisionId);
    if (!revision || revision.vdtId !== workspace.vdtId) {
      throw new VdtStorageError("VDT_REVISION_HEAD_MISSING", "The active VDT revision could not be loaded.");
    }
    request.input.project = database.readVdtRevision(revision);
  }
}

const DISPLAY_KINDS = new Set(["instruction", "answer", "assistant_message", "question", "status", "draft_ready", "retryable_error", "final_report"]);

function readPriorConversationChat(database: VdtDatabase, request: VdtAgentStartRequest, runId: string): AgentChatMessage[] {
  const workspace = request.workspace;
  if (!request.conversationId || !workspace?.vdtId) return [];
  const messages = loadScopedConversationMessages(database, {
    projectId: workspace.projectId, vdtId: workspace.vdtId, conversationId: request.conversationId
  }, 80);
  const runPosition = messages.find((message) => message.agentRunId === runId)?.position;
  const openedAt = runPosition === undefined ? database.getAgentRun(runId)?.createdAt : undefined;
  return messages.flatMap((message) => {
    const kind = message.runContext?.kind as AgentChatMessage["kind"] | undefined;
    if (!message.agentRunId || message.agentRunId === runId || !kind || !DISPLAY_KINDS.has(kind)
      || (runPosition !== undefined ? message.position >= runPosition : (!openedAt || message.createdAt >= openedAt))) return [];
    return [{
      id: message.id,
      runId: message.agentRunId,
      role: message.role,
      kind,
      text: message.content,
      createdAt: message.startedAt ?? message.createdAt
    }];
  });
}

/** Add history at the HTTP boundary. Runtime snapshots, receipts and native
 * checkpoints still belong to exactly one run. */
export function presentConversation(snapshot: PublicAgentRunSnapshot): PublicAgentRunSnapshot {
  if (!resolveTrustedStorageWriteMode() || !snapshot.request.conversationId || !snapshot.request.workspace?.vdtId) return snapshot;
  let database: VdtDatabase | undefined;
  try {
    database = openAgentRunPersistenceDatabase(process.cwd());
    const prior = readPriorConversationChat(database, snapshot.request, snapshot.runId);
    if (!prior.length) return snapshot;
    let budget = PUBLIC_AGENT_SNAPSHOT_TARGET_BYTES - Buffer.byteLength(JSON.stringify(snapshot));
    const earlier: AgentChatMessage[] = [];
    for (const message of prior.reverse()) {
      if (earlier.length + snapshot.chatMessages.length >= 100) break;
      const bytes = Buffer.byteLength(JSON.stringify(message)) + 1;
      if (bytes > budget) break;
      budget -= bytes;
      earlier.push(message);
    }
    return earlier.length ? { ...snapshot, chatMessages: [...earlier.reverse(), ...snapshot.chatMessages] } : snapshot;
  } catch {
    // The local run can still be shown if the optional history read fails.
    return snapshot;
  } finally {
    database?.close();
  }
}
