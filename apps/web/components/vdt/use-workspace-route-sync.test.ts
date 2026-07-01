import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VdtWorkspaceState } from "./vdt-store";
import { bootstrapProjectWorkspaceRoute } from "./use-workspace-route-sync";

function workspace(overrides: Partial<VdtWorkspaceState> = {}): VdtWorkspaceState {
  return {
    activePanel: "project",
    projectSummaries: [],
    isLoading: false,
    isMutating: false,
    ...overrides
  };
}

describe("bootstrapProjectWorkspaceRoute", () => {
  const refreshWorkspace = vi.fn<(options?: { scopedProjectId?: string | undefined }) => Promise<void>>(async () => {});
  const selectWorkspaceProject = vi.fn<(projectId: string) => Promise<boolean>>(async () => true);
  const selectWorkspaceVdt = vi.fn<(vdtId: string) => Promise<boolean>>(async () => true);
  const closeWorkspaceVdtEditor = vi.fn();

  beforeEach(() => {
    refreshWorkspace.mockClear();
    selectWorkspaceProject.mockClear();
    selectWorkspaceVdt.mockClear();
    closeWorkspaceVdtEditor.mockClear();
  });

  it("skips project selection when the route project is already active and no VDT is requested", async () => {
    const current = workspace({ activeProjectId: "project_a" });

    await bootstrapProjectWorkspaceRoute({
      projectId: "project_a",
      refreshWorkspace,
      selectWorkspaceProject,
      selectWorkspaceVdt,
      closeWorkspaceVdtEditor,
      getWorkspace: () => current
    });

    expect(refreshWorkspace).toHaveBeenCalledWith({ scopedProjectId: "project_a" });
    expect(selectWorkspaceProject).not.toHaveBeenCalled();
    expect(selectWorkspaceVdt).not.toHaveBeenCalled();
    expect(closeWorkspaceVdtEditor).toHaveBeenCalledTimes(1);
  });

  it("selects the project when the active project differs from the route", async () => {
    const current = { value: workspace({ activeProjectId: "project_b" }) };
    selectWorkspaceProject.mockImplementation(async (projectId: string) => {
      current.value = workspace({ activeProjectId: projectId });
      return true;
    });

    await bootstrapProjectWorkspaceRoute({
      projectId: "project_a",
      refreshWorkspace,
      selectWorkspaceProject,
      selectWorkspaceVdt,
      closeWorkspaceVdtEditor,
      getWorkspace: () => current.value
    });

    expect(selectWorkspaceProject).toHaveBeenCalledWith("project_a");
    expect(closeWorkspaceVdtEditor).toHaveBeenCalledTimes(1);
  });

  it("opens the requested VDT without re-selecting the project when already scoped", async () => {
    const current = workspace({
      activeProjectId: "project_a",
      activePanel: "project"
    });

    await bootstrapProjectWorkspaceRoute({
      projectId: "project_a",
      initialVdt: "vdt_a",
      refreshWorkspace,
      selectWorkspaceProject,
      selectWorkspaceVdt,
      closeWorkspaceVdtEditor,
      getWorkspace: () => current
    });

    expect(selectWorkspaceProject).not.toHaveBeenCalled();
    expect(selectWorkspaceVdt).toHaveBeenCalledWith("vdt_a");
    expect(closeWorkspaceVdtEditor).not.toHaveBeenCalled();
  });
});
