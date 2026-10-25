"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check, Plus, RefreshCw, Sparkles, X } from "lucide-react";
import {
  INCOMING_KPI_LIMITS, calculateGraph, incomingKpiProposedAlias, kpiCanonicalJson, newIncomingKpiExistingKey, newIncomingKpiManualKey, resolveIncomingKpiValues,
  type IncomingKpiBatchDraft, type IncomingKpiBatchInput, type IncomingKpiBatchPreview, type KpiSuggestionSet, type VdtProject
} from "@vdt-studio/vdt-core";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/field";
import { IncomingKpiFormulaField } from "./incoming-kpi-formula-field";
import { createIncomingKpiDraft, editIncomingKpiDraft, incomingKpiDraftReferences, IncomingKpiDraftBook,
  type RetainedIncomingKpiDraft } from "./incoming-kpi-draft";
import { placeSmartKpiPanel, type SmartKpiPlacement } from "./smart-kpi-geometry";
import { SmartKpiCanvasPreview } from "./smart-kpi-canvas-preview";
import type { SmartKpiController } from "./use-smart-kpi";
import styles from "./smart-kpi-preview.module.css";

const focusableSelector = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, [tabindex="0"]';

export function SmartKpiPreparationNotice({ reason, limitations }: { reason: string; limitations?: string[] | undefined }) {
  return <div role="status" aria-live="polite" data-testid="smart-kpi-preparation-notice" className="py-2 text-xs text-muted">
    <p>{reason}</p>
    {limitations?.length ? <details className="mt-1"><summary className="cursor-pointer">Details</summary>
      <ul className="mt-1 list-disc space-y-1 pl-4">{limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul>
    </details> : null}
  </div>;
}

/** Undo remains reachable after a newly decomposed Input loses Suggested. */
export function SmartKpiUndoNotice({ controller }: { controller: SmartKpiController }) {
  const [dismissed, setDismissed] = useState(false);
  const mutation = controller.mutation;
  useEffect(() => { setDismissed(false); }, [controller.ownerKey, mutation.canUndo]);
  const working = mutation.status === "undoing";
  if (controller.active || dismissed || !mutation.canUndo && !working) return null;
  return <div role="status" aria-live="polite" data-testid="smart-kpi-undo-notice"
    className="absolute bottom-4 right-4 z-40 flex items-center gap-3 rounded-xl border border-line bg-white px-3 py-2 text-xs text-ink shadow-sm">
    <Check className="h-3.5 w-3.5 text-muted" aria-hidden="true" /><span>{working ? "Undoing…" : "KPIs added"}</span>
    <Button type="button" size="sm" data-testid="smart-kpi-undo" disabled={working} onClick={() => { void controller.undo(); }}>Undo</Button>
    <Button type="button" size="icon" variant="ghost" aria-label="Dismiss KPI addition" disabled={working} onClick={() => setDismissed(true)} icon={<X className="h-3.5 w-3.5" />} />
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
  const [editing, setEditing] = useState(false);
  const [appliedInput, setAppliedInput] = useState<IncomingKpiBatchInput>();
  const proposal = snapshot.proposal;
  const context = controller.context ?? controller.latestContext;
  const entry = retained?.ownerKey === controller.ownerKey && retained.input.draft.targetNodeId === active?.targetNodeId ? retained : undefined;
  const preview = previewResult?.input === entry?.input && previewResult?.project === controller.project ? previewResult.value : undefined;
  const values = useMemo(() => entry ? resolveIncomingKpiValues(controller.project, entry.input) : undefined, [entry, controller.project]);
  const currentValues = useMemo(() => calculateGraph(controller.project).values, [controller.project]);

  useEffect(() => { setEditing(active?.mode === "manual"); }, [active?.targetNodeId, active?.mode, controller.ownerKey]);

  useEffect(() => {
    if (!active || !context || context.targetNodeId !== active.targetNodeId) return;
    let current = book.current.get(controller.ownerKey, active.targetNodeId);
    const manual = active.mode === "manual";
    if (!current || manual && manualActivation.current !== active && current.input.draft.source.kind !== "manual"
      || !manual && !current.dirty && proposal && (current.input.draft.source.kind === "manual"
        || current.input.draft.source.proposalId !== proposal.proposalId && !snapshot.stale)) {
      current = book.current.open(controller.ownerKey, createIncomingKpiDraft(context, controller.project, manual ? undefined : proposal));
    }
    if (manual && manualActivation.current !== active) {
      setEditing(true);
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
    if (!focusRow || !active || active.mode === "manual" && !placement) return;
    const input = panel.current?.querySelector<HTMLInputElement>(`[data-manual-name="${focusRow}"]`);
    if (!input?.isConnected || input.matches(":disabled") || getComputedStyle(input).visibility === "hidden") return;
    input.focus({ preventScroll: true });
    if (document.activeElement === input) setFocusRow(undefined);
  }, [focusRow, entry, active, placement, controller.mutation?.status]);

  useLayoutEffect(() => {
    if (!active || active.mode !== "manual") return;
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
  const preparationMismatch = sourceProposal?.groups.some(group => group.children.length < 2);
  const executionStale = sourceProposal?.origin.kind === "model" && controller.admission.selection
    && kpiCanonicalJson(sourceProposal.origin.execution) !== kpiCanonicalJson(controller.admission.selection.execution);
  const selectedGroup = source?.kind === "proposal" ? sourceProposal?.groups.find(group => group.id === source.groupId) : undefined;
  const working = ["applying", "undoing", "reconciling"].includes(controller.mutation?.status ?? "");
  const stale = Boolean(input && controller.latestContext && input.context.contextHash !== controller.latestContext.contextHash)
    || Boolean(source?.kind === "proposal" && snapshot.stale && source.proposalId === snapshot.proposal?.proposalId);
  const references = input ? incomingKpiDraftReferences(input, controller.project) : [];
  const newCount = (selectedGroup?.children.filter(child => draft?.childKeys.includes(child.key) && !child.existingNodeId).length ?? 0)
    + (draft?.manualChildren.filter(row => row.selected).length ?? 0);
  const reusedCount = (selectedGroup?.children.filter(child => draft?.childKeys.includes(child.key) && child.existingNodeId).length ?? 0)
    + (draft?.existingFactors.filter(row => row.selected).length ?? 0);
  const selectedCount = newCount + reusedCount;
  const existingIds = new Set(draft?.existingFactors.map(row => row.nodeId));
  const existingCandidates = controller.project.graph.nodes.filter(node => node.id !== active.targetNodeId && node.status !== "rejected" && node.unit && !existingIds.has(node.id));
  const history = book.current.list(controller.ownerKey, active.targetNodeId);
  const latestAvailable = Boolean(proposal && source?.kind === "proposal" && proposal.proposalId !== source.proposalId || proposal && source?.kind === "manual" && entry?.dirty);
  let addReason = controller.blockedReason ?? (working ? "Wait for the current save." : undefined);
  if (!addReason && controller.contextError) addReason = controller.contextError;
  if (!addReason && stale) addReason = "The KPI changed. Refresh its context.";
  if (!addReason && preparationMismatch) addReason = "A decomposition needs at least two component KPIs. Refresh suggestions.";
  if (!addReason && executionStale) addReason = "The selected execution changed. Refresh suggestions or review the latest draft.";
  if (!addReason && (!input || controller.contextPending)) addReason = controller.contextError ?? "Checking the KPI context…";
  const incompleteRow = draft?.manualChildren.find(row => row.selected && (!row.name.trim() || !row.unit.trim()));
  if (!addReason && incompleteRow) addReason = !incompleteRow.name.trim() ? "Name the new KPI." : "Enter the new KPI’s unit.";
  if (!addReason && (!preview || preview.draftRevision !== draft?.revision)) addReason = "Checking the formula…";
  if (!addReason && preview && !preview.valid) addReason = preview.issues[0]?.message ?? "Check this formula.";
  if (!addReason && sourceProposal?.origin.kind === "model" && controller.admission.status !== "ready") addReason = "Restore the selected execution mode.";
  const state = snapshot.state;
  const canvasPreview = active.mode !== "manual";
  const applied = appliedInput === input && controller.mutation?.canUndo === true;
  const preparing = canvasPreview && !sourceProposal && !entry?.dirty && (state.status === "preparing" || controller.admission.status === "preparing" || controller.contextPending);
  const showDefinition = !applied && !preparationMismatch && (!canvasPreview || !!sourceProposal || !!entry?.dirty);
  const statusReason = preparationMismatch ? "A decomposition needs at least two component KPIs. Refresh suggestions."
    : controller.contextError ?? ("reason" in state ? state.reason : state.status === "preparing" || controller.admission.status === "preparing" ? "Preparing suggestions…" :
      state.status === "idle" ? "Prepare suggestions for this KPI." : "");
  const actionFeedback = controller.feedback ?? (controller.mutation?.targetNodeId === active.targetNodeId
    && !["failed", "succeeded"].includes(controller.mutation.status) ? controller.mutation.message : undefined);
  const stop = (event: { stopPropagation(): void }) => event.stopPropagation();
  const runOwnedAction = (action: () => void) => {
    // Disabled/removed action buttons cannot retain focus. Keep a stable focus
    // owner through the save and its resulting layout so feedback stays open.
    panel.current?.focus({ preventScroll: true });
    action();
  };
  const formatValue = (value: number) => String(Number(value.toPrecision(12)));
  const valueInput = (alias: string, name: string, selected = true, existingNodeId?: string) => {
    const resolved = values?.inputs.find(row => row.alias === alias);
    const existingNode = existingNodeId ? controller.project.graph.nodes.find(node => node.id === existingNodeId) : undefined;
    const existingValue = existingNodeId ? currentValues[existingNodeId] : undefined;
    const editable = resolved?.editable ?? (!existingNode?.formula?.trim() && existingValue === undefined);
    const estimated = resolved?.estimated || existingNode?.valueStatus === "default_assumption" || existingNode?.valueSource?.sourceTier === "assumption";
    if (!editable) return <span className={`min-w-16 text-right text-xs tabular-nums ${estimated ? "text-amber-800" : ""}`} aria-label={`Value for ${name}`} title={estimated ? "Illustrative estimate, not measured data." : undefined}>{estimated ? "≈ " : ""}{existingValue === undefined ? "n/a" : formatValue(existingValue)}</span>;
    return <span className="flex shrink-0 items-center gap-1">{estimated ? <span className="text-xs text-amber-800" title="Illustrative estimate, not measured data.">≈</span> : null}
      <TextInput aria-label={`Value for ${name}`} inputMode="decimal" autoComplete="off" disabled={working || !selected} data-value-source={resolved?.source}
      value={draft?.inputValues?.[alias] ?? ""} placeholder={resolved?.value !== undefined ? formatValue(resolved.value) : "Value"}
      title={estimated ? "Illustrative estimate, not measured data." : resolved?.source === "derived" ? "Calculated from the current KPI; not an independent measurement." : "Input value"}
      className={`!w-[76px] shrink-0 px-1.5 py-1 text-right text-xs tabular-nums ${estimated ? "border-amber-200 bg-amber-50 text-amber-900" : ""}`} maxLength={80}
      onChange={event => edit({ inputValues: { ...draft?.inputValues, [alias]: event.target.value },
        ...(estimated ? { estimatedAliases: [...new Set([...(draft?.estimatedAliases ?? []), alias as NonNullable<IncomingKpiBatchDraft["estimatedAliases"]>[number]])] } : {}) })} />
    </span>;
  };
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.key === "Tab" && event.shiftKey && (document.activeElement === panel.current || document.activeElement === panel.current?.querySelector(focusableSelector))) {
      event.preventDefault(); active.trigger.focus();
    }
  };

  const content = <div ref={panel} id="smart-kpi-panel" role={canvasPreview ? "region" : "dialog"} aria-modal={canvasPreview ? undefined : false} tabIndex={-1} aria-label={`${canvasPreview ? "Suggested" : "Incoming"} KPIs for ${input?.context.target.name ?? active.trigger.dataset.nodeName ?? "KPI"}`}
      data-testid="smart-kpi-panel" data-target-node-id={active.targetNodeId} data-state={state.status}
      className={canvasPreview ? `nodrag nopan nowheel text-sm ${styles.preview}` : "nodrag nopan nowheel fixed z-[80] flex flex-col overflow-hidden rounded-lg border border-line bg-white text-sm text-ink shadow-xl"}
      style={canvasPreview ? undefined : { left: placement?.left ?? 8, top: placement?.top ?? 8, width: placement?.width ?? Math.min(360, window.innerWidth - 16), maxHeight: placement?.maxHeight ?? window.innerHeight - 16,
        visibility: placement ? "visible" : "hidden" }}
      onPointerEnter={controller.enterPanel} onPointerLeave={controller.leavePanel} onFocusCapture={controller.focusPanel} onBlurCapture={controller.blurPanel}
      onPointerDown={stop} onMouseDown={stop} onClick={stop} onDoubleClick={stop} onWheel={stop} onKeyDown={keyDown} onKeyUp={stop}>
      <div className={canvasPreview ? styles.heading : "flex shrink-0 items-center gap-2 border-b border-line px-3 py-2"}>
        {applied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Sparkles className={canvasPreview ? "h-3.5 w-3.5" : "h-4 w-4 text-accent"} aria-hidden="true" />}<h2 className="min-w-0 flex-1 text-sm font-semibold">{canvasPreview ? applied ? "KPIs added" : "Suggested KPIs" : "Incoming KPIs"}</h2>
        <Button type="button" size="icon" variant="ghost" aria-label="Close Smart suggestions" onClick={() => controller.close(true)} icon={<X className="h-4 w-4" />} />
      </div>
      <div className={canvasPreview ? styles.body : "min-h-0 space-y-3 overflow-y-auto overscroll-contain px-3 py-3"}>
        {!canvasPreview ? <p className="truncate text-xs text-muted" title={input?.context.target.name ?? active.trigger.dataset.nodeName}>{input?.context.target.name ?? active.trigger.dataset.nodeName ?? "KPI"}
          {values?.referenceValue !== undefined ? <span className="ml-1.5 font-medium tabular-nums">{values.referenceEstimated ? "≈ " : ""}{formatValue(values.referenceValue)} {input?.context.target.unit}</span> : null}</p>
        : null}
        {showDefinition && draft && (!values || ["missing", "user", "estimate"].includes(values.referenceSource)) ? <div className="space-y-1"><label className="flex items-center justify-between gap-2 text-xs text-muted">Current KPI value
          <TextInput aria-label="Current KPI value" value={draft.referenceValue ?? ""} inputMode="decimal" placeholder="Value" disabled={working} maxLength={80}
            className="!w-24 px-2 py-1 text-right text-xs" onChange={event => edit({ referenceValue: event.target.value })} />
        </label><label className="flex items-center gap-1.5 text-[11px] text-muted"><input type="checkbox" aria-label="Reference is an estimate" checked={draft.referenceValueEstimated ?? false} disabled={working}
          onChange={event => edit({ referenceValueEstimated: event.target.checked })} />Reference is an estimate</label></div> : null}
        {showDefinition && sourceProposal && draft ? <fieldset disabled={working} className="space-y-2"><legend className="sr-only">Choose one decomposition</legend>
          {sourceProposal.groups.map(group => <div key={group.id}>
            {sourceProposal.groups.length > 1 ? <label className="flex cursor-pointer items-start gap-2 text-xs font-semibold">
              <input type="radio" name={`smart-alternative-${active.targetNodeId}`} value={group.id} checked={selectedGroup?.id === group.id}
                onChange={() => reviewSource(sourceProposal, group.id)} className="mt-0.5 accent-blue-600" />{group.title}
            </label> : null}
            {selectedGroup?.id === group.id ? <div className={canvasPreview ? styles.cards : "space-y-2.5"}>
              {group.children.map((child, index) => <div key={child.key} data-smart-kpi-card={canvasPreview ? child.key : undefined} data-selected={draft.childKeys.includes(child.key)} className={canvasPreview ? styles.card : "flex items-start gap-2 text-xs"}>
                <div className={canvasPreview ? styles.cardHeader : "contents"}>
                <label className={canvasPreview ? styles.selection : "flex min-w-0 flex-1 cursor-pointer items-start gap-2"}>
                <input type="checkbox" checked={draft.childKeys.includes(child.key)} disabled={working}
                  aria-label={child.name} onChange={() => edit({ childKeys: draft.childKeys.includes(child.key) ? draft.childKeys.filter(key => key !== child.key) : [...draft.childKeys, child.key] })}
                  className="mt-0.5 accent-blue-600" />
                <span className={canvasPreview ? styles.name : "min-w-0 flex-1 leading-5"}>{child.name}</span></label>
                {canvasPreview ? <span className={styles.unit} title={child.unit}>{child.unit}</span> : null}
                </div>
                <div className={canvasPreview ? styles.value : "contents"}>
                {canvasPreview ? <span className={styles.valueLabel}>Base</span> : null}
                {valueInput(incomingKpiProposedAlias(index), child.name, draft.childKeys.includes(child.key), child.existingNodeId)}
                {!canvasPreview ? <span className="w-10 shrink-0 pt-1 text-[10px] text-muted">{child.unit}</span> : null}
                </div>
                {canvasPreview ? <p className={styles.caption}>{child.existingNodeId ? "Existing KPI · reuse after adding" : "Suggested · not added yet"}</p> : null}
              </div>)}
            </div> : null}
          </div>)}
        </fieldset> : null}
        {showDefinition && draft && (draft.estimateMissingValues || values?.inputs.some(row => row.editable && row.source === "missing")) ? <label data-testid="incoming-kpi-estimates" className="flex cursor-pointer items-center gap-1.5 text-[11px] text-amber-800">
          <input type="checkbox" aria-label="Use estimates" checked={draft.estimateMissingValues ?? false} disabled={working}
            onChange={event => { const inputValues = { ...draft.inputValues }; if (!event.target.checked) for (const alias of draft.estimatedAliases ?? []) delete inputValues[alias];
              edit({ estimateMissingValues: event.target.checked, ...(!event.target.checked ? { inputValues, estimatedAliases: [] } : {}) }); }} />Use estimates · illustrative values
        </label> : null}
        {preparing ? <div aria-busy="true" aria-label="Preparing suggested KPIs" className={styles.cards}>
          {[0, 1].map(index => <div key={index} data-smart-kpi-card="loading" className={`${styles.card} ${styles.loading}`} aria-hidden="true"><span className={styles.skeleton} /><span className={styles.skeleton} /><span className={styles.skeleton} /></div>)}
        </div> : null}
        {!applied && (!sourceProposal || preparationMismatch) && active.mode !== "manual" && statusReason ? <div className={preparing ? styles.note : styles.status}><SmartKpiPreparationNotice reason={controller.admission.status === "unavailable" ? controller.admission.reason ?? statusReason : statusReason}
          {...("limitations" in state && state.limitations ? { limitations: state.limitations } : {})} /></div> : null}
        {showDefinition && draft ? <div className={canvasPreview && editing ? styles.editor : undefined}><IncomingKpiFormulaField key={entry?.key} rawValue={draft.formula} references={references} disabled={working} expanded={editing} onExpandedChange={setEditing} compact={canvasPreview}
          {...(addReason ? { error: addReason } : {})} onChange={formula => edit({ formula })}>
        <fieldset disabled={working} className="space-y-2"><legend className="sr-only">Own KPIs</legend>
          {draft.manualChildren.map(row => <div key={row.key} className="space-y-1" data-manual-row={row.key}><div className="flex items-start gap-1.5">
            <input type="checkbox" className="mt-2.5 accent-blue-600" aria-label={`Include ${row.name || "own KPI"}`} checked={row.selected}
              onChange={() => edit({ manualChildren: draft.manualChildren.map(candidate => candidate.key === row.key ? { ...candidate, selected: !candidate.selected } : candidate) })} />
            <TextInput value={row.name} data-manual-name={row.key} aria-label="KPI name" placeholder="KPI name" maxLength={INCOMING_KPI_LIMITS.name} className="min-w-0 flex-1 px-2 py-1.5 text-xs"
              onChange={event => edit({ manualChildren: draft.manualChildren.map(candidate => candidate.key === row.key ? { ...candidate, name: event.target.value } : candidate) })} />
            <TextInput value={row.unit} aria-label="KPI unit" placeholder="Unit" maxLength={INCOMING_KPI_LIMITS.unit} className="!w-20 shrink-0 px-2 py-1.5 text-xs"
              onChange={event => edit({ manualChildren: draft.manualChildren.map(candidate => candidate.key === row.key ? { ...candidate, unit: event.target.value } : candidate) })} />
            <button type="button" className="shrink-0 rounded p-1.5 text-muted hover:bg-slate-100" aria-label={`Remove ${row.name || "own KPI"}`}
              onClick={() => { const inputValues = { ...draft.inputValues }; delete inputValues[row.key]; edit({ manualChildren: draft.manualChildren.filter(candidate => candidate.key !== row.key), inputValues, estimatedAliases: draft.estimatedAliases?.filter(alias => alias !== row.key) ?? [] }); }}><X className="h-3 w-3" /></button>
          </div><div className="flex items-center justify-end gap-2 text-[11px] text-muted"><span>Value</span>{valueInput(row.key, row.name || "own KPI", row.selected)}<span className="w-20 truncate">{row.unit}</span></div></div>)}
          <Button type="button" size="sm" data-testid="incoming-kpi-own-row" disabled={working || newCount >= INCOMING_KPI_LIMITS.newRows || draft.manualChildren.length >= INCOMING_KPI_LIMITS.newRows}
            onClick={() => { const key = newIncomingKpiManualKey(); edit({ manualChildren: [...draft.manualChildren, { key, name: "", unit: "", selected: true }] }); setFocusRow(key); }}>+ KPI</Button>
        </fieldset>
        <details className="text-xs"><summary className="cursor-pointer font-medium">Existing KPIs{draft.existingFactors.length ? ` (${draft.existingFactors.length})` : ""}</summary>
          <div className="mt-2 space-y-2">
            {draft.existingFactors.map(row => { const node = controller.project.graph.nodes.find(node => node.id === row.nodeId); return <div key={row.key} className="flex items-start gap-1"><label className="flex min-w-0 flex-1 items-start gap-2">
              <input type="checkbox" aria-label={`Include ${node?.name ?? "existing KPI"}`} disabled={working} className="mt-0.5 accent-blue-600" checked={row.selected}
                onChange={() => edit({ existingFactors: draft.existingFactors.map(candidate => candidate.key === row.key ? { ...candidate, selected: !candidate.selected } : candidate) })} />
              <span>{node?.name ?? "Missing KPI"}<span className="ml-1 text-muted">{node?.unit}</span></span>
            </label>{valueInput(row.key, node?.name ?? "existing KPI", row.selected, row.nodeId)}<button type="button" disabled={working} className="shrink-0 rounded p-0.5 hover:bg-slate-100" aria-label={`Remove reference to ${node?.name ?? "existing KPI"}`}
              onClick={() => { const inputValues = { ...draft.inputValues }; delete inputValues[row.key]; edit({ existingFactors: draft.existingFactors.filter(candidate => candidate.key !== row.key), inputValues, estimatedAliases: draft.estimatedAliases?.filter(alias => alias !== row.key) ?? [] }); }}><X className="h-3 w-3" /></button></div>; })}
            <div className="flex gap-1">
              <select aria-label="Choose existing KPI" value={existingChoice} disabled={working || draft.existingFactors.length >= INCOMING_KPI_LIMITS.existingReferences} className="min-w-0 flex-1 rounded border border-line bg-white px-1 py-1.5"
                onChange={event => setExistingChoice(event.target.value)}><option value="">Choose KPI…</option>{existingCandidates.map(node => <option key={node.id} value={node.id}>{node.name} ({node.unit})</option>)}</select>
              <Button type="button" size="sm" disabled={working || !existingChoice || draft.existingFactors.length >= INCOMING_KPI_LIMITS.existingReferences}
                onClick={() => { edit({ existingFactors: [...draft.existingFactors, { key: newIncomingKpiExistingKey(), nodeId: existingChoice, selected: true }] }); setExistingChoice(""); }}>Use</Button>
            </div>
          </div>
        </details>
        <details className="text-xs text-muted"><summary className="cursor-pointer">Details</summary>
          <div className="mt-2 space-y-2">
            <p>All inputs need values. Estimates are illustrative and preserve the current KPI; replace them with measured inputs when available. A uniquely derived input is not an independent measurement.</p>
            {selectedGroup ? <p>{selectedGroup.title}</p> : null}
            {sourceProposal ? <><p>{sourceProposal.rationale}</p>{[...(selectedGroup?.limitations ?? []), ...sourceProposal.limitations].map((limitation, index) => <p key={index}>{limitation}</p>)}</> :
              <><SmartKpiPreparationNotice reason={controller.admission.status === "unavailable" ? controller.admission.reason ?? statusReason : statusReason} />
                {"limitations" in state ? state.limitations?.map((limitation, index) => <p key={index}>{limitation}</p>) : null}</>}
            {history.length > 1 ? <label className="grid gap-1">Previous drafts<select aria-label="Previous drafts" className="w-full rounded border border-line bg-white p-1 text-ink" value={entry?.key ?? ""}
              onChange={event => setRetained(book.current.select(event.target.value))}>{history.map((saved, index) => <option key={saved.key} value={saved.key}>{index + 1}. {saved.input.draft.source.kind === "manual" ? "Manual" : saved.input.proposal?.groups.find(group => saved.input.draft.source.kind === "proposal" && group.id === saved.input.draft.source.groupId)?.title ?? "Prepared"}{saved.dirty ? " · Edited" : ""}</option>)}</select></label> : null}
            {controller.mutation?.undoBlockedReason ? <p>{controller.mutation.undoBlockedReason}</p> : null}
          </div>
        </details>
        </IncomingKpiFormulaField></div> : !canvasPreview ? <p role="status" className="text-xs text-muted">{controller.contextError ?? "Loading KPI context…"}</p> : null}
        {showDefinition && values?.result !== undefined && values.referenceValue !== undefined ? <p data-testid="incoming-kpi-balance" className={`text-[11px] tabular-nums ${values.issues.length ? "text-amber-800" : "text-muted"}`}>
          Current → calculated: {formatValue(values.referenceValue)} → {formatValue(values.result)} {input?.context.target.unit}
        </p> : null}
        {actionFeedback ? <p role="status" aria-live="polite" data-testid="smart-kpi-feedback" className="text-xs">{actionFeedback}</p> : null}
      </div>
      <div className={canvasPreview ? styles.footer : "flex shrink-0 flex-wrap items-center gap-2 border-t border-line px-3 py-2"}>
        {showDefinition ? <Button type="button" size="sm" variant="primary" className={canvasPreview ? styles.add : "w-full"} data-testid="smart-kpi-add-selected" disabled={!!addReason || !input} title={addReason}
          aria-describedby={canvasPreview && reusedCount > 0 ? "smart-kpi-add-counts" : undefined}
          icon={canvasPreview ? <Plus className="h-3.5 w-3.5" /> : undefined}
          onClick={() => { if (input && !addReason) runOwnedAction(() => { void controller.apply(input).then(result => { if (result?.ok) setAppliedInput(input); }); }); }}>{working ? "Saving…" : canvasPreview ? `Add ${selectedCount || "selected"} KPI${selectedCount === 1 ? "" : "s"}` : "Add & calculate"}</Button> : null}
        {canvasPreview && showDefinition && reusedCount > 0 ? <p id="smart-kpi-add-counts" data-testid="smart-kpi-add-counts" className={styles.note}>{newCount} new · {reusedCount} existing KPI{reusedCount === 1 ? "" : "s"} reused</p> : null}
        {!applied && latestAvailable ? <Button type="button" size="sm" disabled={working} onClick={() => reviewSource(proposal)}>Review latest</Button> : null}
        {stale && source?.kind === "manual" ? <Button type="button" size="sm" disabled={working || controller.contextPending} onClick={() => {
          if (entry && controller.latestContext) setRetained(book.current.save(entry, { ...entry.input, context: controller.latestContext,
            draft: { ...entry.input.draft, contextHash: controller.latestContext.contextHash, revision: entry.input.draft.revision + 1 } }));
          controller.refreshContext();
        }}>Refresh context</Button> : null}
        {!applied && source?.kind !== "manual" && (snapshot.stale || snapshot.refreshAvailable || executionStale || preparationMismatch) ? <Button type="button" size="sm" disabled={working || controller.admission.status === "preparing"} onClick={controller.refresh} icon={<RefreshCw className="h-3 w-3" />}>Refresh</Button> : null}
        {!preparing && !sourceProposal && state.status !== "preparing" && controller.admission.status !== "preparing" ? <Button type="button" size="sm" disabled={working || state.status === "blocked" || controller.admission.status === "blocked"}
          onClick={controller.retry}>{state.status === "idle" || state.status === "unavailable" ? "Prepare" : "Retry"}</Button> : null}
        {controller.mutation?.canUndo ? <Button type="button" size="sm" disabled={working} data-testid="smart-kpi-undo" onClick={() => runOwnedAction(() => { void controller.undo(); })}>Undo</Button> : null}
        {controller.mutation?.status === "reconciling" ? <Button type="button" size="sm" data-testid="smart-kpi-reconcile" disabled={controller.replaying}
          onClick={() => runOwnedAction(() => { void controller.reconcile(); })}>{controller.replaying ? "Reconciling…" : "Reconcile save"}</Button> : null}
      </div>
    </div>;
  return canvasPreview ? <SmartKpiCanvasPreview targetNodeId={active.targetNodeId} expanded={editing} reveal={active.reveal} revealKey={`${entry?.key ?? state.status}/${applied}`}>{content}</SmartKpiCanvasPreview> : createPortal(<>
    {placement && placement.bridge.width > 0 ? <div data-smart-kpi-bridge="true" className="nodrag nopan nowheel fixed z-[79]"
      style={{ left: placement.bridge.left, top: placement.bridge.top, width: placement.bridge.width, height: placement.bridge.height }}
      onPointerEnter={controller.enterPanel} onPointerLeave={controller.leavePanel} onPointerDown={stop} onWheel={stop} /> : null}
    {content}
  </>, document.body);
}
