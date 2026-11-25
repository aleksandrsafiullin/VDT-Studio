"use client";

import { useVdtStudioStore, type VdtStudioState } from "./vdt-store";
import { WorkspaceNavigationLink } from "./workspace-navigation-link";

export function ProjectWorkspaceHandoff({ projectId, vdtId }: { projectId: string; vdtId: string }) {
  const matchesWorkspace = ({ workspace }: Pick<VdtStudioState, "workspace">) =>
    workspace.activePanel === "vdt" && workspace.activeProjectId === projectId && workspace.activeVdtId === vdtId
    && workspace.projectSummaries.some(({ project, vdts }) => project.id === projectId && vdts.some(({ vdt }) => vdt.id === vdtId));
  const isCurrent = useVdtStudioStore(matchesWorkspace);

  if (!isCurrent) return null;

  return (
    <WorkspaceNavigationLink
      href={`/projects/${encodeURIComponent(projectId)}`}
      isCurrent={() => matchesWorkspace(useVdtStudioStore.getState())}
      className="inline-flex rounded-md border border-line px-3 py-2 text-xs font-medium text-ink hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      data-testid="chat-open-project-workspace"
    >
      Open project workspace
    </WorkspaceNavigationLink>
  );
}
