"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Clock3, History, Pencil, Plus, RotateCcw, Undo2, X } from "lucide-react";
import { listVersions, MAX_VERSION_SNAPSHOTS } from "@vdt-studio/vdt-core";
import { Button } from "@/components/ui/button";
import { canUndoVersionRestore, useVdtStudioStore } from "./vdt-store";
import { VdtComparisonPanel } from "./vdt-comparison-panel";
import { formatVersionDate, versionDisplayName } from "./version-presentation";

export function VersionHistoryPanel() {
  const project = useVdtStudioStore((state) => state.project);
  const restoreVersion = useVdtStudioStore((state) => state.restoreVersionSnapshot);
  const undoRestore = useVdtStudioStore((state) => state.undoVersionRestore);
  const saveVersion = useVdtStudioStore((state) => state.saveVersionSnapshot);
  const renameVersion = useVdtStudioStore((state) => state.renameVersionSnapshot);
  const selectNode = useVdtStudioStore((state) => state.selectNode);
  const pendingChangeSet = useVdtStudioStore((state) => state.pendingChangeSet);
  const undo = useVdtStudioStore((state) => state.versionRestoreUndo);
  const canUndo = useVdtStudioStore(canUndoVersionRestore);
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [editing, setEditing] = useState<"save" | "rename">();
  const [name, setName] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const versions = listVersions(project);
  const selected = versions.find((version) => version.id === selectedId) ?? versions[0];

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open]);

  useEffect(() => { if (editing) nameRef.current?.focus(); }, [editing]);

  function close() {
    setOpen(false);
    setConfirmRestore(false);
    setEditing(undefined);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function handleUndo() {
    if (undoRestore()) {
      setNotice("Restoration undone. Your previous state has been restored.");
      setError("");
      requestAnimationFrame(() => {
        if (open) dialogRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
        else triggerRef.current?.focus();
      });
    }
  }

  const undoFeedback = canUndo && undo ? (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3" role="status" data-testid="version-restore-feedback">
      <div className="min-w-0 text-xs leading-5 text-blue-900">
        <p className="font-semibold">Restored “{undo.restoredVersionName}”</p>
        <p>Your previous state was saved as a separate version.</p>
      </div>
      <Button ref={undoRef} size="sm" onClick={handleUndo} icon={<Undo2 className="h-3.5 w-3.5" />} data-testid="undo-version-restore">Undo restore</Button>
    </div>
  ) : null;

  const content = (
    <dialog
      ref={dialogRef}
      className="fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-none w-[min(100vw,64rem)] max-w-none overflow-hidden border-0 bg-white p-0 text-ink shadow-2xl backdrop:bg-slate-900/25"
      aria-labelledby="versions-title"
      aria-describedby="versions-description"
      data-testid="version-history-panel"
      onClose={close}
      onCancel={(event) => { if (confirmRestore) { event.preventDefault(); setConfirmRestore(false); } }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
      }}
    >
      <div className="flex h-full flex-col">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 id="versions-title" className="flex items-center gap-2 text-base font-semibold"><History className="h-4 w-4 text-accent" />Versions</h2>
            <p id="versions-description" className="mt-1 text-xs leading-5 text-muted">Save milestones, compare changes and return to previous versions.</p>
          </div>
          <Button size="icon" variant="ghost" onClick={close} aria-label="Close versions"><X className="h-4 w-4" /></Button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <aside className="max-h-52 w-full shrink-0 overflow-y-auto border-b border-line bg-slate-50/70 p-4 md:max-h-none md:w-64 md:border-b-0 md:border-r" aria-label="Saved versions">
            <div className="mb-3 rounded-lg border border-blue-100 bg-blue-50/70 px-3 py-2.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-blue-900"><span className="h-1.5 w-1.5 rounded-full bg-accent" />Current tree</div>
              <p className="mt-1 text-[11px] leading-4 text-muted">Working state for comparison</p>
            </div>
            <Button className="mb-4 w-full" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => { setEditing("save"); setName(""); setConfirmRestore(false); }}>Save version</Button>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Saved: {versions.length}</div>
            {versions.length ? <ol className="space-y-2">
              {versions.map((version) => <li key={version.id}>
                <button
                  className={`w-full rounded-lg border px-3 py-3 text-left transition focus-visible:outline focus-visible:outline-accent ${selected?.id === version.id ? "border-blue-200 bg-white shadow-sm" : "border-transparent hover:border-line hover:bg-white"}`}
                  aria-pressed={selected?.id === version.id}
                  onClick={() => { setSelectedId(version.id); setConfirmRestore(false); setEditing(undefined); setError(""); }}
                  data-testid={`version-history-row-${version.id}`}
                >
                  <div className="flex items-start justify-between gap-2"><span className="break-words text-xs font-medium leading-5">{versionDisplayName(version)}</span>{selected?.id === version.id ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" /> : null}</div>
                  <div className="mt-1 flex items-center gap-1 text-[10px] text-muted"><Clock3 className="h-3 w-3 shrink-0" />{formatVersionDate(version.createdAt)}</div>
                </button>
              </li>)}
            </ol> : <p className="text-xs leading-5 text-muted">No versions yet. Save the current tree to compare future changes.</p>}
            <p className="mt-4 text-[10px] leading-4 text-muted">The latest {MAX_VERSION_SNAPSHOTS} versions are kept, including backups. A version is saved automatically before you apply prepared changes.</p>
          </aside>
          <section className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 sm:p-6" aria-label="Comparison with the current tree">
            <div className="space-y-5">
              {open ? undoFeedback : null}
              {notice ? <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-graphite" role="status">{notice}</p> : null}
              {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800" role="alert">{error}</p> : null}
              {editing ? <form className="rounded-xl border border-blue-200 bg-blue-50/30 p-4" onSubmit={(event) => {
                event.preventDefault();
                if (!name.trim()) return;
                if (editing === "save") {
                  const versionId = saveVersion(name);
                  if (versionId) { setSelectedId(versionId); setNotice("The current tree was saved as a separate version."); }
                } else if (selected) { renameVersion(selected.id, name); setNotice("Version name saved."); }
                setEditing(undefined);
              }}>
                <label className="block text-xs font-medium" htmlFor="version-name">{editing === "save" ? "New version name" : "Version name"}</label>
                <input ref={nameRef} id="version-name" className="mt-2 w-full rounded-md border border-line bg-white px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-blue-100" maxLength={160} value={name} onChange={(event) => setName(event.target.value)} placeholder="For example: Model for review" required />
                <div className="mt-3 flex gap-2"><Button variant="primary" size="sm" type="submit" disabled={!name.trim()}>Save</Button><Button size="sm" type="button" variant="ghost" onClick={() => setEditing(undefined)}>Cancel</Button></div>
              </form> : null}
              {selected ? <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1"><div className="text-[11px] uppercase tracking-wide text-muted">Selected version</div><h3 className="mt-1 break-words text-base font-semibold">{versionDisplayName(selected)}</h3><p className="mt-1 text-xs text-muted">{formatVersionDate(selected.createdAt)}</p></div>
                  <Button size="icon" variant="ghost" aria-label="Rename version" onClick={() => { setName(versionDisplayName(selected)); setEditing("rename"); setConfirmRestore(false); }}><Pencil className="h-3.5 w-3.5" /></Button>
                </div>
                <div className="rounded-xl border border-line bg-slate-50/50 p-3">
                  {confirmRestore ? <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4" role="group" aria-label="Confirm restoration">
                    <p className="text-sm font-semibold">Restore “{versionDisplayName(selected)}”?</p>
                    <p className="mt-2 text-xs leading-5 text-graphite">The tree, scenarios and data mappings will return to this version. Your current state will be saved first, so you can undo the restore.</p>
                    {pendingChangeSet ? <p className="mt-2 text-xs text-muted">The unapplied change preview will be closed.</p> : null}
                    <div className="mt-4 flex flex-wrap gap-2"><Button variant="primary" size="sm" data-testid="confirm-version-restore" onClick={() => {
                      if (restoreVersion(selected.id)) { setSelectedId(selected.id); setNotice(""); setError(""); setConfirmRestore(false); requestAnimationFrame(() => undoRef.current?.focus()); }
                      else setError(useVdtStudioStore.getState().aiActionError ?? "Could not restore this version.");
                    }}>Save current state and restore</Button><Button size="sm" onClick={() => setConfirmRestore(false)}>Cancel</Button></div>
                  </div> : <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="max-w-xs text-xs leading-5 text-muted">Your current state will be saved before restoring. Undo is available until you make further model changes.</p>
                    <Button size="sm" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => { setConfirmRestore(true); setEditing(undefined); }} data-testid={`version-restore-${selected.id}`}>Restore this version</Button>
                  </div>}
                </div>
                <VdtComparisonPanel before={selected.projectSnapshot} current={project} onSelectNode={(nodeId) => { selectNode(nodeId); close(); }} />
              </> : <div className="py-12 text-center"><History className="mx-auto h-8 w-8 text-slate-300" /><h3 className="mt-4 text-sm font-semibold">Save your first milestone</h3><p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-muted">Save a version of the current tree. After further edits, a before → after comparison will appear here.</p></div>}
            </div>
          </section>
        </div>
      </div>
    </dialog>
  );

  return <>
    <Button ref={triggerRef} size="sm" aria-haspopup="dialog" aria-expanded={open} aria-label={`Versions: ${versions.length}`} title="Versions: save, compare and restore" data-testid="version-history-button" icon={<History className="h-4 w-4" />} onClick={() => { setSelectedId(versions[0]?.id); setOpen(true); setNotice(""); setError(""); }}>
      <span>Versions</span>
      {versions.length > 0 ? <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] leading-none text-graphite" data-testid="version-history-count">{versions.length}</span> : null}
    </Button>
    {typeof document !== "undefined" ? createPortal(content, document.body) : null}
    {!open && undoFeedback ? <div className="fixed bottom-5 right-5 z-40 max-w-[calc(100vw-2.5rem)] shadow-lg">{undoFeedback}</div> : null}
  </>;
}
