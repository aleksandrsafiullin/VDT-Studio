import { hasActiveWorkspaceVdt, type VdtStudioState, type VdtWorkspaceState } from "./vdt-store";

export async function navigateAfterWorkspaceSave(
  href: string,
  state: { workspace: VdtWorkspaceState; saveActiveWorkspaceVdt: () => Promise<boolean> },
  navigate: (href: string) => void
): Promise<boolean> {
  if (hasActiveWorkspaceVdt(state.workspace) && !(await state.saveActiveWorkspaceVdt())) return false;
  navigate(href);
  return true;
}

// In-memory only: a cold launch always follows draft restoration.
type HomeDraftIdentity = Pick<VdtStudioState, "workspace" | "project" | "projectRevision">;
function homeDraftIdentity({ workspace, project, projectRevision }: HomeDraftIdentity) {
  const { activePanel, activeProjectId, activeVdtId, draftRevisionBase, pendingRevisionCommit, pendingVdtCreate } = workspace;
  return { activePanel, activeProjectId, activeVdtId, draftRevisionBase, pendingRevisionCommit, pendingVdtCreate, project, projectRevision };
}

let deliberateHomeNavigation: ReturnType<typeof homeDraftIdentity> | undefined;

export function markDeliberateHomeNavigation(state: HomeDraftIdentity): void {
  deliberateHomeNavigation = homeDraftIdentity(state);
}

export function consumeDeliberateHomeNavigation(current: HomeDraftIdentity): boolean {
  const saved = deliberateHomeNavigation;
  deliberateHomeNavigation = undefined;
  const live = homeDraftIdentity(current);
  return saved !== undefined
    && saved.activePanel === live.activePanel
    && saved.activeProjectId === live.activeProjectId
    && saved.activeVdtId === live.activeVdtId
    && saved.draftRevisionBase === live.draftRevisionBase
    && saved.pendingRevisionCommit === live.pendingRevisionCommit
    && saved.pendingVdtCreate === live.pendingVdtCreate
    && saved.project === live.project
    && saved.projectRevision === live.projectRevision;
}
