"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Folder, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/field";
import type { StoredProjectSummary } from "@/lib/vdt-storage-client";
import { SettingsModal } from "./settings-modal";
import { useVdtStudioStore } from "./vdt-store";

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function ProjectsHomeProjectCards({
  summaries,
  isMutating,
  onDeleteProject
}: {
  summaries: StoredProjectSummary[];
  isMutating: boolean;
  onDeleteProject: (projectId: string, name: string) => void | Promise<void>;
}) {
  if (summaries.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2" data-testid="projects-home-list">
      {summaries.map((entry) => (
        <article
          key={entry.project.id}
          className="flex flex-col rounded-md border border-line bg-white p-4 shadow-panel"
          data-testid={`project-card-${entry.project.id}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate text-base font-semibold text-ink">{entry.project.name}</h3>
              <p className="mt-1 text-sm text-muted">
                {entry.counts.vdts} VDT{entry.counts.vdts === 1 ? "" : "s"} · {entry.counts.revisions} revision
                {entry.counts.revisions === 1 ? "" : "s"}
              </p>
              <p className="mt-1 text-xs text-muted">Updated {formatUpdatedAt(entry.project.updatedAt)}</p>
            </div>
            <Button
              type="button"
              size="icon"
              variant="danger"
              title={`Delete ${entry.project.name}`}
              aria-label={`Delete ${entry.project.name}`}
              disabled={isMutating}
              icon={<Trash2 className="h-4 w-4" />}
              onClick={() => void onDeleteProject(entry.project.id, entry.project.name)}
            />
          </div>
          <div className="mt-4">
            <Link
              href={`/projects/${entry.project.id}`}
              className="inline-flex h-9 items-center justify-center rounded-md border border-accent bg-accent px-3 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              data-testid={`open-project-${entry.project.id}`}
            >
              Open project
            </Link>
          </div>
        </article>
      ))}
    </div>
  );
}

export function ProjectsHomePage() {
  const router = useRouter();
  const workspace = useVdtStudioStore((state) => state.workspace);
  const refreshWorkspace = useVdtStudioStore((state) => state.refreshWorkspace);
  const clearHomeWorkspaceContext = useVdtStudioStore((state) => state.clearHomeWorkspaceContext);
  const createWorkspaceProject = useVdtStudioStore((state) => state.createWorkspaceProject);
  const deleteWorkspaceProject = useVdtStudioStore((state) => state.deleteWorkspaceProject);
  const [createOpen, setCreateOpen] = useState(false);
  const [projectName, setProjectName] = useState("");

  useEffect(() => {
    clearHomeWorkspaceContext();
    void refreshWorkspace();
  }, [clearHomeWorkspaceContext, refreshWorkspace]);

  async function handleCreateProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = projectName.trim();
    if (!trimmed) {
      return;
    }
    const created = await createWorkspaceProject(trimmed);
    if (!created) {
      return;
    }
    const projectId = useVdtStudioStore.getState().workspace.activeProjectId;
    setProjectName("");
    setCreateOpen(false);
    if (projectId) {
      router.push(`/projects/${projectId}`);
    }
  }

  async function handleDeleteProject(projectId: string, name: string) {
    if (!window.confirm(`Delete "${name}" and all saved VDTs in this project?`)) {
      return;
    }
    await deleteWorkspaceProject(projectId);
  }

  return (
    <main className="flex min-h-screen flex-col bg-canvas text-ink">
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-line bg-white px-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-900 text-white">
            <Folder className="h-4 w-4" />
          </div>
          <h1 className="truncate text-sm font-semibold text-ink">VDT Studio</h1>
        </div>
        <SettingsModal />
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-8" data-testid="projects-home">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-normal text-slate-500">Projects</p>
            <h2 className="mt-1 text-2xl font-semibold text-ink">Your workspaces</h2>
            <p className="mt-1 text-sm text-muted">Open a project to manage VDTs or create a new one.</p>
          </div>
          <Button
            type="button"
            variant="primary"
            data-testid="create-project-button"
            disabled={workspace.isMutating}
            icon={<Plus className="h-4 w-4" />}
            onClick={() => setCreateOpen(true)}
          >
            Create project
          </Button>
        </div>

        {createOpen ? (
          <form
            className="mt-6 rounded-md border border-line bg-white p-4 shadow-panel"
            data-testid="create-project-form"
            onSubmit={(event) => void handleCreateProject(event)}
          >
            <label className="block text-sm font-medium text-ink" htmlFor="new-project-name">
              Project name
            </label>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <TextInput
                id="new-project-name"
                data-testid="create-project-name-input"
                value={projectName}
                placeholder="Mining operations model"
                onChange={(event) => setProjectName(event.target.value)}
              />
              <Button type="submit" variant="primary" disabled={workspace.isMutating || !projectName.trim()}>
                Create
              </Button>
              <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : null}

        {workspace.error ? (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {workspace.error}
          </div>
        ) : null}

        <div className="mt-6 min-h-0 flex-1">
          {workspace.isLoading ? (
            <p className="text-sm text-muted">Loading projects...</p>
          ) : workspace.projectSummaries.length === 0 ? (
            <div
              className="flex min-h-[280px] flex-col items-center justify-center rounded-md border border-dashed border-line bg-white p-8 text-center"
              data-testid="projects-home-empty"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-900 text-white">
                <Folder className="h-5 w-5" />
              </div>
              <h3 className="mt-4 text-base font-semibold text-ink">No projects yet</h3>
              <p className="mt-2 max-w-md text-sm leading-6 text-muted">
                Create your first project to store VDT models, revisions, and project metadata.
              </p>
              <Button
                type="button"
                className="mt-4"
                variant="primary"
                disabled={workspace.isMutating}
                icon={<Plus className="h-4 w-4" />}
                onClick={() => setCreateOpen(true)}
              >
                Create project
              </Button>
            </div>
          ) : (
            <ProjectsHomeProjectCards
              summaries={workspace.projectSummaries}
              isMutating={workspace.isMutating}
              onDeleteProject={handleDeleteProject}
            />
          )}
        </div>
      </div>
    </main>
  );
}
