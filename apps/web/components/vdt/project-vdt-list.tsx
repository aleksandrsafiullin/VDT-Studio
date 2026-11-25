"use client";

import { useCallback, useMemo, useState } from "react";
import { FolderOpen, GitCompare, Plus, Trash2 } from "lucide-react";
import { clsx } from "clsx";
import { Button } from "@/components/ui/button";
import { Field, SelectInput, TextInput } from "@/components/ui/field";
import { formatNumber } from "@/lib/format";
import type { StoredVdtRecord, StoredVdtStatus } from "@/lib/vdt-storage-client";
import { NewVdtModal, type NewVdtModalValues } from "./new-vdt-modal";
import { ProjectComparisonsPanel } from "./project-comparisons-panel";
import { ProjectFilesPanel } from "./project-files-panel";
import { VdtJsonImport } from "./vdt-json-import";
import { useVdtStudioStore } from "./vdt-store";
import { VdtTreeIcon } from "./vdt-tree-icon";

const VALUE_EPSILON = 1e-6;

function formatRootValue(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? formatNumber(value) : "Not calculated";
}

function valuesDiffer(base: number | undefined, candidate: number | undefined): boolean {
  if (base === undefined || candidate === undefined) {
    return false;
  }
  return Math.abs(candidate - base) > VALUE_EPSILON;
}

function statusClass(status: string): string {
  if (status === "approved") return "border-teal/30 bg-teal/10 text-teal";
  if (status === "reviewed") return "border-blue-200 bg-blue-50 text-blue-700";
  if (status === "archived") return "border-slate-200 bg-slate-100 text-slate-500";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function VdtCardSettings({ vdt, disabled }: { vdt: StoredVdtRecord; disabled: boolean }) {
  const [name, setName] = useState(vdt.name);
  const renameVdt = useVdtStudioStore((state) => state.renameWorkspaceVdt);
  const setStatus = useVdtStudioStore((state) => state.setWorkspaceVdtStatus);

  return (
    <details className="mt-2 rounded-lg border border-line bg-white px-3 py-2 text-xs">
      <summary className="cursor-pointer font-medium text-ink" aria-label={`Manage ${vdt.name}`}>Manage VDT</summary>
      <form className="mt-2 grid gap-2" onSubmit={(event) => {
        event.preventDefault();
        if (!disabled && name.trim() && name.trim() !== vdt.name) void renameVdt(vdt.id, name);
      }}>
        <Field label="VDT name">
          <TextInput value={name} onChange={(event) => setName(event.target.value)} disabled={disabled} />
        </Field>
        <Button type="submit" size="sm" disabled={disabled || !name.trim() || name.trim() === vdt.name}>Save name</Button>
      </form>
      <div className="mt-2">
        <Field label="VDT status">
          <SelectInput value={vdt.status} disabled={disabled} onChange={(event) => void setStatus(vdt.id, event.target.value as StoredVdtStatus)}>
            <option value="draft">Draft</option>
            <option value="reviewed">Reviewed</option>
            <option value="approved">Approved</option>
            <option value="archived">Archived</option>
          </SelectInput>
        </Field>
      </div>
    </details>
  );
}

export function ProjectVdtList({ onOpenVdt }: { onOpenVdt?: (vdtId: string) => void | Promise<void> }) {
  const [newVdtProjectId, setNewVdtProjectId] = useState<string>();
  const [tab, setTab] = useState<"vdts" | "files" | "comparisons">("vdts");
  const workspace = useVdtStudioStore((state) => state.workspace);
  const project = useVdtStudioStore((state) => state.project);
  const createWorkspaceProject = useVdtStudioStore((state) => state.createWorkspaceProject);
  const createWorkspaceVdt = useVdtStudioStore((state) => state.createWorkspaceVdt);
  const selectWorkspaceVdt = useVdtStudioStore((state) => state.selectWorkspaceVdt);
  const deleteWorkspaceVdt = useVdtStudioStore((state) => state.deleteWorkspaceVdt);
  const activeSummary = useMemo(
    () => workspace.projectSummaries.find((entry) => entry.project.id === workspace.activeProjectId),
    [workspace.activeProjectId, workspace.projectSummaries]
  );
  const rows = activeSummary?.vdts ?? [];
  const newVdtModalOpen = newVdtProjectId !== undefined && newVdtProjectId === activeSummary?.project.id;
  const pendingCreate = workspace.pendingVdtCreate?.projectId === workspace.activeProjectId ? workspace.pendingVdtCreate : undefined;
  const createDisabled = workspace.isMutating || workspace.isLoading || Boolean(workspace.pendingVdtCreate);

  const setNewVdtModalOpen = useCallback((open: boolean) => {
    setNewVdtProjectId(open ? activeSummary?.project.id : undefined);
  }, [activeSummary?.project.id]);

  async function handleCreateProject() {
    const sourceName = project.name?.trim() || "New project";
    await createWorkspaceProject(`${sourceName} project`);
  }

  async function handleCreateVdt(values: NewVdtModalValues) {
    if (!newVdtModalOpen || !newVdtProjectId) return false;
    return createWorkspaceVdt({
      expectedProjectId: newVdtProjectId,
      ...(values.exampleId ? { source: { kind: "example", exampleId: values.exampleId } } : {
        rootKpi: values.rootKpi,
        ...(values.unit ? { unit: values.unit } : {}),
        ...(values.timePeriod ? { timePeriod: values.timePeriod } : {})
      })
    });
  }

  async function handleOpenVdt(vdtId: string) {
    if (onOpenVdt) {
      await onOpenVdt(vdtId);
      return;
    }
    await selectWorkspaceVdt(vdtId);
  }

  return (
    <div className="vdt-ui-scale flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto px-5 py-8 sm:px-6 sm:py-10">
        <div className="mx-auto flex w-full max-w-6xl flex-col">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 max-w-xl">
              <p className="text-sm text-muted">{{ vdts: "VDTs", files: "Files", comparisons: "Comparisons" }[tab]}</p>
              <h2 className="mt-1 truncate text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
                {activeSummary?.project.name ?? "No project selected"}
              </h2>
              <p className="mt-3 text-base leading-relaxed text-muted">
                {activeSummary
                  ? `${activeSummary.counts.vdts} VDT${activeSummary.counts.vdts === 1 ? "" : "s"} saved in this project`
                  : "Create a project before adding VDTs."}
              </p>
            </div>
            {activeSummary ? (
              <div className="flex flex-wrap gap-2">
                <VdtJsonImport projectId={activeSummary.project.id}
                  projectName={activeSummary.project.name} disabled={createDisabled} />
                <Button
                  type="button"
                  variant="primary"
                  className="rounded-full px-5 shadow-sm"
                  data-testid="new-vdt-button"
                  disabled={createDisabled}
                  icon={<Plus className="h-4 w-4" />}
                  onClick={() => setNewVdtModalOpen(true)}
                >
                  New VDT
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="primary"
                className="rounded-full px-5 shadow-sm"
                disabled={workspace.isMutating}
                icon={<Plus className="h-4 w-4" />}
                onClick={() => void handleCreateProject()}
              >
                Create project
              </Button>
            )}
          </div>

          {activeSummary ? (
            <div className="mt-7 flex flex-wrap gap-1 border-b border-black/10" aria-label="Project content">
              <button type="button" aria-pressed={tab === "vdts"} className={clsx("inline-flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium", tab === "vdts" ? "border-accent text-accent" : "border-transparent text-muted hover:text-ink")} onClick={() => setTab("vdts")} data-testid="project-vdts-tab"><VdtTreeIcon className="h-4 w-4" />VDTs</button>
              <button type="button" aria-pressed={tab === "files"} className={clsx("inline-flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium", tab === "files" ? "border-accent text-accent" : "border-transparent text-muted hover:text-ink")} onClick={() => setTab("files")} data-testid="project-files-tab"><FolderOpen className="h-4 w-4" />Files</button>
              <button type="button" aria-pressed={tab === "comparisons"} className={clsx("inline-flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium", tab === "comparisons" ? "border-accent text-accent" : "border-transparent text-muted hover:text-ink")} onClick={() => setTab("comparisons")} data-testid="project-comparisons-tab"><GitCompare className="h-4 w-4" />Comparisons</button>
            </div>
          ) : null}

          {workspace.error ? (
            <div className="mt-6 rounded-2xl border border-amber-200/80 bg-amber-50/90 px-4 py-3 text-sm text-amber-800">
              {workspace.error}
            </div>
          ) : null}
          {pendingCreate ? (
            <div className="mt-4">
              <Button type="button" size="sm" disabled={workspace.isMutating || workspace.isLoading}
                onClick={() => void createWorkspaceVdt()}>
                Retry creating {pendingCreate.input.name}
              </Button>
            </div>
          ) : workspace.pendingVdtCreate ? (
            <p className="mt-4 text-sm text-muted">Return to the original project to retry its pending VDT creation.</p>
          ) : null}

          <div className="mt-10 min-h-0 flex-1">
            {tab === "files" && activeSummary ? (
              <ProjectFilesPanel key={activeSummary.project.id} projectId={activeSummary.project.id} vdts={rows.map((entry) => ({ id: entry.vdt.id, name: entry.vdt.name }))} />
            ) : tab === "comparisons" && activeSummary ? (
              <ProjectComparisonsPanel projectId={activeSummary.project.id} vdts={rows.filter((entry) => entry.revisionCount > 0).map(({ vdt }) => ({ id: vdt.id, name: vdt.name }))} />
            ) : activeSummary && rows.length > 0 ? (
              <div
                className="grid grid-cols-1 gap-5 md:grid-cols-[repeat(auto-fill,minmax(min(100%,420px),1fr))]"
                data-testid="project-vdt-list"
              >
                {rows.map((entry) => {
                  const unit = entry.rootUnit ?? entry.vdt.unit ?? "";
                  const potentialDiffers = valuesDiffer(entry.rootValue, entry.potentialValue);
                  return (
                  <article key={entry.vdt.id} className="group relative min-w-0" data-testid={`project-vdt-card-${entry.vdt.id}`}>
                    <button
                      type="button"
                      aria-label={`Open ${entry.vdt.name}`}
                      className={clsx(
                        "flex w-full min-w-0 flex-col rounded-2xl border border-black/5 bg-gradient-to-b from-white to-slate-50/80 p-5 text-left shadow-glass",
                        "transition duration-200 motion-reduce:transition-none hover:border-black/[0.08] hover:shadow-lg motion-safe:hover:-translate-y-0.5",
                        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      )}
                      onClick={() => void handleOpenVdt(entry.vdt.id)}
                    >
                      <div className="flex items-start gap-3 pr-8">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-sm">
                          <VdtTreeIcon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <h3 className="line-clamp-2 text-base font-semibold leading-snug tracking-tight text-ink">
                            {entry.vdt.name}
                          </h3>
                          <p className="mt-1 truncate text-sm text-muted">{entry.vdt.rootKpi || "Root KPI not set"}</p>
                        </div>
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-4 border-t border-black/5 pt-4">
                        <div className="min-w-0">
                          <p className="text-[10px] font-medium uppercase tracking-wide text-muted">Base</p>
                          <p className="mt-0.5 truncate text-sm font-semibold text-ink">{formatRootValue(entry.rootValue)}</p>
                          {unit ? <p className="mt-0.5 truncate text-xs text-muted">{unit}</p> : null}
                        </div>
                        {entry.potentialValue !== undefined ? (
                          <div className="min-w-0">
                            <p className="text-[10px] font-medium uppercase tracking-wide text-muted">Potential</p>
                            <p
                              className={clsx(
                                "mt-0.5 truncate text-sm font-semibold",
                                potentialDiffers ? "text-accent" : "text-ink"
                              )}
                            >
                              {formatRootValue(entry.potentialValue)}
                            </p>
                            {unit ? <p className="mt-0.5 truncate text-xs text-muted">{unit}</p> : null}
                          </div>
                        ) : null}
                      </div>
                      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs text-muted">
                          {entry.revisionCount} revision{entry.revisionCount === 1 ? "" : "s"}
                          {typeof entry.nodeCount === "number" ? ` · ${entry.nodeCount} nodes` : ""}
                        </p>
                        <span
                          className={clsx(
                            "inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize",
                            statusClass(entry.vdt.status)
                          )}
                        >
                          {entry.vdt.status}
                        </span>
                      </div>
                    </button>
                    <button
                      type="button"
                      title={`Delete ${entry.vdt.name}`}
                      aria-label={`Delete ${entry.vdt.name}`}
                      disabled={workspace.isMutating}
                      className={clsx(
                        "absolute right-3 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full",
                        "border border-transparent text-muted transition",
                        "opacity-40 hover:bg-red-50 hover:text-red-600 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                        "group-hover:opacity-100 group-focus-within:opacity-100",
                        "disabled:cursor-not-allowed disabled:opacity-45"
                      )}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        if (window.confirm(`Delete "${entry.vdt.name}"?`)) {
                          void deleteWorkspaceVdt(entry.vdt.id);
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                    <VdtCardSettings vdt={entry.vdt} disabled={workspace.isMutating || workspace.isLoading} />
                    <Button type="button" size="sm" className="mt-2" aria-label={`Duplicate ${entry.vdt.name}`}
                      disabled={createDisabled}
                      onClick={() => void createWorkspaceVdt({ expectedProjectId: activeSummary.project.id, source: { kind: "duplicate", vdtId: entry.vdt.id } })}>
                      Duplicate VDT
                    </Button>
                  </article>
                  );
                })}
              </div>
            ) : (
              <div
                className="flex min-h-[320px] flex-col items-center justify-center px-6 py-16 text-center"
                data-testid="project-vdt-empty"
              >
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-blue-100 to-indigo-100 text-blue-600 shadow-glass">
                  <VdtTreeIcon className="h-9 w-9" />
                </div>
                <h3 className="mt-6 text-xl font-semibold tracking-tight text-ink">
                  {activeSummary ? "No VDTs in this project" : "No project selected"}
                </h3>
                <p className="mt-2 max-w-md text-base leading-relaxed text-muted">
                  {activeSummary
                    ? "Create the first VDT for this project. The editor opens automatically after you confirm."
                    : "Create a project to start storing VDTs under project-level metadata."}
                </p>
                <Button
                  type="button"
                  className="mt-8 rounded-full px-6 shadow-sm"
                  variant="primary"
                  data-testid="new-vdt-empty-button"
                  disabled={activeSummary ? createDisabled : workspace.isMutating}
                  icon={<Plus className="h-4 w-4" />}
                  onClick={() => void (activeSummary ? setNewVdtModalOpen(true) : handleCreateProject())}
                >
                  {activeSummary ? "New VDT" : "Create project"}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      <NewVdtModal
        open={newVdtModalOpen}
        onOpenChange={setNewVdtModalOpen}
        onConfirm={handleCreateVdt}
        isSubmitting={workspace.isMutating}
        error={newVdtModalOpen ? workspace.error : undefined}
      />
    </div>
  );
}
