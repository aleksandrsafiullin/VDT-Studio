"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  buildKpiSuggestionContext, fingerprintKpiProject, kpiCanonicalJson,
  type IncomingKpiBatchInput, type IncomingKpiBatchPreview, type KpiSuggestionContext, type VdtProject
} from "@vdt-studio/vdt-core";
import { SmartKpiScheduler, type SmartKpiNodeSnapshot } from "@/lib/smart-kpi-scheduler";
import { createSmartKpiPreparedSelection, type SmartKpiPreparedSelection } from "@/lib/smart-kpi-client";
import { getSmartKpiLibraryProposal, recordSmartKpiDecision } from "@/lib/smart-kpi-decisions";
import { resolveSmartKpiScope } from "@/lib/smart-kpi-scope";
import { useApiKeyStorage } from "./api-key-storage";
import { resolveExecutionSettings } from "@/lib/execution-mode-resolver";
import { useVdtStudioStore } from "./vdt-store";

export interface SmartKpiActivation { targetNodeId: string; rail: HTMLElement; trigger: HTMLButtonElement; mode: "smart" | "manual" }
type Admission = { status: "preparing" | "ready" | "unavailable" | "blocked"; selection?: SmartKpiPreparedSelection; reason?: string };
const initialSnapshot: SmartKpiNodeSnapshot = { targetNodeId: "", state: { status: "idle" }, stale: false, refreshAvailable: false, canApply: false };
const runtimeActive = (status?: string) => ["queued", "running", "needs_user_input", "waiting_approval", "recovery_required"].includes(status ?? "");
export function smartKpiAgentIsActive(state: { isGenerating: boolean; agentRun?: { runId: string; status: string } | undefined;
  generateActivity?: { runId: string; status: string } | undefined; smartKpiFencedRunIds: readonly string[];
  agentConnectionStatus: string; agentPendingQuestions?: readonly unknown[] | undefined }): boolean {
  const detached = state.smartKpiFencedRunIds.includes(state.agentRun?.runId ?? state.generateActivity?.runId ?? "");
  return state.isGenerating || !detached && (state.agentConnectionStatus === "connecting" || Boolean(state.agentPendingQuestions?.length)
    || runtimeActive(state.agentRun?.status) || ["running", "needs_user_input", "recovery_required"].includes(state.generateActivity?.status ?? ""));
}

/** Exactly one scheduler for the active canvas owner; no provider work in cards. */
export function useSmartKpi() {
  const project = useVdtStudioStore(state => state.project);
  const workspace = useVdtStudioStore(state => state.workspace);
  const selectedNodeId = useVdtStudioStore(state => state.selectedNodeId);
  const executionSettings = useVdtStudioStore(state => state.executionSettings);
  const runnerPairingToken = useVdtStudioStore(state => state.runnerPairingToken);
  const goal = useVdtStudioStore(state => state.brief.goal);
  const apiKeyStorageStatus = useApiKeyStorage(state => state.status);
  const fullAgentActive = useVdtStudioStore(smartKpiAgentIsActive);
  const mutation = useVdtStudioStore(state => state.smartKpiMutation);
  const mutationBusy = ["applying", "undoing", "reconciling"].includes(mutation.status);
  const mutationBusyRef = useRef(mutationBusy); mutationBusyRef.current = mutationBusy;
  const mutationBlockedReason = useVdtStudioStore(state => state.smartKpiBlockedReason);
  const scope = useMemo(() => resolveSmartKpiScope({ project, workspace }), [project, workspace, goal]);
  const scopeKey = kpiCanonicalJson(scope);
  const ownerKey = kpiCanonicalJson([scope.workspaceId, scope.vdtId, project.id]);
  const [admission, setAdmission] = useState<Admission>({ status: "preparing" });
  const admissionRef = useRef(admission); admissionRef.current = admission;
  const [active, setActive] = useState<SmartKpiActivation | null>(null);
  const activeRef = useRef(active); activeRef.current = active;
  const [feedback, setFeedback] = useState<string>();
  const [currentContext, setCurrentContext] = useState<KpiSuggestionContext>();
  const [contextPending, setContextPending] = useState(false);
  const [contextError, setContextError] = useState<string>();
  const [contextRevision, refreshContext] = useReducer(value => value + 1, 0);
  const [replaying, setReplaying] = useState(false);
  const replayingRef = useRef(false);
  const [metadataRetry, retryMetadata] = useReducer(value => value + 1, 0);
  const [, update] = useReducer(value => value + 1, 0);
  const scheduler = useRef<SmartKpiScheduler | undefined>(undefined);
  const contexts = useRef(new Map<string, KpiSuggestionContext>());
  const fingerprints = useRef(new WeakMap<VdtProject, Promise<string>>());
  const visible = useRef<string[]>([]);
  const closed = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const railInside = useRef(false), panelInside = useRef(false);
  const dismissedHover = useRef<{ targetNodeId: string; rect: DOMRect } | undefined>(undefined);
  const restoringFocus = useRef(false), focusFrame = useRef<number | undefined>(undefined);
  const previousProject = useRef<VdtProject | undefined>(undefined);

  const cancelClose = useCallback(() => { if (closed.current) clearTimeout(closed.current); closed.current = undefined; }, []);
  const close = useCallback((restoreFocus = false) => {
    cancelClose();
    const current = activeRef.current;
    if (!current) return;
    if (focusFrame.current !== undefined) cancelAnimationFrame(focusFrame.current);
    if (restoreFocus) dismissedHover.current = { targetNodeId: current.targetNodeId, rect: current.rail.getBoundingClientRect() };
    if (current) scheduler.current?.releaseDisplay(current.targetNodeId);
    railInside.current = false; panelInside.current = false; activeRef.current = null; setActive(null);
    if (restoreFocus) {
      let attempts = 0;
      const restore = () => {
        const trigger = document.querySelector<HTMLButtonElement>(`.react-flow__node[data-id="${CSS.escape(current.targetNodeId)}"] [data-smart-trigger]`);
        if (trigger?.isConnected && !trigger.disabled && getComputedStyle(trigger).visibility !== "hidden") {
          restoringFocus.current = true; trigger.focus({ preventScroll: true });
          if (document.activeElement === trigger) { queueMicrotask(() => { restoringFocus.current = false; }); focusFrame.current = undefined; return; }
          restoringFocus.current = false;
        }
        // Controlled ReactFlow nodes can briefly await their measurements.
        if (++attempts < 30 && !activeRef.current) focusFrame.current = requestAnimationFrame(restore);
        else focusFrame.current = undefined;
      };
      focusFrame.current = requestAnimationFrame(restore);
    }
  }, [cancelClose]);
  useEffect(() => {
    const moved = (event: PointerEvent) => {
      const dismissed = dismissedHover.current;
      if (dismissed && (event.clientX < dismissed.rect.left || event.clientX > dismissed.rect.right || event.clientY < dismissed.rect.top || event.clientY > dismissed.rect.bottom)) dismissedHover.current = undefined;
    };
    document.addEventListener("pointermove", moved, true);
    return () => document.removeEventListener("pointermove", moved, true);
  }, []);
  const scheduleClose = useCallback(() => {
    cancelClose();
    if (mutationBusyRef.current) return;
    closed.current = setTimeout(() => {
      closed.current = undefined;
      if (mutationBusyRef.current) return;
      const current = activeRef.current, focused = document.activeElement;
      const inRail = !!(current && focused && current.rail.contains(focused));
      const inPanel = focused instanceof Element && !!focused.closest('[data-testid="smart-kpi-panel"]');
      if (!railInside.current && !panelInside.current && !inRail && !inPanel) close();
    }, 200);
  }, [cancelClose, close]);
  useEffect(() => { if (mutationBusy) cancelClose(); }, [mutationBusy, cancelClose]);

  // Settings metadata admission is separate from model preparation and hover.
  const credentialStatus = resolveExecutionSettings(executionSettings).providerId === "local_runner" ? "local" : apiKeyStorageStatus;
  useEffect(() => {
    let current = true;
    setAdmission({ status: "preparing" });
    if (credentialStatus === "saving" || credentialStatus === "loading") return () => { current = false; };
    const timer = setTimeout(() => { void createSmartKpiPreparedSelection(executionSettings, { ...(runnerPairingToken ? { pairingToken: runnerPairingToken } : {}) })
      .then(selection => { if (current) setAdmission({ status: "ready", selection }); })
      .catch(error => { if (current) setAdmission({ status: error?.code === "CLEANUP_UNCONFIRMED" ? "blocked" : "unavailable",
        reason: error?.code === "CLEANUP_UNCONFIRMED" ? "The host must confirm previous process cleanup before preparing more suggestions." : "Choose a supported execution backend and model in Execution mode to prepare this KPI." }); }); }, 150);
    return () => { current = false; clearTimeout(timer); };
  }, [executionSettings, runnerPairingToken, metadataRetry, credentialStatus]);

  useEffect(() => {
    const instance = new SmartKpiScheduler({
      library: getSmartKpiLibraryProposal,
      prepare: async input => {
        const selected = admissionRef.current.selection;
        if (!selected) throw Object.assign(new Error("Selected execution is not admitted."), { code: "SUGGESTIONS_UNAVAILABLE" });
        const proposal = await selected.prepare(input);
        if (proposal && !("status" in proposal)) { try { recordSmartKpiDecision(input.context, proposal); } catch { /* Rebuildable Library metadata cannot invalidate a valid preparation. */ } }
        return proposal;
      },
      fingerprint: currentProject => {
        let fingerprint = fingerprints.current.get(currentProject);
        if (!fingerprint) { fingerprint = fingerprintKpiProject(currentProject); fingerprints.current.set(currentProject, fingerprint); }
        return fingerprint;
      },
      buildContext: async (currentProject, options) => {
        const context = await buildKpiSuggestionContext(currentProject, options);
        contexts.current.set(context.contextHash, context);
        while (contexts.current.size > 64) contexts.current.delete(contexts.current.keys().next().value!);
        return context;
      }
    });
    scheduler.current = instance;
    const unsubscribe = instance.subscribe(update);
    update();
    return () => {
      unsubscribe(); instance.dispose(); if (scheduler.current === instance) scheduler.current = undefined;
      if (focusFrame.current !== undefined) cancelAnimationFrame(focusFrame.current);
      cancelClose(); previousProject.current = undefined; contexts.current.clear();
    };
  }, [scope.workspaceId, cancelClose]);

  const executionKey = admission.selection ? kpiCanonicalJson(admission.selection.execution) : "";
  useEffect(() => { close(); }, [scope.workspaceId, scope.vdtId, project.id, close]);
  useEffect(() => {
    if (!active) { setCurrentContext(undefined); return; }
    let current = true;
    setContextPending(true); setContextError(undefined);
    // The local context port does not admit a provider or prepare suggestions.
    void useVdtStudioStore.getState().buildIncomingKpiContext(active.targetNodeId)
      .then((context: KpiSuggestionContext) => { if (current) setCurrentContext(context); })
      .catch((error: unknown) => { if (current) { setCurrentContext(undefined); setContextError(error instanceof Error ? error.message : "Refresh the KPI context."); } })
      .finally(() => { if (current) setContextPending(false); });
    return () => { current = false; };
  }, [active?.targetNodeId, ownerKey, project, contextRevision]);
  useEffect(() => {
    const instance = scheduler.current;
    if (!instance) return;
    let current = true;
    const before = previousProject.current; previousProject.current = project;
    const existing = new Set(before?.graph.nodes.map(node => node.id));
    const newIds = new Set(project.graph.nodes.filter(node => !existing.has(node.id)).map(node => node.id));
    const owningParents = [...new Set(project.graph.edges.filter(edge => newIds.has(edge.targetNodeId) && !newIds.has(edge.sourceNodeId)).map(edge => edge.sourceNodeId))];
    const newParent = before && newIds.size ? before.id !== project.id ? project.rootNodeId : owningParents.length === 1 ? owningParents[0] : project.rootNodeId : undefined;
    void instance.setWorkspace({ project, workspaceId: scope.workspaceId, vdtId: scope.vdtId, period: scope.period,
      ...(scope.goal ? { goal: scope.goal } : {}), ...(admission.selection ? { execution: admission.selection.execution } : {}) })
      .then(async () => {
        if (!current || scope.blockedReason) return;
        await instance.prewarm(useVdtStudioStore.getState().selectedNodeId || null, visible.current);
        if (newParent) await instance.prepareImmediateChildren(newParent);
        const currentActive = activeRef.current;
        if (currentActive && currentActive.mode !== "manual") {
          // No checked list exists yet. A metadata/cold-context transition may
          // replace an empty status; only a displayed proposal stays frozen.
          if (!instance.getSnapshot(currentActive.targetNodeId).proposal) instance.releaseDisplay(currentActive.targetNodeId);
          await instance.request(currentActive.targetNodeId, { priority: "hover" });
          if (activeRef.current === currentActive) instance.freezeDisplay(currentActive.targetNodeId);
        }
        update();
      }).catch(() => { if (current) setFeedback("The KPI context could not be prepared. Refresh the workspace and try again."); });
    return () => { current = false; };
  }, [project, scopeKey, executionKey, scope.workspaceId]); // Semantic work is shared here, never on mouse movement.

  useEffect(() => { scheduler.current?.setFullAgentActive(fullAgentActive); }, [fullAgentActive, scope.workspaceId]);
  useEffect(() => {
    if (!scope.blockedReason) void scheduler.current?.prewarm(selectedNodeId || null, visible.current);
  }, [selectedNodeId, scope.blockedReason]);
  useEffect(() => {
    if (!active) return;
    const outside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || active.rail.contains(target) || target instanceof Element && target.closest('[data-testid="smart-kpi-panel"], [data-smart-kpi-bridge]')) return;
      close();
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); close(true); } };
    document.addEventListener("pointerdown", outside, true); document.addEventListener("keydown", escape, true);
    return () => { document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", escape, true); };
  }, [active, close]);

  const activate = useCallback((targetNodeId: string, rail: HTMLElement, trigger: HTMLButtonElement, source: "pointer" | "focus" | "touch" | "manual" = "pointer") => {
    if (source === "focus" && restoringFocus.current || source === "pointer" && dismissedHover.current?.targetNodeId === targetNodeId) return;
    dismissedHover.current = undefined;
    if (focusFrame.current !== undefined) { cancelAnimationFrame(focusFrame.current); focusFrame.current = undefined; }
    cancelClose(); if (source === "pointer") railInside.current = true;
    const old = activeRef.current;
    if (old?.targetNodeId === targetNodeId && old.rail === rail && source !== "manual") return;
    if (old) scheduler.current?.releaseDisplay(old.targetNodeId);
    const next: SmartKpiActivation = { targetNodeId, rail, trigger, mode: source === "manual" ? "manual" : "smart" };
    activeRef.current = next; setActive(next); setFeedback(undefined);
    const instance = scheduler.current;
    if (instance?.getSnapshot(targetNodeId).proposal) instance.freezeDisplay(targetNodeId); else instance?.releaseDisplay(targetNodeId);
    if (source !== "manual" && !resolveSmartKpiScope(useVdtStudioStore.getState()).blockedReason) void instance?.request(targetNodeId, { priority: "hover" }).then(() => {
      if (activeRef.current === next) { instance.freezeDisplay(targetNodeId); update(); }
    });
  }, [cancelClose]);
  const activateManual = useCallback((targetNodeId: string, rail: HTMLElement, trigger: HTMLButtonElement) => activate(targetNodeId, rail, trigger, "manual"), [activate]);
  const leaveRail = useCallback(() => { railInside.current = false; scheduleClose(); }, [scheduleClose]);
  const enterPanel = useCallback(() => { panelInside.current = true; cancelClose(); }, [cancelClose]);
  const leavePanel = useCallback(() => { panelInside.current = false; scheduleClose(); }, [scheduleClose]);
  const prewarmVisible = useCallback((ids: string[]) => {
    visible.current = ids.slice(0, 6);
    const state = useVdtStudioStore.getState();
    if (!resolveSmartKpiScope(state).blockedReason) void scheduler.current?.prewarm(state.selectedNodeId || null, visible.current);
  }, []);
  const refresh = useCallback(() => {
    const current = activeRef.current, instance = scheduler.current;
    if (!current || !instance) return;
    instance.refreshDisplay(current.targetNodeId);
    void instance.request(current.targetNodeId).then(() => { instance.refreshDisplay(current.targetNodeId); update(); });
    setFeedback(undefined);
  }, []);
  const retry = useCallback(() => {
    const current = activeRef.current;
    if (admissionRef.current.status !== "ready") { retryMetadata(); return; }
    if (current) {
      const instance = scheduler.current;
      void instance?.retry(current.targetNodeId).then(() => { instance.refreshDisplay(current.targetNodeId); update(); });
    }
  }, []);
  const preview = useCallback((input: IncomingKpiBatchInput): Promise<IncomingKpiBatchPreview> => useVdtStudioStore.getState().previewIncomingKpiBatch(input), []);
  const apply = useCallback(async (input: IncomingKpiBatchInput) => {
    const current = activeRef.current, state = useVdtStudioStore.getState();
    if (!current || input.draft.targetNodeId !== current.targetNodeId || state.smartKpiBlockedReason || resolveSmartKpiScope(state).blockedReason) return;
    const result = await state.applySmartKpiSuggestion(input);
    setFeedback(result.ok ? result.addedNodeIds.length
      ? `${result.addedNodeIds.length} KPI${result.addedNodeIds.length === 1 ? "" : "s"} added${result.durability === "draft" ? " to this draft" : " and saved"}.`
      : `KPI values updated${result.durability === "draft" ? " in this draft" : " and saved"}.`
      : result.reason ?? "The KPI could not be added. Review the status and try again.");
  }, []);
  const undo = useCallback(async () => { const ok = await useVdtStudioStore.getState().undoSmartKpiSuggestion(); if (ok) setFeedback("Smart addition undone."); }, []);
  const reconcile = useCallback(async () => {
    if (replayingRef.current) return;
    replayingRef.current = true; setReplaying(true); setFeedback(undefined);
    try { await useVdtStudioStore.getState().reconcilePendingSmartKpiCommit(); }
    finally { replayingRef.current = false; setReplaying(false); }
  }, []);
  const snapshot = active ? scheduler.current?.getSnapshot(active.targetNodeId) ?? initialSnapshot : initialSnapshot;
  const latestContext = currentContext && currentContext.targetNodeId === active?.targetNodeId && currentContext.workspaceId === scope.workspaceId
    && currentContext.projectId === project.id && currentContext.vdtId === scope.vdtId ? currentContext : undefined;
  const context = snapshot.proposal ? contexts.current.get(snapshot.proposal.contextHash) : latestContext;
  const blockedReason = scope.blockedReason ?? mutationBlockedReason ?? (fullAgentActive ? "Finish or cancel the active agent run before adding KPIs." : undefined);
  return { active, snapshot, context, latestContext, contextPending, contextError, ownerKey, project, admission, mutation, blockedReason, feedback, replaying, activate, activateManual, leaveRail, enterPanel, leavePanel,
    focusPanel: cancelClose, blurPanel: scheduleClose, close, refresh, refreshContext, retry, preview, apply, undo, reconcile, prewarmVisible };
}
export type SmartKpiController = ReturnType<typeof useSmartKpi>;
