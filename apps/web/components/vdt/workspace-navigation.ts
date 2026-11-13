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
let deliberateHomeNavigation: HomeDraftIdentity | undefined;

export function markDeliberateHomeNavigation({ workspace, project, projectRevision }: HomeDraftIdentity): void {
  deliberateHomeNavigation = { workspace, project, projectRevision };
}

export function consumeDeliberateHomeNavigation(current: HomeDraftIdentity): boolean {
  const saved = deliberateHomeNavigation;
  deliberateHomeNavigation = undefined;
  return saved !== undefined && saved.workspace === current.workspace
    && saved.project === current.project && saved.projectRevision === current.projectRevision;
}
