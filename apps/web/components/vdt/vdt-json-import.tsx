"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { readPortableVdt } from "./vdt-json-import-file";
import { useVdtStudioStore, type VdtStudioState } from "./vdt-store";

interface ImportProps {
  projectId: string;
  projectName: string;
  disabled?: boolean | undefined;
}

type Candidate = Awaited<ReturnType<typeof readPortableVdt>> & { fileName: string };

export function VdtJsonImport(props: ImportProps) {
  return <ProjectImport key={props.projectId} {...props} />;
}

function ProjectImport({ projectId, projectName, disabled }: ImportProps) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button ref={trigger} type="button" variant="secondary" className="rounded-full px-5"
        data-testid="import-vdt-json" disabled={disabled} aria-haspopup="dialog"
        icon={<Upload className="h-4 w-4" />} onClick={() => setOpen(true)}>
        Import JSON
      </Button>
      {open ? <ImportDialog projectId={projectId} projectName={projectName} disabled={disabled} onClose={() => {
        setOpen(false);
        // Restore focus after the native modal is removed.
        requestAnimationFrame(() => trigger.current?.focus());
      }} /> : null}
    </>
  );
}

function ImportDialog({ projectId, projectName, disabled, onClose }: ImportProps & { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [candidate, setCandidate] = useState<Candidate>();
  const [reading, setReading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>();
  const pendingRead = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const submitting = useRef(false);
  const submittedCandidate = useRef<Candidate | undefined>(undefined);
  const workspace = useVdtStudioStore((state) => state.workspace);

  useEffect(() => {
    mounted.current = true;
    const element = dialog.current;
    element?.showModal();
    return () => {
      mounted.current = false;
      pendingRead.current?.abort();
      element?.close();
    };
  }, []);

  function currentProject(state = useVdtStudioStore.getState().workspace): boolean {
    return state.activePanel === "project" && state.activeProjectId === projectId;
  }

  function canSubmit(state: VdtStudioState["workspace"]): boolean {
    if (!candidate || reading || !currentProject(state) || state.isMutating || state.isLoading) return false;
    const pending = state.pendingVdtCreate;
    if (!pending) return !disabled;
    return candidate === submittedCandidate.current && pending.projectId === projectId && pending.source?.kind === "import" &&
      JSON.stringify(pending.input.project) === JSON.stringify(candidate.project);
  }

  function close() {
    if (submitting.current) return;
    pendingRead.current?.abort();
    onClose();
  }

  async function selectFile(file: File) {
    if (disabled || submitting.current || useVdtStudioStore.getState().workspace.pendingVdtCreate) return;
    pendingRead.current?.abort();
    const read = new AbortController();
    pendingRead.current = read;
    setCandidate(undefined);
    setError(undefined);
    setReading(true);
    try {
      const parsed = await readPortableVdt(file, read.signal);
      if (!read.signal.aborted && currentProject()) setCandidate({ ...parsed, fileName: file.name });
    } catch (caught) {
      if (!read.signal.aborted && currentProject()) {
        setError(caught instanceof Error ? caught.message : "The VDT JSON could not be read.");
      }
    } finally {
      if (pendingRead.current === read && !read.signal.aborted) {
        pendingRead.current = null;
        setReading(false);
      }
    }
  }

  async function create() {
    const state = useVdtStudioStore.getState();
    if (!candidate || submitting.current || !canSubmit(state.workspace)) return;
    submitting.current = true;
    submittedCandidate.current = candidate;
    setCreating(true);
    setError(undefined);
    try {
      const created = await state.createWorkspaceVdt({ source: { kind: "import", project: candidate.project }, expectedProjectId: projectId });
      if (!mounted.current) return;
      if (created) onClose();
      else if (currentProject()) setError(useVdtStudioStore.getState().workspace.error ?? "Could not create the VDT. You can retry this import.");
    } catch {
      if (mounted.current && currentProject()) setError("Could not create the VDT. You can retry this import.");
    } finally {
      submitting.current = false;
      if (mounted.current) setCreating(false);
    }
  }

  return createPortal(
    <dialog ref={dialog} aria-labelledby={titleId} className="m-auto w-[min(30rem,calc(100%-2rem))] max-w-none rounded-2xl border border-line bg-white p-5 text-ink shadow-xl backdrop:bg-slate-950/30"
      data-testid="import-vdt-json-review" onCancel={(event) => { event.preventDefault(); close(); }}>
      <h3 id={titleId} className="text-lg font-semibold">Import VDT JSON</h3>
      <p className="mt-1 text-sm text-muted">Create a new VDT in <strong>{projectName}</strong> from a VDT Studio JSON export.</p>
      <label className="mt-4 grid gap-2 text-sm font-medium">
        VDT JSON file
        <input type="file" accept=".json,application/json" disabled={creating || disabled || Boolean(workspace.pendingVdtCreate)}
          className="w-full rounded-md border border-line p-2 text-sm"
          data-testid="import-vdt-json-file" onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void selectFile(file);
          }} />
      </label>
      {reading ? <p role="status" className="mt-3 text-sm text-muted">Reading file…</p> : null}
      {error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}
      {candidate ? (
        <div className="mt-4 rounded-lg border border-line bg-slate-50 p-3 text-sm" data-testid="import-vdt-json-summary">
          <p className="break-words font-medium">{candidate.project.name}</p>
          <p className="break-words text-muted">{candidate.fileName}</p>
          <p className="mt-1 text-muted">{candidate.project.graph.nodes.length} KPIs · {candidate.project.scenarios.length} scenarios · {candidate.project.versions.length} named versions</p>
          {candidate.detachedSources ? <p className="mt-2 text-muted">Source attachments and external mappings are detached. Saved values and provenance notes will be kept.</p> : null}
        </div>
      ) : null}
      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" size="sm" variant="secondary" onClick={close} disabled={creating}>Cancel</Button>
        <Button type="button" size="sm" variant="primary" onClick={() => void create()}
          disabled={creating || !canSubmit(workspace)} data-testid="import-vdt-json-create">
          {creating ? "Creating…" : "Create new VDT"}
        </Button>
      </div>
    </dialog>, document.body
  );
}
