import { describe, expect, it } from "vitest";
import { productionVolumeProject, type VdtProject } from "@vdt-studio/vdt-core";
import { captureFileImportTarget, fileImportContextError } from "./import-context";

function fixture(): VdtProject {
  const project = structuredClone(productionVolumeProject);
  project.id = "vdt_file_target";
  project.graph.nodes = project.graph.nodes.slice(0, 2).map((node) => ({ ...node, formula: undefined }));
  project.graph.edges = [];
  return project;
}
const workspace = { activeProjectId: "owner_project", activeVdtId: "vdt_file_target" };

describe("file import target identity", () => {
  it("pins the clicked KPI and uses the owning project plus VDT, rather than graph id for ownership", () => {
    const project = fixture();
    const clicked = project.graph.nodes[1]!;
    const context = captureFileImportTarget(project, workspace, clicked.id)!;
    expect(context.projectId).toBe("owner_project");
    expect(context.vdtId).toBe(project.id);
    expect(context.graphProjectId).toBe(project.id);
    expect(context.targetNodeId).toBe(clicked.id);
    expect(fileImportContextError(context, project, workspace)).toBeUndefined();
  });
  it("refuses an unsaved workspace or missing target", () => {
    const project = fixture();
    expect(captureFileImportTarget(project, {}, project.rootNodeId)).toBeUndefined();
    expect(captureFileImportTarget(project, workspace, "missing_target")).toBeUndefined();
  });
  it("supports distinct owning project, VDT record and legacy graph snapshot identities", () => {
    const project = fixture();
    project.id = "project_ore_haulage";
    const legacyWorkspace = { activeProjectId: "project_haulage_smoke", activeVdtId: "vdt_ore_haulage_record" };
    const context = captureFileImportTarget(project, legacyWorkspace, project.rootNodeId)!;
    expect(context).toMatchObject({ projectId: "project_haulage_smoke", vdtId: "vdt_ore_haulage_record", graphProjectId: "project_ore_haulage" });
    expect(fileImportContextError(context, project, legacyWorkspace)).toBeUndefined();
    expect(fileImportContextError(context, { ...project, id: "other_graph" }, legacyWorkspace)).toContain("project or VDT changed");
    expect(fileImportContextError(context, project, { ...legacyWorkspace, activeVdtId: "other_record" })).toContain("project or VDT changed");
  });
  it("rejects project switching, target changes, removal and new children", () => {
    const project = fixture();
    const context = captureFileImportTarget(project, workspace, project.rootNodeId)!;
    expect(fileImportContextError(context, project, { ...workspace, activeProjectId: "different_owner" })).toContain("project or VDT changed");
    const changed = structuredClone(project);
    changed.graph.nodes[0]!.unit = "minutes";
    expect(fileImportContextError(context, changed, workspace)).toContain("target KPI changed");
    const removed = structuredClone(project);
    removed.graph.nodes.shift();
    expect(fileImportContextError(context, removed, workspace)).toContain("removed");
    const child = structuredClone(project);
    child.graph.edges.push({ id: "new_child", sourceNodeId: project.rootNodeId, targetNodeId: project.graph.nodes[1]!.id, relation: "additive_component", aiGenerated: false });
    expect(fileImportContextError(context, child, workspace)).toContain("already has");
  });
  it("allows card layout changes during mapping review", () => {
    const project = fixture();
    const context = captureFileImportTarget(project, workspace, project.rootNodeId)!;
    project.graph.nodes[0]!.position = { x: 40, y: 90 };
    project.graph.nodes[0]!.updatedAt = "2026-10-16T12:00:00Z";
    expect(fileImportContextError(context, project, workspace)).toBeUndefined();
  });
});
