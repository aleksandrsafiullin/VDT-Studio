import { randomUUID } from "node:crypto";
import type { AgentChatMessage, VdtAgentStartRequest } from "@vdt-studio/vdt-agent-runtime";
import { VdtStorageError, type MessageRecord, type VdtDatabase } from "@vdt-studio/storage";
import { loadScopedConversationMessages, openAgentRunPersistenceDatabase } from "./persistence";
import { PUBLIC_AGENT_SNAPSHOT_TARGET_BYTES, type PublicAgentRunSnapshot } from "./public-snapshot";
import { resolveTrustedStorageWriteMode } from "../../vdt/storage-write-adapter";

const MAX_MESSAGES = 160;
const MAX_DECISIONS = 8;
const MAX_QUESTIONS = 4;
const MAX_CONTEXT_BYTES = 8_192;

type Source = { messageId: string; runId: string };
type Decision = { topic: string; value: string; source: Source; supersedes?: Source | undefined };
type Question = { id: string; text: string; source: Source; options: Map<string, string> };

const DEFINITION_PATTERNS = [
  /^(?:decision\s*:\s*)?(?<topic>[\p{L}\p{N}][\p{L}\p{N} _/-]{0,63})\s*=\s*(?<value>[^\n?]{1,400})$/iu,
  /^(?:define|treat)\s+(?<topic>.{1,64}?)\s+as\s+(?<value>[^\n?]{1,400})$/iu,
  /^(?<topic>.{1,64}?)\s+(?:means|is defined as)\s+(?<value>[^\n?]{1,400})$/iu,
  /^(?:actually,\s*)?use\s+(?<value>[^\n?]{1,400}?)\s+as\s+(?<topic>.{1,64})$/iu
];

function normalizeTopic(text: string): string {
  return text.trim().toLowerCase().replace(/^the\s+/i, "").replace(/[_\s]+/g, " ").replace(/[.!]$/, "");
}

// Require a declarative definition, explicit keyed decision, or an actual
// submitted answer. Investigation and assistant proposals do not confirm facts.
function instructionDecision(content: string): { topic: string; value: string } | undefined {
  const text = content.trim().replace(/^(?:correction|update)\s*:\s*/i, "")
    .replace(/^for (?:this|the) (?:tree|model),\s*/i, "");
  for (const pattern of DEFINITION_PATTERNS) {
    const fields = text.match(pattern)?.groups;
    if (!fields) continue;
    const topic = normalizeTopic(fields.topic ?? "");
    const value = fields.value?.trim().replace(/[.!]$/, "");
    if (value && /^[\p{L}\p{N}][\p{L}\p{N} /-]*$/u.test(topic)
      && !/\b(?:token|password|secret|api[ _-]?key|authorization|formula|equation)\b/i.test(topic)
      && !/^(?:which|what|whether|ask|check|estimate|calculate|guess)\b/i.test(value)) return { topic, value };
  }
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function entries(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

// Conversation carryover excludes credential-shaped strings, attachment and
// tool payloads, and links. Managed binding egress rules still apply.
function safeContextText(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string" || !value.trim() || value.length > limit
    || /https?:\/\/|file:\/\/|bearer\s+\S+|(?:token|password|secret|api[ _-]?key|authorization)\s*[:=]|\bsk-[\w-]{12,}/i.test(value)) return;
  return value.trim();
}

function safeDecisionValue(value: unknown): string | undefined {
  const text = safeContextText(value, 400);
  if (!text || /(?:^=|\{[^}]+\}|\[[^\]]+\]|\w\s+[-+*/=]\s+\w|[×÷])/u.test(text)) return;
  return text;
}

export function deriveConversationContext(messages: readonly MessageRecord[]): VdtAgentStartRequest["conversationContext"] {
  const questions = new Map<string, Question>();
  const decisions = new Map<string, Decision>();
  const remember = (topic: string, value: string, source: Source) => {
    const old = decisions.get(topic);
    decisions.delete(topic);
    decisions.set(topic, { topic, value, source, ...(old && { supersedes: old.source }) });
  };

  for (const message of messages.slice(-MAX_MESSAGES)) {
    if (!message.agentRunId) continue;
    const source = { messageId: message.id, runId: message.agentRunId };
    const context = message.runContext;
    if (message.role === "user" && context?.kind === "instruction") {
      const decision = instructionDecision(message.content);
      const value = safeDecisionValue(decision?.value);
      if (decision && value) {
        remember(decision.topic, value, source);
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
        questions.set(JSON.stringify([source.runId, question.id]), { id: question.id, text: questionText, source, options });
      }
    }

    if (message.role === "user" && context?.kind === "answer") {
      for (const item of entries(context.answers).slice(0, 12)) {
        const answer = object(item);
        const key = JSON.stringify([source.runId, answer.questionId]);
        const question = questions.get(key);
        if (!question) continue;
        const selected = entries(answer.selectedOptionIds).flatMap((id) => {
          const label = typeof id === "string" ? question.options.get(id) : undefined;
          return label ? [label] : [];
        });
        const fields = Object.entries(object(answer.fields)).flatMap(([name, value]) =>
          typeof value === "number" || typeof value === "string" ? [`${name}: ${value}`] : []);
        const freeText = typeof answer.freeText === "string" ? answer.freeText : undefined;
        const value = safeDecisionValue([freeText, ...selected, ...fields].filter(Boolean).join("; "));
        if (!value) continue;
        questions.delete(key);
        remember(questionTopic(question.text), value, source);
      }
    }
  }

  const resolved = [...decisions.values()].slice(-MAX_DECISIONS);
  const unresolved = [...questions.values()].slice(-MAX_QUESTIONS).map(({ id, text, source }) => ({ id, text, source }));
  if (!resolved.length && !unresolved.length) return;
  const context = {
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

function questionTopic(text: string): string {
  const subject = text.match(/^(?:how do you define|what (?:does|is))\s+(.+?)(?:\s+mean)?\?$/i)?.[1];
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
    request.conversationContext = deriveConversationContext(loadScopedConversationMessages(database, scope, MAX_MESSAGES));
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
