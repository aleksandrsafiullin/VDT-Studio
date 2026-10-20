"use client";

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { RefreshCw, Sparkles, X } from "lucide-react";
import {
  INCOMING_KPI_LIMITS, newIncomingKpiExistingKey, newIncomingKpiManualKey,
  type IncomingKpiBatchDraft, type IncomingKpiBatchInput, type IncomingKpiBatchPreview, type KpiSuggestionSet, type VdtProject
} from "@vdt-studio/vdt-core";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/field";
import { IncomingKpiFormulaField } from "./incoming-kpi-formula-field";
import { createIncomingKpiDraft, editIncomingKpiDraft, incomingKpiDraftReferences, IncomingKpiDraftBook,
  type RetainedIncomingKpiDraft } from "./incoming-kpi-draft";
import { placeSmartKpiPanel, type SmartKpiPlacement } from "./smart-kpi-geometry";
import type { SmartKpiController } from "./use-smart-kpi";

const focusableSelector = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, [tabindex="0"]';

export function SmartKpiPreparationNotice({ reason, limitations }: { reason: string; limitations?: string[] | undefined }) {
  return <div role="status" aria-live="polite" data-testid="smart-kpi-preparation-notice" className="py-2 text-xs text-muted">
    <p>{reason}</p>
    {limitations?.length ? <details className="mt-1"><summary className="cursor-pointer">Details</summary>
      <ul className="mt-1 list-disc space-y-1 pl-4">{limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul>
    </details> : null}
  </div>;
}

export function SmartKpiPanel({ controller, viewportRevision }: { controller: SmartKpiController; viewportRevision: number }) {
  const { active, snapshot } = controller;
  const panel = useRef<HTMLDivElement>(null);
  const book = useRef(new IncomingKpiDraftBook());
  const manualActivation = useRef<typeof active>(null);
  const [placement, setPlacement] = useState<SmartKpiPlacement>();
  const [retained, setRetained] = useState<RetainedIncomingKpiDraft>();
  const [previewResult, setPreviewResult] = useState<{ input: IncomingKpiBatchInput; project: VdtProject; value: IncomingKpiBatchPreview }>();
  const [focusRow, setFocusRow] = useState<string>();
  const [existingChoice, setExistingChoice] = useState("");
  const proposal = snapshot.proposal;
  const context = controller.context ?? controller.latestContext;
  const entry = retained?.ownerKey === controller.ownerKey && retained.input.draft.targetNodeId === active?.targetNodeId ? retained : undefined;
  const preview = previewResult?.input === entry?.input && previewResult?.project === controller.project ? previewResult.value : undefined;

  useEffect(() => {
    if (!active || !context || context.targetNodeId !== active.targetNodeId) return;
    let current = book.current.get(controller.ownerKey, active.targetNodeId);
    const manual = active.mode === "manual";
    if (!current || manual && manualActivation.current !== active && current.input.draft.source.kind !== "manual"
      || !manual && !current.dirty && current.input.draft.source.kind === "manual" && proposal) {
      current = book.current.open(controller.ownerKey, createIncomingKpiDraft(context, controller.project, manual ? undefined : proposal));
    }
    if (manual && manualActivation.current !== active) {
      manualActivation.current = active;
      const blank = current.input.draft.manualChildren.find(row => !row.name || !row.unit);
      if (blank) setFocusRow(blank.key);
      else if (current.input.draft.manualChildren.length < INCOMING_KPI_LIMITS.newRows) {
        const key = newIncomingKpiManualKey();
        current = book.current.save(current, editIncomingKpiDraft(current.input, {
          manualChildren: [...current.input.draft.manualChildren, { key, name: "", unit: "", selected: true }]
        }));
        setFocusRow(key);
      }
    }
    setRetained(current);
  }, [active, context?.contextHash, proposal?.proposalId, controller.ownerKey]);

  useEffect(() => {
    setPreviewResult(undefined);
    if (!entry) return;
    let current = true;
    const timer = setTimeout(() => { void controller.preview(entry.input)
      .then(value => { if (current) setPreviewResult({ input: entry.input, project: controller.project, value }); })
      .catch((error: unknown) => { if (current) setPreviewResult({ input: entry.input, project: controller.project, value: { valid: false, draftRevision: entry.input.draft.revision,
        issues: [{ code: "PREVIEW_FAILED", message: error instanceof Error ? error.message : "Check this formula." }] } }); });
    }, 40);
    return () => { current = false; clearTimeout(timer); };
  }, [entry?.input, controller.project, controller.preview]);

  useLayoutEffect(() => {
    if (!focusRow || !active || !placement) return;
    const input = panel.current?.querySelector<HTMLInputElement>(`[data-manual-name="${focusRow}"]`);
    if (!input?.isConnected || input.matches(":disabled") || getComputedStyle(input).visibility === "hidden") return;
    input.focus({ preventScroll: true });
    if (document.activeElement === input) setFocusRow(undefined);
  }, [focusRow, entry, active, placement, controller.mutation?.status]);

  useLayoutEffect(() => {
    if (!active) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!active.rail.isConnected) { controller.close(); return; }
        const anchor = active.rail.getBoundingClientRect(), visual = window.visualViewport;
        setPlacement(placeSmartKpiPanel(anchor, panel.current?.getBoundingClientRect().height ?? 440,
          { width: visual?.width ?? window.innerWidth, height: visual?.height ?? window.innerHeight, left: visual?.offsetLeft ?? 0, top: visual?.offsetTop ?? 0 }));
      });
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    if (panel.current) observer?.observe(panel.current); observer?.observe(active.rail);
    window.addEventListener("resize", measure); window.addEventListener("scroll", measure, true);
    window.visualViewport?.addEventListener("resize", measure); window.visualViewport?.addEventListener("scroll", measure);
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true);
      window.visualViewport?.removeEventListener("resize", measure); window.visualViewport?.removeEventListener("scroll", measure); };
  }, [active, viewportRevision, entry?.key]);

  const edit = (patch: Partial<IncomingKpiBatchDraft>) => {
    if (entry) setRetained(book.current.save(entry, editIncomingKpiDraft(entry.input, patch)));
  };
  const reviewSource = (nextProposal?: KpiSuggestionSet, groupId?: string) => {
    const nextContext = nextProposal ? controller.context : controller.latestContext;
    if (!active || !nextContext || nextProposal && nextContext.contextHash !== nextProposal.contextHash) return;
    const next = book.current.open(controller.ownerKey, createIncomingKpiDraft(nextContext, controller.project, nextProposal, groupId), entry?.input);
    setRetained(next);
  };

  if (!active || typeof document === "undefined") return null;
  const input = entry?.input, draft = input?.draft, source = draft?.source;
  const sourceProposal = input?.proposal;
  const selectedGroup = source?.kind === "proposal" ? sourceProposal?.groups.find(group => group.id === source.groupId) : undefined;
  const working = ["applying", "undoing", "reconciling"].includes(controller.mutation?.status ?? "");
  const stale = Boolean(input && controller.latestContext && input.context.contextHash !== controller.latestContext.contextHash)
    || Boolean(source?.kind === "proposal" && snapshot.stale && source.proposalId === snapshot.proposal?.proposalId);
  const references = input ? incomingKpiDraftReferences(input, controller.project) : [];
  const newCount = (selectedGroup?.children.filter(child => draft?.childKeys.includes(child.key) && !child.existingNodeId).length ?? 0)
    + (draft?.manualChildren.filter(row => row.selected).length ?? 0);
  const existingIds = new Set(draft?.existingFactors.map(row => row.nodeId));
  const existingCandidates = controller.project.graph.nodes.filter(node => node.id !== active.targetNodeId && node.status !== "rejected" && node.unit && !existingIds.has(node.id));
  const history = book.current.list(controller.ownerKey, active.targetNodeId);
  const latestAvailable = Boolean(proposal && source?.kind === "proposal" && proposal.proposalId !== source.proposalId || proposal && source?.kind === "manual" && entry?.dirty);
  let addReason = controller.blockedReason ?? (working ? "Wait for the current save." : undefined);
  if (!addReason && controller.contextError) addReason = controller.contextError;
  if (!addReason && stale) addReason = "The KPI changed. Refresh its context.";
  if (!addReason && (!input || controller.contextPending)) addReason = controller.contextError ?? "Checking the KPI context…";
  const incompleteRow = draft?.manualChildren.find(row => row.selected && (!row.name.trim() || !row.unit.trim()));
  if (!addReason && incompleteRow) addReason = !incompleteRow.name.trim() ? "Name the new KPI." : "Enter the new KPI’s unit.";
  if (!addReason && (!preview || preview.draftRevision !== draft?.revision)) addReason = "Checking the formula…";
  if (!addReason && preview && !preview.valid) addReason = preview.issues[0]?.message ?? "Check this formula.";
  if (!addReason && sourceProposal?.origin.kind === "model" && controller.admission.status !== "ready") addReason = "Restore the selected execution mode.";
  const state = snapshot.state;
  const statusReason = "reason" in state ? state.reason : state.status === "preparing" || controller.admission.status === "preparing" ? "Preparing suggestions…" :
    state.status === "idle" ? "Preparing suggestions…" : "";
  const stop = (event: { stopPropagation(): void }) => event.stopPropagation();
  const runOwnedAction = (action: () => void) => {
    // Disabled/removed action buttons cannot retain focus. Keep a stable focus
    // owner through the save and its resulting layout so feedback stays open.
    panel.current?.focus({ preventScroll: true });
    action();
  };
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.key === "Tab" && event.shiftKey && (document.activeElement === panel.current || document.activeElement === panel.current?.querySelector(focusableSelector))) {
      event.preventDefault(); active.trigger.focus();
    }
  };

  return createPortal(<>
    {placement && placement.bridge.width > 0 ? <div data-smart-kpi-bridge="true" className="nodrag nopan nowheel fixed z-[79]"
      style={{ left: placement.bridge.left, top: placement.bridge.top, width: placement.bridge.width, height: placement.bridge.height }}
      onPointerEnter={controller.enterPanel} onPointerLeave={controller.leavePanel} onPointerDown={stop} onWheel={stop} /> : null}
    <div ref={panel} id="smart-kpi-panel" role="dialog" aria-modal="false" tabIndex={-1} aria-label={`Incoming KPIs for ${input?.context.target.name ?? active.trigger.dataset.nodeName ?? "KPI"}`}
      data-testid="smart-kpi-panel" data-target-node-id={active.targetNodeId} data-state={state.status}
      className="nodrag nopan nowheel fixed z-[80] flex flex-col overflow-hidden rounded-lg border border-line bg-white text-sm text-ink shadow-xl"
      style={{ left: placement?.left ?? 8, top: placement?.top ?? 8, width: placement?.width ?? Math.min(360, window.innerWidth - 16), maxHeight: placement?.maxHeight ?? window.innerHeight - 16,
        visibility: placement ? "visible" : "hidden" }}
      onPointerEnter={controller.enterPanel} onPointerLeave={controller.leavePanel} onFocusCapture={controller.focusPanel} onBlurCapture={controller.blurPanel}
      onPointerDown={stop} onMouseDown={stop} onClick={stop} onDoubleClick={stop} onWheel={stop} onKeyDown={keyDown} onKeyUp={stop}>
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
        <Sparkles className="h-4 w-4 text-accent" aria-hidden="true" /><h2 className="min-w-0 flex-1 text-sm font-semibold">Incoming KPIs</h2>
        {sourceProposal ? <span className="text-[10px] font-medium text-muted">{sourceProposal.origin.kind === "recipe" ? "Library" : "Prepared"}</span> : null}
        <Button type="button" size="icon" variant="ghost" aria-label="Close Smart suggestions" onClick={() => controller.close(true)} icon={<X className="h-4 w-4" />} />
      </div>
      <div className="min-h-0 space-y-3 overflow-y-auto overscroll-contain px-3 py-3">
        <p className="truncate text-xs font-medium text-muted">{input?.context.target.name ?? active.trigger.dataset.nodeName ?? "KPI"}</p>
        {sourceProposal && draft ? <fieldset disabled={working} className="space-y-2"><legend className="sr-only">Choose one decomposition</legend>
          {sourceProposal.groups.map(group => <div key={group.id}>
            <label className="flex cursor-pointer items-start gap-2 text-xs font-semibold">
              <input type="radio" name={`smart-alternative-${active.targetNodeId}`} value={group.id} checked={selectedGroup?.id === group.id}
                onChange={() => reviewSource(sourceProposal, group.id)} className="mt-0.5 accent-blue-600" />{group.title}
            </label>
            {selectedGroup?.id === group.id ? <div className="mt-2 space-y-2 pl-1">
              {group.children.map(child => <label key={child.key} className="flex cursor-pointer items-start gap-2 text-xs">
                <input type="checkbox" checked={draft.childKeys.includes(child.key)} disabled={working}
                  aria-label={child.name} onChange={() => edit({ childKeys: draft.childKeys.includes(child.key) ? draft.childKeys.filter(key => key !== child.key) : [...draft.childKeys, child.key] })}
                  className="mt-0.5 accent-blue-600" />
                <span className="min-w-0">{child.name}<span className="ml-1 text-muted">{child.unit}{child.existingNodeId ? " · Existing" : ""}</span></span>
              </label>)}
            </div> : null}
          </div>)}
        </fieldset> : null}
        {draft ? <fieldset disabled={working} className="space-y-2"><legend className="sr-only">Own KPIs</legend>
          {draft.manualChildren.map(row => <div key={row.key} className="flex items-start gap-1.5" data-manual-row={row.key}>
            <input type="checkbox" className="mt-2.5 accent-blue-600" aria-label={`Include ${row.name || "own KPI"}`} checked={row.selected}
              onChange={() => edit({ manualChildren: draft.manualChildren.map(candidate => candidate.key === row.key ? { ...candidate, selected: !candidate.selected } : candidate) })} />
            <TextInput value={row.name} data-manual-name={row.key} aria-label="KPI name" placeholder="KPI name" maxLength={INCOMING_KPI_LIMITS.name} className="min-w-0 flex-1 px-2 py-1.5 text-xs"
              onChange={event => edit({ manualChildren: draft.manualChildren.map(candidate => candidate.key === row.key ? { ...candidate, name: event.target.value } : candidate) })} />
            <TextInput value={row.unit} aria-label="KPI unit" placeholder="Unit" maxLength={INCOMING_KPI_LIMITS.unit} className="!w-20 shrink-0 px-2 py-1.5 text-xs"
              onChange={event => edit({ manualChildren: draft.manualChildren.map(candidate => candidate.key === row.key ? { ...candidate, unit: event.target.value } : candidate) })} />
            <button type="button" className="shrink-0 rounded p-1.5 text-muted hover:bg-slate-100" aria-label={`Remove ${row.name || "own KPI"}`}
              onClick={() => edit({ manualChildren: draft.manualChildren.filter(candidate => candidate.key !== row.key) })}><X className="h-3 w-3" /></button>
          </div>)}
          <Button type="button" size="sm" data-testid="incoming-kpi-own-row" disabled={working || newCount >= INCOMING_KPI_LIMITS.newRows || draft.manualChildren.length >= INCOMING_KPI_LIMITS.newRows}
            onClick={() => { const key = newIncomingKpiManualKey(); edit({ manualChildren: [...draft.manualChildren, { key, name: "", unit: "", selected: true }] }); setFocusRow(key); }}>+ KPI</Button>
        </fieldset> : <p role="status" className="text-xs text-muted">{controller.contextError ?? "Loading KPI context…"}</p>}
        {draft ? <details className="text-xs"><summary className="cursor-pointer font-medium">Existing KPIs{draft.existingFactors.length ? ` (${draft.existingFactors.length})` : ""}</summary>
          <div className="mt-2 space-y-2">
            {draft.existingFactors.map(row => { const node = controller.project.graph.nodes.find(node => node.id === row.nodeId); return <div key={row.key} className="flex items-start gap-1"><label className="flex min-w-0 flex-1 items-start gap-2">
              <input type="checkbox" aria-label={`Include ${node?.name ?? "existing KPI"}`} disabled={working} className="mt-0.5 accent-blue-600" checked={row.selected}
                onChange={() => edit({ existingFactors: draft.existingFactors.map(candidate => candidate.key === row.key ? { ...candidate, selected: !candidate.selected } : candidate) })} />
              <span>{node?.name ?? "Missing KPI"}<span className="ml-1 text-muted">{node?.unit} · Existing</span></span>
            </label><button type="button" disabled={working} className="shrink-0 rounded p-0.5 hover:bg-slate-100" aria-label={`Remove reference to ${node?.name ?? "existing KPI"}`}
              onClick={() => edit({ existingFactors: draft.existingFactors.filter(candidate => candidate.key !== row.key) })}><X className="h-3 w-3" /></button></div>; })}
            <div className="flex gap-1">
              <select aria-label="Choose existing KPI" value={existingChoice} disabled={working || draft.existingFactors.length >= INCOMING_KPI_LIMITS.existingReferences} className="min-w-0 flex-1 rounded border border-line bg-white px-1 py-1.5"
                onChange={event => setExistingChoice(event.target.value)}><option value="">Choose KPI…</option>{existingCandidates.map(node => <option key={node.id} value={node.id}>{node.name} ({node.unit})</option>)}</select>
              <Button type="button" size="sm" disabled={working || !existingChoice || draft.existingFactors.length >= INCOMING_KPI_LIMITS.existingReferences}
                onClick={() => { edit({ existingFactors: [...draft.existingFactors, { key: newIncomingKpiExistingKey(), nodeId: existingChoice, selected: true }] }); setExistingChoice(""); }}>Use</Button>
            </div>
          </div>
        </details> : null}
        {draft ? <IncomingKpiFormulaField key={entry?.key} rawValue={draft.formula} references={references} disabled={working} {...(addReason ? { error: addReason } : {})}
          onChange={formula => edit({ formula })} /> : null}
        {draft ? <p className="text-[11px] text-muted">Result appears after input values.</p> : null}
        <details className="text-xs text-muted"><summary className="cursor-pointer">Details</summary>
          <div className="mt-2 space-y-2">
            {sourceProposal ? <><p>{sourceProposal.rationale}</p>{[...(selectedGroup?.limitations ?? []), ...sourceProposal.limitations].map((limitation, index) => <p key={index}>{limitation}</p>)}</> :
              <><SmartKpiPreparationNotice reason={controller.admission.status === "unavailable" ? controller.admission.reason ?? statusReason : statusReason} />
                {"limitations" in state ? state.limitations?.map((limitation, index) => <p key={index}>{limitation}</p>) : null}</>}
            {history.length > 1 ? <label className="grid gap-1">Previous drafts<select aria-label="Previous drafts" className="w-full rounded border border-line bg-white p-1 text-ink" value={entry?.key ?? ""}
              onChange={event => setRetained(book.current.select(event.target.value))}>{history.map((saved, index) => <option key={saved.key} value={saved.key}>{index + 1}. {saved.input.draft.source.kind === "manual" ? "Manual" : saved.input.proposal?.groups.find(group => saved.input.draft.source.kind === "proposal" && group.id === saved.input.draft.source.groupId)?.title ?? "Prepared"}{saved.dirty ? " · Edited" : ""}</option>)}</select></label> : null}
            {controller.mutation?.undoBlockedReason ? <p>{controller.mutation.undoBlockedReason}</p> : null}
          </div>
        </details>
        {controller.feedback || controller.mutation?.message ? <p role="status" aria-live="polite" data-testid="smart-kpi-feedback" className="text-xs">{controller.feedback ?? controller.mutation?.message}</p> : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line px-3 py-2">
        <Button type="button" size="sm" variant="primary" data-testid="smart-kpi-add-selected" disabled={!!addReason || !input} title={addReason}
          onClick={() => { if (input && !addReason) runOwnedAction(() => { void controller.apply(input); }); }}>{working ? "Saving…" : "Add & calculate"}</Button>
        {latestAvailable ? <Button type="button" size="sm" disabled={working} onClick={() => reviewSource(proposal)}>Review latest</Button> : null}
        {stale && source?.kind === "manual" ? <Button type="button" size="sm" disabled={working || controller.contextPending} onClick={() => {
          if (entry && controller.latestContext) setRetained(book.current.save(entry, { ...entry.input, context: controller.latestContext,
            draft: { ...entry.input.draft, contextHash: controller.latestContext.contextHash, revision: entry.input.draft.revision + 1 } }));
          controller.refreshContext();
        }}>Refresh context</Button> : null}
        {source?.kind !== "manual" && (snapshot.stale || snapshot.refreshAvailable) ? <Button type="button" size="sm" disabled={working} onClick={controller.refresh} icon={<RefreshCw className="h-3 w-3" />}>Refresh</Button> : null}
        {!sourceProposal && state.status !== "preparing" && controller.admission.status !== "preparing" ? <Button type="button" size="sm" disabled={working || state.status === "blocked" || controller.admission.status === "blocked"}
          onClick={controller.retry}>{state.status === "idle" || state.status === "unavailable" ? "Prepare" : "Retry"}</Button> : null}
        {controller.mutation?.canUndo ? <Button type="button" size="sm" disabled={working} data-testid="smart-kpi-undo" onClick={() => runOwnedAction(() => { void controller.undo(); })}>Undo</Button> : null}
        {controller.mutation?.status === "reconciling" ? <Button type="button" size="sm" data-testid="smart-kpi-reconcile" disabled={controller.replaying}
          onClick={() => runOwnedAction(() => { void controller.reconcile(); })}>{controller.replaying ? "Reconciling…" : "Reconcile save"}</Button> : null}
      </div>
    </div>
  </>, document.body);
}
