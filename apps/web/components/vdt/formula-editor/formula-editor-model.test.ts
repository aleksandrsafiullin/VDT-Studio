import { describe, expect, it } from "vitest";
import type { VdtEdge, VdtNode } from "@vdt-studio/vdt-core";
import {
  editorTokensToFormula,
  getConnectedNodeIds,
  getPaletteNodes,
  getReferencedNodeIds,
  parseFormulaToEditorTokens,
  resolveDisplayName,
  validateFormulaString
} from "./formula-editor-model";

function makeNode(id: string, name: string): VdtNode {
  return {
    id,
    name,
    type: "input",
    status: "accepted",
    aiGenerated: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function makeEdge(sourceNodeId: string, targetNodeId: string): VdtEdge {
  return {
    id: `edge_${sourceNodeId}_${targetNodeId}`,
    sourceNodeId,
    targetNodeId,
    relation: "formula_dependency",
    aiGenerated: false
  };
}

const productionVolumeNodes: VdtNode[] = [
  makeNode("production_volume", "Production Volume"),
  makeNode("effective_working_time", "Effective Working Time"),
  makeNode("average_productivity", "Average Productivity"),
  makeNode("calendar_time", "Calendar Time"),
  makeNode("planned_downtime", "Planned Downtime"),
  makeNode("unplanned_downtime", "Unplanned Downtime")
];

const productionVolumeEdges: VdtEdge[] = [
  makeEdge("production_volume", "effective_working_time"),
  makeEdge("production_volume", "average_productivity"),
  makeEdge("effective_working_time", "calendar_time"),
  makeEdge("effective_working_time", "planned_downtime"),
  makeEdge("effective_working_time", "unplanned_downtime")
];

describe("formula-editor-model", () => {
  it("round-trips editorTokensToFormula(parseFormulaToEditorTokens(...))", () => {
    const formula = "a * b";
    expect(editorTokensToFormula(parseFormulaToEditorTokens(formula))).toBe(formula);
  });

  it("validateFormulaString accepts valid formulas and rejects invalid ones", () => {
    expect(validateFormulaString("a + b")).toEqual({ ok: true });
    expect(validateFormulaString("(")).toMatchObject({ ok: false });
  });

  it("resolveDisplayName falls back to node id when node is missing", () => {
    const nodesById = new Map(productionVolumeNodes.map((node) => [node.id, node]));
    expect(resolveDisplayName("effective_working_time", nodesById)).toBe("Effective Working Time");
    expect(resolveDisplayName("missing_node", nodesById)).toBe("missing_node");
  });

  it("getConnectedNodeIds returns edge targets for the current node as source", () => {
    const connected = getConnectedNodeIds("production_volume", productionVolumeEdges);
    expect([...connected]).toEqual(["effective_working_time", "average_productivity"]);
  });

  it("getPaletteNodes excludes the current node, unconnected nodes, and referenced ids", () => {
    const formula = "effective_working_time + calendar_time";
    const palette = getPaletteNodes(
      productionVolumeNodes,
      "production_volume",
      formula,
      productionVolumeEdges
    );

    expect(palette.map((node) => node.id)).not.toContain("production_volume");
    expect(palette.map((node) => node.id)).not.toContain("effective_working_time");
    expect(palette.map((node) => node.id)).not.toContain("calendar_time");
    expect(palette.map((node) => node.id)).toContain("average_productivity");
  });

  it("getPaletteNodes after effective_working_time * average_productivity excludes both referenced ids", () => {
    const formula = "effective_working_time * average_productivity";
    const palette = getPaletteNodes(
      productionVolumeNodes,
      "production_volume",
      formula,
      productionVolumeEdges
    );
    const paletteIds = palette.map((node) => node.id);

    expect(paletteIds).not.toContain("effective_working_time");
    expect(paletteIds).not.toContain("average_productivity");
    expect(paletteIds).not.toContain("production_volume");
    expect(paletteIds).toHaveLength(0);
  });

  it("duplicate-ref MVP: getReferencedNodeIds dedupes ids and hides them from palette", () => {
    const formula = "a * a";
    const referenced = getReferencedNodeIds(formula);

    expect(referenced.size).toBe(1);
    expect(referenced.has("a")).toBe(true);

    const edges = [makeEdge("current", "a"), makeEdge("current", "b")];
    const palette = getPaletteNodes(
      [makeNode("a", "A"), makeNode("b", "B")],
      "current",
      formula,
      edges
    );
    expect(palette.map((node) => node.id)).toEqual(["b"]);

    // Duplicate re-insert requires "Edit as text" (Subtask 07) — palette cannot add `a` again.
  });

  it("getPaletteNodes sorts connected nodes by name", () => {
    const edges = [
      makeEdge("current", "z_node"),
      makeEdge("current", "a_node"),
      makeEdge("current", "m_node")
    ];
    const palette = getPaletteNodes(
      [makeNode("z_node", "Zulu"), makeNode("a_node", "Alpha"), makeNode("m_node", "Mike")],
      "current",
      "",
      edges
    );
    expect(palette.map((node) => node.name)).toEqual(["Alpha", "Mike", "Zulu"]);
  });

  it("parseFormulaToEditorTokens returns empty array when tokenization fails", () => {
    expect(parseFormulaToEditorTokens("a @ b")).toEqual([]);
  });

  it("parseFormulaToEditorTokens assigns stable token ids for hydration", () => {
    const formula = "effective_working_time * average_productivity";
    const first = parseFormulaToEditorTokens(formula);
    const second = parseFormulaToEditorTokens(formula);

    expect(first.map((entry) => entry.id)).toEqual(second.map((entry) => entry.id));
    expect(first.map((entry) => entry.id)).toEqual([
      "fet_0_ref_effective_working_time",
      "fet_1_op_*",
      "fet_2_ref_average_productivity"
    ]);
  });

  it("getReferencedNodeIds scans identifier tokens when parse fails", () => {
    const referenced = getReferencedNodeIds("a * (");
    expect([...referenced]).toEqual(["a"]);
  });
});
