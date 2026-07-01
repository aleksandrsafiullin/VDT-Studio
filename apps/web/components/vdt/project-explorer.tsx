"use client";

import { useState, type ReactNode } from "react";
import { Check, FileJson, GitBranch, History, Loader2, MessageSquare, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { listVersions, type VdtProject } from "@vdt-studio/vdt-core";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/field";
import type {
  StoredProjectExplorerSummary,
  StoredProjectSummary,
  StoredVdtRecord,
  StoredVdtStatus
} from "@/lib/vdt-storage-client";
import { useVdtStudioStore, type GenerateActivityState } from "./vdt-store";

interface ProjectExplorerProps {
  project: VdtProject;
  generateActivity?: GenerateActivityState | undefined;
  storedSummary?: StoredProjectExplorerSummary | undefined;
}

interface ExplorerRow {
  id: string;
  label: string;
  detail: string;
  Icon: typeof GitBranch;
}

export function ProjectExplorer({ project, generateActivity, storedSummary: initialStoredSummary }: ProjectExplorerProps) {
  const workspace = useVdtStudioStore((state) => state.workspace);
  const createWorkspaceProject = useVdtStudioStore((state) => state.createWorkspaceProject);
  const renameWorkspaceProject = useVdtStudioStore((state) => state.renameWorkspaceProject);
  const deleteWorkspaceProject = useVdtStudioStore((state) => state.deleteWorkspaceProject);
  const createWorkspaceVdt = useVdtStudioStore((state) => state.createWorkspaceVdt);
  const selectWorkspaceProject = useVdtStudioStore((state) => state.selectWorkspaceProject);
  const selectWorkspaceVdt = useVdtStudioStore((state) => state.selectWorkspaceVdt);
  const renameWorkspaceVdt = useVdtStudioStore((state) => state.renameWorkspaceVdt);
  const setWorkspaceVdtStatus = useVdtStudioStore((state) => state.setWorkspaceVdtStatus);
  const deleteWorkspaceVdt = useVdtStudioStore((state) => state.deleteWorkspaceVdt);
  const saveActiveWorkspaceVdt = useVdtStudioStore((state) => state.saveActiveWorkspaceVdt);
  const [creatingProject, setCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [creatingVdt, setCreatingVdt] = useState(false);
  const [newVdtName, setNewVdtName] = useState("");
  const [editingProjectId, setEditingProjectId] = useState<string | undefined>();
  const [editingProjectName, setEditingProjectName] = useState("");
  const [editingVdtId, setEditingVdtId] = useState<string | undefined>();
  const [editingVdtName, setEditingVdtName] = useState("");
  const versions = listVersions(project);
  const projectSummaries = initialStoredSummary?.projects ?? workspace.projectSummaries;
  const activeProjectId = initialStoredSummary ? projectSummaries[0]?.project.id : workspace.activeProjectId;
  const activeVdtId = initialStoredSummary ? projectSummaries[0]?.vdts[0]?.vdt.id : workspace.activeVdtId;
  const activeSummary = activeProjectId
    ? projectSummaries.find((entry) => entry.project.id === activeProjectId)
    : projectSummaries[0];
  const storedTotals = projectSummaries.reduce(
    (totals, entry) => ({
      projects: totals.projects + 1,
      vdts: totals.vdts + entry.counts.vdts,
      revisions: totals.revisions + entry.counts.revisions,
      conversations: totals.conversations + entry.counts.conversations,
      comparisons: totals.comparisons + entry.counts.comparisons
    }),
    { projects: 0, vdts: 0, revisions: 0, conversations: 0, comparisons: 0 }
  );
  const activeConversationCount = generateActivity ? 1 : 0;
  const threadLabel = activeConversationCount === 1 ? "thread" : "threads";
  const activeRunLabel = generateActivity
    ? generateActivity.status === "needs_user_input"
      ? "waiting for input"
      : generateActivity.status
    : "none active";
  const rows: ExplorerRow[] = [
    {
      id: "vdts",
      label: "Canvas",
      detail: `${project.graph.nodes.length} nodes in active VDT`,
      Icon: GitBranch
    },
    {
      id: "conversations",
      label: "Conversations",
      detail: `${activeConversationCount} active agent ${threadLabel} · ${activeRunLabel}`,
      Icon: MessageSquare
    },
    {
      id: "comparisons",
      label: "Comparisons",
      detail: versions.length > 0 ? `${versions.length} snapshot baseline${versions.length === 1 ? "" : "s"}` : "create a snapshot to compare",
      Icon: History
    },
    {
      id: "files",
      label: "Files / exports",
      detail: "JSON, SVG, and Markdown exports",
      Icon: FileJson
    }
  ];

  return (
    <section className="border-b border-line px-4 py-4" data-testid="project-explorer">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-normal text-muted">Project explorer</p>
          <p className="mt-1 truncate text-sm font-semibold text-ink">{activeSummary?.project.name ?? project.name}</p>
        </div>
        <Button
          size="icon"
          variant="ghost"
          type="button"
          aria-label="Save active VDT"
          title="Save active VDT"
          disabled={!workspace.activeVdtId || workspace.isMutating}
          onClick={() => void saveActiveWorkspaceVdt()}
        >
          {workspace.isMutating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        </Button>
      </div>

      <div className="mt-3 space-y-2" role="tree" aria-label="Project explorer">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-semibold uppercase tracking-normal text-muted">Projects</div>
          <Button
            size="icon"
            variant="ghost"
            type="button"
            aria-label="Create project"
            title="Create project"
            disabled={workspace.isMutating}
            onClick={() => {
              setCreatingProject(true);
              setNewProjectName(`${project.name || "New"} project`);
            }}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        {creatingProject ? (
          <InlineNameEditor
            value={newProjectName}
            placeholder="Project name"
            submitLabel="Create project"
            disabled={workspace.isMutating}
            onChange={setNewProjectName}
            onCancel={() => setCreatingProject(false)}
            onSubmit={async () => {
              const accepted = await createWorkspaceProject(newProjectName);
              if (accepted) {
                setCreatingProject(false);
                setNewProjectName("");
              }
            }}
          />
        ) : null}

        <div className="space-y-1">
          {projectSummaries.map((summary) => (
            <WorkspaceProjectRow
              key={summary.project.id}
              summary={summary}
              activeProjectId={activeProjectId}
              activeVdtId={activeVdtId}
              editingProjectId={editingProjectId}
              editingProjectName={editingProjectName}
              editingVdtId={editingVdtId}
              editingVdtName={editingVdtName}
              disabled={workspace.isMutating || workspace.isLoading}
              onSelectProject={(projectId) => void selectWorkspaceProject(projectId)}
              onEditProject={(projectId, name) => {
                setEditingProjectId(projectId);
                setEditingProjectName(name);
              }}
              onProjectNameChange={setEditingProjectName}
              onCancelProjectEdit={() => setEditingProjectId(undefined)}
              onSubmitProjectEdit={async (projectId) => {
                const accepted = await renameWorkspaceProject(projectId, editingProjectName);
                if (accepted) setEditingProjectId(undefined);
              }}
              onDeleteProject={(projectId, name) => {
                if (window.confirm(`Delete project "${name}" and all VDTs?`)) {
                  void deleteWorkspaceProject(projectId);
                }
              }}
              onSelectVdt={(vdtId) => void selectWorkspaceVdt(vdtId)}
              onEditVdt={(vdtId, name) => {
                setEditingVdtId(vdtId);
                setEditingVdtName(name);
              }}
              onVdtNameChange={setEditingVdtName}
              onCancelVdtEdit={() => setEditingVdtId(undefined)}
              onSubmitVdtEdit={async (vdtId) => {
                const accepted = await renameWorkspaceVdt(vdtId, editingVdtName);
                if (accepted) setEditingVdtId(undefined);
              }}
              onSetVdtStatus={(vdtId, status) => void setWorkspaceVdtStatus(vdtId, status)}
              onDeleteVdt={(vdtId, name) => {
                if (window.confirm(`Delete VDT "${name}"?`)) {
                  void deleteWorkspaceVdt(vdtId);
                }
              }}
            />
          ))}
        </div>

        {activeSummary ? (
          <div className="ml-3 border-l border-slate-200 pl-3">
            {creatingVdt ? (
              <InlineNameEditor
                value={newVdtName}
                placeholder="VDT name"
                submitLabel="Create VDT"
                disabled={workspace.isMutating}
                onChange={setNewVdtName}
                onCancel={() => setCreatingVdt(false)}
                onSubmit={async () => {
                  const accepted = await createWorkspaceVdt(newVdtName);
                  if (accepted) {
                    setCreatingVdt(false);
                    setNewVdtName("");
                  }
                }}
              />
            ) : (
              <Button
                className="w-full justify-start"
                size="sm"
                variant="ghost"
                type="button"
                icon={<Plus className="h-4 w-4" />}
                disabled={workspace.isMutating}
                onClick={() => {
                  setCreatingVdt(true);
                  setNewVdtName(`${project.name || "New"} VDT`);
                }}
              >
                New VDT
              </Button>
            )}
          </div>
        ) : null}

        {projectSummaries.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-muted">
            No saved projects yet.
          </div>
        ) : null}

        <div className="ml-3 space-y-1 border-l border-slate-200 pl-3">
          {rows.map(({ id, label, detail, Icon }) => (
            <div
              key={id}
              className="flex min-w-0 items-start gap-2 rounded-md px-2 py-1.5 hover:bg-slate-50"
              role="treeitem"
              aria-selected="false"
              data-testid={`project-explorer-${id}`}
            >
              <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold text-ink">{label}</div>
                <div className="mt-0.5 truncate text-[11px] leading-4 text-muted">{detail}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {storedTotals.projects > 0 ? (
        <div
          className="mt-3 rounded-md border border-line bg-slate-50 px-3 py-2"
          data-testid="project-explorer-storage"
        >
          <div className="text-xs font-semibold uppercase tracking-normal text-muted">SQLite workspace</div>
          <div className="mt-1 text-sm font-semibold text-ink">
            {storedTotals.projects} project{storedTotals.projects === 1 ? "" : "s"} · {storedTotals.vdts} VDT{storedTotals.vdts === 1 ? "" : "s"} · {storedTotals.revisions} revision{storedTotals.revisions === 1 ? "" : "s"}
          </div>
          {activeSummary ? (
            <div className="mt-1 text-[11px] leading-4 text-muted">
              {activeSummary.project.name}: {activeSummary.counts.conversations} conversation{activeSummary.counts.conversations === 1 ? "" : "s"} · {activeSummary.counts.comparisons} comparison{activeSummary.counts.comparisons === 1 ? "" : "s"}
            </div>
          ) : null}
        </div>
      ) : null}

      {workspace.error ? (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
          {workspace.error}
        </div>
      ) : null}
    </section>
  );
}

function WorkspaceProjectRow({
  summary,
  activeProjectId,
  activeVdtId,
  editingProjectId,
  editingProjectName,
  editingVdtId,
  editingVdtName,
  disabled,
  onSelectProject,
  onEditProject,
  onProjectNameChange,
  onCancelProjectEdit,
  onSubmitProjectEdit,
  onDeleteProject,
  onSelectVdt,
  onEditVdt,
  onVdtNameChange,
  onCancelVdtEdit,
  onSubmitVdtEdit,
  onSetVdtStatus,
  onDeleteVdt
}: {
  summary: StoredProjectSummary;
  activeProjectId?: string | undefined;
  activeVdtId?: string | undefined;
  editingProjectId?: string | undefined;
  editingProjectName: string;
  editingVdtId?: string | undefined;
  editingVdtName: string;
  disabled: boolean;
  onSelectProject: (projectId: string) => void;
  onEditProject: (projectId: string, name: string) => void;
  onProjectNameChange: (value: string) => void;
  onCancelProjectEdit: () => void;
  onSubmitProjectEdit: (projectId: string) => void;
  onDeleteProject: (projectId: string, name: string) => void;
  onSelectVdt: (vdtId: string) => void;
  onEditVdt: (vdtId: string, name: string) => void;
  onVdtNameChange: (value: string) => void;
  onCancelVdtEdit: () => void;
  onSubmitVdtEdit: (vdtId: string) => void;
  onSetVdtStatus: (vdtId: string, status: StoredVdtStatus) => void;
  onDeleteVdt: (vdtId: string, name: string) => void;
}) {
  const active = summary.project.id === activeProjectId;
  return (
    <div
      className={[
        "rounded-md border px-2 py-2",
        active ? "border-accent bg-blue-50/60" : "border-line bg-white"
      ].join(" ")}
      role="treeitem"
      aria-expanded={active}
      aria-selected={active}
    >
      {editingProjectId === summary.project.id ? (
        <InlineNameEditor
          value={editingProjectName}
          placeholder="Project name"
          submitLabel="Save project name"
          disabled={disabled}
          onChange={onProjectNameChange}
          onCancel={onCancelProjectEdit}
          onSubmit={() => onSubmitProjectEdit(summary.project.id)}
        />
      ) : (
        <div className="flex items-start gap-2">
          <button
            type="button"
            className="min-w-0 flex-1 text-left"
            disabled={disabled}
            onClick={() => onSelectProject(summary.project.id)}
          >
            <div className="truncate text-sm font-semibold text-ink">{summary.project.name}</div>
            <div className="mt-0.5 truncate text-[11px] leading-4 text-muted">
              {summary.counts.vdts} VDT{summary.counts.vdts === 1 ? "" : "s"} · {summary.counts.revisions} revision{summary.counts.revisions === 1 ? "" : "s"}
            </div>
          </button>
          <IconButton label="Rename project" disabled={disabled} onClick={() => onEditProject(summary.project.id, summary.project.name)}>
            <Pencil className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton label="Delete project" disabled={disabled} onClick={() => onDeleteProject(summary.project.id, summary.project.name)}>
            <Trash2 className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      )}

      {active ? (
        <div className="mt-2 space-y-1 border-l border-slate-200 pl-2">
          {summary.vdts.map(({ vdt, revisionCount }) => (
            <WorkspaceVdtRow
              key={vdt.id}
              vdt={vdt}
              revisionCount={revisionCount}
              active={vdt.id === activeVdtId}
              editing={editingVdtId === vdt.id}
              editingName={editingVdtName}
              disabled={disabled}
              onSelect={() => onSelectVdt(vdt.id)}
              onEdit={() => onEditVdt(vdt.id, vdt.name)}
              onNameChange={onVdtNameChange}
              onCancelEdit={onCancelVdtEdit}
              onSubmitEdit={() => onSubmitVdtEdit(vdt.id)}
              onSetStatus={(status) => onSetVdtStatus(vdt.id, status)}
              onDelete={() => onDeleteVdt(vdt.id, vdt.name)}
            />
          ))}
          {summary.vdts.length === 0 ? (
            <div className="px-2 py-1.5 text-xs leading-5 text-muted">No VDTs in this project.</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function WorkspaceVdtRow({
  vdt,
  revisionCount,
  active,
  editing,
  editingName,
  disabled,
  onSelect,
  onEdit,
  onNameChange,
  onCancelEdit,
  onSubmitEdit,
  onSetStatus,
  onDelete
}: {
  vdt: StoredVdtRecord;
  revisionCount: number;
  active: boolean;
  editing: boolean;
  editingName: string;
  disabled: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onNameChange: (value: string) => void;
  onCancelEdit: () => void;
  onSubmitEdit: () => void;
  onSetStatus: (status: StoredVdtStatus) => void;
  onDelete: () => void;
}) {
  if (editing) {
    return (
      <InlineNameEditor
        value={editingName}
        placeholder="VDT name"
        submitLabel="Save VDT name"
        disabled={disabled}
        onChange={onNameChange}
        onCancel={onCancelEdit}
        onSubmit={onSubmitEdit}
      />
    );
  }

  return (
    <div
      className={[
        "flex min-w-0 items-start gap-2 rounded-md px-2 py-1.5",
        active ? "bg-white shadow-sm ring-1 ring-blue-100" : "hover:bg-slate-50"
      ].join(" ")}
      role="treeitem"
      aria-selected={active}
      data-testid={`project-explorer-vdt-${vdt.id}`}
    >
      <GitBranch className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
      <button type="button" className="min-w-0 flex-1 text-left" disabled={disabled} onClick={onSelect}>
        <div className="truncate text-xs font-semibold text-ink">{vdt.name}</div>
        <div className="mt-0.5 truncate text-[11px] leading-4 text-muted">
          {vdt.rootKpi} · {revisionCount} revision{revisionCount === 1 ? "" : "s"}
        </div>
      </button>
      {active ? (
        <select
          className="h-7 rounded-md border border-line bg-white px-1.5 text-[11px] font-medium text-graphite outline-none"
          value={vdt.status}
          disabled={disabled}
          aria-label="VDT status"
          onChange={(event) => onSetStatus(event.target.value as StoredVdtStatus)}
        >
          <option value="draft">Draft</option>
          <option value="reviewed">Reviewed</option>
          <option value="approved">Approved</option>
          <option value="archived">Archived</option>
        </select>
      ) : null}
      <IconButton label="Rename VDT" disabled={disabled} onClick={onEdit}>
        <Pencil className="h-3.5 w-3.5" />
      </IconButton>
      <IconButton label="Delete VDT" disabled={disabled} onClick={onDelete}>
        <Trash2 className="h-3.5 w-3.5" />
      </IconButton>
    </div>
  );
}

function InlineNameEditor({
  value,
  placeholder,
  submitLabel,
  disabled,
  onChange,
  onSubmit,
  onCancel
}: {
  value: string;
  placeholder: string;
  submitLabel: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <TextInput
        className="h-8 min-w-0 py-1.5 text-xs"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      <IconButton label={submitLabel} type="submit" disabled={disabled || value.trim().length === 0}>
        <Check className="h-3.5 w-3.5" />
      </IconButton>
      <IconButton label="Cancel" type="button" disabled={disabled} onClick={onCancel}>
        <X className="h-3.5 w-3.5" />
      </IconButton>
    </form>
  );
}

function IconButton({
  label,
  children,
  type = "button",
  disabled,
  onClick
}: {
  label: string;
  children: ReactNode;
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type={type}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-slate-100 hover:text-ink disabled:cursor-not-allowed disabled:opacity-45"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
