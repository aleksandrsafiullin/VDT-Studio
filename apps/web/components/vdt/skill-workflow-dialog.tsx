"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { BookOpen, Check, Download, LoaderCircle, RefreshCw, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, TextArea, TextInput } from "@/components/ui/field";
import { downloadBinaryFile } from "@/lib/download";
import { resolveExecutionSettings } from "@/lib/execution-mode-resolver";
import { skillAuthorTimeoutMs } from "@/lib/skill-author-deadline";
import { getVdtSkillContext, skillContextRootKpi, skillRequest, skillsChanged, type SkillDocument, type VdtSkillContext } from "@/lib/skills-client";
import { applySkillChanges, skillWorkflowSourceKey, type SkillUpdateChange, type SkillUpdateProposal } from "@/lib/skill-workflow";
import { useVdtStudioStore } from "./vdt-store";
import styles from "./skill-workflow-dialog.module.css";

const UNIVERSAL_SKILL_ID = "generic.logical_kpi_decomposition";
const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
type Mode = "create" | "update";
type Busy = "create" | "update" | "save" | null;
interface NewDraft { key: string; raw: string; name: string; description: string; instructions: string; warnings: string[] }
interface UpdateDraft { key: string; proposal: SkillUpdateProposal; selected: string[] }
interface SkillAuthorPreparation { key: string; providerId: string; startedAt: number; timeoutMs: number }

/** Resolve once before asynchronous Context checks, so both the request and its
 * waiting message retain the same effective model, reasoning and budget. */
export function captureSkillAuthorRequest(settings: Parameters<typeof resolveExecutionSettings>[0], key: string) {
  const execution = resolveExecutionSettings(settings);
  const preparation: SkillAuthorPreparation = { key, providerId: execution.providerId, startedAt: Date.now(), timeoutMs: skillAuthorTimeoutMs(execution.providerId) };
  return { execution, preparation };
}

export function formatSkillAuthorElapsed(elapsedMs: number): string {
  const seconds = Number.isFinite(elapsedMs) ? Math.max(0, Math.floor(elapsedMs / 1000)) : 0;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function skillAuthorBudgetLabel(timeoutMs: number): string {
  const seconds = Math.ceil(timeoutMs / 1000);
  return seconds % 60 === 0 ? `${seconds / 60} ${seconds === 60 ? "minute" : "minutes"}` : `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
}

/** Observe elapsed wall time, including throttled/background intervals. This is
 * a display clock only: it never sets a client deadline or aborts a request. */
export function observeSkillAuthorElapsed(startedAt: number, onElapsed: (elapsedMs: number) => void): () => void {
  const tick = () => onElapsed(Math.max(0, Date.now() - startedAt));
  tick();
  const interval = setInterval(tick, 1000);
  return () => clearInterval(interval);
}

export function SkillAuthorWaiting({ operation, preparation, onCancel }: {
  operation: Mode; preparation: SkillAuthorPreparation; onCancel: () => void;
}) {
  const [elapsedMs, setElapsedMs] = useState(() => Math.max(0, Date.now() - preparation.startedAt));
  useEffect(() => observeSkillAuthorElapsed(preparation.startedAt, setElapsedMs), [preparation.startedAt]);
  return <div className={styles.waiting} data-testid="skill-author-waiting" data-provider-id={preparation.providerId}>
    <div className={styles.waitingMessage}>
      <div role="status"><span className={styles.pending}><LoaderCircle size={14} className="animate-spin" aria-hidden="true" />{operation === "create" ? "Preparing a reusable skill…" : "Comparing the tree and skill…"}</span><p>This can take up to {skillAuthorBudgetLabel(preparation.timeoutMs)}.</p></div>
      <span className={styles.elapsed} role="timer" aria-live="off">Elapsed {formatSkillAuthorElapsed(elapsedMs)}</span>
    </div>
    <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel preparation</Button>
  </div>;
}

export function skillContextIdentity(context: VdtSkillContext | undefined): string {
  return JSON.stringify([context?.skill?.id ?? null, context?.skill?.version ?? null,
    context?.skill?.contentHash ?? null, context?.selection?.revision ?? null, Boolean(context?.needsReselection)]);
}

/** Refresh the parent before rejecting a stale pin so retry can use the new
 * Context. This also checks a previously empty/unresolved Context. */
export async function revalidateSkillWorkflowContext(input: {
  projectId: string; vdtId: string; rootKpi: string;
  context: VdtSkillContext | undefined; stillCurrent: () => boolean;
}): Promise<VdtSkillContext> {
  const fresh = await getVdtSkillContext(input.projectId, input.vdtId, input.rootKpi);
  if (!input.stillCurrent()) throw new Error("The tree changed. Prepare the draft again from the current Context.");
  if (skillContextIdentity(fresh) !== skillContextIdentity(input.context)) {
    skillsChanged();
    throw new Error("The selected skill changed. Context is refreshing; prepare the draft again after it updates.");
  }
  return fresh;
}

function scalar(raw: string, key: string): string {
  const value = raw.match(new RegExp(`^${key}:\\s*(.*)$`, "m"))?.[1]?.trim() ?? "";
  try { const parsed = JSON.parse(value); return typeof parsed === "string" ? parsed : value; } catch { return value; }
}

export function skillDraftInstructions(raw: string): string {
  const match = raw.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) throw new Error("The draft needs skill metadata. Prepare the draft again.");
  return match[1]!.replace(/^\r?\n/, "");
}

/** Export a distinct portable identity; an authored user.draft ID is never reused. */
export function newSkillWorkingMarkdown(raw: string, name: string, description: string, instructions: string): string {
  const title = name.trim(), summary = description.trim();
  if (!title || title.length > 120 || /[\r\n]/.test(title)) throw new Error("Enter a skill name of 1–120 characters.");
  if (!summary || summary.length > 600 || /[\r\n]/.test(summary)) throw new Error("Enter a description of 1–600 characters.");
  if (instructions.trim().length < 20) throw new Error("Add the instructions to reuse with future trees.");
  const header = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!header) throw new Error("The draft needs skill metadata. Prepare the draft again.");
  const slug = title.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N} _-]/gu, "").trim().replace(/[\s_]+/g, "-").slice(0, 60);
  if (!slug) throw new Error("Use letters or numbers in the skill name.");
  const retained = header[1]!.replace(/^(?:id|version|name|title|description):[^\r\n]*(?:\r?\n|$)/gm, "").trim();
  const result = `---\nname: ${JSON.stringify(slug)}\ntitle: ${JSON.stringify(title)}\ndescription: ${JSON.stringify(summary)}\n${retained ? `${retained}\n` : ""}---\n\n${instructions.trim()}\n`;
  if (new TextEncoder().encode(result).length > 128 * 1024) throw new Error("A skill must be at most 128 KiB.");
  return result;
}

export function SkillWorkflowChoices({ mode, canUpdate, onModeChange }: { mode: Mode; canUpdate: boolean; onModeChange: (mode: Mode) => void }) {
  return <div className={styles.choices} role="group" aria-label="Skill operation">
    <Button type="button" size="sm" variant={mode === "create" ? "primary" : "secondary"} aria-pressed={mode === "create"} onClick={() => onModeChange("create")} icon={<Sparkles size={14} />}>Save as new skill</Button>
    <Button type="button" size="sm" variant={mode === "update" ? "primary" : "secondary"} aria-pressed={mode === "update"} disabled={!canUpdate} onClick={() => onModeChange("update")} icon={<RefreshCw size={14} />}>Update used skill</Button>
  </div>;
}

export function SkillChangeReview({ change, selected, disabled, nodes, onSelected, onEdit, onViewNode }: {
  change: SkillUpdateChange; selected: boolean; disabled: boolean; nodes: { id: string; name: string }[];
  onSelected: (selected: boolean) => void; onEdit: (after: string) => void; onViewNode: (nodeId: string) => void;
}) {
  return <article className={styles.change} data-testid="skill-change" data-change-id={change.id}>
    <label className={styles.changeHeading}><input type="checkbox" checked={selected} disabled={disabled} onChange={event => onSelected(event.target.checked)} /><strong>{change.title}</strong><span>{change.kind === "topology" ? "Tree formulas" : change.kind}</span></label>
    <p className={styles.help}>{change.reason}</p>
    {change.nodeIds.length ? <div className={styles.nodeLinks} aria-label="Source tree nodes">{change.nodeIds.map(id => <button key={id} type="button" disabled={disabled} onClick={() => onViewNode(id)} title="View this node in the tree">{nodes.find(node => node.id === id)?.name ?? id}</button>)}</div> : null}
    <div className={styles.comparison}>
      <div><span className={styles.fieldLabel}>Current passage</span><pre>{change.before || "New instruction"}</pre></div>
      <Field label="Proposed passage"><TextArea aria-label={`Proposed passage: ${change.title}`} className={styles.passage} rows={5} value={change.after} maxLength={28_000} disabled={disabled || !selected} readOnly={change.kind === "topology"} onChange={event => onEdit(event.target.value)} /></Field>
    </div>
    {change.kind === "topology" ? <p className={styles.help}>Prepared from the tree’s validated formulas. Choose whether to include this change.</p> : null}
  </article>;
}

interface SkillWorkflowDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context?: VdtSkillContext | undefined;
  triggerRef?: RefObject<HTMLButtonElement | null>;
  onOpenLibrary: () => void;
}

export function SkillWorkflowDialog({ open, onOpenChange, context, triggerRef, onOpenLibrary }: SkillWorkflowDialogProps) {
  const project = useVdtStudioStore(state => state.project);
  const workspace = useVdtStudioStore(state => state.workspace);
  const generating = useVdtStudioStore(state => state.isGenerating);
  const [mode, setMode] = useState<Mode>("create");
  const [creation, setCreation] = useState<NewDraft>();
  const [update, setUpdate] = useState<UpdateDraft>();
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [knownSourceKey, setKnownSourceKey] = useState<string>();
  const [preparation, setPreparation] = useState<SkillAuthorPreparation>();
  const dialogRef = useRef<HTMLDivElement>(null), mounted = useRef(true);
  const controllerRef = useRef<AbortController | null>(null), sequenceRef = useRef(0), busyRef = useRef<Busy>(null);
  const contextRef = useRef(context); contextRef.current = context;
  const openRef = useRef(open); openRef.current = open;
  const titleId = useId(), descriptionId = useId();
  const scope = `${workspace.activeProjectId ?? ""}/${workspace.activeVdtId ?? ""}`;
  const source = useMemo(() => { try { return { key: skillWorkflowSourceKey(project), error: undefined }; } catch (failure) { return { key: "", error: failure instanceof Error ? failure.message : "This tree cannot become a skill yet." }; } }, [project]);
  const key = `${scope}:${source.key}:${skillContextIdentity(context)}`;
  const currentKeyRef = useRef(key); currentKeyRef.current = key;
  const selectedSkill = context?.skill;
  const universal = selectedSkill?.id === UNIVERSAL_SKILL_ID;
  const canUpdate = Boolean(selectedSkill && context?.selection && !context.needsReselection && !universal);
  const activeDraftKey = mode === "create" ? creation?.key : update?.key;
  const stale = Boolean(activeDraftKey && (activeDraftKey !== key || knownSourceKey && knownSourceKey !== key));
  const locked = Boolean(busy || generating);
  const canPrepare = Boolean(workspace.activeProjectId && workspace.activeVdtId && !source.error && !locked && (mode === "create" || canUpdate));

  const newMarkdown = useMemo(() => {
    if (!creation) return { raw: "", error: undefined };
    try { return { raw: newSkillWorkingMarkdown(creation.raw, creation.name, creation.description, creation.instructions), error: undefined }; }
    catch (failure) { return { raw: "", error: failure instanceof Error ? failure.message : "Review the new skill." }; }
  }, [creation]);
  const accepted = useMemo(() => {
    if (!update) return { raw: "", count: 0, error: undefined };
    const changes = update.proposal.changes.filter(change => update.selected.includes(change.id));
    try { return { raw: applySkillChanges(update.proposal.raw, changes), count: changes.length, error: undefined }; }
    catch (failure) { return { raw: "", count: changes.length, error: failure instanceof Error ? failure.message : "Review the proposed changes." }; }
  }, [update]);

  const stopPreparation = useCallback(() => {
    if (busyRef.current === "save") return;
    sequenceRef.current++; controllerRef.current?.abort(); controllerRef.current = null; busyRef.current = null; setBusy(null); setPreparation(undefined);
  }, []);
  const close = useCallback(() => {
    if (busyRef.current === "save") return;
    stopPreparation(); onOpenChange(false);
    requestAnimationFrame(() => triggerRef?.current?.focus());
  }, [onOpenChange, stopPreparation, triggerRef]);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controllerRef.current?.abort(); }; }, []);
  useEffect(() => {
    if (knownSourceKey && knownSourceKey !== key && busyRef.current !== "save") {
      if (busyRef.current) setNotice("The tree or selected skill changed. Prepare the draft again from the current Context.");
      stopPreparation();
    }
  }, [key, knownSourceKey, stopPreparation]);
  useEffect(() => { if (!open && busyRef.current !== "save") stopPreparation(); }, [open, stopPreparation]);
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus());
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const items = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(item => item.offsetParent !== null || item === document.activeElement);
      const first = items[0], last = items[items.length - 1];
      if (!first || !last) { event.preventDefault(); dialogRef.current.focus(); }
      else if (event.shiftKey && (document.activeElement === first || !dialogRef.current.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKey);
    return () => { cancelAnimationFrame(focusFrame); document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", handleKey); };
  }, [open, close]);

  const perform = async (operation: Exclude<Busy, null>, task: (signal: AbortSignal, stillCurrent: () => boolean) => Promise<void>) => {
    if (busyRef.current || generating) return;
    const capturedKey = currentKeyRef.current, sequence = ++sequenceRef.current, controller = new AbortController();
    controllerRef.current = controller; busyRef.current = operation; setBusy(operation); setPreparation(undefined); setError(undefined); setNotice(undefined); setKnownSourceKey(capturedKey);
    const stillCurrent = () => {
      if (!mounted.current || !openRef.current || controller.signal.aborted || sequenceRef.current !== sequence || currentKeyRef.current !== capturedKey) return false;
      const live = useVdtStudioStore.getState();
      try {
        return `${live.workspace.activeProjectId ?? ""}/${live.workspace.activeVdtId ?? ""}:${skillWorkflowSourceKey(live.project)}:${skillContextIdentity(contextRef.current)}` === capturedKey;
      } catch { return false; }
    };
    try { await task(controller.signal, stillCurrent); }
    catch (failure) {
      if (mounted.current && sequenceRef.current === sequence && !controller.signal.aborted) setError(failure instanceof Error ? failure.message : "The skill operation could not complete. Your draft is still here.");
    } finally {
      if (sequenceRef.current === sequence) { controllerRef.current = null; busyRef.current = null; if (mounted.current) { setBusy(null); setPreparation(undefined); } }
    }
  };

  const checkSelection = async (stillCurrent: () => boolean) => {
    const state = useVdtStudioStore.getState(), currentContext = contextRef.current;
    if (!state.workspace.activeProjectId || !state.workspace.activeVdtId) throw new Error("Open a tree to work with its skill.");
    return revalidateSkillWorkflowContext({ projectId: state.workspace.activeProjectId, vdtId: state.workspace.activeVdtId,
      rootKpi: skillContextRootKpi(state.project, state.brief.rootKpi), context: currentContext, stillCurrent });
  };

  const prepare = () => perform(mode, async (signal, stillCurrent) => {
    const capturedKey = currentKeyRef.current, state = useVdtStudioStore.getState();
    const captured = captureSkillAuthorRequest(state.executionSettings, capturedKey), execution = captured.execution;
    setPreparation(captured.preparation);
    const fresh = await checkSelection(stillCurrent);
    if (!stillCurrent()) return;
    const input = { projectId: state.workspace.activeProjectId, vdtId: state.workspace.activeVdtId,
      project: { ...state.project, versions: [], scenarios: [], dataSources: [] },
      providerId: execution.providerId, providerConfig: execution.providerConfig ?? {}, ...(feedback.trim() ? { feedback: feedback.trim() } : {}) };
    if (mode === "create") {
      const result = await skillRequest<{ raw: string; warnings: string[] }>("/api/skills/from-vdt", input, signal);
      if (stillCurrent()) setCreation({ key: capturedKey, raw: result.raw, name: scalar(result.raw, "title") || scalar(result.raw, "name"), description: scalar(result.raw, "description"), instructions: skillDraftInstructions(result.raw), warnings: result.warnings });
    } else {
      if (!fresh?.skill || !fresh.selection || fresh.skill.id === UNIVERSAL_SKILL_ID) throw new Error("Choose a thematic skill in Context before preparing an update.");
      const result = await skillRequest<{ proposal: SkillUpdateProposal }>("/api/skills/update-from-vdt", { ...input,
        base: { id: fresh.skill.id, version: fresh.skill.version, contentHash: fresh.skill.contentHash }, selectionRevision: fresh.selection.revision }, signal);
      if (stillCurrent()) setUpdate({ key: capturedKey, proposal: result.proposal, selected: result.proposal.changes.map(change => change.id) });
    }
  });

  const save = () => perform("save", async (signal, stillCurrent) => {
    if (stale) throw new Error("The tree or selected skill changed. Prepare a new draft before saving.");
    const state = useVdtStudioStore.getState();
    await checkSelection(stillCurrent);
    if (!stillCurrent()) return;
    const rootKpi = state.project.graph.nodes.find(node => node.id === state.project.rootNodeId)?.name ?? state.project.name;
    if (mode === "create") {
      if (!creation || newMarkdown.error) throw new Error(newMarkdown.error ?? "Prepare a new skill first.");
      const result = await skillRequest<{ skill: SkillDocument }>("/api/skills", { raw: newMarkdown.raw,
        sourceVdt: { projectId: state.workspace.activeProjectId, vdtId: state.workspace.activeVdtId, rootKpi } }, signal);
      skillsChanged();
      if (stillCurrent()) { setCreation(undefined); setNotice(`Saved “${result.skill.title}” to the skill library.`); }
    } else {
      if (!update || accepted.error || !accepted.count) throw new Error(accepted.error ?? "Choose at least one change to save.");
      const result = await skillRequest<{ skill: SkillDocument }>("/api/skills/update", { projectId: state.workspace.activeProjectId, vdtId: state.workspace.activeVdtId, target: update.proposal.target, raw: accepted.raw }, signal);
      skillsChanged();
      if (stillCurrent()) { setUpdate(undefined); setNotice(`Saved “${result.skill.title}” as version ${result.skill.version}. This tree keeps its selected version.`); }
    }
  });

  const editChange = (id: string, after: string) => setUpdate(current => current ? { ...current, proposal: { ...current.proposal,
    changes: current.proposal.changes.map(change => change.id === id && change.kind !== "topology" ? { ...change, after,
      kind: change.before ? after ? "replace" : "remove" : "add" } : change) } } : current);
  const warnings = mode === "create" ? creation?.warnings : update?.proposal.warnings;
  if (!open || typeof document === "undefined") return null;

  return createPortal(<div className={styles.overlay}>
    <div className={styles.backdrop} aria-hidden="true" onClick={close} />
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={-1} className={styles.dialog} data-testid="skill-workflow-dialog">
      <header className={styles.header}><div><div className={styles.eyebrow}><BookOpen size={15} /> Reusable modelling guidance</div><h2 id={titleId}>Work with skills</h2><p id={descriptionId}>Turn this tree into guidance for future trees, or propose improvements to its selected skill.</p></div><Button type="button" size="icon" variant="ghost" aria-label="Close skill workflow" disabled={busy === "save"} icon={<X size={18} />} onClick={close} /></header>
      <div className={styles.content}>
        <SkillWorkflowChoices mode={mode} canUpdate={canUpdate && !locked} onModeChange={next => { if (!locked) { setMode(next); setError(undefined); setNotice(undefined); } }} />
        <div className={styles.context}><strong>{project.graph.nodes.find(node => node.id === project.rootNodeId)?.name ?? project.name}</strong><span>{selectedSkill ? `${selectedSkill.title} · selected v${selectedSkill.version}` : "No skill selected"}</span></div>
        {universal ? <p className={styles.info}>This tree uses the universal skill. Save a new thematic skill to reuse what you developed for this topic.</p> : !canUpdate ? <p className={styles.help}>A thematic skill selected in Context is needed to prepare an update.</p> : null}
        {source.error ? <p className={styles.info}>{source.error}</p> : null}
        {generating ? <p className={styles.info}>Wait for the tree’s current agent run to finish before preparing or saving a skill.</p> : null}
        {stale ? <p className={styles.info} role="alert">The tree or selected skill changed after this draft was prepared. Your edits are retained; prepare it again before saving.</p> : null}
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {notice ? <p className={styles.notice} role="status"><Check size={15} />{notice}</p> : null}
        <Field label="Authoring notes" hint="Optional: explain which modelling lessons or changes should be included."><TextArea aria-label="Skill authoring notes" rows={2} value={feedback} maxLength={4000} disabled={locked} onChange={event => setFeedback(event.target.value)} /></Field>
        <div className={styles.prepare}><Button type="button" size="sm" disabled={!canPrepare} onClick={() => { void prepare(); }} icon={<Sparkles size={14} />}>{mode === "create" ? creation ? "Prepare new draft again" : "Prepare new skill" : update ? "Compare again" : "Compare tree with skill"}</Button></div>
        {(busy === "create" || busy === "update") && preparation && preparation.key === key ? <SkillAuthorWaiting operation={busy} preparation={preparation} onCancel={stopPreparation} /> : null}
        {warnings?.length ? <ul className={styles.warnings}>{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul> : null}
        {mode === "create" && creation ? <section className={styles.review} aria-label="New skill review">
          <div className={styles.reviewHeading}><h3>Review the new skill</h3><span>Unsaved draft</span></div>
          <div className={styles.metadata}><Field label="Skill name"><TextInput aria-label="New skill name" value={creation.name} maxLength={120} disabled={locked} onChange={event => setCreation({ ...creation, name: event.target.value })} /></Field><Field label="Description"><TextInput aria-label="New skill description" value={creation.description} maxLength={600} disabled={locked} onChange={event => setCreation({ ...creation, description: event.target.value })} /></Field></div>
          <Field label="Skill instructions" hint="Review the scope, assumptions, formulas and checks before reusing this method."><TextArea aria-label="New skill instructions" className={styles.instructions} rows={15} maxLength={120_000} value={creation.instructions} disabled={locked} onChange={event => setCreation({ ...creation, instructions: event.target.value })} /></Field>
          {newMarkdown.error ? <p className={styles.error} role="alert">{newMarkdown.error}</p> : <details className={styles.preview}><summary>Preview SKILL.md</summary><pre>{newMarkdown.raw}</pre></details>}
        </section> : null}
        {mode === "update" && update ? <section className={styles.review} aria-label="Skill update review">
          <div className={styles.reviewHeading}><h3>Review proposed changes</h3><span>{accepted.count} selected</span></div>
          <p className={styles.help}>{update.proposal.summary}</p>
          <p className={styles.help}>Compared selected v{update.proposal.target.baseVersion} with the current skill v{update.proposal.target.version}. Only the selected changes will be saved.</p>
          {update.proposal.changes.length ? <div className={styles.selectionActions}><Button type="button" size="sm" variant="ghost" disabled={locked} onClick={() => setUpdate({ ...update, selected: update.proposal.changes.map(change => change.id) })}>Select all</Button><Button type="button" size="sm" variant="ghost" disabled={locked} onClick={() => setUpdate({ ...update, selected: [] })}>Clear selection</Button></div> : <p className={styles.info}>No reusable changes were proposed for this tree.</p>}
          {update.proposal.changes.map(change => <SkillChangeReview key={change.id} change={change} selected={update.selected.includes(change.id)} disabled={locked} nodes={project.graph.nodes} onSelected={selected => setUpdate(current => current ? { ...current, selected: selected ? [...current.selected.filter(id => id !== change.id), change.id] : current.selected.filter(id => id !== change.id) } : current)} onEdit={after => editChange(change.id, after)} onViewNode={nodeId => { useVdtStudioStore.getState().selectNode(nodeId); setNotice(`Selected “${project.graph.nodes.find(node => node.id === nodeId)?.name ?? nodeId}” in the tree. Your review remains open.`); }} />)}
          {accepted.error ? <p className={styles.error} role="alert">{accepted.error}</p> : <details className={styles.preview}><summary>Preview skill with selected changes</summary><pre>{accepted.raw}</pre></details>}
        </section> : null}
      </div>
      <footer className={styles.footer}>
        <Button type="button" size="sm" variant="ghost" disabled={locked} icon={<BookOpen size={14} />} onClick={() => { close(); onOpenLibrary(); }}>Skill library</Button>
        <div className={styles.footerActions}>
          {mode === "create" && creation ? <Button type="button" size="sm" disabled={locked || stale || Boolean(newMarkdown.error)} icon={<Download size={14} />} onClick={() => { try { downloadBinaryFile("SKILL.md", new TextEncoder().encode(newMarkdown.raw), "text/markdown;charset=utf-8"); setNotice("Downloaded SKILL.md. The library is unchanged."); } catch (failure) { setError(failure instanceof Error ? failure.message : "The skill could not be downloaded."); } }}>Download SKILL.md</Button> : null}
          <Button type="button" size="sm" variant="primary" disabled={locked || stale || (mode === "create" ? !creation || Boolean(newMarkdown.error) : !update || Boolean(accepted.error) || !accepted.count)} icon={busy === "save" ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} />} onClick={() => { void save(); }}>{busy === "save" ? "Saving…" : mode === "create" ? "Save to library" : "Save selected changes"}</Button>
        </div>
      </footer>
    </div>
  </div>, document.body);
}
