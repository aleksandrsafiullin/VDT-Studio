"use client";

import { useMemo, useState } from "react";
import { GitBranch, Plus, Trash2 } from "lucide-react";
import { clsx } from "clsx";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";
import { NewVdtModal, type NewVdtModalValues } from "./new-vdt-modal";
import { useVdtStudioStore } from "./vdt-store";

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

export function ProjectVdtList({ onOpenVdt }: { onOpenVdt?: (vdtId: string) => void | Promise<void> }) {
  const [newVdtModalOpen, setNewVdtModalOpen] = useState(false);
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

  async function handleCreateProject() {
    const sourceName = project.name?.trim() || "New project";
    await createWorkspaceProject(`${sourceName} project`);
  }

  async function handleCreateVdt(values: NewVdtModalValues) {
    return createWorkspaceVdt({
      rootKpi: values.rootKpi,
      ...(values.unit ? { unit: values.unit } : {}),
      ...(values.timePeriod ? { timePeriod: values.timePeriod } : {})
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
              <p className="text-sm text-muted">VDTs</p>
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
              <Button
                type="button"
                variant="primary"
                className="rounded-full px-5 shadow-sm"
                data-testid="new-vdt-button"
                disabled={workspace.isMutating}
                icon={<Plus className="h-4 w-4" />}
                onClick={() => setNewVdtModalOpen(true)}
              >
                New VDT
              </Button>
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

          {workspace.error ? (
            <div className="mt-6 rounded-2xl border border-amber-200/80 bg-amber-50/90 px-4 py-3 text-sm text-amber-800">
              {workspace.error}
            </div>
          ) : null}

          <div className="mt-10 min-h-0 flex-1">
            {activeSummary && rows.length > 0 ? (
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
                          <GitBranch className="h-4 w-4" />
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
                  <GitBranch className="h-9 w-9" strokeWidth={1.5} />
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
                  disabled={workspace.isMutating}
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
      />
    </div>
  );
}
