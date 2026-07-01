"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { FolderPlus, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, SelectInput, TextInput } from "@/components/ui/field";
import { projectMetadataText } from "@/lib/project-metadata";
import { useVdtStudioStore } from "./vdt-store";

export function ProjectManagementPanel({ urlScopedProjectId }: { urlScopedProjectId?: string }) {
  const workspace = useVdtStudioStore((state) => state.workspace);
  const project = useVdtStudioStore((state) => state.project);
  const createWorkspaceProject = useVdtStudioStore((state) => state.createWorkspaceProject);
  const selectWorkspaceProject = useVdtStudioStore((state) => state.selectWorkspaceProject);
  const updateWorkspaceProjectDetails = useVdtStudioStore((state) => state.updateWorkspaceProjectDetails);
  const activeSummary = useMemo(
    () => workspace.projectSummaries.find((entry) => entry.project.id === workspace.activeProjectId),
    [workspace.activeProjectId, workspace.projectSummaries]
  );

  const [name, setName] = useState("");
  const [clientName, setClientName] = useState("");
  const [siteName, setSiteName] = useState("");
  const [year, setYear] = useState("");

  useEffect(() => {
    const projectRecord = activeSummary?.project;
    setName(projectRecord?.name ?? "");
    setClientName(projectMetadataText(projectRecord?.metadata, "clientName"));
    setSiteName(projectMetadataText(projectRecord?.metadata, "siteName"));
    setYear(projectMetadataText(projectRecord?.metadata, "year"));
  }, [activeSummary?.project]);

  const dirty = activeSummary
    ? name.trim() !== activeSummary.project.name ||
      clientName.trim() !== projectMetadataText(activeSummary.project.metadata, "clientName") ||
      siteName.trim() !== projectMetadataText(activeSummary.project.metadata, "siteName") ||
      year.trim() !== projectMetadataText(activeSummary.project.metadata, "year")
    : false;

  const showProjectSwitcher = !urlScopedProjectId && workspace.projectSummaries.length > 0;

  async function handleCreateProject() {
    const sourceName = project.name?.trim() || "New project";
    await createWorkspaceProject(`${sourceName} project`);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeSummary || !dirty) return;
    await updateWorkspaceProjectDetails(activeSummary.project.id, {
      name,
      clientName,
      siteName,
      year
    });
  }

  return (
    <section className="vdt-ui-scale flex h-full min-h-0 flex-col border-r border-black/5 bg-white/70 backdrop-blur-xl">
      <div className="border-b border-black/5 px-4 py-4">
        <p className="text-xs text-muted">Project</p>
        <h2 className="mt-0.5 text-sm font-medium tracking-tight text-ink">Project management</h2>
        <p className="mt-1 text-xs leading-5 text-muted">Project data and project-level context</p>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {showProjectSwitcher ? (
          <div className="mb-5">
            <Field label="Active project">
              <SelectInput
                value={activeSummary?.project.id ?? ""}
                className="rounded-xl border-black/10"
                disabled={workspace.isLoading || workspace.isMutating}
                onChange={(event) => void selectWorkspaceProject(event.target.value)}
              >
                {workspace.projectSummaries.map((summary) => (
                  <option key={summary.project.id} value={summary.project.id}>
                    {summary.project.name}
                  </option>
                ))}
              </SelectInput>
            </Field>
          </div>
        ) : urlScopedProjectId && activeSummary ? (
          <div className="mb-5 rounded-xl border border-black/5 bg-white/60 px-3 py-2.5">
            <p className="text-xs text-muted">Project</p>
            <p className="mt-0.5 truncate text-sm font-medium tracking-tight text-ink">{activeSummary.project.name}</p>
          </div>
        ) : null}

        {activeSummary ? (
          <form className="grid gap-4" onSubmit={(event) => void handleSubmit(event)}>
            <Field label="Project name">
              <TextInput
                value={name}
                className="rounded-xl border-black/10"
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field label="Client name">
              <TextInput
                value={clientName}
                placeholder="Client"
                className="rounded-xl border-black/10"
                onChange={(event) => setClientName(event.target.value)}
              />
            </Field>
            <Field label="Site">
              <TextInput
                value={siteName}
                placeholder="Site, plant, or operation"
                className="rounded-xl border-black/10"
                onChange={(event) => setSiteName(event.target.value)}
              />
            </Field>
            <Field label="Year">
              <TextInput
                inputMode="numeric"
                value={year}
                placeholder="2026"
                className="rounded-xl border-black/10"
                onChange={(event) => setYear(event.target.value)}
              />
            </Field>

            <div className="flex flex-wrap gap-2">
              <div className="rounded-2xl border border-black/5 bg-white/80 px-3 py-2.5 shadow-glass">
                <p className="text-sm font-semibold tracking-tight text-ink">{activeSummary.counts.vdts}</p>
                <p className="mt-0.5 text-xs text-muted">VDTs</p>
              </div>
              <div className="rounded-2xl border border-black/5 bg-white/80 px-3 py-2.5 shadow-glass">
                <p className="text-sm font-semibold tracking-tight text-ink">{activeSummary.counts.revisions}</p>
                <p className="mt-0.5 text-xs text-muted">Revisions</p>
              </div>
            </div>

            <Button
              type="submit"
              variant="primary"
              className="rounded-full px-5 shadow-sm"
              data-testid="save-project-button"
              disabled={!dirty || workspace.isMutating || !name.trim()}
              icon={<Save className="h-4 w-4" />}
            >
              Save project
            </Button>
          </form>
        ) : (
          <div className="rounded-2xl border border-black/5 bg-white/80 p-4 shadow-glass">
            <p className="text-sm font-medium tracking-tight text-ink">No saved project selected</p>
            <p className="mt-2 text-xs leading-5 text-muted">
              Create a project to store VDTs and project-level metadata separately from the VDT editor.
            </p>
            <Button
              type="button"
              className="mt-4 rounded-full px-5 shadow-sm"
              variant="primary"
              disabled={workspace.isMutating}
              icon={<FolderPlus className="h-4 w-4" />}
              onClick={() => void handleCreateProject()}
            >
              Create project
            </Button>
          </div>
        )}

        {workspace.error ? (
          <div className="mt-4 rounded-2xl border border-amber-200/80 bg-amber-50/90 px-3 py-2 text-xs leading-5 text-amber-800">
            {workspace.error}
          </div>
        ) : null}
      </div>
    </section>
  );
}
