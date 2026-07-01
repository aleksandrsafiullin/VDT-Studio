"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Folder, Plus, Trash2 } from "lucide-react";
import { clsx } from "clsx";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/field";
import type { StoredProjectSummary } from "@/lib/vdt-storage-client";
import { projectCardDetailRows } from "@/lib/project-metadata";
import { SettingsModal } from "./settings-modal";
import { useVdtStudioStore } from "./vdt-store";

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function ProjectsHomeSkeletonCards() {
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
      {Array.from({ length: 3 }, (_, index) => (
        <div
          key={index}
          className="motion-safe:animate-pulse flex h-[13.5rem] flex-col rounded-2xl border border-black/5 bg-gradient-to-b from-white to-slate-50/80 p-5 shadow-glass"
        >
          <div className="h-6 w-2/3 rounded-md bg-slate-200/80" />
          <div className="mt-2 space-y-1">
            <div className="grid h-4 grid-cols-[4.5rem_1fr] gap-x-2">
              <div className="h-3 w-10 rounded-md bg-slate-200/60" />
              <div className="h-3 w-4/5 rounded-md bg-slate-200/50" />
            </div>
            <div className="grid h-4 grid-cols-[4.5rem_1fr] gap-x-2">
              <div className="h-3 w-8 rounded-md bg-slate-200/60" />
              <div className="h-3 w-3/5 rounded-md bg-slate-200/50" />
            </div>
            <div className="grid h-4 grid-cols-[4.5rem_1fr] gap-x-2">
              <div className="h-3 w-8 rounded-md bg-slate-200/60" />
              <div className="h-3 w-2/5 rounded-md bg-slate-200/50" />
            </div>
          </div>
          <div className="mt-3 flex h-7 gap-2">
            <div className="h-6 w-16 rounded-full bg-slate-200/70" />
            <div className="h-6 w-20 rounded-full bg-slate-200/70" />
          </div>
          <div className="mt-auto h-4 w-1/3 rounded-md bg-slate-200/60" />
        </div>
      ))}
    </div>
  );
}

function ProjectCardMetadataList({
  projectId,
  metadata
}: {
  projectId: string;
  metadata: Record<string, unknown> | undefined;
}) {
  const detailRows = projectCardDetailRows(metadata);

  return (
    <dl
      className="mt-2 shrink-0 space-y-1"
      data-testid={`project-card-details-${projectId}`}
    >
      {detailRows.map((row) => (
        <div key={row.key} className="grid h-4 grid-cols-[4.5rem_1fr] items-center gap-x-2 text-xs leading-4">
          <dt className="text-muted">{row.label}</dt>
          <dd className={clsx("truncate", row.value ? "text-ink" : "text-transparent")}>
            {row.value || "\u00A0"}
          </dd>
        </div>
      ))}
    </dl>
  );
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
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" data-testid="projects-home-list">
      {summaries.map((entry) => (
        <article
          key={entry.project.id}
          className="group relative"
          data-testid={`project-card-${entry.project.id}`}
        >
          <Link
            href={`/projects/${entry.project.id}`}
            data-testid={`open-project-${entry.project.id}`}
            className={clsx(
              "flex h-[13.5rem] w-full flex-col rounded-2xl border border-black/5 bg-gradient-to-b from-white to-slate-50/80 p-5 shadow-glass",
              "transition duration-200 motion-reduce:transition-none hover:border-black/[0.08] hover:shadow-lg motion-safe:hover:-translate-y-0.5",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            )}
          >
            <h3 className="line-clamp-1 h-6 shrink-0 pr-8 text-base font-semibold leading-6 tracking-tight text-ink">
              {entry.project.name}
            </h3>
            <ProjectCardMetadataList projectId={entry.project.id} metadata={entry.project.metadata} />
            <div className="mt-3 flex h-7 shrink-0 flex-nowrap items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-slate-100/90 px-2.5 py-0.5 text-xs text-muted">
                {entry.counts.vdts} VDT{entry.counts.vdts === 1 ? "" : "s"}
              </span>
              <span className="inline-flex items-center rounded-full bg-slate-100/90 px-2.5 py-0.5 text-xs text-muted">
                {entry.counts.revisions} revision{entry.counts.revisions === 1 ? "" : "s"}
              </span>
            </div>
            <p className="mt-auto shrink-0 pt-2 text-xs leading-4 text-muted">
              Updated {formatUpdatedAt(entry.project.updatedAt)}
            </p>
          </Link>
          <button
            type="button"
            title={`Delete ${entry.project.name}`}
            aria-label={`Delete ${entry.project.name}`}
            disabled={isMutating}
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
              void onDeleteProject(entry.project.id, entry.project.name);
            }}
          >
            <Trash2 className="h-4 w-4" />
          </button>
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
    <main className="vdt-apple-home flex min-h-screen flex-col bg-apple-gray text-ink">
      <div
        className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(47,111,237,0.08),transparent)]"
        aria-hidden="true"
      />

      <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-black/5 bg-white/70 px-5 backdrop-blur-xl">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-sm">
            <Folder className="h-4 w-4" />
          </div>
          <h1 className="truncate text-[15px] font-medium tracking-tight text-ink">VDT Studio</h1>
        </div>
        <SettingsModal />
      </header>

      <div
        className="relative mx-auto flex w-full max-w-6xl flex-1 flex-col px-5 py-12 sm:px-6 sm:py-16"
        data-testid="projects-home"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-xl">
            <p className="text-sm text-muted">Projects</p>
            <h2 className="mt-1 text-4xl font-semibold tracking-tight text-ink sm:text-5xl">Your workspaces</h2>
            <p className="mt-3 text-base leading-relaxed text-muted">
              Open a project to manage VDTs or create a new one.
            </p>
          </div>
          <Button
            type="button"
            variant="primary"
            className="rounded-full px-5 shadow-sm"
            data-testid="create-project-button"
            aria-expanded={createOpen}
            aria-controls="create-project-form"
            disabled={workspace.isMutating}
            icon={<Plus className="h-4 w-4" />}
            onClick={() => setCreateOpen(true)}
          >
            Create project
          </Button>
        </div>

        <div
          className={clsx(
            "grid transition-all duration-200 ease-out",
            createOpen ? "mt-8 grid-rows-[1fr] opacity-100" : "mt-0 grid-rows-[0fr] opacity-0"
          )}
        >
          <div className="overflow-hidden">
            {createOpen ? (
              <form
                id="create-project-form"
                className="rounded-2xl border border-black/5 bg-white/90 p-6 shadow-glass backdrop-blur-sm"
                data-testid="create-project-form"
                onSubmit={(event) => void handleCreateProject(event)}
              >
                <label className="block text-sm font-medium text-ink" htmlFor="new-project-name">
                  Project name
                </label>
                <div className="mt-3 flex flex-wrap items-end gap-3">
                  <TextInput
                    id="new-project-name"
                    data-testid="create-project-name-input"
                    value={projectName}
                    placeholder="Mining operations model"
                    className="min-w-[220px] flex-1 rounded-xl border-black/10"
                    onChange={(event) => setProjectName(event.target.value)}
                  />
                  <Button
                    type="submit"
                    variant="primary"
                    className="rounded-full px-5"
                    disabled={workspace.isMutating || !projectName.trim()}
                  >
                    Create
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="rounded-full"
                    onClick={() => setCreateOpen(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            ) : null}
          </div>
        </div>

        {workspace.error ? (
          <div className="mt-6 rounded-2xl border border-amber-200/80 bg-amber-50/90 px-4 py-3 text-sm text-amber-800">
            {workspace.error}
          </div>
        ) : null}

        <div className="mt-10 min-h-0 flex-1" aria-busy={workspace.isLoading}>
          {workspace.isLoading ? (
            <>
              <span className="sr-only">Loading projects</span>
              <ProjectsHomeSkeletonCards />
            </>
          ) : workspace.projectSummaries.length === 0 ? (
            <div
              className="flex min-h-[320px] flex-col items-center justify-center px-6 py-16 text-center"
              data-testid="projects-home-empty"
            >
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-blue-100 to-indigo-100 text-blue-600 shadow-glass">
                <Folder className="h-9 w-9" strokeWidth={1.5} />
              </div>
              <h3 className="mt-6 text-xl font-semibold tracking-tight text-ink">No projects yet</h3>
              <p className="mt-2 max-w-md text-base leading-relaxed text-muted">
                Create your first project to store VDT models, revisions, and project metadata.
              </p>
              <Button
                type="button"
                className="mt-8 rounded-full px-6 shadow-sm"
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
