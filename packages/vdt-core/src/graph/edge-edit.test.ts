import { describe, expect, it } from "vitest";
import { VdtBuilderSession } from "../builder/session";
import { applyChangeSet } from "../changeset/apply";
import { calculateGraph } from "../formula/calculate";
import type { VdtProject } from "../types";
import { prepareEdgeEdit, type EdgeEditCommand } from "./edge-edit";
import { validateGraph } from "./validation";

const metadata = { id: "edit", backendId: "manual", createdAt: "2026-11-24T00:00:00Z" };

function fixture() {
  const builder = new VdtBuilderSession();
  builder.createDraft({ rootKpi: "Total", projectTitle: "Totals" });
  builder.addDriver({ parentNodeId: "total", nodeId: "count", name: "Count", baselineValue: 4, relation: "formula_dependency" });
  builder.addDriver({ parentNodeId: "total", nodeId: "reference", name: "Reference", baselineValue: 9, relation: "contextual_influence" });
  builder.setFormula({ nodeId: "total", formula: "count" });
  return builder.getProject();
}

function apply(project: VdtProject, command: EdgeEditCommand) {
  const edit = prepareEdgeEdit(project, command, metadata);
  if (!edit.ok) throw new Error(edit.message);
  const result = applyChangeSet(project, edit.changeSet, new Set(edit.changeSet.edgeChanges.map(change => change.id)));
  if (!result.success) throw new Error(result.warnings.map(warning => warning.message).join("\n"));
  return { project: result.project, edgeId: edit.edgeId };
}

describe("graph link edits", () => {
  it("adds a contextual link, edits its relation and removes its exact ID while preserving formulas", () => {
    const initial = fixture();
    expect(validateGraph(initial).valid).toBe(true);
    const added = apply(initial, {
      kind: "add", sourceNodeId: "count", targetNodeId: "reference", relation: "contextual_influence"
    });
    expect(added.project.graph.edges).toContainEqual(expect.objectContaining({
      id: added.edgeId, sourceNodeId: "count", targetNodeId: "reference", relation: "contextual_influence", aiGenerated: false
    }));
    expect(validateGraph(added.project).valid).toBe(true);
    const intermediate = apply(added.project, { kind: "set_relation", edgeId: added.edgeId, relation: "formula_dependency" });
    expect(validateGraph(intermediate.project).valid).toBe(false);
    expect(validateGraph(intermediate.project, undefined, { purpose: "draft" }).valid).toBe(true);
    const corrected = apply(intermediate.project, { kind: "set_relation", edgeId: added.edgeId, relation: "contextual_influence" });
    expect(corrected.project.graph).toEqual(added.project.graph);
    expect(calculateGraph(corrected.project).rootValue).toBe(4);
    expect(apply(corrected.project, { kind: "remove", edgeId: added.edgeId }).project.graph).toEqual(initial.graph);
  });

  it("keeps the draft unchanged when removing the last link would disconnect a KPI", () => {
    const project = fixture();
    const edit = prepareEdgeEdit(project, { kind: "remove", edgeId: "edge_total_reference" }, metadata);
    if (!edit.ok) throw new Error(edit.message);
    const result = applyChangeSet(project, edit.changeSet, new Set(edit.changeSet.edgeChanges.map(change => change.id)));
    expect(result).toMatchObject({
      success: false, project, warnings: expect.arrayContaining([
        expect.objectContaining({ id: "validation-unreachable-reference" })
      ])
    });
  });

  it("rejects duplicate, root, cycle and missing-edge requests before publishing changes", () => {
    const original = fixture();
    const added = apply(original, {
      kind: "add", sourceNodeId: "count", targetNodeId: "reference", relation: "contextual_influence"
    });
    const before = structuredClone(added.project);
    const add = (sourceNodeId: string, targetNodeId: string) => prepareEdgeEdit(added.project,
      { kind: "add", sourceNodeId, targetNodeId, relation: "contextual_influence" }, metadata);
    expect(add("count", "reference")).toMatchObject({ ok: false, code: "DUPLICATE_EDGE" });
    expect(add("reference", "total")).toMatchObject({ ok: false, code: "ROOT_NODE_PROTECTED" });
    expect(add("reference", "count")).toMatchObject({ ok: false, code: "HIERARCHY_CYCLE" });
    expect(prepareEdgeEdit(added.project, { kind: "remove", edgeId: "absent" }, metadata))
      .toMatchObject({ ok: false, code: "EDGE_NOT_FOUND" });
    expect(added.project).toEqual(before);
  });
});
