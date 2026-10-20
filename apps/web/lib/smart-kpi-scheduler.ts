import {
  buildKpiSuggestionContext, fingerprintKpiProject, kpiCanonicalJson,
  resolveKpiSuggestionSelection, validateKpiSuggestionForContext,
  type KpiSuggestionContext, type KpiSuggestionExecutionIdentity, type KpiSuggestionPeriod,
  type KpiSuggestionSelection, type KpiSuggestionSet, type KpiSuggestionState, type VdtProject
} from "@vdt-studio/vdt-core";
import { SmartKpiCache, smartKpiExecutionKey, validSmartKpiLimitations, type SmartKpiCacheScope, type SmartKpiNegativeStatus } from "./smart-kpi-cache";

export const SMART_KPI_SCHEDULER_LIMITS = { queue: 12, visible: 6, children: 6, speculativeAttempts: 8 } as const;
export type SmartKpiPriority = "hover" | "selected" | "new_child" | "visible";
const priority: Record<SmartKpiPriority, number> = { hover: 0, selected: 1, new_child: 2, visible: 3 };
export type SmartKpiPreparationResult = KpiSuggestionSet | undefined |
  { status: "ready"; proposal: unknown } | { status: "empty" | "unavailable"; reason: string; limitations?: string[] };
export interface SmartKpiWorkspace {
  workspaceId: string; project: VdtProject; vdtId: string | null; period: KpiSuggestionPeriod;
  execution?: KpiSuggestionExecutionIdentity; goal?: string;
  /** Optional host token changes ONLY on semantic edits. No revisions/admissions. */
  semanticGeneration?: string;
}
export interface SmartKpiNodeSnapshot {
  targetNodeId: string; key?: string;
  state: KpiSuggestionState | { status: "blocked"; reason: string };
  /** Retained solely to show a frozen stale list. Add must obey canApply. */
  proposal?: KpiSuggestionSet; selection?: KpiSuggestionSelection;
  stale: boolean; refreshAvailable: boolean; canApply: boolean;
}
export interface SmartKpiSchedulerOptions {
  prepare: (input: { context: KpiSuggestionContext; execution: KpiSuggestionExecutionIdentity; signal: AbortSignal }) => Promise<SmartKpiPreparationResult>;
  cache?: SmartKpiCache;
  library?: (context: KpiSuggestionContext) => KpiSuggestionSet | undefined;
  now?: () => number;
  visibility?: { isHidden(): boolean; subscribe(listener: () => void): () => void };
  fingerprint?: typeof fingerprintKpiProject;
  buildContext?: typeof buildKpiSuggestionContext;
}
export interface SmartKpiSchedulerCounters {
  started: number; completed: number; cacheHits: number; deduplicated: number; cancelled: number;
  stale: number; empty: number; failed: number; timedOut: number; queueDropped: number; quarantined: number;
}
type Job = { key: string; scope: SmartKpiCacheScope; targetNodeId: string; generation: string;
  priority: SmartKpiPriority; explicit: boolean; order: number; controller: AbortController };
type Lane = { running?: { owner: symbol; execution: string }; quarantines: Map<string, string>; listeners: Set<() => void> };
// This host-session registry outlives individual canvases. Disposing a component
// is not evidence that its owned CLI/remote process has terminated.
const lanes = new Map<string, Lane>();
const laneFor = (workspaceId: string) => {
  let lane = lanes.get(workspaceId);
  if (!lane) { lane = { quarantines: new Map(), listeners: new Set() }; lanes.set(workspaceId, lane); }
  return lane;
};
const notifyLane = (lane: Lane) => { for (const listener of [...lane.listeners]) { try { listener(); } catch { /* Subscribers cannot release execution ownership. */ } } };
export function confirmSmartKpiTerminalCleanup(input: {
  workspaceId: string; execution: KpiSuggestionExecutionIdentity; terminalCleanupConfirmedByHost: true;
}): void {
  if (input.terminalCleanupConfirmedByHost !== true) return;
  const lane = lanes.get(input.workspaceId);
  if (lane?.quarantines.delete(smartKpiExecutionKey(input.execution))) {
    notifyLane(lane);
    if (!lane.running && !lane.listeners.size && !lane.quarantines.size) lanes.delete(input.workspaceId);
  }
}
const immutable = <T>(value: T): T => {
  const copy = JSON.parse(JSON.stringify(value)) as T;
  const freeze = (v: unknown): void => { if (v && typeof v === "object") { for (const child of Object.values(v)) freeze(child); Object.freeze(v); } };
  freeze(copy); return copy;
};
const errorCode = (error: unknown) => error && typeof error === "object" && "code" in error ? String(error.code) : "";

/** One workspace controller, never one controller/effect per mounted KPI card. */
export class SmartKpiScheduler {
  readonly cache: SmartKpiCache;
  private readonly options: SmartKpiSchedulerOptions;
  private readonly owner = Symbol("smart-kpi-scheduler");
  private workspace: SmartKpiWorkspace | undefined;
  private generation = "";
  private contexts = new Map<string, Promise<KpiSuggestionContext>>();
  private fingerprints = new Map<string, Promise<string>>();
  private graphFingerprint = "";
  private snapshots = new Map<string, SmartKpiNodeSnapshot>();
  private frozen = new Map<string, SmartKpiNodeSnapshot>();
  private listeners = new Set<() => void>();
  private queue = new Map<string, Job>();
  private attempted = new Set<string>();
  private spent = 0;
  private order = 0;
  private updateTicket = 0;
  private pendingUpdate: Promise<void> = Promise.resolve();
  private active: { job: Job; done: Promise<void> } | undefined;
  private disposed = false;
  private stopped = false;
  private fullAgentActive = false;
  private pumpQueued = false;
  private unsubscribeVisibility: (() => void) | undefined;
  private attachedLane: { workspaceId: string; lane: Lane } | undefined;
  private counters: SmartKpiSchedulerCounters = { started: 0, completed: 0, cacheHits: 0, deduplicated: 0,
    cancelled: 0, stale: 0, empty: 0, failed: 0, timedOut: 0, queueDropped: 0, quarantined: 0 };

  constructor(options: SmartKpiSchedulerOptions) {
    this.options = options; this.cache = options.cache ?? new SmartKpiCache({ ...(options.now ? { now: options.now } : {}) });
    if (options.visibility) this.unsubscribeVisibility = options.visibility.subscribe(() => this.schedule());
    else if (typeof document !== "undefined") {
      const listener = () => this.schedule(); document.addEventListener("visibilitychange", listener);
      this.unsubscribeVisibility = () => document.removeEventListener("visibilitychange", listener);
    }
  }
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private emit(): void { for (const listener of [...this.listeners]) { try { listener(); } catch { /* Rendering is not transport ownership. */ } } }
  private laneListener = () => { if (!this.disposed) { this.emit(); this.schedule(); } };
  private attachLane(workspaceId: string): void {
    if (this.attachedLane?.workspaceId === workspaceId) return;
    this.detachLane();
    const lane = laneFor(workspaceId); lane.listeners.add(this.laneListener); this.attachedLane = { workspaceId, lane };
  }
  private detachLane(): void {
    if (!this.attachedLane) return;
    const { workspaceId, lane } = this.attachedLane; lane.listeners.delete(this.laneListener);
    if (!lane.running && !lane.quarantines.size && !lane.listeners.size) lanes.delete(workspaceId);
    this.attachedLane = undefined;
  }

  setWorkspace(input: SmartKpiWorkspace): Promise<void> {
    const ticket = ++this.updateTicket;
    const update = async () => {
      if (this.disposed) return;
      // Hosts can supply a semantic generation to share hashing with their store.
      // Without it we hash once per supplied project snapshot, never per hover.
      const memoKey = input.semanticGeneration === undefined ? undefined : kpiCanonicalJson({ workspace: input.workspaceId, project: input.project.id, generation: input.semanticGeneration });
      let fingerprint = memoKey ? this.fingerprints.get(memoKey) : undefined;
      if (!fingerprint) {
        fingerprint = (this.options.fingerprint ?? fingerprintKpiProject)(input.project);
        if (memoKey) { this.fingerprints.set(memoKey, fingerprint); while (this.fingerprints.size > 2) this.fingerprints.delete(this.fingerprints.keys().next().value!); }
      }
      const [graphFingerprint] = await Promise.all([fingerprint, this.cache.hydrate()]);
      if (this.disposed || ticket !== this.updateTicket) return;
      if (input.execution) smartKpiExecutionKey(input.execution);
      const generation = kpiCanonicalJson({ workspace: input.workspaceId, project: input.project.id, vdt: input.vdtId,
        graphFingerprint, period: input.period, goal: input.goal ?? null, execution: input.execution ? smartKpiExecutionKey(input.execution) : null });
      this.workspace = input; this.graphFingerprint = graphFingerprint; this.attachLane(input.workspaceId);
      if (generation !== this.generation) {
        this.generation = generation; this.contexts.clear(); this.queue.clear(); this.attempted.clear(); this.spent = 0;
        this.cancelActive();
        for (const [id, snapshot] of this.snapshots) this.snapshots.set(id, this.staleSnapshot(snapshot));
        for (const [id, snapshot] of this.frozen) this.frozen.set(id, this.staleSnapshot(snapshot));
        this.emit();
      }
      this.schedule();
    };
    this.pendingUpdate = update();
    return this.pendingUpdate;
  }

  private staleSnapshot(snapshot: SmartKpiNodeSnapshot): SmartKpiNodeSnapshot {
    return immutable({ ...snapshot, state: { status: "stale", reason: "KPI context or execution changed. Refresh the suggestions." }, stale: true, refreshAvailable: true, canApply: false });
  }
  private context(targetNodeId: string): Promise<KpiSuggestionContext> {
    let context = this.contexts.get(targetNodeId);
    if (!context) {
      const w = this.workspace!;
      context = (this.options.buildContext ?? buildKpiSuggestionContext)(w.project, {
        workspaceId: w.workspaceId, vdtId: w.vdtId, targetNodeId, period: w.period,
        graphFingerprint: this.graphFingerprint, ...(w.goal === undefined ? {} : { goal: w.goal })
      });
      this.contexts.set(targetNodeId, context);
    }
    return context;
  }
  getSnapshot = (targetNodeId: string): SmartKpiNodeSnapshot => {
    const existing = this.frozen.get(targetNodeId) ?? this.snapshots.get(targetNodeId);
    if (existing) {
      if (existing.canApply && existing.proposal && Date.parse(existing.proposal.expiresAt) <= (this.options.now ?? Date.now)()) {
        const stale = this.staleSnapshot(existing);
        if (this.frozen.has(targetNodeId)) this.frozen.set(targetNodeId, stale); else this.snapshots.set(targetNodeId, stale);
        return stale;
      }
      return existing;
    }
    const idle = immutable<SmartKpiNodeSnapshot>({ targetNodeId, state: { status: "idle" }, stale: false, refreshAvailable: false, canApply: false });
    this.snapshots.set(targetNodeId, idle); return idle;
  };
  private publish(target: string, key: string, state: SmartKpiNodeSnapshot["state"]): void {
    const next = immutable<SmartKpiNodeSnapshot>({ targetNodeId: target, key, state,
      ...(state.status === "ready" ? { proposal: state.proposal } : {}), stale: state.status === "stale", refreshAvailable: false, canApply: state.status === "ready" });
    this.snapshots.set(target, next);
    const frozen = this.frozen.get(target);
    if (frozen) {
      if (!frozen.proposal && !frozen.stale) this.frozen.set(target, next);
      else if (frozen.key !== next.key || frozen.proposal?.proposalId !== next.proposal?.proposalId)
        this.frozen.set(target, immutable({ ...frozen, refreshAvailable: true }));
    }
    this.emit();
  }
  freezeDisplay(target: string): SmartKpiNodeSnapshot {
    if (!this.frozen.has(target)) this.frozen.set(target, this.getSnapshot(target));
    return this.getSnapshot(target);
  }
  releaseDisplay(target: string): void { if (this.frozen.delete(target)) this.emit(); }
  refreshDisplay(target: string): SmartKpiNodeSnapshot {
    this.frozen.delete(target); const snapshot = this.getSnapshot(target); this.frozen.set(target, snapshot); this.emit(); return snapshot;
  }
  setSelection(target: string, selection: KpiSuggestionSelection): boolean {
    const snapshot = this.freezeDisplay(target);
    if (!snapshot.proposal || !snapshot.canApply || snapshot.stale) return false;
    try { resolveKpiSuggestionSelection(snapshot.proposal, selection); }
    catch { return false; }
    this.frozen.set(target, immutable({ ...snapshot, selection })); this.emit(); return true;
  }

  async request(target: string, options: { priority?: SmartKpiPriority; explicit?: boolean } = {}): Promise<SmartKpiNodeSnapshot> {
    await this.pendingUpdate;
    if (this.disposed || !this.workspace) return this.getSnapshot(target);
    const generation = this.generation;
    let context: KpiSuggestionContext;
    try { context = await this.context(target); }
    catch {
      if (!this.disposed && generation === this.generation) this.publish(target, "", { status: "stale", reason: "The target KPI no longer exists or its context is invalid." });
      return this.getSnapshot(target);
    }
    if (this.disposed || generation !== this.generation) return this.getSnapshot(target);
    const scope: SmartKpiCacheScope = { context, ...(this.workspace.execution ? { execution: this.workspace.execution } : {}) }, key = this.cache.key(scope);
    if (!options.explicit) {
      let local: KpiSuggestionSet | undefined;
      try { local = this.options.library?.(context); } catch { /* Invalid local applicability is a miss. */ }
      const localStored = local ? await this.cache.put({ context }, local) : false;
      if (this.disposed || generation !== this.generation) return this.getSnapshot(target);
      if (local && localStored) {
        this.publish(target, key, { status: "ready", proposal: local, source: "library" }); return this.getSnapshot(target);
      }
      const cached = this.cache.peek({ context }) ?? this.cache.peek(scope);
      if (cached) { this.counters.cacheHits++; this.publish(target, key, { status: "ready", proposal: cached, source: "cache" }); return this.getSnapshot(target); }
      const negative = this.cache.negative(scope);
      if (negative) { this.publish(target, key, { status: negative.status, reason: negative.reason, ...(negative.limitations ? { limitations: negative.limitations } : {}) }); return this.getSnapshot(target); }
    } else this.cache.clearNegative(scope);
    if (this.active?.job.key === key || this.queue.has(key)) {
      this.counters.deduplicated++;
      const queued = this.queue.get(key);
      if (queued) { if (priority[options.priority ?? "hover"] < priority[queued.priority]) queued.priority = options.priority ?? "hover"; queued.explicit ||= !!options.explicit; }
      return this.getSnapshot(target);
    }
    if (!scope.execution) { this.publish(target, key, { status: "unavailable", reason: "Choose an available execution backend to prepare this KPI." }); return this.getSnapshot(target); }
    const quarantine = laneFor(context.workspaceId).quarantines.get(smartKpiExecutionKey(scope.execution));
    if (quarantine) { this.publish(target, key, { status: "blocked", reason: quarantine }); return this.getSnapshot(target); }
    if (!options.explicit && this.attempted.has(key)) {
      this.publish(target, key, { status: "unavailable", reason: "This KPI was already attempted. Choose Prepare or Retry for a new bounded attempt." }); return this.getSnapshot(target);
    }
    const job: Job = { key, scope, targetNodeId: target, generation, priority: options.priority ?? "hover", explicit: !!options.explicit, order: this.order++, controller: new AbortController() };
    if (this.queue.size >= SMART_KPI_SCHEDULER_LIMITS.queue) {
      const worst = [...this.queue.values()].sort((a, b) => priority[b.priority] - priority[a.priority] || b.order - a.order)[0]!;
      this.counters.queueDropped++;
      if (priority[job.priority] >= priority[worst.priority] && !job.explicit) {
        this.publish(target, key, { status: "unavailable", reason: "Preparation queue is full. Choose Prepare to try this KPI." }); return this.getSnapshot(target);
      }
      this.queue.delete(worst.key);
      this.publish(worst.targetNodeId, worst.key, { status: "unavailable", reason: "Preparation queue is full. Choose Prepare to try this KPI." });
    }
    this.queue.set(key, job); this.publish(target, key, { status: "preparing" }); this.schedule(); return this.getSnapshot(target);
  }

  async prewarm(selected: string | null, visible: readonly string[]): Promise<void> {
    await this.pendingUpdate;
    const ids = [...new Set(visible)].filter(id => id !== selected).slice(0, SMART_KPI_SCHEDULER_LIMITS.visible);
    await Promise.all([...(selected ? [this.request(selected, { priority: "selected" })] : []), ...ids.map(id => this.request(id, { priority: "visible" }))]);
  }
  async prepareImmediateChildren(parentNodeId: string): Promise<void> {
    await this.pendingUpdate;
    const ids = [...new Set(this.workspace?.project.graph.edges.filter(e => e.sourceNodeId === parentNodeId).map(e => e.targetNodeId))].slice(0, SMART_KPI_SCHEDULER_LIMITS.children);
    await Promise.all(ids.map(id => this.request(id, { priority: "new_child" })));
  }
  retry(target: string): Promise<SmartKpiNodeSnapshot> { return this.request(target, { priority: "hover", explicit: true }); }
  setFullAgentActive(active: boolean): void { this.fullAgentActive = active; this.schedule(); }
  private hidden(): boolean { return this.options.visibility?.isHidden() ?? (typeof document !== "undefined" && document.hidden); }
  private eligible(job: Job): boolean { return (!this.fullAgentActive || job.explicit) && (!this.hidden() || job.explicit); }
  private schedule(): void {
    if (this.pumpQueued || this.disposed) return;
    this.pumpQueued = true; queueMicrotask(() => { this.pumpQueued = false; this.pump(); });
  }
  private pump(): void {
    if (this.disposed || this.stopped || this.active || !this.workspace) return;
    const lane = laneFor(this.workspace.workspaceId);
    if (lane.running) return;
    const jobs = [...this.queue.values()].sort((a, b) => priority[a.priority] - priority[b.priority] || a.order - b.order);
    const job = jobs.find(j => this.eligible(j));
    if (!job) return;
    const execution = smartKpiExecutionKey(job.scope.execution!), quarantine = lane.quarantines.get(execution);
    if (quarantine) {
      for (const pending of jobs) { this.queue.delete(pending.key); this.publish(pending.targetNodeId, pending.key, { status: "blocked", reason: quarantine }); }
      return;
    }
    this.queue.delete(job.key);
    if (!job.explicit && this.spent >= SMART_KPI_SCHEDULER_LIMITS.speculativeAttempts) {
      this.publish(job.targetNodeId, job.key, { status: "unavailable", reason: "Background preparation budget is used. Choose Prepare for this KPI." }); this.schedule(); return;
    }
    if (!job.explicit) this.spent++;
    this.attempted.add(job.key); this.counters.started++;
    lane.running = { owner: this.owner, execution };
    const done = this.run(job, lane, execution);
    this.active = { job, done };
    // Always release after the callback's terminal acknowledgement, never an
    // AbortSignal race. Unknown cleanup quarantines instead of granting a lane.
    void done.finally(() => {
      if (lane.running?.owner === this.owner) delete lane.running;
      if (this.active?.job === job) this.active = undefined;
      notifyLane(lane); this.schedule();
      if (!lane.running && !lane.listeners.size && !lane.quarantines.size) lanes.delete(job.scope.context.workspaceId);
    });
  }
  private current(job: Job): boolean { return !this.disposed && this.generation === job.generation && !job.controller.signal.aborted; }
  private async run(job: Job, lane: Lane, executionKey: string): Promise<void> {
    try {
      const result = await this.options.prepare({ context: job.scope.context, execution: job.scope.execution!, signal: job.controller.signal });
      await this.pendingUpdate;
      if (!this.current(job)) { this.counters.stale++; return; }
      if (result === undefined || "status" in result && result.status !== "ready") {
        if (result && (!(["empty", "unavailable"] as string[]).includes(result.status) ||
          Object.keys(result).some(key => !["status", "reason", "limitations"].includes(key)) || typeof result.reason !== "string" || !result.reason.trim() || result.reason.length > 300 ||
          !validSmartKpiLimitations(result.limitations)))
          throw new Error("Invalid terminal preparation result.");
        const status = result?.status ?? "empty", reason = result?.reason ?? "No suitable immediate children were suggested.";
        const limitations = result?.limitations;
        this.counters.empty++; this.cache.setNegative(job.scope, status, reason, limitations);
        this.publish(job.targetNodeId, job.key, { status, reason, ...(limitations ? { limitations } : {}) }); return;
      }
      if ("status" in result && Object.keys(result).some(key => !["status", "proposal"].includes(key))) throw new Error("Invalid preparation envelope.");
      const raw = "status" in result ? result.proposal : result;
      const proposal = validateKpiSuggestionForContext(raw, job.scope.context, this.cache.catalog, (this.options.now ?? Date.now)());
      if (proposal.origin.kind !== "model" || smartKpiExecutionKey(proposal.origin.execution) !== executionKey) throw new Error("Prepared result has no matching host execution provenance.");
      if (!await this.cache.put(job.scope, proposal)) throw new Error("Prepared result failed local cache validation.");
      if (!this.current(job)) { this.counters.stale++; return; }
      this.counters.completed++; this.publish(job.targetNodeId, job.key, { status: "ready", proposal, source: "prepared" });
    } catch (error) {
      if (errorCode(error) === "CLEANUP_UNCONFIRMED") {
        const reason = "The host could not confirm previous process cleanup. Confirm terminal cleanup on the host or explicitly replace this execution backend.";
        lane.quarantines.set(executionKey, reason); this.counters.quarantined++;
        if (!this.disposed && this.generation === job.generation) this.publish(job.targetNodeId, job.key, { status: "blocked", reason });
        return;
      }
      await this.pendingUpdate;
      if (!this.current(job)) { this.counters.stale++; return; }
      const code = errorCode(error);
      const status: SmartKpiNegativeStatus = code === "TIMEOUT" ? "timeout" : code === "SUGGESTIONS_UNAVAILABLE" ? "unavailable" : "failed";
      const reason = status === "timeout" ? "Preparation timed out. Choose Retry for a new bounded attempt." : status === "unavailable" ? "This execution backend cannot currently prepare suggestions." : "Preparation failed validation or execution. Choose Retry for a new bounded attempt.";
      if (status === "timeout") this.counters.timedOut++; else this.counters.failed++;
      this.cache.setNegative(job.scope, status, reason); this.publish(job.targetNodeId, job.key, { status, reason });
    }
  }
  private cancelActive(): void {
    if (this.active && !this.active.job.controller.signal.aborted) { this.counters.cancelled++; this.active.job.controller.abort(); }
  }
  stop(): void {
    this.stopped = true;
    for (const job of this.queue.values()) this.publish(job.targetNodeId, job.key, { status: "unavailable", reason: "Preparation was stopped. Choose Prepare to try again." });
    this.queue.clear();
    if (this.active) this.publish(this.active.job.targetNodeId, this.active.job.key, { status: "stale", reason: "Preparation was stopped. Choose Prepare to try again." });
    this.cancelActive();
  }
  resume(): void { if (!this.disposed) { this.stopped = false; this.schedule(); } }
  dispose(): void {
    this.disposed = true; ++this.updateTicket; this.queue.clear(); this.cancelActive(); this.unsubscribeVisibility?.(); this.detachLane();
    for (const [id, snapshot] of this.snapshots) this.snapshots.set(id, this.staleSnapshot(snapshot));
    for (const [id, snapshot] of this.frozen) this.frozen.set(id, this.staleSnapshot(snapshot));
    this.listeners.clear();
  }
  async whenSettled(): Promise<void> {
    await this.pendingUpdate;
    for (;;) {
      await Promise.resolve();
      if (this.active) { await this.active.done; continue; }
      if (this.pumpQueued) continue;
      if (!this.disposed && !this.stopped && this.queue.size && !this.attachedLane?.lane.running &&
        !this.diagnostics().blocked && [...this.queue.values()].some(job => this.eligible(job))) { this.schedule(); continue; }
      break;
    }
    await this.cache.flush();
  }
  diagnostics(): SmartKpiSchedulerCounters & { queued: number; speculativeAttempts: number; inFlight: boolean; blocked: boolean } {
    const blocked = !!(this.workspace?.execution && this.attachedLane?.lane.quarantines.has(smartKpiExecutionKey(this.workspace.execution)));
    return { ...this.counters, queued: this.queue.size, speculativeAttempts: this.spent, inFlight: !!this.active, blocked };
  }
}
