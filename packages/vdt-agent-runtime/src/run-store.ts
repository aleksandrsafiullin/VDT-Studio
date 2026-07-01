import { randomUUID } from "node:crypto";
import type { VdtBuilderSession } from "@vdt-studio/vdt-core";
import { AgentEventBus } from "./event-bus";
import type {
  AgentEventInput,
  AgentChatMessage,
  AgentThreadContext,
  ManualProjectChange,
  PublicAgentStatus,
  VdtAgentEvent,
  VdtAgentRunPhase,
  VdtAgentRunSnapshot,
  VdtAgentRunState,
  VdtAgentRunStatus,
  VdtAgentStartRequest
} from "./types";

export interface PersistedAgentRunState {
  snapshot: VdtAgentRunSnapshot;
  seq: number;
  chatSeq: number;
  firstResponseCompleted: boolean;
  answers: VdtAgentRunState["answers"];
  manualChanges: VdtAgentRunState["manualChanges"];
  recipes: VdtAgentRunState["recipes"];
  lastToolResult?: VdtAgentRunState["lastToolResult"] | undefined;
  feedbackHistory?: VdtAgentRunState["feedbackHistory"] | undefined;
  lastFeedback?: VdtAgentRunState["lastFeedback"] | undefined;
  repairAttemptCount?: VdtAgentRunState["repairAttemptCount"] | undefined;
  validationState?: VdtAgentRunState["validationState"] | undefined;
  calculationState?: VdtAgentRunState["calculationState"] | undefined;
  memoryNotes: VdtAgentRunState["memoryNotes"];
}

export interface AgentRunPersistence {
  createRun(state: VdtAgentRunState): void;
  updateRun(state: VdtAgentRunState): void;
  appendEvent(event: VdtAgentEvent, state: VdtAgentRunState): void;
  getState(runId: string): VdtAgentRunState | null;
  getSnapshot(runId: string): VdtAgentRunSnapshot | null;
}

export interface AgentRunStoreOptions {
  now?: (() => string) | undefined;
  maxEventsPerRun?: number | undefined;
  eventBus?: AgentEventBus | undefined;
  persistence?: AgentRunPersistence | undefined;
}

export class AgentRunStore {
  private readonly runs = new Map<string, VdtAgentRunState>();
  private readonly now: () => string;
  private readonly maxEventsPerRun: number;
  private readonly persistence?: AgentRunPersistence | undefined;
  readonly eventBus: AgentEventBus;

  constructor(options: AgentRunStoreOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.maxEventsPerRun = options.maxEventsPerRun ?? 500;
    this.persistence = options.persistence;
    this.eventBus = options.eventBus ?? new AgentEventBus();
  }

  createRun(request: VdtAgentStartRequest): VdtAgentRunState {
    const timestamp = this.now();
    const runId = randomUUID();
    const normalizedRequest = normalizeStartRequest(request);
    const state: VdtAgentRunState = {
      runId,
      status: "queued",
      phase: "classifying_request",
      request: normalizedRequest,
      selectedSkills: [],
      events: [],
      chatMessages: [],
      chatSeq: 0,
      firstResponseCompleted: false,
      publicStatus: {
        phase: "reading_request",
        message: "Agent is reading your request...",
        updatedAt: timestamp
      },
      visibleContext: emptyVisibleContext(runId, normalizedRequest),
      createdAt: timestamp,
      updatedAt: timestamp,
      seq: 0,
      abortController: new AbortController(),
      answers: {},
      manualChanges: [],
      recipes: [],
      memoryNotes: []
    };
    state.visibleContext = visibleContextFromState(state);
    this.runs.set(runId, state);
    this.persistence?.createRun(state);
    return state;
  }

  has(runId: string): boolean {
    if (this.runs.has(runId)) return true;
    const persisted = this.persistence?.getState(runId);
    if (!persisted) return false;
    this.runs.set(runId, persisted);
    return true;
  }

  getState(runId: string): VdtAgentRunState {
    const state = this.runs.get(runId) ?? this.persistence?.getState(runId) ?? undefined;
    if (!state) throw new Error(`Agent run "${runId}" was not found.`);
    if (!this.runs.has(runId)) {
      this.runs.set(runId, state);
    }
    return state;
  }

  getSnapshot(runId: string): VdtAgentRunSnapshot {
    const state = this.runs.get(runId);
    if (state) return snapshotFromState(state);
    const persisted = this.persistence?.getSnapshot(runId);
    if (persisted) return persisted;
    return snapshotFromState(this.getState(runId));
  }

  updateRun(runId: string, patch: Partial<Omit<VdtAgentRunState, "runId" | "events" | "createdAt" | "seq" | "abortController">>): VdtAgentRunState {
    const state = this.getState(runId);
    const updatedBase: VdtAgentRunState = {
      ...state,
      ...patch,
      updatedAt: this.now()
    };
    const updated = {
      ...updatedBase,
      visibleContext: visibleContextFromState(updatedBase)
    };
    this.runs.set(runId, updated);
    this.persistence?.updateRun(updated);
    return updated;
  }

  appendChatMessage(
    runId: string,
    message: Omit<AgentChatMessage, "id" | "runId" | "createdAt">
  ): VdtAgentRunState {
    const state = this.getState(runId);
    const chatSeq = state.chatSeq + 1;
    const createdAt = this.now();
    const nextMessage: AgentChatMessage = {
      ...message,
      id: `${runId}:chat:${chatSeq}`,
      runId,
      createdAt
    };
    const updatedBase: VdtAgentRunState = {
      ...state,
      chatSeq,
      chatMessages: [...state.chatMessages, nextMessage],
      updatedAt: createdAt
    };
    const updated = {
      ...updatedBase,
      visibleContext: visibleContextFromState(updatedBase)
    };
    this.runs.set(runId, updated);
    this.persistence?.updateRun(updated);
    return updated;
  }

  updatePublicStatus(
    runId: string,
    status: Omit<PublicAgentStatus, "updatedAt"> & { updatedAt?: string | undefined }
  ): VdtAgentRunState {
    const state = this.getState(runId);
    const updatedAt = status.updatedAt ?? this.now();
    const publicStatus: PublicAgentStatus = {
      ...status,
      updatedAt
    };
    const updatedBase: VdtAgentRunState = {
      ...state,
      publicStatus,
      updatedAt
    };
    const updated = {
      ...updatedBase,
      visibleContext: visibleContextFromState(updatedBase)
    };
    this.runs.set(runId, updated);
    this.persistence?.updateRun(updated);
    return updated;
  }

  appendEvent(runId: string, event: AgentEventInput): VdtAgentRunState {
    const state = this.getState(runId);
    const seq = state.seq + 1;
    const nextEvent = {
      id: `${runId}:${seq}`,
      runId,
      seq,
      timestamp: this.now(),
      phase: event.phase ?? state.phase,
      type: event.type,
      title: event.title,
      message: event.message,
      metadata: redactMetadata(event.metadata),
      patch: event.patch,
      questions: event.questions
    };
    const events = [...state.events, nextEvent].slice(-this.maxEventsPerRun);
    const updatedBase: VdtAgentRunState = {
      ...state,
      seq,
      events,
      updatedAt: nextEvent.timestamp
    };
    const updated = {
      ...updatedBase,
      visibleContext: visibleContextFromState(updatedBase)
    };
    this.runs.set(runId, updated);
    this.persistence?.appendEvent(nextEvent, updated);
    this.eventBus.publish(nextEvent);
    return updated;
  }

  observeManualChange(runId: string, input: { projectRevision?: number | undefined; change: ManualProjectChange }): VdtAgentRunState {
    const observedAt = this.now();
    const state = this.getState(runId);
    const updated = this.updateRun(runId, {
      manualChanges: [...state.manualChanges, { ...input, observedAt }]
    });
    this.appendEvent(runId, {
      type: "manual_change_observed",
      phase: updated.phase,
      title: "Manual change observed",
      message: input.change.summary ?? describeManualChange(input.change),
      metadata: {
        projectRevision: input.projectRevision,
        kind: input.change.kind,
        nodeId: input.change.nodeId,
        edgeId: input.change.edgeId
      }
    });
    return this.getState(runId);
  }

  cancelRun(runId: string): VdtAgentRunState {
    const state = this.getState(runId);
    state.abortController.abort();
    const completedAt = this.now();
    const updatedBase: VdtAgentRunState = {
      ...state,
      status: "cancelled",
      phase: "reporting",
      completedAt,
      updatedAt: completedAt
    };
    const updated = {
      ...updatedBase,
      visibleContext: visibleContextFromState(updatedBase)
    };
    this.runs.set(runId, updated);
    this.persistence?.updateRun(updated);
    this.appendEvent(runId, {
      type: "run_completed",
      phase: "reporting",
      title: "Run cancelled",
      message: "Agent run was cancelled."
    });
    return this.getState(runId);
  }
}

export function snapshotFromState(state: VdtAgentRunState): VdtAgentRunSnapshot {
  const visibleContext = visibleContextFromState(state);
  return {
    runId: state.runId,
    status: state.status,
    phase: state.phase,
    request: redactSecrets(state.request) as VdtAgentStartRequest,
    project: state.project,
    draftProject: state.draftProject,
    selectedSkills: state.selectedSkills,
    events: state.events,
    chatMessages: state.chatMessages,
    publicStatus: state.publicStatus,
    visibleContext,
    pendingQuestions: state.pendingQuestions,
    pendingPlan: state.pendingPlan,
    pendingChangeSet: state.pendingChangeSet,
    pendingMutationProposal: state.pendingMutationProposal,
    finalReport: state.finalReport,
    error: state.error,
    retryableError: state.retryableError,
    feedbackHistory: redactSecrets(state.feedbackHistory) as VdtAgentRunState["feedbackHistory"],
    lastFeedback: redactSecrets(state.lastFeedback) as VdtAgentRunState["lastFeedback"],
    repairAttemptCount: state.repairAttemptCount,
    artifacts: state.artifacts,
    mutationProposals: state.mutationProposals,
    progressiveBuild: state.progressiveBuild,
    subagentTasks: state.subagentTasks,
    subagentReports: state.subagentReports,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    completedAt: state.completedAt
  };
}

export function serializeAgentRunState(state: VdtAgentRunState): PersistedAgentRunState {
  return {
    snapshot: snapshotFromState(state),
    seq: state.seq,
    chatSeq: state.chatSeq,
    firstResponseCompleted: state.firstResponseCompleted,
    answers: redactSecrets(state.answers) as VdtAgentRunState["answers"],
    manualChanges: redactSecrets(state.manualChanges) as VdtAgentRunState["manualChanges"],
    recipes: state.recipes,
    lastToolResult: redactSecrets(state.lastToolResult) as VdtAgentRunState["lastToolResult"],
    feedbackHistory: redactSecrets(state.feedbackHistory) as VdtAgentRunState["feedbackHistory"],
    lastFeedback: redactSecrets(state.lastFeedback) as VdtAgentRunState["lastFeedback"],
    repairAttemptCount: state.repairAttemptCount,
    validationState: state.validationState,
    calculationState: state.calculationState,
    memoryNotes: redactSecrets(state.memoryNotes) as VdtAgentRunState["memoryNotes"]
  };
}

export function hydrateAgentRunState(persisted: PersistedAgentRunState): VdtAgentRunState {
  const snapshot = persisted.snapshot;
  return {
    runId: snapshot.runId,
    status: snapshot.status,
    phase: snapshot.phase,
    request: normalizeStartRequest(snapshot.request),
    project: snapshot.project,
    draftProject: snapshot.draftProject,
    selectedSkills: snapshot.selectedSkills,
    events: snapshot.events,
    chatMessages: snapshot.chatMessages,
    publicStatus: snapshot.publicStatus,
    visibleContext: snapshot.visibleContext,
    pendingQuestions: snapshot.pendingQuestions,
    pendingPlan: snapshot.pendingPlan,
    pendingChangeSet: snapshot.pendingChangeSet,
    pendingMutationProposal: snapshot.pendingMutationProposal,
    finalReport: snapshot.finalReport,
    error: snapshot.error,
    retryableError: snapshot.retryableError,
    artifacts: snapshot.artifacts,
    mutationProposals: snapshot.mutationProposals,
    progressiveBuild: snapshot.progressiveBuild,
    subagentTasks: snapshot.subagentTasks,
    subagentReports: snapshot.subagentReports,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    completedAt: snapshot.completedAt,
    seq: persisted.seq,
    chatSeq: persisted.chatSeq,
    firstResponseCompleted: persisted.firstResponseCompleted,
    abortController: new AbortController(),
    answers: persisted.answers,
    manualChanges: persisted.manualChanges,
    recipes: persisted.recipes,
    lastToolResult: persisted.lastToolResult,
    feedbackHistory: persisted.feedbackHistory ?? snapshot.feedbackHistory,
    lastFeedback: persisted.lastFeedback ?? snapshot.lastFeedback,
    repairAttemptCount: persisted.repairAttemptCount ?? snapshot.repairAttemptCount,
    validationState: persisted.validationState,
    calculationState: persisted.calculationState,
    memoryNotes: persisted.memoryNotes
  };
}

function normalizeStartRequest(request: VdtAgentStartRequest): VdtAgentStartRequest {
  return {
    ...request,
    options: {
      ...(request.options ?? {}),
      researchMode: request.options?.researchMode ?? "auto"
    }
  };
}

function emptyVisibleContext(runId: string, request: VdtAgentStartRequest): AgentThreadContext {
  const brief = briefFromRequest(request);
  return {
    threadId: runId,
    visibleTitle: brief.rootKpi,
    brief,
    visibleMessages: []
  };
}

function visibleContextFromState(state: VdtAgentRunState): AgentThreadContext {
  const brief = briefFromRequest(state.request);
  const project = state.project ?? state.draftProject ?? state.request.input.project;
  const rootNode = project?.graph.nodes.find((node) => node.id === project.rootNodeId);
  return {
    threadId: state.runId,
    visibleTitle: brief.rootKpi,
    brief,
    ...(project && rootNode
      ? {
          project: {
            id: project.id,
            name: project.name,
            rootNodeName: rootNode.name,
            ...(rootNode.unit ? { rootNodeUnit: rootNode.unit } : {})
          }
        }
      : {}),
    visibleMessages: state.chatMessages
  };
}

function briefFromRequest(request: VdtAgentStartRequest): AgentThreadContext["brief"] {
  const input = request.input;
  const rootKpi =
    input.rootKpi?.trim() ||
    input.project?.graph.nodes.find((node) => node.id === input.project?.rootNodeId)?.name?.trim() ||
    input.project?.name?.trim() ||
    "Value driver tree";
  const businessContext = visibleBusinessContext(input.businessContext, input.prompt);
  return {
    rootKpi,
    ...(input.unit?.trim() ? { unit: input.unit.trim() } : {}),
    ...(input.timePeriod?.trim() ? { period: input.timePeriod.trim() } : {}),
    ...(input.industry?.trim() ? { industry: input.industry.trim() } : {}),
    ...(businessContext ? { businessContext } : {})
  };
}

function visibleBusinessContext(...values: Array<string | undefined>): string | undefined {
  const parts = values.map((value) => value?.trim()).filter((value): value is string => Boolean(value));
  const uniqueParts = [...new Set(parts)];
  return uniqueParts.length > 0 ? uniqueParts.join("\n") : undefined;
}

function describeManualChange(change: ManualProjectChange): string {
  if (change.nodeId) return `User changed node "${change.nodeId}".`;
  if (change.edgeId) return `User changed edge "${change.edgeId}".`;
  return `User made a ${change.kind.replaceAll("_", " ")} change.`;
}

function redactMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  return redactSecrets(metadata) as Record<string, unknown> | undefined;
}

function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => redactSecrets(entry));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      isSecretKey(key) ? "[redacted]" : redactSecrets(entry)
    ])
  );
}

function isSecretKey(key: string): boolean {
  return /thought|reasoning|chainofthought|api[_-]?key|token|authorization|password|secret|access[_-]?token|refresh[_-]?token/i.test(key);
}
