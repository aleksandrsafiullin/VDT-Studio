import { hasActiveWorkspaceVdt, type VdtWorkspaceState } from "./vdt-store";

export async function navigateAfterWorkspaceSave(
  href: string,
  state: { workspace: VdtWorkspaceState; saveActiveWorkspaceVdt: () => Promise<boolean> },
  navigate: (href: string) => void
): Promise<boolean> {
  if (hasActiveWorkspaceVdt(state.workspace) && !(await state.saveActiveWorkspaceVdt())) return false;
  navigate(href);
  return true;
}
