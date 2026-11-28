import type { AgentRunEventV2, VdtAgentEvent, VdtAgentRunSnapshot } from "@vdt-studio/vdt-agent-runtime";

export type VoiceNotificationKind = "method" | "read" | "progress" | "question" | "approval" | "validation" | "error" | "cancel" | "finish";

export interface VoiceNotification {
  key: string;
  kind: VoiceNotificationKind;
  text: string;
  priority: "progress" | "normal" | "urgent";
}

export type VoiceRunEvent = AgentRunEventV2 | VdtAgentEvent;
export type VoiceRunSnapshot = Pick<VdtAgentRunSnapshot,
  "runId" | "status" | "draftProject" | "project" | "workspaceRevision" | "finishOutcome" | "pendingQuestions" | "pendingMutationProposal" | "events" | "artifacts"
>;

const readTools = new Set(["skill.read", "project.read_current", "project.get_node", "project.get_subtree",
  "vdt.read_back_calculation", "vdt.read_decomposition_assumptions"]);
const digest = /^sha256:[a-f0-9]{64}$/;
const id = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/;
const isRu = (locale: string) => /^ru(?:[-_]|$)/i.test(locale);

// Only allow bounded text drawn from specific user-facing fields. Do not pass
// through tool output, model prose, diagnostics, or markup.
function spokenText(value: unknown, max = 320): string {
  if (typeof value !== "string") return "";
  return value.replace(/<(?:think|analysis)\b[^>]*>[\s\S]*?(?:<\/(?:think|analysis)>|$)/gi, " ")
    .replace(/<[^>]*>/g, " ").replace(/\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/https?:\/\/\S+/gi, " ").replace(/[\u0000-\u001f\u007f`*_#]/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, max);
}

function verifiedMethod(data: Record<string, unknown> | undefined, runId: string, locale: string): VoiceNotification | undefined {
  if (!data || typeof data.selectionId !== "string" || !id.test(data.selectionId)
    || typeof data.id !== "string" || !id.test(data.id)
    || !Number.isSafeInteger(data.version) || Number(data.version) < 1
    || typeof data.contentHash !== "string" || !digest.test(data.contentHash)
    || !Number.isSafeInteger(data.selectionRevision) || Number(data.selectionRevision) < 0
    || typeof data.readReceiptId !== "string" || !id.test(data.readReceiptId)) return;
  const name = spokenText(data.methodTitle, 100), reason = spokenText(data.reason);
  if (!name || !reason) return;
  return { key: `${runId}:method:${data.selectionId}`, kind: "method", priority: "normal",
    text: isRu(locale) ? `Выбрана методика: ${name}. ${reason}` : `Selected method: ${name}. ${reason}` };
}

export function voiceRunStatus(snapshot: VoiceRunSnapshot | undefined, locale: string) {
  const ru = isRu(locale);
  const graph = snapshot?.status === "succeeded"
    ? (snapshot.project ?? (snapshot.finishOutcome?.state === "final_persisted" ? snapshot.draftProject : undefined))?.graph
    : (snapshot?.draftProject ?? snapshot?.project)?.graph;
  const status = snapshot?.status;
  const count = graph?.nodes.length ?? null;
  const state = status === "running" || status === "queued" ? ru ? "Выполняется" : "Running"
    : status === "needs_user_input" ? ru ? "Ожидается ответ" : "Waiting for an answer"
    : status === "waiting_approval" ? ru ? "Ожидается подтверждение" : "Waiting for approval"
    : status === "succeeded" ? ru ? "Завершено" : "Finished"
    : status === "failed" || status === "recovery_required" ? ru ? "Выполнение остановлено" : "Run stopped"
    : status === "cancelled" ? ru ? "Отменено" : "Cancelled"
    : ru ? "Нет активного задания" : "No active run";
  return { status, nodeCount: count, text: count === null ? `${state}.` : ru
    ? `${state}. Число узлов: ${count}.` : `${state}. Node count: ${count}.` };
}

function questions(event: VoiceRunEvent, values: readonly { id: string; question: string }[], key: string | undefined, locale: string) {
  const text = values.slice(0, 5).map(value => spokenText(value.question)).filter(Boolean).join(" ");
  if (!text) return;
  const identity = key || values.map(value => value.id).join(",");
  return { key: `${event.runId}:question:${identity}`, kind: "question", priority: "urgent",
    text: `${isRu(locale) ? "Вопрос." : "Question."} ${text}` } satisfies VoiceNotification;
}

/** Project only closed, host-attested event types. Final agent prose has no
 * authority to announce a save or artifact. */
export function projectVoiceEvent(event: VoiceRunEvent, locale: string): VoiceNotification | undefined {
  const ru = isRu(locale);
  const base = `${event.runId}:${"schemaVersion" in event ? "canonical" : "public"}:${event.seq}`;
  const line = (kind: VoiceNotificationKind, english: string, russian: string,
    priority: VoiceNotification["priority"] = "normal", key = base): VoiceNotification =>
    ({ key, kind, priority, text: ru ? russian : english });
  if ("schemaVersion" in event) {
    // This selection may be projected by newer canonical outboxes. Existing
    // Supervisor runs expose exactly the same receipt in their public events.
    if ((event as { type: string }).type === "skill_selected" && event.source === "runtime") {
      return verifiedMethod(event.payload as Record<string, unknown>, event.runId, locale);
    }
    if (event.type === "question") return questions(event, event.payload.questions, `${event.payload.questionSetId}:${event.id}`, locale);
    if (event.type === "approval_required") return line("approval", "Approval needed. Review the pending changes.",
      "Нужно подтверждение. Проверьте предложенные изменения.", "urgent", `${event.runId}:approval:${event.payload.proposalId}`);
    if (event.type === "error" && event.source === "runtime")
      return line("error", "The run encountered an error. See details in the workspace.", "Произошла ошибка. Подробности в рабочей области.",
        "urgent", event.payload.retryable ? base : `${event.runId}:failed`);
    if (event.type === "runtime_status") {
      if (event.payload.code === "RUN_CANCELLED")
        return line("cancel", "Run cancelled.", "Задание отменено.", "urgent", `${event.runId}:cancel`);
      if (event.payload.code === "SESSION_STARTED")
        return line("progress", "The run started.", "Задание запущено.", "progress");
    }
    if (event.type === "tool_result" && event.payload.status === "succeeded" && readTools.has(event.payload.toolName))
      return line("read", "The requested information was read.", "Запрошенные данные прочитаны.", "progress");
    return;
  }
  if (event.type === "skill_selected") return verifiedMethod(event.metadata, event.runId, locale);
  // A compatibility mirror cannot produce a second notification for its
  // canonical event. Snapshot-only events still have their own sequence.
  if (typeof event.metadata?.eventV2Id === "string") return;
  if (event.type === "clarifying_questions" && event.questions)
    return questions(event, event.questions, typeof event.metadata?.questionSetId === "string" ? `${event.metadata.questionSetId}:${event.id}` : event.id, locale);
  if (event.type === "skill_read" && typeof event.metadata?.readReceiptId === "string" && id.test(event.metadata.readReceiptId))
    return line("read", "The method was read.", "Методика прочитана.", "progress");
  if (event.type === "tool_call_completed" && event.metadata?.ok === true && typeof event.metadata.toolName === "string"
    && event.metadata.toolName !== "skill.read" && readTools.has(event.metadata.toolName))
    return line("read", "The requested information was read.", "Запрошенные данные прочитаны.", "progress");
  if (event.type === "graph_validation" && Number.isSafeInteger(event.metadata?.errors) && Number(event.metadata?.errors) >= 0) {
    const errors = Number(event.metadata?.errors);
    return errors === 0 ? line("validation", "Validation passed.", "Проверка пройдена.")
      : line("validation", `Validation found issues. Error count: ${errors}.`, `Проверка обнаружила проблемы. Число ошибок: ${errors}.`);
  }
  return;
}

function latestQuestionBoundary(snapshot: VoiceRunSnapshot) {
  return snapshot.events.slice().reverse().find(row =>
    row.type === "clarifying_questions" || row.type === "user_answer_received" || row.type === "run_completed");
}

function projectQuestionReceipt(event: VdtAgentEvent, locale: string) {
  if (event.type !== "clarifying_questions" || !event.questions || !id.test(event.id)) return;
  const { eventV2Id, questionSetId } = event.metadata ?? {};
  if (eventV2Id === undefined) return projectVoiceEvent(event, locale);
  if (typeof eventV2Id !== "string" || !id.test(eventV2Id) || typeof questionSetId !== "string" || !id.test(questionSetId)) return;
  return questions(event, event.questions, `${questionSetId}:${eventV2Id}`, locale);
}

/** An unseen stream occurrence can precede its snapshot. A known stale
 * occurrence cannot be replayed after its authoritative snapshot retires it. */
export function isDismissedVoiceQuestion(snapshot: VoiceRunSnapshot | undefined, key: string, locale: string): boolean {
  if (!snapshot) return false;
  const latest = latestQuestionBoundary(snapshot);
  return snapshot.events.some(event => event.runId === snapshot.runId && projectQuestionReceipt(event, locale)?.key === key
    && (latest !== event || snapshot.status !== "needs_user_input" || !event.questions?.every(question =>
      snapshot.pendingQuestions?.some(pending => pending.id === question.id && pending.question === question.question))));
}

/** Recover just the currently pending occurrence when attaching a live voice
 * observer missed its stream event. Snapshot mirrors reuse the stream key. */
export function recoverLiveVoiceQuestion(snapshot: VoiceRunSnapshot | undefined, runId: string, locale: string,
  observedSince: number, requireFreshRun: boolean, requireCanonical = false): VoiceNotification | undefined {
  if (snapshot?.runId !== runId || snapshot.status !== "needs_user_input" || !snapshot.pendingQuestions?.length) return;
  const pending = snapshot.pendingQuestions;
  if (!requireCanonical && pending.length !== 1) return;
  const event = latestQuestionBoundary(snapshot);
  if (event?.type !== "clarifying_questions" || event.runId !== runId || !id.test(event.id)
    || !Number.isSafeInteger(event.seq) || event.seq < 1 || event.questions?.length !== pending.length) return;
  if (requireCanonical && typeof event.metadata?.eventV2Id !== "string") return;
  const occurred = Date.parse(event.timestamp);
  if (!(occurred > observedSince) || !event.questions.every((question, index) =>
    pending[index]?.id === question.id && pending[index]?.question === question.question)) return;
  if (requireFreshRun && !snapshot.events.some(row => {
    const started = Date.parse(row.timestamp);
    return row.type === "run_started" && row.runId === runId && row.seq > 0 && row.seq < event.seq
      && started >= observedSince && started <= occurred;
  })) return;
  return projectQuestionReceipt(event, locale);
}

export function projectVoiceSnapshot(snapshot: VoiceRunSnapshot, locale: string): VoiceNotification[] {
  const ru = isRu(locale), base = snapshot.runId;
  if (snapshot.status === "cancelled") return [{ key: `${base}:cancel`, kind: "cancel", priority: "urgent",
    text: ru ? "Задание отменено." : "Run cancelled." }];
  if (snapshot.status === "failed") return [{ key: `${base}:failed`, kind: "error", priority: "urgent",
    text: ru ? "Произошла ошибка. Подробности в рабочей области." : "The run encountered an error. See details in the workspace." }];
  if (snapshot.status === "waiting_approval" && snapshot.pendingMutationProposal)
    return [{ key: `${base}:approval:${snapshot.pendingMutationProposal.id}`, kind: "approval", priority: "urgent",
      text: ru ? "Нужно подтверждение. Проверьте предложенные изменения." : "Approval needed. Review the pending changes." }];
  const finish = snapshot.finishOutcome;
  if (snapshot.status !== "succeeded" || finish?.state !== "final_persisted") return [];
  const savedRevisionId = snapshot.workspaceRevision?.head.activeRevisionId;
  const saved = finish.outcome !== "answer" && Boolean(savedRevisionId);
  const workbook = savedRevisionId && snapshot.artifacts?.find(artifact => {
    if (artifact.runId !== snapshot.runId || artifact.type !== "excel_workbook" || !/^excel_[a-f0-9]{64}$/.test(artifact.id)) return false;
    const value = artifact.payload as { kind?: unknown; id?: unknown; revisionId?: unknown; scenarioId?: unknown; downloadUrl?: unknown } | undefined;
    if (!value || value.kind !== "excel_workbook" || value.id !== artifact.id || value.revisionId !== savedRevisionId
      || (value.scenarioId !== null && typeof value.scenarioId !== "string")) return false;
    const query = new URLSearchParams({ id: artifact.id, revisionId: savedRevisionId });
    if (typeof value.scenarioId === "string") query.set("scenarioId", value.scenarioId);
    return value.downloadUrl === `/api/agent/runs/${encodeURIComponent(snapshot.runId)}/excel-workbook?${query}`;
  });
  if (workbook) return [{ key: `${base}:finish:${workbook.id}`, kind: "finish", priority: "urgent",
    text: ru ? "Книга Excel для сохранённой версии готова к скачиванию." : "The Excel workbook for the saved revision is ready to download." }];
  const count = saved ? voiceRunStatus(snapshot, locale).nodeCount : null;
  const text = saved ? ru ? "Модель сохранена." : "The model was saved."
    : ru ? "Задание завершено." : "The run finished.";
  return [{ key: `${base}:finish`, kind: "finish", priority: "urgent",
    text: count === null ? text : ru ? `${text} Число узлов: ${count}.` : `${text} Node count: ${count}.` }];
}

/** Cloud readback is bounded to the current canonical question or pending approval. */
export function projectCurrentVoiceReadback(snapshot: VoiceRunSnapshot, locale: string): VoiceNotification | undefined {
  if (snapshot.status === "needs_user_input") {
    return recoverLiveVoiceQuestion(snapshot, snapshot.runId, locale, -Infinity, false, true);
  }
  if (snapshot.status === "waiting_approval") return projectVoiceSnapshot(snapshot, locale)[0];
}
