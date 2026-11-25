import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectWorkspaceHandoff } from "./project-workspace-handoff";
import { WorkspaceNavigationLink } from "./workspace-navigation-link";

const { state } = vi.hoisted(() => ({ state: {
  workspace: {
    activePanel: "vdt",
    activeProjectId: "p1",
    activeVdtId: "v1",
    projectSummaries: [{ project: { id: "p1" }, vdts: [{ vdt: { id: "v1" } }] }]
  }
} }));
vi.mock("./vdt-store", () => ({
  useVdtStudioStore: Object.assign((select: (value: typeof state) => unknown) => select(state), { getState: () => state })
}));

beforeEach(() => {
  state.workspace.activePanel = "vdt";
  state.workspace.activeProjectId = "p1";
  state.workspace.activeVdtId = "v1";
});

describe("project workspace handoff", () => {
  it("offers a labeled link through the editor's save and recovery guard while its scope is active", () => {
    const link = ProjectWorkspaceHandoff({ projectId: "p1", vdtId: "v1" });
    expect(link?.type).toBe(WorkspaceNavigationLink);
    expect(link?.props).toMatchObject({ href: "/projects/p1", children: "Open project workspace" });
    expect(link?.props.isCurrent()).toBe(true);
    state.workspace.activeVdtId = "other";
    expect(link?.props.isCurrent()).toBe(false);
  });

  it("hides artifacts from another project or VDT and disables a stale project binding", () => {
    expect(ProjectWorkspaceHandoff({ projectId: "p2", vdtId: "v1" })).toBeNull();
    expect(ProjectWorkspaceHandoff({ projectId: "p1", vdtId: "v2" })).toBeNull();
    state.workspace.activeProjectId = "p2";
    expect(ProjectWorkspaceHandoff({ projectId: "p2", vdtId: "v1" })).toBeNull();
    state.workspace.activePanel = "project";
    expect(ProjectWorkspaceHandoff({ projectId: "p1", vdtId: "v1" })).toBeNull();
  });
});
