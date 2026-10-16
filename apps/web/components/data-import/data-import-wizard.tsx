"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, FileText, Loader2, Sparkles, X } from "lucide-react";
import type { DataDiscoveryFileMetadata, DataDiscoveryRunSnapshot, IncomingKpiOptions } from "@vdt-studio/data-harness";
import { Button } from "@/components/ui/button";
import { resolveExecutionSettings } from "@/lib/execution-mode-resolver";
import { useVdtStudioStore } from "@/components/vdt/vdt-store";
import { IncomingKpiMappingReview } from "./incoming-kpi-mapping-review";
import { captureFileImportTarget, FILE_IMPORT_REQUEST_EVENT, fileImportContextError, type FileImportTargetContext } from "./import-context";

type WizardStatus = "idle" | "uploading" | "analyzing" | "saving" | "applying";
interface SavedSource { datasetId: string; file: DataDiscoveryFileMetadata; sourceUrl: string }
interface DiscoveryResponse {
  ok?: boolean;
  snapshot?: DataDiscoveryRunSnapshot;
  changeSet?: DataDiscoveryRunSnapshot["changeSetPreview"];
  error?: { message?: string };
}
interface ImportSession {
  context: FileImportTargetContext;
  targetName: string;
  source: "node_action" | "agent_composer_attachment";
}

const FILE_TYPES = ".csv,.tsv,.txt,.json,.ndjson,.xlsx,.xls,.parquet";

/** One shared modal serves both the composer and every node action. */
export function DataImportWizard() {
  const projectId = useVdtStudioStore((state) => state.workspace.activeProjectId);
  const vdtId = useVdtStudioStore((state) => state.workspace.activeVdtId);
  const project = useVdtStudioStore((state) => state.project);
  const [session, setSession] = useState<ImportSession>();
  const [file, setFile] = useState<File>();
  const [sources, setSources] = useState<SavedSource[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [sourceError, setSourceError] = useState<string>();
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [status, setStatus] = useState<WizardStatus>("idle");
  const [snapshot, setSnapshot] = useState<DataDiscoveryRunSnapshot>();
  const [options, setOptions] = useState<IncomingKpiOptions>({});
  const [mappingChanged, setMappingChanged] = useState(false);
  const [error, setError] = useState<string>();
  const operationRef = useRef(0);
  const requestRef = useRef<AbortController | undefined>(undefined);
  const busyRef = useRef(false);
  const dialogRef = useRef<HTMLElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const running = status !== "idle";

  function close() {
    operationRef.current += 1;
    requestRef.current?.abort();
    busyRef.current = false;
    setStatus("idle");
    setSession(undefined);
    previousFocus.current?.focus();
  }

  useEffect(() => {
    function open(event: Event) {
      if (busyRef.current) return;
      const detail = (event as CustomEvent<{ targetNodeId: string; source: ImportSession["source"] }>).detail;
      const state = useVdtStudioStore.getState();
      const context = captureFileImportTarget(state.project, state.workspace, detail.targetNodeId);
      if (!context) return;
      operationRef.current += 1;
      requestRef.current?.abort();
      previousFocus.current = document.activeElement as HTMLElement | null;
      setSession({ context, targetName: state.project.graph.nodes.find((node) => node.id === context.targetNodeId)!.name, source: detail.source });
      setFile(undefined);
      setSelectedSourceId("");
      setSnapshot(undefined);
      setOptions({});
      setMappingChanged(false);
      setError(undefined);
    }
    window.addEventListener(FILE_IMPORT_REQUEST_EVENT, open);
    return () => { window.removeEventListener(FILE_IMPORT_REQUEST_EVENT, open); operationRef.current += 1; requestRef.current?.abort(); };
  }, []);

  useEffect(() => {
    if (!session) return;
    if (session.context.projectId !== projectId || session.context.vdtId !== vdtId) close();
    // Selection changes do not retarget the import.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, vdtId, session]);

  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    const scope = new URLSearchParams({ projectId: session.context.projectId, vdtId: session.context.vdtId });
    setSources([]);
    setSourcesLoading(true);
    setSourceError(undefined);
    void fetch(`/api/data/files?${scope}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await readJson<{ ok?: boolean; sources?: SavedSource[]; error?: { message?: string } }>(response);
        if (!response.ok || !payload.ok) throw new Error(payload.error?.message ?? "Could not load saved project sources.");
        if (!controller.signal.aborted) setSources((existing) => [...existing, ...(payload.sources ?? []).filter((source) => !existing.some((entry) => entry.datasetId === source.datasetId))]);
      })
      .catch((caught) => { if (!controller.signal.aborted) setSourceError(message(caught)); })
      .finally(() => { if (!controller.signal.aborted) setSourcesLoading(false); });
    return () => controller.abort();
  }, [session]);

  useEffect(() => {
    if (!session) return;
    dialogRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); close(); }
      if (event.key !== "Tab") return;
      const elements = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]');
      const first = elements?.[0];
      const last = elements?.[elements.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  function assertCurrent(context: FileImportTargetContext, operation: number) {
    if (operation !== operationRef.current) throw new Error("File import was closed or replaced.");
    const current = useVdtStudioStore.getState();
    const contextError = fileImportContextError(context, current.project, current.workspace);
    if (contextError) throw new Error(contextError);
    return current;
  }

  function startOperation(nextStatus: WizardStatus) {
    const operation = ++operationRef.current;
    const controller = new AbortController();
    requestRef.current?.abort();
    requestRef.current = controller;
    busyRef.current = true;
    setStatus(nextStatus);
    setError(undefined);
    return { operation, controller };
  }

  function finishOperation(operation: number, caught?: unknown) {
    if (operation !== operationRef.current) return;
    if (caught) setError(message(caught));
    busyRef.current = false;
    setStatus("idle");
  }

  function validateSnapshotTarget(next: DataDiscoveryRunSnapshot, context: FileImportTargetContext) {
    if (next.projectId !== context.graphProjectId ||
      (next.incomingKpi && next.incomingKpi.targetNodeId !== context.targetNodeId) ||
      (next.file.projectId && next.file.projectId !== context.projectId) ||
      (next.file.vdtId && next.file.vdtId !== context.vdtId)) {
      throw new Error("The analysis does not belong to the intended project and KPI. Reopen file import.");
    }
  }

  function acceptSnapshot(next: DataDiscoveryRunSnapshot, context: FileImportTargetContext) {
    validateSnapshotTarget(next, context);
    setSnapshot(next);
    setOptions(next.incomingKpi?.options ?? {});
    setMappingChanged(false);
  }

  async function analyze() {
    if (!session || running || (!file && !selectedSourceId)) return;
    const { context } = session;
    const { operation, controller } = startOperation(file ? "uploading" : "analyzing");
    setSnapshot(undefined);
    try {
      let state = assertCurrent(context, operation);
      let datasetId = selectedSourceId;
      if (file) {
        const form = new FormData();
        form.set("file", file);
        form.set("projectId", context.projectId);
        form.set("vdtId", context.vdtId);
        const upload = await fetch("/api/data/files", { method: "POST", body: form, signal: controller.signal });
        const payload = await readJson<{ ok?: boolean; datasetId?: string; file?: DataDiscoveryFileMetadata; sourceUrl?: string; error?: { message?: string } }>(upload);
        if (!upload.ok || !payload.ok || !payload.datasetId) throw new Error(payload.error?.message ?? "File upload failed.");
        state = assertCurrent(context, operation);
        datasetId = payload.datasetId;
        if (payload.file && payload.sourceUrl) setSources((existing) => [{ datasetId: payload.datasetId!, file: payload.file!, sourceUrl: payload.sourceUrl! }, ...existing.filter((entry) => entry.datasetId !== payload.datasetId)]);
        setSelectedSourceId(datasetId);
        setFile(undefined);
      }
      setStatus("analyzing");
      const { providerId, providerConfig } = resolveExecutionSettings(state.executionSettings);
      const response = await fetch("/api/data/discovery/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          projectId: context.projectId, vdtId: context.vdtId, targetNodeId: context.targetNodeId, datasetId,
          entryContext: { source: session.source, cardName: session.targetName, targetNodeId: context.targetNodeId, purpose: "incoming_kpis" },
          project: state.project,
          ...(providerId === "mock" ? {} : { providerId, providerConfig: providerId === "local_runner" && state.runnerPairingToken ? { ...providerConfig, pairingToken: state.runnerPairingToken } : providerConfig })
        })
      });
      const payload = await readJson<DiscoveryResponse>(response);
      if (!response.ok || !payload.ok || !payload.snapshot) throw new Error(payload.error?.message ?? "Data discovery failed.");
      assertCurrent(context, operation);
      acceptSnapshot(payload.snapshot, context);
      finishOperation(operation);
    } catch (caught) { finishOperation(operation, caught); }
  }

  async function calculatePreview() {
    if (!session || !snapshot || running) return;
    const { context } = session;
    const { operation, controller } = startOperation("saving");
    try {
      const state = assertCurrent(context, operation);
      const response = await fetch(`/api/data/discovery/runs/${encodeURIComponent(snapshot.runId)}/user-input`, {
        method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ projectId: context.projectId, vdtId: context.vdtId, project: state.project, edits: { incomingKpiOptions: options } })
      });
      const payload = await readJson<DiscoveryResponse>(response);
      if (!response.ok || !payload.ok || !payload.snapshot) throw new Error(payload.error?.message ?? "Could not calculate this mapping.");
      assertCurrent(context, operation);
      acceptSnapshot(payload.snapshot, context);
      finishOperation(operation);
    } catch (caught) { finishOperation(operation, caught); }
  }

  async function stage() {
    if (!session || !snapshot || running || mappingChanged) return;
    const { context } = session;
    const { operation, controller } = startOperation("applying");
    try {
      const state = assertCurrent(context, operation);
      const response = await fetch(`/api/data/discovery/runs/${encodeURIComponent(snapshot.runId)}/apply`, {
        method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ projectId: context.projectId, vdtId: context.vdtId, project: state.project })
      });
      const payload = await readJson<DiscoveryResponse>(response);
      if (!response.ok || !payload.ok || !payload.snapshot || !payload.changeSet) throw new Error(payload.error?.message ?? "Server validation blocked this preview.");
      validateSnapshotTarget(payload.snapshot, context);
      const current = assertCurrent(context, operation);
      if (!current.stageDataDiscoveryChangeSet(payload.changeSet, context)) throw new Error("The import target changed. Reopen and analyze the file again.");
      current.setUiPreference("leftPanelCollapsed", false);
      close();
    } catch (caught) { finishOperation(operation, caught); }
  }

  if (!session) return null;
  const contextError = fileImportContextError(session.context, project, { activeProjectId: projectId, activeVdtId: vdtId });
  const selectedSource = sources.find((source) => source.datasetId === selectedSourceId);
  const review = snapshot?.incomingKpi;
  const canStage = Boolean(snapshot?.changeSetPreview && review && review.questions.length === 0 && review.blockingReasons.length === 0 && review.coverage.complete && review.options.confirmed && !mappingChanged && !contextError && snapshot.validationResults.every((item) => item.status !== "error") && (snapshot.status === "waiting_review" || snapshot.status === "succeeded"));
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/25 p-3 sm:p-6">
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="data-import-title" tabIndex={-1} className="flex max-h-[92dvh] w-full max-w-4xl flex-col rounded-lg border border-line bg-white shadow-xl outline-none" data-testid="data-import-wizard">
        <header className="flex items-start justify-between gap-3 border-b border-line p-4">
          <div><h2 id="data-import-title" className="text-base font-semibold text-ink">Create incoming KPIs from file</h2><p className="mt-1 text-sm text-muted" data-testid="data-import-target">Target: {session.targetName}</p></div>
          <Button type="button" size="icon" variant="ghost" className="h-8 w-8" icon={<X className="h-4 w-4" />} aria-label="Close file import" onClick={close} />
        </header>
        <div className="overflow-y-auto p-4">
          <p className="text-xs leading-5 text-muted">Choose a project source or upload a file. Review the categories and calculation before creating the hierarchy. The original file stays with this project.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border border-line p-3">
              <label className="block text-xs font-semibold text-ink" htmlFor="data-import-file">Upload a file</label>
              <input id="data-import-file" ref={fileRef} type="file" accept={FILE_TYPES} className="mt-2 block w-full text-xs text-muted file:mr-2 file:rounded file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:font-semibold file:text-accent" data-testid="data-import-file-input" disabled={running} onChange={(event) => { const next = event.target.files?.[0]; if (!next) return; setFile(next); setSelectedSourceId(""); setSnapshot(undefined); setError(undefined); }} />
              {file ? <p className="mt-2 flex items-center gap-1.5 text-xs text-ink"><FileText className="h-3.5 w-3.5" />{file.name}</p> : null}
            </div>
            <div className="rounded-md border border-line p-3">
              <label className="block text-xs font-semibold text-ink" htmlFor="data-import-source">Saved project sources</label>
              <select id="data-import-source" value={selectedSourceId} disabled={running || sourcesLoading} className="mt-2 w-full rounded-md border border-line bg-white px-2 py-2 text-xs text-ink" onChange={(event) => { setSelectedSourceId(event.target.value); setFile(undefined); if (fileRef.current) fileRef.current.value = ""; setSnapshot(undefined); setError(undefined); }}>
                <option value="">{sourcesLoading ? "Loading sources…" : sources.length ? "Select a saved source" : "No saved sources yet"}</option>
                {sources.map((source) => <option key={source.datasetId} value={source.datasetId}>{source.file.fileName} · {source.file.uploadedAt.slice(0, 10)}</option>)}
              </select>
              {selectedSource ? <a className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-accent" href={selectedSource.sourceUrl} download={selectedSource.file.fileName} data-testid="data-import-download"><Download className="h-3.5 w-3.5" />Download original file</a> : null}
              {sourceError ? <p role="alert" className="mt-2 text-xs text-red-700">{sourceError}</p> : null}
            </div>
          </div>
          <Button type="button" className="mt-3" size="sm" variant="primary" icon={running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} disabled={(!file && !selectedSourceId) || running || Boolean(contextError)} onClick={() => void analyze()} data-testid="data-import-analyze">{status === "uploading" ? "Uploading…" : status === "analyzing" ? "Analyzing…" : snapshot || selectedSource ? "Analyze again" : "Analyze file"}</Button>
          {contextError || error ? <div role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" data-testid="data-import-error">{contextError ?? error}</div> : null}
          {snapshot ? <IncomingKpiMappingReview snapshot={snapshot} options={options} running={running} mappingChanged={mappingChanged} onOptionsChange={(next) => { setOptions(next); setMappingChanged(true); }} onCalculate={() => void calculatePreview()} /> : null}
        </div>
        <footer className="flex items-center justify-between gap-3 border-t border-line p-4">
          <p className="text-xs text-muted">Stage the complete hierarchy, then review and apply it in the editor.</p>
          <Button type="button" size="sm" variant="primary" disabled={!canStage || running} onClick={() => void stage()} data-testid="data-import-stage-preview">{status === "applying" ? "Validating…" : "Stage incoming KPI preview"}</Button>
        </footer>
      </section>
    </div>, document.body
  );
}

function message(caught: unknown): string { return caught instanceof Error ? caught.message : "File import could not be completed."; }
async function readJson<T>(response: Response): Promise<T> {
  if (!(response.headers.get("content-type") ?? "").includes("application/json")) throw new Error(`Server returned a non-JSON response (${response.status}).`);
  return await response.json() as T;
}
