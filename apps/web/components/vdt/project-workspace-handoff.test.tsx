import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditorHandoffController, editorHandoffView } from "@/lib/editor-handoff-controller";
import { ProjectWorkspaceHandoff } from "./project-workspace-handoff";
import { WorkspaceNavigationLink } from "./workspace-navigation-link";

const { state, listeners } = vi.hoisted(() => {
  const state = {
    projectRevision: 0,
    workspace: {
      activePanel: "vdt",
      activeProjectId: "p1",
      activeVdtId: "v1",
      projectSummaries: [{ project: { id: "p1" }, vdts: [{ vdt: { id: "v1" } }] }]
    }
  };
  return { state, listeners: new Set<(value: typeof state) => void>() };
});
vi.mock("./vdt-store", () => ({
  useVdtStudioStore: Object.assign((select: (value: typeof state) => unknown) => select(state), { getState: () => state, subscribe: (listener: (value: typeof state) => void) => { listeners.add(listener); return () => listeners.delete(listener); } })
}));

beforeEach(() => {
  listeners.clear();
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
  it("requires dispatched navigation and the observed destination before settling", () => {
    const controller = new EditorHandoffController();
    const action = { action: "project_workspace" as const, projectId: "p1", vdtId: "v1" };
    const identity = { runId: "run", id: "handoff", handoff: action };
    const view = () => editorHandoffView(state as unknown as Parameters<typeof editorHandoffView>[0]);
    const element = ProjectWorkspaceHandoff({ projectId: "p1", vdtId: "v1", startHandoff: () => controller.start(identity, view()) });
    expect(element?.props.beforeNavigate()).toBe(true);
    expect(listeners.size).toBe(0);
    element?.props.onNavigationDispatched();
    state.workspace.activePanel = "project";
    state.workspace.activeProjectId = "different_project";
    for (const listener of listeners) listener(state);
    expect(controller.state("run", "handoff")).toBe("pending");
    state.workspace.activeProjectId = "p1";
    for (const listener of listeners) listener(state);
    expect(controller.state("run", "handoff")).toEqual({ kind: "workspace_opened", projectId: "p1" });
    expect(listeners.size).toBe(0);
  });

});
