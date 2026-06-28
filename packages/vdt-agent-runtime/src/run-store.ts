import { randomUUID } from "node:crypto";
import type { VdtBuilderSession } from "@vdt-studio/vdt-core";
import { AgentEventBus } from "./event-bus";
import type {
  AgentEventInput,
  AgentChatMessage,
  AgentThreadContext,
  ManualProjectChange,
  PublicAgentStatus,
  VdtAgentRunPhase,
  VdtAgentRunSnapshot,
  VdtAgentRunState,
  VdtAgentRunStatus,
  VdtAgentStartRequest
} from "./types";

export interface AgentRunStoreOptions {
  now?: (() => string) | undefined;
  maxEventsPerRun?: number | undefined;
  eventBus?: AgentEventBus | undefined;
}

export class AgentRunStore {
  private readonly runs = new Map<string, VdtAgentRunState>();
  private readonly now: () => string;
  private readonly maxEventsPerRun: number;
  readonly eventBus: AgentEventBus;

  constructor(options: AgentRunStoreOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.maxEventsPerRun = options.maxEventsPerRun ?? 500;
    this.eventBus = options.eventBus ?? new AgentEventBus();
  }

  createRun(request: VdtAgentStartRequest): VdtAgentRunState {
    const timestamp = this.now();
    const runId = randomUUID();
    const state: VdtAgentRunState = {
      runId,
      status: "queued",
      phase: "classifying_request",
      request,
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
      visibleContext: emptyVisibleContext(runId, request),
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
    return state;
  }

  has(runId: string): boolean {
    return this.runs.has(runId);
  }

  getState(runId: string): VdtAgentRunState {
    const state = this.runs.get(runId);
    if (!state) throw new Error(`Agent run "${runId}" was not found.`);
    return state;
  }

  getSnapshot(runId: string): VdtAgentRunSnapshot {
    const state = this.getState(runId);
    return snapshotFromState(state);
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
    this.appendEvent(runId, {
      type: "run_completed",
      phase: "reporting",
      title: "Run cancelled",
      message: "Agent run was cancelled."
    });
    return this.getState(runId);
  }
}

function snapshotFromState(state: VdtAgentRunState): VdtAgentRunSnapshot {
  const visibleContext = visibleContextFromState(state);
  return {
    runId: state.runId,
    status: state.status,
    phase: state.phase,
    request: state.request,
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
    finalReport: state.finalReport,
    error: state.error,
    retryableError: state.retryableError,
    artifacts: state.artifacts,
    subagentTasks: state.subagentTasks,
    subagentReports: state.subagentReports,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    completedAt: state.completedAt
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
  return {
    rootKpi,
    ...(input.unit?.trim() ? { unit: input.unit.trim() } : {}),
    ...(input.timePeriod?.trim() ? { period: input.timePeriod.trim() } : {}),
    ...(input.industry?.trim() ? { industry: input.industry.trim() } : {}),
    ...(input.businessContext?.trim() ? { businessContext: input.businessContext.trim() } : {})
  };
}

function describeManualChange(change: ManualProjectChange): string {
  if (change.nodeId) return `User changed node "${change.nodeId}".`;
  if (change.edgeId) return `User changed edge "${change.edgeId}".`;
  return `User made a ${change.kind.replaceAll("_", " ")} change.`;
}

function redactMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (/thought|reasoning|chainofthought|api.?key|token|secret/i.test(key)) {
      redacted[key] = "[redacted]";
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}
