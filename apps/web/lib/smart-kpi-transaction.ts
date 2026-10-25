import { buildKpiSuggestionContext, calculateGraph, cloneProject, compileIncomingKpiBatch, createVersionSnapshot, expandIncomingKpiFormula, inspectIncomingKpiDraft, incomingKpiInputValuePatch, incomingKpiReferenceValuePatch, incomingKpiValuesEqual, kpiCanonicalJson, previewIncomingKpiBatch, resolveIncomingKpiValues, validateKpiSuggestionDecomposition,
  type IncomingKpiBatchInput, type KpiSuggestionContext, type KpiSuggestionExecutionIdentity, type KpiSuggestionSelection, type KpiSuggestionSet, type VdtProject } from "@vdt-studio/vdt-core";
import type { SmartKpiMixedOperation } from "./smart-kpi-incoming-contract";
import { createStoredVdt, fetchStoredVdtRevisionState, revisionCasFromHead, runtimeCasFromState, saveStoredVdtRevision,
  VdtStorageRequestError, type ProjectRuntimeCasV1, type SaveStoredVdtRevisionInput, type StoredProjectSummary, type VdtRevisionCasV1 } from "./vdt-storage-client";
import { persistedExecutionSettings } from "./execution-mode-catalog";
import { createSmartKpiPreparedSelection } from "./smart-kpi-client";
import { recordAcceptedSmartKpiChildren } from "./smart-kpi-decisions";
import { resolveSmartKpiScope } from "./smart-kpi-scope";
import { smartKpiJournalPersisted, studioStatePersistenceProblem } from "./smart-kpi-journal";
import type { VdtStudioState, UiPreferences } from "@/components/vdt/vdt-store";

export interface SmartKpiMutationView {
  status: "idle" | "applying" | "reconciling" | "undoing" | "succeeded" | "conflict" | "failed";
  targetNodeId?: string | undefined; message?: string | undefined; canUndo: boolean; undoBlockedReason?: string | undefined;
}
export type SmartKpiApplyInput = IncomingKpiBatchInput;
export interface SmartKpiApplyResult { ok: boolean; addedNodeIds: string[]; targetNodeId: string; durability: "stored" | "draft"; reason?: string; code?: string }
interface Authority { head: VdtRevisionCasV1; runtime: ProjectRuntimeCasV1 }
export interface SmartKpiOperationV1 {
  schemaVersion: "smart_kpi_operation.v1";
  id: string; kind: "add" | "undo"; phase: "preparing" | "committing";
  workspaceId: string; vdtId: string | null; projectId: string; projectRevision: number;
  before: VdtProject; beforeJson: string; settings: string;
  previousNodeId: string; previousScenarioId: string;
  context?: KpiSuggestionContext; proposal?: KpiSuggestionSet; selection?: KpiSuggestionSelection;
  execution?: KpiSuggestionExecutionIdentity;
  authority?: Authority | undefined; candidate?: VdtProject; input?: SaveStoredVdtRevisionInput; addedNodeIds: string[];
  checkpointVersionId?: string;
}
export type SmartKpiOperation = SmartKpiOperationV1 | SmartKpiMixedOperation;
export interface SmartKpiUndo {
  operationId: string; workspaceId: string; vdtId: string | null; projectId: string;
  before: VdtProject; appliedJson: string; projectRevision: number; authority?: Authority;
  previousNodeId: string; previousScenarioId: string; checkpointVersionId: string;
}
export interface SmartKpiRebase { workspaceId: string; vdtId: string | null }
type Get = () => VdtStudioState;
type Set = (partial: Partial<VdtStudioState> | ((state: VdtStudioState) => Partial<VdtStudioState>)) => void;
const same = (a: unknown, b: unknown) => a === undefined || b === undefined ? a === b : kpiCanonicalJson(a) === kpiCanonicalJson(b);
const configuration = (state: VdtStudioState) => kpiCanonicalJson(persistedExecutionSettings(state.executionSettings));
const failure = (reason: string, code?: string) => Object.assign(new Error(reason), code ? { code } : {});
const preparationIssue = (input: IncomingKpiBatchInput) => {
  if (!input.proposal) return;
  try { validateKpiSuggestionDecomposition(input.proposal, input.context); }
  catch (error) { return { code: error && typeof error === "object" && "code" in error ? String(error.code) : "NOT_A_DECOMPOSITION",
    message: error instanceof Error ? error.message : "Check the proposed decomposition. Refresh suggestions." }; }
};
const running = new Set<string>();
const actualConflict = (error: unknown) => error instanceof VdtStorageRequestError && ["REVISION_CONFLICT", "PROJECT_WRITE_STATE_CHANGED", "IDEMPOTENCY_KEY_REUSE"].includes(error.code);
export function hasSmartKpiRebase(state: VdtStudioState): boolean {
  const marker = state.smartKpiRebaseRequired;
  return Boolean(marker && resolveSmartKpiScope(state).workspaceId === marker.workspaceId && (state.workspace.activeVdtId ?? null) === marker.vdtId);
}

function authority(state: VdtStudioState): Authority | undefined {
  if (!state.workspace.activeVdtId) return undefined;
  const summary = state.workspace.projectSummaries.find(s => s.project.id === state.workspace.activeProjectId);
  const entry = summary?.vdts.find(e => e.vdt.id === state.workspace.activeVdtId && e.vdt.projectId === summary.project.id);
  if (!entry || !summary || summary.runtimeState.writeState !== "enabled") throw failure("Stored VDT authority is unavailable or read-only. Refresh before applying suggestions.");
  return { head: revisionCasFromHead(entry.head), runtime: runtimeCasFromState(summary.runtimeState) };
}

export function smartKpiBlockedReason(state: VdtStudioState, ignoreOwnOperation = false): string | undefined {
  const stop = state.pendingIncomingKpiRestart;
  if (stop && stop.workspaceId === (state.workspace.activeProjectId ?? state.project.id) && stop.vdtId === (state.workspace.activeVdtId ?? null)) return "Confirm the previous agent cleanup before applying incoming KPIs.";
  if (!ignoreOwnOperation && (state.smartKpiOperation || ["applying", "undoing", "reconciling"].includes(state.smartKpiMutation.status))) return "Resolve the pending Smart operation before changing the graph.";
  if (hasSmartKpiRebase(state)) return "Reload this VDT from its stored revision before applying or automatically saving the stale draft. Your draft evidence is retained.";
  const detached = state.smartKpiFencedRunIds.includes(state.agentRun?.runId ?? state.generateActivity?.runId ?? "");
  if (state.isGenerating || !detached && (state.agentConnectionStatus === "connecting" || state.agentPendingQuestions?.length
    || ["queued", "running", "needs_user_input", "waiting_approval", "recovery_required"].includes(state.agentRun?.status ?? "")
    || ["running", "needs_user_input", "recovery_required"].includes(state.generateActivity?.status ?? ""))) return "Finish or cancel the active agent before applying Smart suggestions.";
  if (state.workspace.isLoading || state.workspace.isMutating) return "Wait for the workspace operation to finish.";
  return resolveSmartKpiScope(state).blockedReason;
}

function ownsBase(state: VdtStudioState, operation: SmartKpiOperation): boolean {
  const scope = resolveSmartKpiScope(state);
  return !scope.blockedReason && scope.workspaceId === operation.workspaceId && scope.vdtId === operation.vdtId && state.project.id === operation.projectId
    && state.projectRevision === operation.projectRevision && kpiCanonicalJson(state.project) === operation.beforeJson
    && (operation.proposal?.origin.kind !== "model" || operation.phase === "committing" || configuration(state) === operation.settings);
}
function authorityMatches(state: VdtStudioState, expected: Authority | undefined): boolean {
  try { return same(authority(state), expected); } catch { return false; }
}

/** Recovered journal components are one operation, never independent sources
 * of display and commit truth. Reject inconsistencies without rewriting them. */
export function validateSmartKpiOperation(operation: SmartKpiOperation): boolean {
  try {
    if (!["smart_kpi_operation.v1", "smart_kpi_operation.v2"].includes(operation.schemaVersion) || operation.phase !== "committing" || !/^smart_[a-z0-9_]{20,60}$/.test(operation.id)
      || !["add", "undo"].includes(operation.kind) || !operation.candidate || operation.before.id !== operation.projectId || operation.candidate.id !== operation.projectId
      || kpiCanonicalJson(operation.before) !== operation.beforeJson || !operation.checkpointVersionId) return false;
    const checkpoint = operation.candidate.versions.find(v => v.id === operation.checkpointVersionId);
    if (!checkpoint || checkpoint.taskType !== "suggest_incoming_kpis" || operation.candidate.versions.filter(v => v.id === operation.checkpointVersionId).length !== 1) return false;
    if (operation.vdtId) {
      if (!operation.input || !operation.authority || !same(operation.input.project, operation.candidate)
        || !same(operation.input.expectedHead, operation.authority.head) || !same(operation.input.expectedRuntime, operation.authority.runtime)
        || operation.input.idempotencyKey !== `smart-${operation.kind}:${operation.vdtId}:${operation.id}`) return false;
    } else if (operation.input || operation.authority) return false;
    if (operation.kind === "add") {
      if (!operation.context || operation.context.workspaceId !== operation.workspaceId || operation.context.vdtId !== operation.vdtId || operation.context.projectId !== operation.projectId
        || !same(checkpoint.projectSnapshot, { ...operation.before, versions: [] })) return false;
      if (operation.schemaVersion === "smart_kpi_operation.v1") {
        // Historical receipt is replayed exactly. Never apply new draft rules to it.
        if (!operation.proposal || !operation.selection || operation.context.contextHash !== operation.proposal.contextHash || operation.context.targetNodeId !== operation.proposal.targetNodeId) return false;
      } else {
        if (!operation.resolved.values && [operation.draft.inputValues, operation.draft.referenceValue, operation.draft.estimateMissingValues, operation.draft.estimatedAliases, operation.draft.referenceValueEstimated].some(value => value !== undefined)) return false;
        const inspected = inspectIncomingKpiDraft({ schemaVersion: "incoming_kpi_apply.v2", context: operation.context,
          ...(operation.proposal ? { proposal: operation.proposal } : {}), draft: operation.draft }, operation.before);
        if (!inspected.readyForCompile || !same(inspected.lineage, operation.lineage) || !same(operation.execution, inspected.lineage.kind === "model" ? inspected.lineage.execution : undefined)
          || operation.resolved.aliases.length !== inspected.bindings.length) return false;
        for (let i = 0; i < inspected.bindings.length; i++) {
          const row = inspected.bindings[i]!, mapped = operation.resolved.aliases[i]!;
          if (mapped.alias !== row.alias || mapped.origin !== row.origin || mapped.kind !== (row.existingNodeId ? "existing" : "new") || mapped.nodeId !== (row.existingNodeId ?? `${operation.id}_${row.alias}`)) return false;
          const node = operation.candidate.graph.nodes.find(node => node.id === mapped.nodeId);
          const source = mapped.kind === "existing" ? operation.before.graph.nodes.find(node => node.id === mapped.nodeId) : undefined;
          if (!node || node.name !== (source?.name ?? row.name) || node.unit !== row.unit || mapped.kind === "existing" && (!source || source.unit !== row.unit)) return false;
          if (mapped.kind === "new" && !operation.resolved.values && (node.baselineValue !== undefined || node.value !== undefined || node.valueStatus !== "unknown")) return false;
          if (mapped.kind === "new" && mapped.origin === "manual" && (node.aiGenerated || node.status !== "accepted" || !operation.resolved.values && node.valueStatus !== "unknown")) return false;
        }
        const parent = operation.candidate.graph.nodes.find(node => node.id === operation.context.targetNodeId);
        if (expandIncomingKpiFormula(operation.draft.formula, operation.resolved.aliases) !== operation.resolved.formula || parent?.formula !== operation.resolved.formula
          || parent.type !== (parent.id === operation.candidate.rootNodeId ? "root_kpi" : "calculated")) return false;
        // New receipts pin baseline values as well as aliases/formula. Historical
        // committing v2 bodies remain exact, including their unknown inputs.
        if (operation.resolved.values) {
          const input: IncomingKpiBatchInput = { schemaVersion: "incoming_kpi_apply.v2", context: operation.context,
            ...(operation.proposal ? { proposal: operation.proposal } : {}), draft: operation.draft };
          const values = resolveIncomingKpiValues(operation.before, input);
          if (values.issues.length || !same(values, operation.resolved.values)) return false;
          for (const row of values.inputs) {
            const id = operation.resolved.aliases.find(alias => alias.alias === row.alias)?.nodeId;
            const node = operation.candidate.graph.nodes.find(node => node.id === id);
            const patch = incomingKpiInputValuePatch(row, input, values.referenceValue!);
            if (!node || Object.entries(patch).some(([key, value]) => !same(node[key as keyof typeof node], value))) return false;
          }
          const oldParent = operation.before.graph.nodes.find(node => node.id === parent.id)!;
          if (Object.entries(incomingKpiReferenceValuePatch(values, oldParent)).some(([key, value]) => !same(parent[key as keyof typeof parent], value))) return false;
          const calculated = calculateGraph(operation.candidate).values;
          if (values.referenceValue === undefined || calculated[parent.id] === undefined || !incomingKpiValuesEqual(calculated[parent.id]!, values.referenceValue)) return false;
          if (values.inputs.some(row => {
            const id = operation.resolved.aliases.find(alias => alias.alias === row.alias)?.nodeId;
            return !id || row.value === undefined || calculated[id] === undefined || !incomingKpiValuesEqual(calculated[id]!, row.value);
          })) return false;
        }
      }
      const added = operation.candidate.graph.nodes.filter(n => !operation.before.graph.nodes.some(old => old.id === n.id)).map(n => n.id).sort();
      if (!same(added, [...operation.addedNodeIds].sort()) || added.some(id => !id.startsWith(`${operation.id}_`))) return false;
    } else {
      const model = (project: VdtProject) => { const { versions: _versions, updatedAt: _updatedAt, ...rest } = project; return rest; };
      if (operation.addedNodeIds.length || !same(operation.candidate.versions, operation.before.versions) || !same(model(operation.candidate), model(checkpoint.projectSnapshot))) return false;
    }
    return true;
  } catch { return false; }
}

/** Merge only the owning authority, never an older acknowledgement over a
 * newer local head/another VDT's metadata. */
function mergeSummary(current: StoredProjectSummary[], incoming: StoredProjectSummary): StoredProjectSummary[] {
  const existing = current.find(s => s.project.id === incoming.project.id);
  if (!existing) return [...current, incoming];
  return current.map(s => s !== existing ? s : { ...s,
    runtimeState: incoming.runtimeState.generationVersion >= s.runtimeState.generationVersion ? incoming.runtimeState : s.runtimeState,
    counts: { ...s.counts, revisions: Math.max(s.counts.revisions, incoming.counts.revisions) },
    vdts: [...s.vdts.map(old => {
      const next = incoming.vdts.find(e => e.vdt.id === old.vdt.id);
      return next && next.head.commitGeneration >= old.head.commitGeneration ? next : old;
    }), ...incoming.vdts.filter(e => !s.vdts.some(old => old.vdt.id === e.vdt.id))]
  });
}
function mergeConflict(state: VdtStudioState, incoming: Awaited<ReturnType<typeof fetchStoredVdtRevisionState>>) {
  return state.workspace.projectSummaries.map(summary => summary.project.id !== incoming.vdt.projectId ? summary : { ...summary,
    runtimeState: incoming.runtimeState.generationVersion >= summary.runtimeState.generationVersion ? incoming.runtimeState : summary.runtimeState,
    vdts: summary.vdts.map(entry => entry.vdt.id !== incoming.vdt.id || entry.head.commitGeneration > incoming.head.commitGeneration ? entry : { ...entry, head: incoming.head })
  });
}

export function canUndoSmartKpi(state: VdtStudioState): boolean {
  const undo = state.smartKpiUndo;
  if (!undo || smartKpiBlockedReason(state) || state.projectRevision !== undo.projectRevision || kpiCanonicalJson(state.project) !== undo.appliedJson) return false;
  const scope = resolveSmartKpiScope(state);
  if (scope.workspaceId !== undo.workspaceId || scope.vdtId !== undo.vdtId || state.project.id !== undo.projectId) return false;
  try { return same(authority(state), undo.authority); } catch { return false; }
}

/** Replaying an ambiguous ordinary write is required before capturing Smart's
 * head. It reuses its immutable input, even when its owner is no longer open. */
async function reconcileOrdinary(get: Get, set: Set) {
  const pending = get().workspace.pendingRevisionCommit;
  if (pending) {
    const saved = await saveStoredVdtRevision(pending.vdtId, pending.input);
    set(current => ({ workspace: { ...current.workspace, projectSummaries: mergeSummary(current.workspace.projectSummaries, saved.summary),
      ...(same(current.workspace.pendingRevisionCommit, pending) ? { pendingRevisionCommit: undefined } : {}) } }));
  }
  const create = get().workspace.pendingVdtCreate;
  if (create) {
    const saved = await createStoredVdt(create.projectId, create.input);
    set(current => {
      const publish = current.workspace.activeProjectId === create.projectId && current.projectRevision === create.projectRevision
        && same(current.project, create.localProjectAtStart);
      return { ...(publish ? { project: create.input.project, projectRevision: current.projectRevision + 1 } : {}),
        workspace: { ...current.workspace, projectSummaries: mergeSummary(current.workspace.projectSummaries, saved.summary),
          ...(same(current.workspace.pendingVdtCreate, create) ? { pendingVdtCreate: undefined } : {}),
          ...(publish ? { activeVdtId: saved.vdt.id, activePanel: "vdt" as const } : {}) } };
    });
  }
}

export function createSmartKpiActions(set: Set, get: Get, layout: (project: VdtProject, ui: UiPreferences) => VdtProject) {
  const result = (operation: SmartKpiOperation, ok: boolean, reason?: string): SmartKpiApplyResult => ({ ok, targetNodeId: operation.context?.targetNodeId ?? operation.previousNodeId,
    addedNodeIds: ok ? operation.addedNodeIds : [], durability: operation.vdtId ? "stored" : "draft", ...(reason ? { reason } : {}) });
  async function finish(operation: SmartKpiOperation): Promise<SmartKpiApplyResult> {
    if (!operation.candidate || operation.vdtId && !operation.input) return result(operation, false, "The pending operation is incomplete. Refresh suggestions.");
    if (running.has(operation.id)) return result(operation, false, "The same Smart operation is already in progress.");
    if (!validateSmartKpiOperation(operation)) {
      const message = "The retained Smart operation is inconsistent. Its evidence remains intact; no request was sent. Reconcile the owning VDT before editing.";
      set({ smartKpiConflictOperation: operation, smartKpiRebaseRequired: { workspaceId: operation.workspaceId, vdtId: operation.vdtId }, smartKpiMutation: { status: "failed", canUndo: false, message } });
      return result(operation, false, message);
    }
    if (operation.vdtId && !smartKpiJournalPersisted(operation.id, operation.input)) {
      const message = studioStatePersistenceProblem()
        ? "Browser storage could not retain the recovery copy. Nothing was sent; keep this tab open and retry when browser storage is available."
        : "The saved Smart request changed before it could be sent. Nothing was sent; reopen this VDT and retry.";
      set({ smartKpiOperation: undefined, smartKpiMutation: { status: "failed", targetNodeId: operation.context?.targetNodeId ?? operation.previousNodeId, canUndo: false, message } });
      return result(operation, false, message);
    }
    running.add(operation.id);
    try {
      const saved = operation.vdtId ? await saveStoredVdtRevision(operation.vdtId, operation.input!) : undefined;
      // An idempotent replay can acknowledge an older committed operation after
      // another writer advanced the head. Never publish that candidate as head.
      const latest = saved && operation.vdtId ? await fetchStoredVdtRevisionState(operation.vdtId).catch(() => undefined) : undefined;
      const currentHeadConfirmed = !saved || Boolean(latest && latest.vdt.projectId === operation.workspaceId && latest.vdt.id === operation.vdtId
        && same(revisionCasFromHead(latest.head), revisionCasFromHead(saved.head)) && same(runtimeCasFromState(latest.runtimeState), runtimeCasFromState(saved.runtimeState)));
      let executionCurrent = true;
      if (operation.execution) {
        try { executionCurrent = same((await createSmartKpiPreparedSelection(get().executionSettings, get().runnerPairingToken ? { pairingToken: get().runnerPairingToken! } : {})).execution, operation.execution); }
        catch { executionCurrent = false; }
      }
      // Prepare only explicit accepted child roles before publishing new nodes,
      // so their first prewarm can use the Library without a model round trip.
      const selection = operation.schemaVersion === "smart_kpi_operation.v2"
        ? operation.draft.formulaAuthorship === "recipe" && operation.draft.source.kind === "proposal"
          ? { mode: "formula" as const, groupId: operation.draft.source.groupId, childKeys: operation.draft.childKeys } : undefined
        : operation.selection;
      if (operation.kind === "add" && operation.context && operation.proposal && selection) {
        await recordAcceptedSmartKpiChildren({ project: operation.candidate, context: operation.context, proposal: operation.proposal,
          selection, ...(operation.schemaVersion === "smart_kpi_operation.v2" ? { aliases: operation.resolved.aliases } : {}), operationId: operation.id, scope: { workspaceId: operation.workspaceId, vdtId: operation.vdtId,
            period: operation.context.period, ...(operation.context.business.goal ? { goal: operation.context.business.goal } : {}) } }).catch(() => {});
      }
      let published = false;
      set(current => {
        if (current.smartKpiOperation?.id !== operation.id) return saved ? { workspace: { ...current.workspace, projectSummaries: mergeSummary(current.workspace.projectSummaries, saved.summary) } } : {};
        published = currentHeadConfirmed && executionCurrent && ownsBase(current, operation) && !smartKpiBlockedReason(current, true)
          && (saved ? authorityMatches(current, operation.authority) : true);
        const nextAuthority = saved ? { head: revisionCasFromHead(saved.head), runtime: runtimeCasFromState(saved.runtimeState) } : undefined;
        const undo: SmartKpiUndo | undefined = published && operation.kind === "add" ? { operationId: operation.id, workspaceId: operation.workspaceId, vdtId: operation.vdtId,
          projectId: operation.projectId, before: operation.before, appliedJson: kpiCanonicalJson(operation.candidate), projectRevision: current.projectRevision + 1,
          ...(nextAuthority ? { authority: nextAuthority } : {}), previousNodeId: operation.previousNodeId, previousScenarioId: operation.previousScenarioId,
          checkpointVersionId: operation.checkpointVersionId! } : undefined;
        return { ...(published ? { project: operation.candidate!, projectRevision: current.projectRevision + 1,
            selectedNodeId: operation.kind === "add" ? operation.context!.targetNodeId : operation.previousNodeId,
            activeScenarioId: operation.previousScenarioId, selectedEdgeId: undefined,
            highlightedNodeIds: operation.addedNodeIds, pendingChangeSet: undefined, pendingFileImport: undefined, changeSetSelection: new Set<string>(), versionRestoreUndo: undefined } : {}),
          smartKpiOperation: undefined, smartKpiUndo: undo, smartKpiBlockedReason: undefined,
          ...(!published ? { smartKpiConflictOperation: operation, smartKpiRebaseRequired: { workspaceId: operation.workspaceId, vdtId: operation.vdtId } } : {}),
          smartKpiMutation: { status: published ? "succeeded" : "conflict", targetNodeId: operation.context?.targetNodeId ?? operation.previousNodeId,
            canUndo: Boolean(undo), message: published ? operation.kind === "undo" ? "Smart addition undone as a new revision." : operation.vdtId ? "Smart suggestions added and saved." : "Smart suggestions added to this unsaved draft."
              : "The submitted Smart revision was saved, but the open graph changed. Your current draft remains open; inspect Versions or reload the owning VDT." },
          workspace: { ...current.workspace, ...(saved ? { projectSummaries: latest ? mergeConflict({ ...current, workspace: { ...current.workspace,
              projectSummaries: mergeSummary(current.workspace.projectSummaries, saved.summary) } }, latest) : mergeSummary(current.workspace.projectSummaries, saved.summary) } : {}),
            ...(published && saved ? { lastSavedAt: new Date().toISOString() } : {}) }
        };
      });
      if (published && studioStatePersistenceProblem()) set(current => ({ smartKpiMutation: { ...current.smartKpiMutation,
        message: `${operation.vdtId ? "Smart revision saved." : "Smart suggestions added in memory."} Browser storage could not persist this editor state; reload may require reconciliation. Undo is available only while its exact state and journal remain available.` } }));
      if (published) void get().sendManualProjectChange({ kind: "project_replaced", summary: operation.kind === "undo" ? "User undid Smart KPI suggestions." : "User applied Smart KPI suggestions." });
      return result(operation, published, published ? undefined : "The open graph or owning authority changed.");
    } catch (error) {
      const conflict = actualConflict(error), deterministic = error instanceof VdtStorageRequestError && !error.retryable && error.status >= 400 && error.status < 500;
      const refreshed = conflict && operation.vdtId ? await fetchStoredVdtRevisionState(operation.vdtId).catch(() => undefined) : undefined;
      set(current => current.smartKpiOperation?.id !== operation.id ? {} : {
        smartKpiOperation: deterministic ? undefined : operation,
        ...(conflict ? { smartKpiConflictOperation: operation, smartKpiRebaseRequired: { workspaceId: operation.workspaceId, vdtId: operation.vdtId } } : {}),
        smartKpiMutation: { status: conflict ? "conflict" : deterministic ? "failed" : "reconciling", targetNodeId: operation.context?.targetNodeId ?? operation.previousNodeId, canUndo: false,
          message: conflict ? "The VDT authority changed. Your draft and selection remain open; refresh or rebase before trying a new addition."
            : deterministic ? error.message : "The save result is unknown. Reconcile this same immutable Smart operation before editing or adding again." },
        workspace: refreshed ? { ...current.workspace, projectSummaries: mergeConflict(current, refreshed) } : current.workspace
      });
      return result(operation, false, error instanceof Error ? error.message : "Smart save could not be confirmed.");
    } finally { running.delete(operation.id); }
  }
  return {
    buildIncomingKpiContext: async (targetNodeId: string): Promise<KpiSuggestionContext> => {
      const state = get(), scope = resolveSmartKpiScope(state);
      if (scope.blockedReason) throw failure(scope.blockedReason);
      return buildKpiSuggestionContext(state.project, { ...scope, targetNodeId });
    },
    previewIncomingKpiBatch: async (input: IncomingKpiBatchInput) => {
      const issue = preparationIssue(input);
      if (issue) return { valid: false as const, draftRevision: input.draft.revision, issues: [issue] };
      const state = get(), scope = resolveSmartKpiScope(state);
      const context = !scope.blockedReason ? await buildKpiSuggestionContext(state.project, { ...scope, targetNodeId: input.context.targetNodeId }) : undefined;
      if (!same(context, input.context)) return { valid: false as const, draftRevision: input.draft.revision,
        issues: [{ code: "STALE_DRAFT", message: "Refresh the KPI context." }] };
      // Pure local compiler: no execution admission, provider, journal or graph writes.
      return previewIncomingKpiBatch(state.project, input);
    },
    applySmartKpiSuggestion: async (input: IncomingKpiBatchInput): Promise<SmartKpiApplyResult> => {
      const state = get(), scope = resolveSmartKpiScope(state), reason = smartKpiBlockedReason(state);
      if (reason) return { ok: false, targetNodeId: input.context.targetNodeId, addedNodeIds: [], durability: scope.vdtId ? "stored" : "draft", reason };
      const issue = preparationIssue(input);
      if (issue) return { ok: false, targetNodeId: input.context.targetNodeId, addedNodeIds: [], durability: scope.vdtId ? "stored" : "draft", reason: issue.message, code: issue.code };
      const inspected = inspectIncomingKpiDraft(input, state.project);
      if (!inspected.readyForCompile) return { ok: false, targetNodeId: input.context.targetNodeId, addedNodeIds: [], durability: scope.vdtId ? "stored" : "draft", reason: inspected.issues[0]!.message };
      let operation: SmartKpiOperation = { schemaVersion: "smart_kpi_operation.v2", id: `smart_${crypto.randomUUID().replaceAll("-", "_")}`, kind: "add", phase: "preparing",
        workspaceId: scope.workspaceId, vdtId: scope.vdtId, projectId: state.project.id, projectRevision: state.projectRevision,
        before: cloneProject(state.project), beforeJson: kpiCanonicalJson(state.project), settings: configuration(state),
        previousNodeId: state.selectedNodeId, previousScenarioId: state.activeScenarioId, addedNodeIds: [],
        context: structuredClone(input.context), ...(input.proposal ? { proposal: structuredClone(input.proposal) } : {}),
        draft: structuredClone(input.draft), lineage: structuredClone(inspected.lineage) };
      // Synchronous reservation precedes the first promise/metadata read.
      set({ smartKpiOperation: operation, smartKpiUndo: undefined, smartKpiMutation: { status: "applying", targetNodeId: input.context.targetNodeId, canUndo: false },
        smartKpiFencedRunIds: [...new Set([...state.smartKpiFencedRunIds, state.agentRun?.runId, state.generateActivity?.runId, ...state.agentChatHistory.map(h => h.runId)].filter((id): id is string => Boolean(id)))].slice(-64) });
      operation = structuredClone(operation);
      try {
        if (!smartKpiJournalPersisted(operation.id)) throw failure("Browser storage could not reserve the recovery copy. Nothing was sent; keep this tab open and retry when browser storage is available.");
        await reconcileOrdinary(get, set);
        if (!ownsBase(get(), operation)) throw failure("The ordinary pending write changed this scope. Refresh suggestions.");
        const current = get(), currentScope = resolveSmartKpiScope(current);
        operation.authority = authority(current);
        let selected;
        if (operation.lineage.kind === "model") {
          selected = await createSmartKpiPreparedSelection(current.executionSettings, current.runnerPairingToken ? { pairingToken: current.runnerPairingToken } : {});
          if (!same(selected.execution, operation.lineage.execution)) throw failure("The selected model/backend/credential changed. Refresh suggestions.", "STALE_EXECUTION");
          operation.execution = selected.execution;
        }
        const context = await buildKpiSuggestionContext(operation.before, { ...currentScope, targetNodeId: operation.context.targetNodeId });
        if (!same(context, operation.context)) throw failure("The KPI context changed. Refresh suggestions.");
        const compiled = await compileIncomingKpiBatch(operation.before, { schemaVersion: "incoming_kpi_apply.v2", context,
          ...(operation.proposal ? { proposal: operation.proposal } : {}), draft: operation.draft }, { operationId: operation.id, now: new Date().toISOString() });
        const checkpointed = createVersionSnapshot(operation.before, { name: "Before incoming KPIs", taskType: "suggest_incoming_kpis" });
        const candidate = layout({ ...compiled.preview, versions: checkpointed.versions }, current.ui);
        if (selected && !(await selected.revalidate(get().executionSettings))) throw failure("The selected execution changed while validating incoming KPIs.", "STALE_EXECUTION");
        if (!ownsBase(get(), operation) || smartKpiBlockedReason(get(), true) || !same(authority(get()), operation.authority)) throw failure("The graph or storage authority changed while validating incoming KPIs.");
        operation = { ...operation, phase: "committing", candidate, addedNodeIds: compiled.newNodeIds, checkpointVersionId: checkpointed.versions.at(-1)!.id,
          resolved: { aliases: compiled.aliases, formula: compiled.formula, values: compiled.values },
          ...(operation.vdtId ? { input: { idempotencyKey: `smart-add:${operation.vdtId}:${operation.id}`, expectedHead: operation.authority!.head,
            expectedRuntime: operation.authority!.runtime, project: cloneProject(candidate), summary: "Incoming KPI formula and mixed inputs" } } : {}) };
        set({ smartKpiOperation: structuredClone(operation) });
        return await finish(operation);
      } catch (error) {
        set(current => current.smartKpiOperation?.id !== operation.id ? {} : { smartKpiOperation: undefined,
          smartKpiMutation: { status: "failed", targetNodeId: input.context.targetNodeId, canUndo: false, message: error instanceof Error ? error.message : "Incoming validation failed." } });
        return { ...result(operation, false, error instanceof Error ? error.message : "Incoming validation failed."),
          ...((error as { code?: string })?.code === "STALE_EXECUTION" ? { code: "STALE_EXECUTION" } : {}) };
      }
    },
    reconcilePendingSmartKpiCommit: async (): Promise<boolean> => {
      const operation = get().smartKpiOperation;
      if (!operation) return true;
      if (operation.phase !== "committing") return false;
      return (await finish(operation)).ok;
    },
    undoSmartKpiSuggestion: async (): Promise<boolean> => {
      const state = get(), undo = state.smartKpiUndo;
      if (!undo || !canUndoSmartKpi(state)) return false;
      const operation: SmartKpiOperation = { schemaVersion: "smart_kpi_operation.v1", id: `smart_${crypto.randomUUID().replaceAll("-", "_")}`, kind: "undo", phase: "committing",
        workspaceId: undo.workspaceId, vdtId: undo.vdtId, projectId: undo.projectId, projectRevision: state.projectRevision,
        before: cloneProject(state.project), beforeJson: kpiCanonicalJson(state.project), settings: configuration(state), authority: undo.authority,
        previousNodeId: undo.previousNodeId, previousScenarioId: undo.previousScenarioId, addedNodeIds: [], checkpointVersionId: undo.checkpointVersionId,
        candidate: { ...cloneProject(undo.before), versions: cloneProject(state.project.versions), updatedAt: new Date().toISOString() } };
      if (operation.vdtId) operation.input = { idempotencyKey: `smart-undo:${operation.vdtId}:${operation.id}`, expectedHead: undo.authority!.head,
        expectedRuntime: undo.authority!.runtime, project: cloneProject(operation.candidate!), summary: "Undo Smart KPI addition (new revision)" };
      set({ smartKpiOperation: operation, smartKpiMutation: { status: "undoing", canUndo: false, targetNodeId: undo.previousNodeId } });
      return (await finish(operation)).ok;
    }
  };
}

/** Entry guards also stop network/agent starts: guarding only setters would
 * leave an already-started external mutation behind. Inspection remains usable. */
export function guardSmartKpiActions(state: VdtStudioState, get: Get): VdtStudioState {
  const voidActions = ["resetUiPreferences", "autoDistributeLayout", "clearHomeWorkspaceContext", "closeWorkspaceVdtEditor", "setWorkspacePanel", "updateNodePosition", "setBriefField", "setProviderId", "setProviderConfigField", "setExecutionMode", "setExecutionCategory", "setExecutionSettingsField", "setSelectedCliAgentId", "removeCliAgent", "restoreCliAgent", "setLocalRunnerPreset", "setByokProtocol", "setByokGateway", "setGatewayPreset", "setMemoryModelMode", "setCliModelSelection", "setCliModelForAgent", "loadExample", "updateNode", "updateNodeBaselineValue", "deleteNode", "createScenario", "setMainScenario", "renameScenario", "deleteScenario", "cloneScenario", "updateScenarioOverride", "toggleChangeSelection", "applyPendingChangeSet", "discardPendingChangeSet", "renameVersionSnapshot", "addManualIncomingKpi", "connectAgentEvents"];
  const falseActions = ["createWorkspaceProject", "renameWorkspaceProject", "updateWorkspaceProjectDetails", "deleteWorkspaceProject", "createWorkspaceVdt", "selectWorkspaceProject", "selectWorkspaceVdt", "renameWorkspaceVdt", "setWorkspaceVdtStatus", "deleteWorkspaceVdt", "saveActiveWorkspaceVdt", "startNewAgentChat", "openAgentChat", "startAgentRun", "sendAgentInstruction", "requestIncomingKpisWithAi", "stageDataDiscoveryChangeSet", "restoreVersionSnapshot", "undoVersionRestore"];
  const asyncVoid = ["refreshWorkspace", "resumePersistedAgentRun", "sendAgentAnswers", "continueAgentRun", "sendAgentApproval", "generateWithAi", "pairRunner", "unpairRunner"];
  const actions = state as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const name of [...voidActions, ...falseActions, ...asyncVoid, "saveVersionSnapshot"]) {
    const original = actions[name]; if (!original) continue;
    actions[name] = (...args) => {
      const current = get();
      const recoveryReload = name === "selectWorkspaceVdt" && current.smartKpiOperation && !validateSmartKpiOperation(current.smartKpiOperation)
        && hasSmartKpiRebase(current) && args[0] === current.smartKpiOperation.vdtId;
      return current.smartKpiOperation && !recoveryReload ? (asyncVoid.includes(name) ? Promise.resolve() : falseActions.includes(name) ? false : undefined) : original(...args);
    };
  }
  const preference = state.setUiPreference;
  state.setUiPreference = (field, value) => { if (!get().smartKpiOperation || field !== "kpiHorizontalGap" && field !== "kpiVerticalGap") preference(field, value); };
  return state;
}
