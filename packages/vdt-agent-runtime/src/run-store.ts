import { randomUUID } from "node:crypto";
import type { VdtBuilderSession } from "@vdt-studio/vdt-core";
import { AgentEventBus } from "./event-bus";
import type {
  AgentEventInput,
  ManualProjectChange,
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
      createdAt: timestamp,
      updatedAt: timestamp,
      seq: 0,
      abortController: new AbortController(),
      answers: {},
      manualChanges: [],
      recipes: [],
      memoryNotes: []
    };
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
    const updated: VdtAgentRunState = {
      ...state,
      ...patch,
      updatedAt: this.now()
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
    const updated: VdtAgentRunState = {
      ...state,
      seq,
      events,
      updatedAt: nextEvent.timestamp
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
    const updated: VdtAgentRunState = {
      ...state,
      status: "cancelled",
      phase: "reporting",
      completedAt,
      updatedAt: completedAt
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
  return {
    runId: state.runId,
    status: state.status,
    phase: state.phase,
    request: state.request,
    project: state.project,
    draftProject: state.draftProject,
    selectedSkills: state.selectedSkills,
    events: state.events,
    pendingQuestions: state.pendingQuestions,
    pendingPlan: state.pendingPlan,
    pendingChangeSet: state.pendingChangeSet,
    finalReport: state.finalReport,
    error: state.error,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    completedAt: state.completedAt
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
