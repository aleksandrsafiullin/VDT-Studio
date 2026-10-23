"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Archive, Check, Download, FileText, FolderOpen, Link2, Loader2, Pencil, RotateCcw, Search, Unlink, Upload, X } from "lucide-react";
import { clsx } from "clsx";
import { Button } from "@/components/ui/button";
import { PROJECT_FILES_CHANGED, listProjectFiles, updateProjectFile, uploadProjectFile, type ProjectFileSource, type ProjectFileUpdate } from "@/lib/project-files-client";

export interface FileLibraryVdt { id: string; name: string }

export function ProjectFilesPanel({ projectId, vdts, vdtId }: { projectId: string; vdts: FileLibraryVdt[]; vdtId?: string }) {
  const [sources, setSources] = useState<ProjectFileSource[]>([]);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [selectedVdtId, setSelectedVdtId] = useState(vdtId ?? "");
  const [browseProject, setBrowseProject] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState("");
  const [renaming, setRenaming] = useState<string>();
  const [newName, setNewName] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const mutation = useRef<AbortController | undefined>(undefined);
  const busyRef = useRef(false);
  const scopeId = useId();
  const searchId = useId();
  const currentVdt = vdts.find((vdt) => vdt.id === selectedVdtId);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(undefined);
    void listProjectFiles(projectId, controller.signal)
      .then((files) => { if (!controller.signal.aborted) setSources(files); })
      .catch((caught) => { if (!controller.signal.aborted) setLoadError(fileError(caught)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [projectId, revision]);

  useEffect(() => {
    function refresh(event: Event) {
      if ((event as CustomEvent<{ projectId: string }>).detail.projectId === projectId) setRevision((value) => value + 1);
    }
    window.addEventListener(PROJECT_FILES_CHANGED, refresh);
    return () => { window.removeEventListener(PROJECT_FILES_CHANGED, refresh); mutation.current?.abort(); };
  }, [projectId]);

  async function perform(label: string, operation: (signal: AbortSignal) => Promise<void>) {
    if (busyRef.current) return;
    const controller = new AbortController();
    mutation.current = controller;
    busyRef.current = true;
    setBusy(label);
    setError(undefined);
    setNotice(undefined);
    try { await operation(controller.signal); }
    catch (caught) { if (!controller.signal.aborted) setError(fileError(caught)); }
    finally { if (!controller.signal.aborted) { busyRef.current = false; setBusy(undefined); } }
  }

  async function upload(files: File[]) {
    await perform("Uploading files…", async (signal) => {
      let saved = 0;
      const failures: string[] = [];
      for (const file of files) {
        if (signal.aborted) return;
        setBusy(`Uploading ${file.name}…`);
        try { await uploadProjectFile(projectId, file, selectedVdtId || undefined, signal); saved += 1; }
        catch (caught) { if (!signal.aborted) failures.push(`${file.name}: ${fileError(caught)}`); }
      }
      if (signal.aborted) return;
      if (saved) setNotice(`${saved} file${saved === 1 ? "" : "s"} saved to this project${currentVdt ? ` and attached to ${currentVdt.name}` : ""}.`);
      if (failures.length) setError(failures.join("\n"));
      if (fileInput.current) fileInput.current.value = "";
    });
  }

  async function update(source: ProjectFileSource, change: ProjectFileUpdate) {
    await perform("Saving file…", async (signal) => {
      await updateProjectFile(projectId, source.datasetId, change, signal);
      if (signal.aborted) return;
      if (change.action === "rename") { setRenaming(undefined); setNotice("File name saved. The original download keeps its original name."); }
      else if (change.action === "archive") setNotice("File archived. Existing VDTs and their history can still read the original.");
      else if (change.action === "restore") setNotice("File restored to the project library.");
      else if (change.action === "attach") setNotice(`File attached to ${currentVdt?.name ?? "this VDT"}.`);
      else setNotice("File removed from this VDT’s file list. Saved references remain available.");
    });
  }

  const query = search.trim().toLocaleLowerCase();
  const visible = sources.filter((source) => {
    const attached = Boolean(selectedVdtId && source.vdtIds.includes(selectedVdtId));
    if (selectedVdtId && !browseProject && !attached) return false;
    if (source.archived && !showArchived && !(attached && !browseProject)) return false;
    return !query || `${source.displayName} ${source.file.fileName}`.toLocaleLowerCase().includes(query);
  });
  const attachedCount = sources.filter((source) => source.vdtIds.includes(selectedVdtId)).length;

  return (
    <section className="min-w-0" data-testid="project-files-panel" aria-label="Project file library">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold tracking-tight text-ink">{currentVdt ? "VDT files" : "Project files"}</h3>
          <p className="mt-1 max-w-xl text-sm leading-6 text-muted">Upload client data once and reuse it across this project’s trees.</p>
        </div>
        <Button variant="primary" size="sm" className="shrink-0 rounded-full" icon={<Upload className="h-4 w-4" />} disabled={Boolean(busy)} onClick={() => fileInput.current?.click()} data-testid="project-files-upload">Upload files</Button>
        <input ref={fileInput} type="file" multiple className="sr-only" tabIndex={-1} aria-label="Upload project files" data-testid="project-files-input" disabled={Boolean(busy)} onChange={(event) => { const files = Array.from(event.target.files ?? []); if (files.length) void upload(files); }} />
      </div>

      <div className="mt-5 flex flex-wrap items-end gap-3">
        {!vdtId ? (
          <div className="min-w-0 flex-1 sm:max-w-xs">
            <label htmlFor={scopeId} className="mb-1.5 block text-xs font-medium text-muted">Files for</label>
            <select id={scopeId} value={selectedVdtId} disabled={Boolean(busy)} onChange={(event) => { setSelectedVdtId(event.target.value); setBrowseProject(false); setRenaming(undefined); }} className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink" data-testid="project-files-scope">
              <option value="">Entire project</option>
              {vdts.map((vdt) => <option key={vdt.id} value={vdt.id}>{vdt.name}</option>)}
            </select>
          </div>
        ) : null}
        <div className="min-w-0 flex-1 sm:max-w-sm">
          <label htmlFor={searchId} className="mb-1.5 block text-xs font-medium text-muted">Find a file</label>
          <div className="flex items-center gap-2 rounded-lg border border-line bg-white px-3">
            <Search className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
            <input id={searchId} type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search files…" className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none" />
          </div>
        </div>
        <label className="flex items-center gap-2 py-2 text-xs text-muted"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} data-testid="project-files-show-archived" />Show archived</label>
      </div>

      {selectedVdtId ? (
        <div className="mt-4 flex flex-wrap gap-1 border-b border-line" aria-label="File scope">
          <button type="button" aria-pressed={!browseProject} className={tabClass(!browseProject)} onClick={() => setBrowseProject(false)} data-testid="project-files-attached">This VDT ({attachedCount})</button>
          <button type="button" aria-pressed={browseProject} className={tabClass(browseProject)} onClick={() => setBrowseProject(true)} data-testid="project-files-browse">Add from project</button>
        </div>
      ) : <p className="mt-4 text-xs leading-5 text-muted">Select a tree in “Files for” to manage its attachments. Each upload keeps its original content; maximum 50 MB per file.</p>}

      {busy ? <p role="status" className="mt-4 flex items-center gap-2 text-sm text-accent"><Loader2 className="h-4 w-4 animate-spin" />{busy}</p> : null}
      {notice ? <p role="status" className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p> : null}
      {error || loadError ? <div role="alert" className="mt-4 whitespace-pre-line rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error ?? loadError}{loadError ? <button type="button" className="ml-2 font-semibold underline" onClick={() => setRevision((value) => value + 1)}>Retry</button> : null}</div> : null}

      <div className="mt-4 divide-y divide-line rounded-xl border border-line bg-white" aria-busy={loading} data-testid="project-files-list">
        {visible.map((source) => {
          const attached = source.vdtIds.includes(selectedVdtId);
          const usedIn = vdts.filter((vdt) => source.vdtIds.includes(vdt.id));
          return (
            <article key={source.datasetId} className="min-w-0 p-4" data-testid={`project-file-${source.datasetId}`}>
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-accent"><FileText className="h-5 w-5" /></span>
                <div className="min-w-0 flex-1">
                  {renaming === source.datasetId ? (
                    <form className="flex flex-wrap items-center gap-1" onSubmit={(event) => { event.preventDefault(); void update(source, { action: "rename", displayName: newName }); }}>
                      <input aria-label="File name" autoFocus value={newName} maxLength={255} onChange={(event) => setNewName(event.target.value)} className="min-w-0 flex-1 rounded border border-line px-2 py-1 text-sm" disabled={Boolean(busy)} />
                      <Button type="submit" size="icon" aria-label="Save file name" disabled={Boolean(busy) || !newName.trim()} icon={<Check className="h-4 w-4" />} />
                      <Button type="button" size="icon" aria-label="Cancel file rename" disabled={Boolean(busy)} onClick={() => setRenaming(undefined)} icon={<X className="h-4 w-4" />} />
                    </form>
                  ) : <h4 className="break-words text-sm font-semibold text-ink">{source.displayName}</h4>}
                  {source.displayName !== source.file.fileName ? <p className="mt-0.5 break-words text-xs text-muted">Original: {source.file.fileName}</p> : null}
                  <p className="mt-1 text-xs text-muted">{formatFileSize(source.file.sizeBytes)} · {formatFileDate(source.file.uploadedAt)}{source.archived ? " · Archived" : ""}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    {usedIn.length ? usedIn.map((vdt) => <span key={vdt.id} className="max-w-full truncate rounded-full bg-slate-100 px-2 py-0.5" title={vdt.name}>{vdt.name}</span>) : <span>Not attached to a VDT</span>}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 sm:pl-[52px]">
                <a href={source.sourceUrl} download={source.file.fileName} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-accent hover:bg-blue-50" aria-label={`Download ${source.displayName}`}><Download className="h-3.5 w-3.5" />Download</a>
                <Button size="sm" variant="ghost" disabled={Boolean(busy)} aria-label={`Rename ${source.displayName}`} icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => { setRenaming(source.datasetId); setNewName(source.displayName); }}>Rename</Button>
                {selectedVdtId ? <Button size="sm" variant="secondary" disabled={Boolean(busy) || (!attached && source.archived)} aria-label={`${attached ? "Detach" : "Attach"} ${source.displayName}`} icon={attached ? <Unlink className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />} onClick={() => void update(source, { action: attached ? "detach" : "attach", vdtId: selectedVdtId })}>{attached ? "Remove from VDT" : "Attach to VDT"}</Button> : null}
                <Button size="sm" variant="ghost" disabled={Boolean(busy)} aria-label={`${source.archived ? "Restore" : "Archive"} ${source.displayName}`} icon={source.archived ? <RotateCcw className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />} onClick={() => void update(source, { action: source.archived ? "restore" : "archive" })}>{source.archived ? "Restore" : "Archive"}</Button>
              </div>
            </article>
          );
        })}
        {!visible.length ? <div className="flex flex-col items-center px-5 py-10 text-center"><FolderOpen className="h-9 w-9 text-slate-300" /><p className="mt-3 text-sm font-medium text-ink">{loading ? "Loading files…" : query ? "No files match your search" : selectedVdtId && !browseProject ? "No files attached to this VDT" : "No project files yet"}</p><p className="mt-1 max-w-sm text-xs leading-5 text-muted">{selectedVdtId && !browseProject ? "Upload files here or choose Add from project to reuse existing data." : "Upload client extracts and documents to keep them with the project."}</p></div> : null}
      </div>
    </section>
  );
}

function tabClass(active: boolean): string { return clsx("border-b-2 px-3 py-2 text-xs font-semibold", active ? "border-accent text-accent" : "border-transparent text-muted hover:text-ink"); }
function fileError(caught: unknown): string { return caught instanceof Error ? caught.message : "The file operation could not be completed."; }
function formatFileSize(bytes: number): string { return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
function formatFileDate(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(date); }
