import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VdtWorkspaceState } from "./vdt-store";
import {
  bootstrapProjectWorkspaceRoute,
  shouldCloseWorkspaceVdtEditorForRoute
} from "./use-workspace-route-sync";

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
  const selectWorkspaceVdt = vi.fn<(vdtId: string, options?: { expectedProjectId?: string | undefined }) => Promise<boolean>>(async () => true);
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
    expect(selectWorkspaceVdt).toHaveBeenCalledWith("vdt_a", { expectedProjectId: "project_a" });
    expect(closeWorkspaceVdtEditor).not.toHaveBeenCalled();
  });

  it("closes the editor when the requested VDT does not belong to the route project", async () => {
    const current = workspace({
      activeProjectId: "project_a",
      activePanel: "project"
    });
    selectWorkspaceVdt.mockResolvedValueOnce(false);

    await bootstrapProjectWorkspaceRoute({
      projectId: "project_a",
      initialVdt: "vdt_from_project_b",
      refreshWorkspace,
      selectWorkspaceProject,
      selectWorkspaceVdt,
      closeWorkspaceVdtEditor,
      getWorkspace: () => current
    });

    expect(selectWorkspaceVdt).toHaveBeenCalledWith("vdt_from_project_b", { expectedProjectId: "project_a" });
    expect(closeWorkspaceVdtEditor).toHaveBeenCalledTimes(1);
  });
});

describe("shouldCloseWorkspaceVdtEditorForRoute", () => {
  it("does not close a newly created local VDT before the URL query catches up", () => {
    expect(shouldCloseWorkspaceVdtEditorForRoute(undefined, undefined, "vdt_a")).toBe(false);
  });

  it("closes the editor when navigation removes an existing VDT query", () => {
    expect(shouldCloseWorkspaceVdtEditorForRoute("vdt_a", undefined, "vdt_a")).toBe(true);
  });
});
