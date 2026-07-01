"use client";

import { useMemo, useState } from "react";
import { ExternalLink, GitBranch, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";
import { NewVdtModal, type NewVdtModalValues } from "./new-vdt-modal";
import { useVdtStudioStore } from "./vdt-store";

function formatRootValue(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? formatNumber(value) : "Not calculated";
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
    <div className="vdt-ui-scale flex h-full min-h-0 flex-col bg-canvas">
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-line bg-white px-5 py-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-normal text-slate-500">Project workspace</p>
          <h2 className="mt-1 truncate text-lg font-semibold text-ink">
            {activeSummary?.project.name ?? "No project selected"}
          </h2>
          <p className="mt-1 text-sm text-muted">
            {activeSummary
              ? `${activeSummary.counts.vdts} VDTs saved in this project`
              : "Create a project before adding VDTs."}
          </p>
        </div>
        {activeSummary ? (
          <Button
            type="button"
            variant="primary"
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
            disabled={workspace.isMutating}
            icon={<Plus className="h-4 w-4" />}
            onClick={() => void handleCreateProject()}
          >
            Create project
          </Button>
        )}
      </header>

      {workspace.error ? (
        <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-5 py-2 text-sm text-amber-800">
          {workspace.error}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto p-5">
        {activeSummary && rows.length > 0 ? (
          <div className="overflow-hidden rounded-md border border-line bg-white shadow-panel">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                <thead className="border-b border-line bg-slate-50 text-xs font-semibold uppercase tracking-normal text-slate-500">
                  <tr>
                    <th className="px-4 py-3">VDT</th>
                    <th className="px-4 py-3">Root KPI</th>
                    <th className="px-4 py-3">Root KPI value</th>
                    <th className="px-4 py-3">Unit</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((entry) => (
                    <tr key={entry.vdt.id} className="align-middle hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="flex min-w-0 items-start gap-3">
                          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-900 text-white">
                            <GitBranch className="h-4 w-4" />
                          </span>
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-ink">{entry.vdt.name}</p>
                            <p className="mt-0.5 text-xs text-muted">
                              {entry.revisionCount} revisions
                              {typeof entry.nodeCount === "number" ? ` - ${entry.nodeCount} nodes` : ""}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="max-w-[220px] px-4 py-3 text-graphite">
                        <span className="block truncate">{entry.vdt.rootKpi || "Not set"}</span>
                      </td>
                      <td className="px-4 py-3 font-medium text-ink">{formatRootValue(entry.rootValue)}</td>
                      <td className="px-4 py-3 text-graphite">{entry.rootUnit ?? entry.vdt.unit ?? "Not set"}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${statusClass(entry.vdt.status)}`}>
                          {entry.vdt.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            size="sm"
                            icon={<ExternalLink className="h-4 w-4" />}
                            onClick={() => void handleOpenVdt(entry.vdt.id)}
                          >
                            Open
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="danger"
                            title={`Delete ${entry.vdt.name}`}
                            aria-label={`Delete ${entry.vdt.name}`}
                            disabled={workspace.isMutating}
                            icon={<Trash2 className="h-4 w-4" />}
                            onClick={() => {
                              if (window.confirm(`Delete "${entry.vdt.name}"?`)) {
                                void deleteWorkspaceVdt(entry.vdt.id);
                              }
                            }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="flex h-full min-h-[280px] items-center justify-center rounded-md border border-dashed border-line bg-white p-6 text-center">
            <div className="max-w-md">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-md bg-slate-900 text-white">
                <GitBranch className="h-5 w-5" />
              </div>
              <h3 className="mt-4 text-base font-semibold text-ink">
                {activeSummary ? "No VDTs in this project" : "No project selected"}
              </h3>
              <p className="mt-2 text-sm leading-6 text-muted">
                {activeSummary
                  ? "Create the first VDT for this project. The editor opens automatically after you confirm."
                  : "Create a project to start storing VDTs under project-level metadata."}
              </p>
              <Button
                type="button"
                className="mt-4"
                variant="primary"
                disabled={workspace.isMutating}
                icon={<Plus className="h-4 w-4" />}
                onClick={() => void (activeSummary ? setNewVdtModalOpen(true) : handleCreateProject())}
              >
                {activeSummary ? "New VDT" : "Create project"}
              </Button>
            </div>
          </div>
        )}
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
