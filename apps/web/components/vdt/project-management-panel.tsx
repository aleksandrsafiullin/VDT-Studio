"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { FolderPlus, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, SelectInput, TextInput } from "@/components/ui/field";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { useVdtStudioStore } from "./vdt-store";

function metadataText(metadata: Record<string, unknown> | undefined, key: string): string {
  const value = metadata?.[key];
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

export function ProjectManagementPanel() {
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
    setClientName(metadataText(projectRecord?.metadata, "clientName"));
    setSiteName(metadataText(projectRecord?.metadata, "siteName"));
    setYear(metadataText(projectRecord?.metadata, "year"));
  }, [activeSummary?.project]);

  const dirty = activeSummary
    ? name.trim() !== activeSummary.project.name ||
      clientName.trim() !== metadataText(activeSummary.project.metadata, "clientName") ||
      siteName.trim() !== metadataText(activeSummary.project.metadata, "siteName") ||
      year.trim() !== metadataText(activeSummary.project.metadata, "year")
    : false;

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
    <Panel className="flex h-full min-h-0 flex-col border-r">
      <PanelHeader
        title="Project management"
        subtitle="Project data and project-level context"
        action={
          <Button
            type="button"
            size="icon"
            variant="ghost"
            title="Create project"
            aria-label="Create project"
            disabled={workspace.isMutating}
            icon={<FolderPlus className="h-4 w-4" />}
            onClick={() => void handleCreateProject()}
          />
        }
      />
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {workspace.projectSummaries.length > 0 ? (
          <div className="mb-5">
            <Field label="Active project">
              <SelectInput
                value={activeSummary?.project.id ?? ""}
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
        ) : null}

        {activeSummary ? (
          <form className="grid gap-4" onSubmit={(event) => void handleSubmit(event)}>
            <Field label="Project name">
              <TextInput value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
            <Field label="Client name">
              <TextInput
                value={clientName}
                placeholder="Client"
                onChange={(event) => setClientName(event.target.value)}
              />
            </Field>
            <Field label="Site / mine">
              <TextInput
                value={siteName}
                placeholder="Mine, plant, or operation"
                onChange={(event) => setSiteName(event.target.value)}
              />
            </Field>
            <Field label="Year">
              <TextInput
                inputMode="numeric"
                value={year}
                placeholder="2026"
                onChange={(event) => setYear(event.target.value)}
              />
            </Field>

            <div className="grid grid-cols-2 gap-2 rounded-md border border-line bg-slate-50 p-3 text-xs">
              <div>
                <p className="font-semibold text-ink">{activeSummary.counts.vdts}</p>
                <p className="mt-0.5 text-muted">VDTs</p>
              </div>
              <div>
                <p className="font-semibold text-ink">{activeSummary.counts.revisions}</p>
                <p className="mt-0.5 text-muted">Revisions</p>
              </div>
            </div>

            <div className="rounded-md border border-dashed border-line bg-white p-3 text-xs leading-5 text-muted">
              Additional project data will appear here when the project schema is extended.
            </div>

            <Button
              type="submit"
              variant="primary"
              disabled={!dirty || workspace.isMutating || !name.trim()}
              icon={<Save className="h-4 w-4" />}
            >
              Save project
            </Button>
          </form>
        ) : (
          <div className="rounded-md border border-dashed border-line bg-slate-50 p-4">
            <p className="text-sm font-semibold text-ink">No saved project selected</p>
            <p className="mt-2 text-xs leading-5 text-muted">
              Create a project to store VDTs and project-level metadata separately from the VDT editor.
            </p>
            <Button
              type="button"
              className="mt-4"
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
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
            {workspace.error}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
