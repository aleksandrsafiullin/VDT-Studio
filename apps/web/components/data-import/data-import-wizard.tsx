"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileText, Loader2, Paperclip, Save, Sparkles, Table2, X } from "lucide-react";
import type { DataDiscoveryRunSnapshot, DataDiscoveryUserEdits } from "@vdt-studio/data-harness";
import type { SemanticLogicalType, SemanticMetricCandidate, SemanticTaxonomy } from "@vdt-studio/vdt-core";
import { Button } from "@/components/ui/button";
import { resolveExecutionSettings } from "@/lib/execution-mode-resolver";
import { useVdtStudioStore } from "@/components/vdt/vdt-store";

type WizardStatus = "idle" | "uploading" | "analyzing" | "ready" | "saving" | "applying" | "error";

const LOGICAL_TYPES: SemanticLogicalType[] = [
  "identifier",
  "category",
  "text",
  "measure",
  "duration",
  "timestamp",
  "date",
  "currency",
  "percentage",
  "status",
  "other"
];

const AGGREGATIONS: SemanticMetricCandidate["aggregation"][] = [
  "sum",
  "count",
  "avg",
  "min",
  "max",
  "ratio",
  "distinct_count",
  "custom"
];

interface UploadResponse {
  ok?: boolean;
  datasetId?: string;
  error?: { message?: string };
}

interface DiscoveryResponse {
  ok?: boolean;
  runId?: string;
  snapshot?: DataDiscoveryRunSnapshot;
  error?: { message?: string };
}

interface ApplyResponse extends DiscoveryResponse {
  changeSet?: DataDiscoveryRunSnapshot["changeSetPreview"];
  validationResults?: DataDiscoveryRunSnapshot["validationResults"];
}

export function DataImportWizard() {
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const project = useVdtStudioStore((state) => state.project);
  const selectedNodeId = useVdtStudioStore((state) => state.selectedNodeId);
  const executionSettings = useVdtStudioStore((state) => state.executionSettings);
  const runnerPairingToken = useVdtStudioStore((state) => state.runnerPairingToken);
  const stageDataDiscoveryChangeSet = useVdtStudioStore((state) => state.stageDataDiscoveryChangeSet);
  const [file, setFile] = useState<File | undefined>();
  const [status, setStatus] = useState<WizardStatus>("idle");
  const [snapshot, setSnapshot] = useState<DataDiscoveryRunSnapshot | undefined>();
  const [error, setError] = useState<string | undefined>();
  const selectedNode = useMemo(
    () => project.graph.nodes.find((node) => node.id === selectedNodeId) ?? project.graph.nodes[0],
    [project.graph.nodes, selectedNodeId]
  );
  const running = status === "uploading" || status === "analyzing" || status === "saving" || status === "applying";
  const semanticColumns = snapshot?.semanticModel?.tables.flatMap((table) => table.columns.map((column) => ({
    ...column,
    tableName: table.name
  }))) ?? [];
  const disabledColumns = useMemo(
    () => new Set((snapshot?.userEdits?.disabledColumns ?? []).map((entry) => `${entry.tableId}.${entry.columnName}`)),
    [snapshot?.userEdits?.disabledColumns]
  );
  const validationErrors = snapshot?.validationResults.filter((result) => result.status === "error") ?? [];
  const validationWarnings = snapshot?.validationResults.filter((result) => result.status === "warning") ?? [];
  const metrics = snapshot?.proposal?.metrics ?? [];
  const taxonomies = snapshot?.proposal?.taxonomies ?? [];
  const canStage = Boolean(
    snapshot?.changeSetPreview &&
    validationErrors.length === 0 &&
    (snapshot.status === "waiting_review" || snapshot.status === "succeeded")
  );
  const lastEvent = snapshot?.events.at(-1);

  useEffect(() => {
    if (!open) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    function closeOnOutsideClick(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("mousedown", closeOnOutsideClick);
    };
  }, [open]);

  async function analyzeFile() {
    if (!file || running) return;
    setStatus("uploading");
    setError(undefined);
    setSnapshot(undefined);

    try {
      const formData = new FormData();
      formData.set("file", file);
      const uploadResponse = await fetch("/api/data/files", {
        method: "POST",
        body: formData
      });
      const uploadPayload = await readJson<UploadResponse>(uploadResponse);
      if (!uploadResponse.ok || uploadPayload.ok !== true || !uploadPayload.datasetId) {
        throw new Error(uploadPayload.error?.message ?? "File upload failed.");
      }

      setStatus("analyzing");
      const { providerId, providerConfig } = resolveExecutionSettings(executionSettings);
      const discoveryResponse = await fetch("/api/data/discovery/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          datasetId: uploadPayload.datasetId,
          entryContext: {
            source: "agent_composer_attachment",
            cardName: selectedNode?.name,
            targetNodeId: selectedNode?.id,
            purpose: "incoming_kpis"
          },
          project,
          ...(providerId === "mock" ? {} : {
            providerId,
            providerConfig: providerId === "local_runner" && runnerPairingToken
              ? { ...providerConfig, pairingToken: runnerPairingToken }
              : providerConfig
          })
        })
      });
      const discoveryPayload = await readJson<DiscoveryResponse>(discoveryResponse);
      if (!discoveryResponse.ok || discoveryPayload.ok !== true || !discoveryPayload.snapshot) {
        throw new Error(discoveryPayload.error?.message ?? "Data discovery failed.");
      }

      setSnapshot(discoveryPayload.snapshot);
      setStatus("ready");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Data discovery failed.");
      setStatus("error");
    }
  }

  function chooseFile() {
    if (file || snapshot || error) {
      setOpen(true);
      return;
    }
    fileInputRef.current?.click();
  }

  function replaceFile() {
    if (fileInputRef.current) fileInputRef.current.value = "";
    fileInputRef.current?.click();
  }

  async function saveUserEdits(edits: DataDiscoveryUserEdits) {
    if (!snapshot || status === "saving") return;
    setStatus("saving");
    setError(undefined);
    try {
      const response = await fetch(`/api/data/discovery/runs/${encodeURIComponent(snapshot.runId)}/user-input`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ edits })
      });
      const payload = await readJson<DiscoveryResponse>(response);
      if (!response.ok || payload.ok !== true || !payload.snapshot) {
        throw new Error(payload.error?.message ?? "Could not save review edits.");
      }
      setSnapshot(payload.snapshot);
      setStatus("ready");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save review edits.");
      setStatus("error");
    }
  }

  async function stageProposal() {
    if (!snapshot?.changeSetPreview || running) return;
    setStatus("applying");
    setError(undefined);
    try {
      const response = await fetch(`/api/data/discovery/runs/${encodeURIComponent(snapshot.runId)}/apply`, {
        method: "POST"
      });
      const payload = await readJson<ApplyResponse>(response);
      if (!response.ok || payload.ok !== true || !payload.snapshot || !payload.changeSet) {
        throw new Error(payload.error?.message ?? "Server validation blocked this preview.");
      }
      setSnapshot(payload.snapshot);
      stageDataDiscoveryChangeSet(payload.changeSet);
      setStatus("ready");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Server validation blocked this preview.");
      setStatus("error");
    }
  }

  function setColumnDisabled(tableId: string, columnName: string, disabled: boolean) {
    const next = new Set(disabledColumns);
    const key = `${tableId}.${columnName}`;
    if (disabled) {
      next.add(key);
    } else {
      next.delete(key);
    }
    void saveUserEdits({ disabledColumns: [...next].map(splitColumnKey) });
  }

  function setTableEnabled(tableId: string, enabled: boolean) {
    const next = new Set(disabledColumns);
    for (const column of semanticColumns.filter((candidate) => candidate.tableId === tableId)) {
      const key = `${column.tableId}.${column.columnName}`;
      if (enabled) {
        next.delete(key);
      } else {
        next.add(key);
      }
    }
    void saveUserEdits({ disabledColumns: [...next].map(splitColumnKey) });
  }

  function saveColumnRole(tableId: string, columnName: string, patch: Partial<NonNullable<DataDiscoveryUserEdits["columnRoles"]>[number]>) {
    void saveUserEdits({
      columnRoles: [
        {
          tableId,
          columnName,
          ...patch
        }
      ]
    });
  }

  function saveMetric(metricId: string, patch: Partial<NonNullable<DataDiscoveryUserEdits["metricEdits"]>[number]>) {
    void saveUserEdits({
      metricEdits: [
        {
          metricId,
          ...patch
        }
      ]
    });
  }

  function saveTaxonomy(taxonomyId: string, patch: Partial<NonNullable<DataDiscoveryUserEdits["taxonomyEdits"]>[number]>) {
    void saveUserEdits({
      taxonomyEdits: [
        {
          taxonomyId,
          ...patch
        }
      ]
    });
  }

  function saveTaxonomyCategory(taxonomy: SemanticTaxonomy, categoryId: string, name: string) {
    const categories = taxonomy.categories.map((category) => {
      if (category.id !== categoryId) return category;
      return {
        ...category,
        name
      };
    });
    saveTaxonomy(taxonomy.id, { categories });
  }

  return (
    <div ref={containerRef} className="relative shrink-0" data-testid="data-import-attachment">
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.tsv,.txt,.json,.ndjson,.xlsx,.xls,.parquet,text/csv,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/vnd.apache.parquet"
        className="sr-only"
        data-testid="data-import-file-input"
        disabled={running}
        onChange={(event) => {
          const nextFile = event.target.files?.[0];
          if (!nextFile) return;
          setFile(nextFile);
          setSnapshot(undefined);
          setStatus("idle");
          setError(undefined);
          setOpen(true);
        }}
      />
      <Button
        type="button"
        className="relative h-9 w-9"
        size="icon"
        variant={file ? "primary" : "secondary"}
        icon={<Paperclip className="h-4 w-4" />}
        aria-label="Attach data file to create incoming KPIs"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="data-import-popover"
        title="Attach data file to create incoming KPIs"
        data-testid="data-import-attachment-button"
        onClick={chooseFile}
      />

      {open ? (
        <section
          id="data-import-popover"
          role="dialog"
          aria-label="Create incoming KPIs from file"
          className="absolute bottom-full left-0 z-50 mb-2 max-h-[min(42rem,72vh)] w-[min(28rem,calc(100vw-2rem))] overflow-y-auto rounded-md border border-line bg-white p-3 shadow-xl"
          data-testid="data-import-wizard"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-ink">Create incoming KPIs from file</h3>
              <p className="mt-1 text-xs leading-5 text-muted">
                {selectedNode ? `Target: ${selectedNode.name}` : "Target: root KPI"}
              </p>
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-7 w-7 shrink-0"
              icon={<X className="h-4 w-4" />}
              aria-label="Close file attachment"
              onClick={() => setOpen(false)}
            />
          </div>

          {file ? (
            <div className="mt-3 flex items-center gap-2 rounded-md border border-line bg-slate-50 px-2.5 py-2">
              <FileText className="h-4 w-4 shrink-0 text-accent" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ink">{file.name}</span>
              <button
                type="button"
                className="shrink-0 text-xs font-semibold text-accent hover:text-blue-700"
                disabled={running}
                onClick={replaceFile}
              >
                Replace
              </button>
            </div>
          ) : (
            <Button type="button" className="mt-3 w-full" size="sm" onClick={replaceFile}>
              Select data file
            </Button>
          )}

          <Button
            type="button"
            className="mt-3 w-full"
            size="sm"
            variant="primary"
            icon={status === "uploading" || status === "analyzing" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            disabled={!file || running}
            data-testid="data-import-analyze"
            onClick={() => void analyzeFile()}
          >
            {status === "uploading" ? "Uploading" : status === "analyzing" ? "Analyzing" : "Analyze and create incoming KPIs"}
          </Button>

      {error ? (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700" data-testid="data-import-error">
          {error}
        </div>
      ) : null}

      {snapshot ? (
        <div className="mt-3 space-y-3" data-testid="data-import-result">
          <RunStatus snapshot={snapshot} saving={status === "saving" || status === "applying"} lastEvent={lastEvent?.message} />

          {snapshot.tables.length > 0 ? (
            <section>
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-normal text-muted">
                <Table2 className="h-3.5 w-3.5" aria-hidden />
                Tables
              </div>
              <div className="mt-2 space-y-1.5">
                {snapshot.tables.map((table) => {
                  const columns = semanticColumns.filter((column) => column.tableId === table.tableId);
                  const enabled = columns.some((column) => !disabledColumns.has(`${column.tableId}.${column.columnName}`));
                  return (
                    <label key={table.tableId} className="flex items-center justify-between gap-2 rounded-md border border-line bg-slate-50 px-2.5 py-2 text-xs">
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-ink">{table.name}</span>
                        <span className="block text-muted">{table.rowCount} rows · {table.columnCount} columns</span>
                      </span>
                      <input
                        type="checkbox"
                        className="h-4 w-4 shrink-0"
                        checked={enabled}
                        disabled={running}
                        onChange={(event) => setTableEnabled(table.tableId, event.target.checked)}
                      />
                    </label>
                  );
                })}
              </div>
            </section>
          ) : null}

          {semanticColumns.length > 0 ? (
            <section>
              <div className="text-xs font-semibold uppercase tracking-normal text-muted">Mappings</div>
              <div className="mt-2 space-y-1.5">
                {semanticColumns.slice(0, 10).map((column) => {
                  const columnKey = `${column.tableId}.${column.columnName}`;
                  const disabled = disabledColumns.has(columnKey);
                  return (
                    <div key={columnKey} className="rounded-md border border-line bg-slate-50 px-2.5 py-2">
                      <div className="flex items-start justify-between gap-2">
                        <label className="flex min-w-0 items-center gap-2 text-xs font-semibold text-ink">
                          <input
                            type="checkbox"
                            className="h-4 w-4 shrink-0"
                            checked={!disabled}
                            disabled={running}
                            onChange={(event) => setColumnDisabled(column.tableId, column.columnName, !event.target.checked)}
                          />
                          <span className="truncate">{column.columnName}</span>
                        </label>
                        <span className="shrink-0 text-xs text-muted">{Math.round(column.confidence * 100)}%</span>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <select
                          className="min-w-0 rounded-md border border-line bg-white px-2 py-1 text-xs text-ink"
                          value={column.logicalType}
                          disabled={running || disabled}
                          onChange={(event) => saveColumnRole(column.tableId, column.columnName, { logicalType: event.target.value as SemanticLogicalType })}
                        >
                          {LOGICAL_TYPES.map((type) => (
                            <option key={type} value={type}>{type}</option>
                          ))}
                        </select>
                        <input
                          className="min-w-0 rounded-md border border-line bg-white px-2 py-1 text-xs text-ink"
                          defaultValue={column.unit ?? ""}
                          placeholder="Unit"
                          disabled={running || disabled}
                          onBlur={(event) => saveColumnRole(column.tableId, column.columnName, { unit: event.currentTarget.value })}
                        />
                      </div>
                      <p className="mt-2 text-xs leading-5 text-muted">{column.evidence[0]?.message ?? column.tableName}</p>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          {metrics.length > 0 ? (
            <section>
              <div className="text-xs font-semibold uppercase tracking-normal text-muted">KPI Candidates</div>
              <div className="mt-2 space-y-1.5">
                {metrics.slice(0, 6).map((metric) => (
                  <div key={metric.id} className="rounded-md border border-line bg-slate-50 px-2.5 py-2">
                    <input
                      className="w-full rounded-md border border-line bg-white px-2 py-1 text-xs font-semibold text-ink"
                      defaultValue={metric.name}
                      disabled={running}
                      onBlur={(event) => saveMetric(metric.id, { name: event.currentTarget.value })}
                    />
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <select
                        className="min-w-0 rounded-md border border-line bg-white px-2 py-1 text-xs text-ink"
                        value={metric.aggregation}
                        disabled={running}
                        onChange={(event) => saveMetric(metric.id, { aggregation: event.target.value as SemanticMetricCandidate["aggregation"] })}
                      >
                        {AGGREGATIONS.map((aggregation) => (
                          <option key={aggregation} value={aggregation}>{aggregation}</option>
                        ))}
                      </select>
                      <input
                        className="min-w-0 rounded-md border border-line bg-white px-2 py-1 text-xs text-ink"
                        defaultValue={metric.unit ?? ""}
                        placeholder="Unit"
                        disabled={running}
                        onBlur={(event) => saveMetric(metric.id, { unit: event.currentTarget.value })}
                      />
                    </div>
                    <p className="mt-2 text-xs leading-5 text-muted">{metric.evidence[0]?.message ?? metric.description}</p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {taxonomies.length > 0 ? (
            <section>
              <div className="text-xs font-semibold uppercase tracking-normal text-muted">Taxonomy</div>
              <div className="mt-2 space-y-1.5">
                {taxonomies.slice(0, 3).map((taxonomy) => (
                  <details key={taxonomy.id} className="rounded-md border border-line bg-slate-50 px-2.5 py-2">
                    <summary className="cursor-pointer text-xs font-semibold text-ink">
                      {taxonomy.name} · {Math.round(taxonomy.coverage.coveredShare * 100)}%
                    </summary>
                    <input
                      className="mt-2 w-full rounded-md border border-line bg-white px-2 py-1 text-xs font-semibold text-ink"
                      defaultValue={taxonomy.name}
                      disabled={running}
                      onBlur={(event) => saveTaxonomy(taxonomy.id, { name: event.currentTarget.value })}
                    />
                    <div className="mt-2 space-y-1.5">
                      {taxonomy.categories.slice(0, 8).map((category) => (
                        <input
                          key={category.id}
                          className="w-full rounded-md border border-line bg-white px-2 py-1 text-xs text-ink"
                          defaultValue={category.name}
                          disabled={running}
                          onBlur={(event) => saveTaxonomyCategory(taxonomy, category.id, event.currentTarget.value)}
                        />
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            </section>
          ) : null}

          {snapshot.warnings.length > 0 || validationWarnings.length > 0 || validationErrors.length > 0 ? (
            <section className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-normal text-amber-800">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                Review
              </div>
              <ul className="mt-1 space-y-1 text-xs leading-5 text-amber-900">
                {[...validationErrors, ...validationWarnings].slice(0, 4).map((item, index) => (
                  <li key={`${item.id}-${index}`}>{item.message}</li>
                ))}
                {snapshot.warnings.slice(0, 4).map((warning, index) => (
                  <li key={`${warning.id}-${index}`}>{warning.message}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <Button
            type="button"
            size="sm"
            variant="primary"
            className="w-full"
            icon={status === "applying" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            disabled={!canStage || running}
            data-testid="data-import-stage-preview"
            onClick={() => void stageProposal()}
          >
            {status === "applying" ? "Validating" : "Stage incoming KPI preview"}
          </Button>
        </div>
      ) : null}
        </section>
      ) : null}
    </div>
  );
}

function RunStatus({
  snapshot,
  saving,
  lastEvent
}: {
  snapshot: DataDiscoveryRunSnapshot;
  saving: boolean;
  lastEvent?: string | undefined;
}) {
  const failed = snapshot.status === "failed";
  return (
    <div className={`rounded-md border px-3 py-2 ${failed ? "border-red-200 bg-red-50" : "border-blue-100 bg-blue-50"}`}>
      <div className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-normal ${failed ? "text-red-800" : "text-blue-800"}`}>
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />}
        {snapshot.status.replace(/_/g, " ")}
      </div>
      <p className={`mt-1 text-xs leading-5 ${failed ? "text-red-900" : "text-blue-950"}`}>
        {lastEvent ?? snapshot.semanticModel?.summary.description ?? "Semantic model prepared."}
      </p>
    </div>
  );
}

function splitColumnKey(key: string): { tableId: string; columnName: string } {
  const separator = key.indexOf(".");
  return {
    tableId: separator >= 0 ? key.slice(0, separator) : "",
    columnName: separator >= 0 ? key.slice(separator + 1) : key
  };
}

async function readJson<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error(`Server returned a non-JSON response (${response.status}).`);
  }
  return await response.json() as T;
}
