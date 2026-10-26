"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Folder, Plus, Search, Trash2, X } from "lucide-react";
import { clsx } from "clsx";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/field";
import type { StoredProjectSummary } from "@/lib/vdt-storage-client";
import { projectCardDetailRows, projectMatchesSearch, type ProjectCardMetadata } from "@/lib/project-metadata";
import { CreateProjectDialog } from "./create-project-dialog";
import { SettingsModal } from "./settings-modal";
import { useVdtStudioStore } from "./vdt-store";
import styles from "./projects-home-page.module.css";

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function ProjectsHomeSkeletonCards() {
  return (
    <div className={styles.grid} aria-hidden="true">
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
    <div className={styles.grid} data-testid="projects-home-list">
      {summaries.map((entry) => (
        <article
          key={entry.project.id}
          className="group relative min-w-0"
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
  const [createError, setCreateError] = useState<string>();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const visibleSummaries = workspace.projectSummaries.filter((entry) => projectMatchesSearch(entry.project, searchQuery));

  useEffect(() => {
    clearHomeWorkspaceContext();
    void refreshWorkspace();
  }, [clearHomeWorkspaceContext, refreshWorkspace]);

  useEffect(() => {
    if (searchOpen) searchInput.current?.focus();
  }, [searchOpen]);

  function openCreateDialog() {
    setCreateError(undefined);
    setCreateOpen(true);
  }

  function closeSearch() {
    setSearchQuery("");
    setSearchOpen(false);
    searchButton.current?.focus();
  }

  async function handleCreateProject(name: string, details: ProjectCardMetadata) {
    setCreateError(undefined);
    const created = await createWorkspaceProject(name, details);
    if (!created) {
      setCreateError(useVdtStudioStore.getState().workspace.error ?? "Project could not be created. Try again.");
      return;
    }
    const projectId = useVdtStudioStore.getState().workspace.activeProjectId;
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
    <main className={clsx(styles.page, "vdt-apple-home flex min-h-screen flex-col bg-apple-gray text-ink")}>
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
        className={clsx(styles.content, "relative mx-auto flex flex-1 flex-col py-12 sm:py-16")}
        data-testid="projects-home"
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-3xl font-semibold tracking-tight text-ink">Projects</h2>
          <div className="flex items-center gap-3">
            <Button
              ref={searchButton}
              type="button"
              className="rounded-full px-4"
              data-testid="search-projects-button"
              aria-label="Search projects"
              aria-expanded={searchOpen}
              aria-controls="project-search"
              icon={<Search className="h-4 w-4" />}
              onClick={() => searchOpen ? closeSearch() : setSearchOpen(true)}
            >
              Search
            </Button>
            <Button
              type="button"
              variant="primary"
              className="rounded-full px-5 shadow-sm"
              data-testid="create-project-button"
              aria-expanded={createOpen}
              aria-haspopup="dialog"
              aria-controls="create-project-dialog"
              disabled={workspace.isMutating}
              icon={<Plus className="h-4 w-4" />}
              onClick={openCreateDialog}
            >
              Create project
            </Button>
          </div>
        </div>

        {searchOpen ? (
          <div id="project-search" role="search" aria-label="Project search" className="mt-6 flex items-center gap-3 rounded-2xl border border-black/10 bg-white/90 px-4 py-2 shadow-sm">
            <Search className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
            <TextInput
              ref={searchInput}
              type="search"
              aria-label="Search projects by any field"
              data-testid="project-search-input"
              placeholder="Search all project fields…"
              className="min-w-0 border-0 bg-transparent px-0 shadow-none focus:ring-0"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); closeSearch(); } }}
            />
            <Button type="button" variant="ghost" size="icon" className="shrink-0 rounded-full" aria-label="Close project search" onClick={closeSearch}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : null}

        {createOpen ? (
          <CreateProjectDialog isMutating={workspace.isMutating} error={createError} onCreate={handleCreateProject} onClose={() => setCreateOpen(false)} />
        ) : null}

        {workspace.error && !createOpen ? (
          <div className="mt-6 rounded-2xl border border-amber-200/80 bg-amber-50/90 px-4 py-3 text-sm text-amber-800">
            {workspace.error}
          </div>
        ) : null}

        <div className="mt-8 min-h-0 flex-1" aria-busy={workspace.isLoading}>
          {searchOpen && !workspace.isLoading ? (
            <p role="status" className="mb-4 text-sm text-muted">{visibleSummaries.length} of {workspace.projectSummaries.length} projects</p>
          ) : null}
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
                onClick={openCreateDialog}
              >
                Create project
              </Button>
            </div>
          ) : visibleSummaries.length === 0 ? (
            <div className="rounded-2xl border border-black/5 bg-white/70 px-6 py-16 text-center" data-testid="projects-home-no-results">
              <Search className="mx-auto h-8 w-8 text-muted" aria-hidden="true" />
              <h3 className="mt-4 text-lg font-semibold text-ink">No projects found</h3>
              <p className="mt-2 text-sm text-muted">Try another name, client, site, year, or project detail.</p>
              <Button type="button" className="mt-5 rounded-full px-5" onClick={() => { setSearchQuery(""); searchInput.current?.focus(); }}>Clear search</Button>
            </div>
          ) : (
            <ProjectsHomeProjectCards
              summaries={visibleSummaries}
              isMutating={workspace.isMutating}
              onDeleteProject={handleDeleteProject}
            />
          )}
        </div>
      </div>
    </main>
  );
}
