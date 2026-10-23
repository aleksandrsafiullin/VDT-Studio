"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FolderOpen, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProjectFilesPanel, type FileLibraryVdt } from "./project-files-panel";
import { useVdtStudioStore } from "./vdt-store";

export function VdtFilesButton() {
  const workspace = useVdtStudioStore((state) => state.workspace);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const summary = workspace.projectSummaries.find((entry) => entry.project.id === workspace.activeProjectId);
  const vdtId = workspace.activeVdtId;
  if (!summary || !vdtId) return null;
  return (
    <>
      <Button size="sm" icon={<FolderOpen className="h-4 w-4" />} aria-label="Open VDT files" aria-haspopup="dialog" aria-expanded={open} data-testid="open-vdt-files" onClick={() => setOpen(true)}><span className="hidden sm:inline">Files</span></Button>
      {open ? <ProjectFilesDialog key={`${summary.project.id}:${vdtId}`} projectId={summary.project.id} vdtId={vdtId} vdts={summary.vdts.map((entry) => ({ id: entry.vdt.id, name: entry.vdt.name }))} onClose={close} /> : null}
    </>
  );
}

function ProjectFilesDialog({ projectId, vdtId, vdts, onClose }: { projectId: string; vdtId: string; vdts: FileLibraryVdt[]; onClose: () => void }) {
  const dialog = useRef<HTMLElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    function keyDown(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialog.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]):not([tabindex="-1"]), select:not([disabled]), [tabindex="0"]') ?? []);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", keyDown);
    return () => { document.removeEventListener("keydown", keyDown); document.body.style.overflow = previousOverflow; previousFocus?.focus(); };
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/30 p-2 sm:p-6">
      <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="flex max-h-[92dvh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-xl outline-none" data-testid="vdt-files-dialog">
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-4"><h2 id={titleId} className="text-base font-semibold text-ink">Files · {vdts.find((entry) => entry.id === vdtId)?.name}</h2><Button size="icon" variant="ghost" aria-label="Close VDT files" icon={<X className="h-4 w-4" />} onClick={onClose} /></header>
        <div className="min-h-0 overflow-y-auto p-4 sm:p-5"><ProjectFilesPanel projectId={projectId} vdts={vdts} vdtId={vdtId} /></div>
      </section>
    </div>, document.body
  );
}
