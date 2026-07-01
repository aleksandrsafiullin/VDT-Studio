"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, Clock3, Loader2, RotateCcw, X } from "lucide-react";
import { clsx } from "clsx";
import { Button } from "@/components/ui/button";
import type { AgentAnswerPayload, AgentChatMessage, PublicAgentStatus, VdtAgentQuestion } from "@/lib/agent-client";
import type { GenerateActivityState } from "./vdt-store";

export type AgentAnswerSubmission = Record<string, string | number | string[]> | AgentAnswerPayload[];

type QuestionField = NonNullable<VdtAgentQuestion["fields"]>[number];
type QuestionOption = NonNullable<VdtAgentQuestion["options"]>[number];
type PendingMutationProposal = NonNullable<NonNullable<GenerateActivityState["runtimeAgentRun"]>["pendingMutationProposal"]>;
type GenericApprovalRequest = {
  title: string;
  message: string;
  selectedChangeIds?: string[] | undefined;
};

export function isWaitingForUser(
  activity: Pick<GenerateActivityState, "status" | "runtimeAgentRun">
): boolean {
  return activity.status === "needs_user_input"
    || activity.runtimeAgentRun?.status === "waiting_approval";
}

export function formatActiveElapsed(
  startedAt: string,
  completedAt: string | undefined,
  pausedMs: number,
  pauseStartedAt: number | null,
  now: number = Date.now()
): string {
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return "0:00";

  let end: number;
  if (completedAt) {
    end = Date.parse(completedAt);
  } else if (pauseStartedAt !== null) {
    end = pauseStartedAt;
  } else {
    end = now;
  }
  if (!Number.isFinite(end)) return "0:00";

  const totalSeconds = Math.max(0, Math.floor((end - start - pausedMs) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

type ElapsedTrackerState = {
  runId: string;
  pausedMs: number;
  pauseStartedAt: number | null;
};

function initElapsedTracker(
  runId: string,
  activity: Pick<GenerateActivityState, "status" | "runtimeAgentRun" | "updatedAt">,
  now = Date.now()
): ElapsedTrackerState {
  const state: ElapsedTrackerState = { runId, pausedMs: 0, pauseStartedAt: null };
  if (!isWaitingForUser(activity)) return state;
  const pauseStart = Date.parse(activity.updatedAt);
  state.pauseStartedAt = Number.isFinite(pauseStart) ? pauseStart : now;
  return state;
}

export function syncElapsedTracker(
  state: ElapsedTrackerState,
  activity: Pick<GenerateActivityState, "runId" | "status" | "runtimeAgentRun" | "updatedAt" | "startedAt" | "completedAt">,
  now = Date.now()
): { state: ElapsedTrackerState; elapsed: string } {
  let next = state.runId === activity.runId
    ? state
    : initElapsedTracker(activity.runId, activity, now);

  const waiting = isWaitingForUser(activity);
  if (waiting) {
    if (next.pauseStartedAt === null) {
      const pauseStart = Date.parse(activity.updatedAt);
      next = {
        ...next,
        pauseStartedAt: Number.isFinite(pauseStart) ? pauseStart : now
      };
    }
  } else if (next.pauseStartedAt !== null) {
    const completedAtMs = activity.completedAt ? Date.parse(activity.completedAt) : Number.NaN;
    const resumeAt = Number.isFinite(completedAtMs) ? Math.min(now, completedAtMs) : now;
    next = {
      ...next,
      pausedMs: next.pausedMs + (resumeAt - next.pauseStartedAt),
      pauseStartedAt: null
    };
  }

  return {
    state: next,
    elapsed: formatActiveElapsed(
      activity.startedAt,
      activity.completedAt,
      next.pausedMs,
      next.pauseStartedAt,
      now
    )
  };
}

function useActiveElapsed(activity: GenerateActivityState): string {
  const trackerRef = useRef<ElapsedTrackerState>(
    initElapsedTracker(activity.runId, activity)
  );

  const [elapsed, setElapsed] = useState(() => syncElapsedTracker(
    trackerRef.current,
    activity
  ).elapsed);

  useEffect(() => {
    const { state, elapsed: nextElapsed } = syncElapsedTracker(trackerRef.current, activity);
    trackerRef.current = state;
    setElapsed(nextElapsed);

    const waiting = isWaitingForUser(activity);
    const isActiveRunning = activity.status === "running" && !waiting && !activity.completedAt;
    if (!isActiveRunning) return undefined;

    const timer = window.setInterval(() => {
      const tick = syncElapsedTracker(trackerRef.current, activity);
      trackerRef.current = tick.state;
      setElapsed(tick.elapsed);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [
    activity.runId,
    activity.startedAt,
    activity.completedAt,
    activity.status,
    activity.updatedAt,
    activity.runtimeAgentRun?.status
  ]);

  return elapsed;
}

function statusLabel(activity: GenerateActivityState) {
  if (activity.runtimeAgentRun?.status === "waiting_approval") return "Needs approval";
  if (activity.status === "ready") return activity.schemaId === "deepen-node-v1" ? "Patch ready" : "VDT ready";
  if (activity.status === "needs_user_input") return "Needs input";
  if (activity.status === "error") return "Needs attention";
  if (activity.status === "cancelled") return "Cancelled";
  if (activity.cancelRequested) return "Cancelling";
  return "Running";
}

function formatMetadata(value: unknown) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function technicalRows(activity: GenerateActivityState): Array<[string, string | undefined]> {
  return [
    ["Backend", activity.backendId],
    ["Provider", activity.providerId],
    ["Schema", activity.schemaId],
    ["Request", activity.requestId],
    ["Agent run", activity.agentRun?.runId],
    ["Agent status", activity.agentRun?.status],
    ["Agent phase", activity.agentRun?.phase],
    ["App mode", activity.appMode],
    ["Model", activity.model],
    ["Output", activity.outputBytes ? `${activity.outputBytes.toLocaleString()} bytes` : undefined],
    ["Schema valid", activity.schemaValid === undefined ? undefined : activity.schemaValid ? "yes" : "no"],
    ["Repair", activity.repairAttempted ? (activity.repairSucceeded ? "succeeded" : "attempted") : undefined],
    ["Timeout", activity.timeoutMs ? `${Math.round(activity.timeoutMs / 1000)}s` : undefined]
  ];
}

function optionId(option: QuestionOption, index: number) {
  return typeof option === "string" ? option : option.id || `option_${index}`;
}

function optionLabel(option: QuestionOption) {
  return typeof option === "string" ? option : option.label;
}

function optionValue(option: QuestionOption) {
  return typeof option === "string" ? option : option.value;
}

function optionRequiresFreeText(option: QuestionOption) {
  return typeof option === "string" ? false : option.requiresFreeText === true;
}

function mutationCounts(proposal: PendingMutationProposal) {
  const additions = proposal.changeSet.additions.length;
  const updates = proposal.changeSet.updates.length;
  const deletions = proposal.changeSet.deletions.length;
  const edges = proposal.changeSet.edgeChanges.length;
  return [
    additions ? `${additions} add${additions === 1 ? "" : "s"}` : undefined,
    updates ? `${updates} update${updates === 1 ? "" : "s"}` : undefined,
    deletions ? `${deletions} delete${deletions === 1 ? "" : "s"}` : undefined,
    edges ? `${edges} edge change${edges === 1 ? "" : "s"}` : undefined
  ].filter((entry): entry is string => Boolean(entry));
}

function mutationChangeLabels(proposal: PendingMutationProposal): string[] {
  return [
    ...proposal.changeSet.additions.map((entry) => `Add ${entry.name} under ${entry.parentNodeId}`),
    ...proposal.changeSet.updates.map((entry) => `Update ${entry.nodeId}`),
    ...proposal.changeSet.deletions.map((entry) => `Delete ${entry.nodeId}`),
    ...proposal.changeSet.edgeChanges.map((entry) => `${entry.action === "add" ? "Add" : entry.action === "remove" ? "Delete" : "Update"} edge ${entry.id}`)
  ].slice(0, 6);
}

function fieldsForQuestion(question: VdtAgentQuestion): QuestionField[] {
  if (question.fields && question.fields.length > 0) return question.fields;
  if (question.options && question.options.length > 0) return [];
  const answerKind = question.answerKind ?? question.expectedAnswerType ?? "text";
  if (answerKind === "number" || answerKind === "text") {
    return [
      {
        id: "answer",
        label: "Answer",
        kind: answerKind === "number" ? "number" : "text",
        required: question.required,
        placeholder: question.placeholder
      }
    ];
  }
  return [];
}

function fieldValue(field: QuestionField, value: string): string | number {
  const trimmed = value.trim();
  if (field.kind !== "number") return trimmed;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : trimmed;
}

function questionsFromActivity(activity: GenerateActivityState) {
  if (activity.agentQuestions && activity.agentQuestions.length > 0) return activity.agentQuestions;
  const legacyQuestions = activity.questionsForUser ?? activity.agentRun?.questionsForUser ?? [];
  return legacyQuestions.map((question, index) => ({
    id: `question_${index + 1}`,
    question,
    reason: "The agent needs this before continuing.",
    required: true,
    answerKind: "text" as const,
    freeTextAllowed: true,
    placeholder: "Answer for the agent"
  }));
}

function fallbackChatMessages(activity: GenerateActivityState): AgentChatMessage[] {
  const messages: AgentChatMessage[] = [];
  const timestamp = activity.startedAt;
  const publicStatus = activity.publicStatus;
  if (publicStatus) {
    messages.push({
      id: `${activity.runId}:status`,
      runId: activity.runId,
      role: "assistant",
      kind: "status",
      text: publicStatus.message,
      status: publicStatus,
      createdAt: publicStatus.updatedAt
    });
  } else if (activity.message) {
    messages.push({
      id: `${activity.runId}:message`,
      runId: activity.runId,
      role: activity.status === "error" ? "system" : "assistant",
      kind: activity.status === "error" ? "retryable_error" : "status",
      text: activity.message,
      createdAt: timestamp
    });
  }

  const questions = questionsFromActivity(activity);
  if (activity.status === "needs_user_input" && questions.length > 0) {
    messages.push({
      id: `${activity.runId}:questions`,
      runId: activity.runId,
      role: "assistant",
      kind: "question",
      questions,
      createdAt: activity.updatedAt
    });
  }

  const finalReport = activity.finalReport ?? activity.agentRun?.finalReport;
  if (activity.status === "ready" && finalReport) {
    messages.push({
      id: `${activity.runId}:final`,
      runId: activity.runId,
      role: "assistant",
      kind: "final_report",
      text: finalReport,
      createdAt: activity.completedAt ?? activity.updatedAt
    });
  }

  return messages;
}

function MessageBubble({
  message,
  canAnswer,
  onAnswer
}: {
  message: AgentChatMessage;
  canAnswer: boolean;
  onAnswer: ((answers: AgentAnswerSubmission) => void) | undefined;
}) {
  const isUser = message.role === "user";
  return (
    <article
      className={clsx(
        "rounded-md border px-3 py-2",
        isUser ? "border-blue-100 bg-blue-50" : "border-line bg-white"
      )}
      data-testid={`agent-chat-message-${message.role}`}
    >
      <div className="text-xs font-semibold uppercase tracking-normal text-muted">
        {isUser ? "User" : message.kind === "retryable_error" ? "Needs attention" : "Agent"}
      </div>
      {message.text ? (
        <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink">{message.text}</p>
      ) : null}
      {message.status ? (
        <div className="mt-2 text-xs font-medium text-muted" data-testid="agent-public-status">
          {message.status.message}
        </div>
      ) : null}
      {message.questions && message.questions.length > 0 ? (
        <QuestionCard
          questions={message.questions}
          canSubmit={canAnswer}
          onAnswer={onAnswer}
        />
      ) : null}
    </article>
  );
}

function ActivityStatusRow({
  status,
  activity,
  elapsed,
  onCancel
}: {
  status: PublicAgentStatus | undefined;
  activity: GenerateActivityState;
  elapsed: string;
  onCancel: () => void;
}) {
  const isWorking = activity.status === "running" || activity.status === "needs_user_input";
  const isTerminal = activity.status === "ready" || activity.status === "error" || activity.status === "cancelled";
  if (!status && !isWorking && !isTerminal) return null;
  return (
    <div
      className="flex items-center gap-3 rounded-md border border-blue-100 bg-white px-3 py-2"
      data-testid="agent-current-status"
    >
      {isWorking ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" aria-hidden="true" />
      ) : (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-ink">
          {status?.message ?? statusLabel(activity)}
        </div>
        <div className="truncate text-xs text-muted">{activity.providerLabel} - {statusLabel(activity)}</div>
      </div>
      <div className="flex shrink-0 items-center gap-2 text-xs font-medium text-muted">
        <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
        <span data-testid="generate-activity-elapsed">{elapsed}</span>
      </div>
      {isWorking ? (
        <Button
          size="sm"
          variant="ghost"
          icon={<X className="h-3.5 w-3.5" />}
          className="shrink-0"
          disabled={!activity.canCancel || activity.cancelRequested}
          onClick={onCancel}
          data-testid="cancel-generate"
        >
          {activity.cancelRequested ? "Cancelling" : "Cancel"}
        </Button>
      ) : null}
    </div>
  );
}

function QuestionCard({
  questions,
  canSubmit,
  onAnswer
}: {
  questions: VdtAgentQuestion[];
  canSubmit: boolean;
  onAnswer: ((answers: AgentAnswerSubmission) => void) | undefined;
}) {
  const [selectedByQuestion, setSelectedByQuestion] = useState<Record<string, string[]>>({});
  const [freeTextByQuestion, setFreeTextByQuestion] = useState<Record<string, string>>({});
  const [fieldValues, setFieldValues] = useState<Record<string, Record<string, string>>>({});

  const canContinue = questions.every((question) => {
    if (!question.required) return true;
    const selected = selectedByQuestion[question.id] ?? [];
    const freeText = freeTextByQuestion[question.id]?.trim();
    const fields = fieldsForQuestion(question);
    const requiredFields = fields.filter((field) => field.required !== false);
    const requiredFieldsComplete = requiredFields.length === 0
      ? true
      : requiredFields.every((field) => (fieldValues[question.id]?.[field.id] ?? "").trim().length > 0);
    if (fields.length > 0) return requiredFieldsComplete;
    if (question.options && question.options.length > 0) {
      return selected.length > 0 || (question.freeTextAllowed !== false && Boolean(freeText));
    }
    return Boolean(freeText || question.defaultValue !== undefined);
  });

  return (
    <form
      className="mt-3 space-y-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-3"
      data-testid="generate-questions"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit || !canContinue) return;
        const payload: AgentAnswerPayload[] = [];
        for (const question of questions) {
          const selected = selectedByQuestion[question.id] ?? [];
          const freeText = freeTextByQuestion[question.id]?.trim();
          const questionFields = fieldsForQuestion(question);
          const fields = Object.fromEntries(
            questionFields
              .map((field) => [field.id, fieldValue(field, fieldValues[question.id]?.[field.id] ?? "")] as const)
              .filter(([, value]) => String(value).trim().length > 0)
          );
          payload.push({
            questionId: question.id,
            ...(selected.length > 0 ? { selectedOptionIds: selected } : {}),
            ...(Object.keys(fields).length > 0 ? { fields } : {}),
            ...(freeText ? { freeText } : {})
          });
        }
        onAnswer?.(payload);
      }}
    >
      <div className="text-sm font-semibold text-ink">Questions</div>
      {questions.map((question) => (
        <div key={question.id} className="space-y-2 text-sm text-ink">
          <div>
            <div className="font-medium">{question.question}</div>
            {question.reason ? <div className="mt-1 text-xs leading-5 text-muted">{question.reason}</div> : null}
          </div>
          {question.options && question.options.length > 0 ? (
            <div className="grid gap-2">
              {question.options.map((option, index) => {
                const id = optionId(option, index);
                const value = optionValue(option);
                const answerKind = question.answerKind ?? question.expectedAnswerType;
                const isMulti = answerKind === "multi_choice";
                const selected = selectedByQuestion[question.id] ?? [];
                const checked = selected.includes(id);
                const revealsFields = typeof option === "string" ? [] : option.revealsFields ?? [];
                return (
                  <div key={id} className="rounded-md border border-line bg-white px-2 py-2">
                    <label className="flex items-start gap-2">
                      <input
                        className="mt-1"
                        type={isMulti ? "checkbox" : "radio"}
                        name={question.id}
                        value={value}
                        checked={checked}
                        onChange={() => setSelectedByQuestion((current) => ({
                          ...current,
                          [question.id]: isMulti
                            ? (checked ? selected.filter((entry) => entry !== id) : [...selected, id])
                            : [id]
                        }))}
                        data-testid={`agent-answer-option-${question.id}-${id}`}
                      />
                      <span>{optionLabel(option)}</span>
                    </label>
                    {checked && revealsFields.length > 0 ? (
                      <div className="mt-2 grid gap-2">
                        {revealsFields.map((field) => (
                          <label key={field.id} className="block text-xs font-medium text-graphite">
                            {field.label}
                            <input
                              className="mt-1 w-full rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink"
                              type={field.kind === "number" ? "number" : "text"}
                              placeholder={field.placeholder}
                              onChange={(event) => setFieldValues((current) => ({
                                ...current,
                                [question.id]: {
                                  ...(current[question.id] ?? {}),
                                  [field.id]: event.target.value
                                }
                              }))}
                              data-testid={`agent-answer-field-${question.id}-${field.id}`}
                            />
                          </label>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
          {fieldsForQuestion(question).length > 0 ? (
            <div className="grid gap-2">
              {fieldsForQuestion(question).map((field) => (
                <label key={field.id} className="block text-xs font-medium text-graphite">
                  {field.label}{field.unit ? <span className="font-normal text-muted"> ({field.unit})</span> : null}
                  <input
                    className="mt-1 w-full rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink"
                    type={field.kind === "number" ? "number" : "text"}
                    placeholder={field.placeholder}
                    onChange={(event) => setFieldValues((current) => ({
                      ...current,
                      [question.id]: {
                        ...(current[question.id] ?? {}),
                        [field.id]: event.target.value
                      }
                    }))}
                    data-testid={`agent-answer-field-${question.id}-${field.id}`}
                  />
                </label>
              ))}
            </div>
          ) : null}
          {question.freeTextAllowed !== false &&
          ((question.options && question.options.length > 0) ||
            (question.options && question.options.some((option) => optionRequiresFreeText(option))) ||
            (question.fields && question.fields.length > 0)) ? (
            <textarea
              className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-blue-100"
              rows={2}
              value={freeTextByQuestion[question.id] ?? ""}
              onChange={(event) => setFreeTextByQuestion((current) => ({ ...current, [question.id]: event.target.value }))}
              data-testid={questions.length === 1 ? "agent-answer-freeform" : `agent-answer-freeform-${question.id}`}
              placeholder={question.placeholder ?? (question.options && question.options.length > 0 ? "Custom answer or additional context" : "Additional details")}
            />
          ) : null}
        </div>
      ))}
      <Button
        type="submit"
        size="sm"
        variant="primary"
        disabled={!canSubmit || !canContinue}
        data-testid="continue-agent"
      >
        {canSubmit ? "Send answer" : "Working..."}
      </Button>
    </form>
  );
}

function MutationPreviewCard({
  proposal,
  canSubmit,
  onApproval
}: {
  proposal: PendingMutationProposal;
  canSubmit: boolean;
  onApproval: ((approved: boolean, selectedChangeIds?: string[] | undefined) => void) | undefined;
}) {
  const counts = mutationCounts(proposal);
  const labels = mutationChangeLabels(proposal);
  const validationLabel = proposal.validation.valid ? "Validation passed" : "Validation needs attention";
  return (
    <section
      className="rounded-md border border-blue-200 bg-blue-50 px-3 py-3"
      data-testid="mutation-preview"
    >
      <div className="text-sm font-semibold text-ink">{proposal.title}</div>
      <p className="mt-1 text-sm leading-5 text-graphite">{proposal.summary}</p>
      <div className="mt-2 flex flex-wrap gap-2 text-xs font-medium text-blue-800">
        {(counts.length > 0 ? counts : ["No graph changes"]).map((entry) => (
          <span key={entry} className="rounded border border-blue-200 bg-white px-2 py-1">{entry}</span>
        ))}
        <span className="rounded border border-blue-200 bg-white px-2 py-1">{validationLabel}</span>
      </div>
      {labels.length > 0 ? (
        <ul className="mt-3 space-y-1 text-xs leading-5 text-graphite">
          {labels.map((label) => (
            <li key={label} className="truncate">{label}</li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="primary"
          icon={<CheckCircle2 className="h-3.5 w-3.5" />}
          disabled={!canSubmit}
          onClick={() => onApproval?.(true, proposal.selectedChangeIds)}
          data-testid="approve-mutation"
        >
          Apply mutation
        </Button>
        <Button
          type="button"
          size="sm"
          variant="danger"
          icon={<X className="h-3.5 w-3.5" />}
          disabled={!canSubmit}
          onClick={() => onApproval?.(false)}
          data-testid="reject-mutation"
        >
          Reject
        </Button>
      </div>
    </section>
  );
}

function GenericApprovalCard({
  request,
  canSubmit,
  onApproval
}: {
  request: GenericApprovalRequest;
  canSubmit: boolean;
  onApproval: ((approved: boolean, selectedChangeIds?: string[] | undefined) => void) | undefined;
}) {
  return (
    <section
      className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3"
      data-testid="generic-approval-request"
    >
      <div className="text-sm font-semibold text-ink">{request.title || "Approval requested"}</div>
      {request.message ? (
        <p className="mt-1 whitespace-pre-wrap text-sm leading-5 text-graphite">{request.message}</p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="primary"
          icon={<CheckCircle2 className="h-3.5 w-3.5" />}
          disabled={!canSubmit}
          onClick={() => onApproval?.(true, request.selectedChangeIds)}
          data-testid="approve-generic-approval"
        >
          Approve
        </Button>
        <Button
          type="button"
          size="sm"
          variant="danger"
          icon={<X className="h-3.5 w-3.5" />}
          disabled={!canSubmit}
          onClick={() => onApproval?.(false)}
          data-testid="reject-generic-approval"
        >
          Reject
        </Button>
      </div>
    </section>
  );
}

function selectedChangeIdsFromMetadata(metadata: Record<string, unknown> | undefined): string[] | undefined {
  const value = metadata?.selectedChangeIds;
  if (!Array.isArray(value)) return undefined;
  const ids = value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  return ids.length > 0 ? ids : undefined;
}

function pendingGenericApprovalRequest(
  activity: GenerateActivityState,
  events: Array<{ type: string; title: string; message: string; metadata?: Record<string, unknown> | undefined }>
): GenericApprovalRequest | undefined {
  if (activity.runtimeAgentRun?.status !== "waiting_approval") return undefined;
  if (activity.runtimeAgentRun.pendingMutationProposal) return undefined;
  const runtimeEvents = activity.runtimeAgentRun.events ?? [];
  const planEvent = [...runtimeEvents, ...events]
    .reverse()
    .find((event) => event.type === "plan_proposed");
  if (planEvent) {
    return {
      title: planEvent.title,
      message: planEvent.message,
      selectedChangeIds: selectedChangeIdsFromMetadata(planEvent.metadata)
    };
  }
  const approvalMessage = [
    ...(activity.runtimeAgentRun.chatMessages ?? []),
    ...(activity.agentChatMessages ?? [])
  ]
    .reverse()
    .find((message) => message.role === "assistant" && message.kind === "assistant_message" && message.text?.trim());
  if (!approvalMessage?.text) return undefined;
  return {
    title: "Approval requested",
    message: approvalMessage.text
  };
}

export function GenerateActivityPanel({
  activity,
  onCancel,
  onAnswer,
  onApproval,
  diagnostics = false
}: {
  activity: GenerateActivityState;
  onCancel: () => void;
  onAnswer?: (answers: AgentAnswerSubmission) => void;
  onApproval?: (approved: boolean, selectedChangeIds?: string[] | undefined) => void;
  diagnostics?: boolean | undefined;
}) {
  const elapsed = useActiveElapsed(activity);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const events = useMemo(() => activity.agentEvents ?? activity.agentRun?.events ?? [], [activity.agentEvents, activity.agentRun]);
  const selectedSkills = activity.selectedSkills ?? activity.agentRun?.selectedSkills ?? [];
  const messages = activity.agentChatMessages && activity.agentChatMessages.length > 0
    ? activity.agentChatMessages
    : fallbackChatMessages(activity);
  const pendingMutation = activity.runtimeAgentRun?.pendingMutationProposal;
  const visibleMessages = messages.filter((message) => message.kind !== "status");
  const latestStatusMessage = [...messages].reverse().find((message) => message.kind === "status");
  const publicStatus = latestStatusMessage?.status ?? activity.publicStatus;
  const pendingGenericApproval = pendingMutation
    ? undefined
    : pendingGenericApprovalRequest(activity, events);

  return (
    <section
      className="space-y-3"
      data-testid="generate-activity-panel"
      aria-live="polite"
    >
      <div className="space-y-2" data-testid="agent-chat-thread">
        {visibleMessages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            canAnswer={activity.status === "needs_user_input" && message.kind === "question"}
            onAnswer={onAnswer}
          />
        ))}
      </div>

      <ActivityStatusRow
        status={publicStatus}
        activity={activity}
        elapsed={elapsed}
        onCancel={onCancel}
      />

      {pendingMutation ? (
        <MutationPreviewCard
          proposal={pendingMutation}
          canSubmit={activity.runtimeAgentRun?.status === "waiting_approval" && Boolean(onApproval)}
          onApproval={onApproval}
        />
      ) : null}

      {pendingGenericApproval ? (
        <GenericApprovalCard
          request={pendingGenericApproval}
          canSubmit={activity.runtimeAgentRun?.status === "waiting_approval" && Boolean(onApproval)}
          onApproval={onApproval}
        />
      ) : null}

      {activity.retryableError ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3" data-testid="agent-retryable-error">
          <p className="text-sm leading-5 text-ink">{activity.retryableError.message}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="primary"
              icon={<RotateCcw className="h-3.5 w-3.5" />}
              disabled={!onAnswer}
              onClick={() => onAnswer?.({ retry: "retry_last_step" })}
              data-testid="retry-agent"
            >
              Retry last step
            </Button>
            <Button
              size="sm"
              disabled={!onAnswer}
              onClick={() => onAnswer?.({ continue: "smaller_step" })}
              data-testid="continue-agent-smaller-step"
            >
              Smaller step
            </Button>
            <Button
              size="sm"
              icon={<X className="h-3.5 w-3.5" />}
              onClick={onCancel}
              data-testid="cancel-generate"
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {diagnostics ? (
        <div className="space-y-2" data-testid="agent-debug-diagnostics">
          <details className="rounded-md border border-line bg-white px-3 py-2" data-testid="generate-agent-events">
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-normal text-muted">
              Activity log ({events.length})
            </summary>
            <div className="mt-3 space-y-3">
              {events.length > 0 ? events.map((event) => (
                <article key={event.id} className="border-l border-line pl-3">
                  <div className="text-sm font-semibold text-ink">{event.title}</div>
                  <p className="mt-1 text-sm leading-6 text-graphite">{event.message}</p>
                  {event.metadata ? (
                    <dl className="mt-2 grid gap-1 text-xs text-muted">
                      {Object.entries(event.metadata).slice(0, 4).map(([key, value]) => {
                        const formatted = formatMetadata(value);
                        return formatted ? (
                          <div key={key} className="flex gap-2">
                            <dt className="shrink-0 font-medium text-graphite">{key}</dt>
                            <dd className="min-w-0 truncate">{formatted}</dd>
                          </div>
                        ) : null;
                      })}
                    </dl>
                  ) : null}
                </article>
              )) : (
                <p className="text-sm leading-6 text-muted">Waiting for runtime events.</p>
              )}
            </div>
          </details>

          {selectedSkills.length > 0 ? (
            <details className="rounded-md border border-line bg-white px-3 py-2" data-testid="generate-selected-skills">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-normal text-muted">
                Selected skills ({selectedSkills.length})
              </summary>
              <div className="mt-3 space-y-2">
                {selectedSkills.map((skill) => (
                  <div key={skill.id} className="text-sm leading-6 text-ink">
                    <span className="font-semibold">{skill.id}</span>
                    <span className="text-muted"> - {skill.reason}</span>
                  </div>
                ))}
              </div>
            </details>
          ) : null}

          <div data-testid="generate-run-details">
            <button
              type="button"
              className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted"
              aria-expanded={detailsOpen}
              onClick={() => setDetailsOpen((open) => !open)}
            >
              <ChevronDown
                className={clsx("h-3.5 w-3.5 transition-transform", detailsOpen ? "rotate-180" : undefined)}
                aria-hidden="true"
              />
              Run details
            </button>
            {detailsOpen ? (
              <dl className="mt-3 grid gap-2 text-xs text-muted">
                {technicalRows(activity).map(([label, value]) => value ? (
                  <div key={label} className="flex gap-2">
                    <dt className="w-24 shrink-0 font-medium text-graphite">{label}</dt>
                    <dd className="min-w-0 truncate">{value}</dd>
                  </div>
                ) : null)}
              </dl>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
