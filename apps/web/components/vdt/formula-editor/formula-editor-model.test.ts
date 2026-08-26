import { describe, expect, it } from "vitest";
import type { VdtEdge, VdtNode } from "@vdt-studio/vdt-core";
import {
  createCommaToken,
  createEditorToken,
  createFunctionCallSkeleton,
  createReferenceToken,
  defaultAppendIndex,
  editorTokensToFormula,
  editorTokensToSegments,
  getConnectedNodeIds,
  getPaletteNodes,
  getReferencedNodeIds,
  insertEditorTokenAt,
  insertEditorTokensAt,
  operatorToToken,
  parseFormulaToEditorTokens,
  removeEditorTokenById,
  resolveDisplayName,
  resolveReferenceInsertIndex,
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
  makeNode("effective_working_time", "Working time"),
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
    expect(resolveDisplayName("effective_working_time", nodesById)).toBe("Working time");
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

  it("removeEditorTokenById drops the matching token and updates formula", () => {
    const tokens = parseFormulaToEditorTokens("a * b");
    const operatorToken = tokens.find((entry) => entry.token.type === "operator");
    expect(operatorToken).toBeDefined();

    const next = removeEditorTokenById(tokens, operatorToken!.id);
    expect(next).toHaveLength(2);
    expect(next.map((entry) => entry.token.type)).toEqual(["identifier", "identifier"]);
    expect(editorTokensToFormula(next)).toBe("a b");
  });

  it("removeEditorTokenById can remove operators without losing adjacent references", () => {
    const tokens = parseFormulaToEditorTokens("calendar_time - planned_downtime - unplanned_downtime");
    const firstMinus = tokens.find((entry) => entry.token.type === "operator");
    expect(firstMinus).toBeDefined();

    const next = removeEditorTokenById(tokens, firstMinus!.id);
    expect(editorTokensToFormula(next)).toBe("calendar_time planned_downtime - unplanned_downtime");
  });

  it("inserted operator round-trips through editorTokensToFormula", () => {
    const tokens = parseFormulaToEditorTokens("a");
    const withPlus = [...tokens, createEditorToken(operatorToToken("+"))];
    expect(editorTokensToFormula(withPlus)).toBe("a +");
  });

  it("round-trips min(a, b) through parse → tokens → formula", () => {
    const formula = "min(a, b)";
    expect(editorTokensToFormula(parseFormulaToEditorTokens(formula))).toBe(formula);
  });

  it("round-trips max(0, a - b) through parse → tokens → formula", () => {
    const formula = "max(0, a - b)";
    expect(editorTokensToFormula(parseFormulaToEditorTokens(formula))).toBe(formula);
  });

  it("getReferencedNodeIds excludes min/max in call position", () => {
    const referenced = getReferencedNodeIds("min(a, b)");
    expect([...referenced].sort()).toEqual(["a", "b"]);
    expect(referenced.has("min")).toBe(false);
  });

  it("getReferencedNodeIds includes bare min as a reference", () => {
    const referenced = getReferencedNodeIds("min");
    expect([...referenced]).toEqual(["min"]);
  });

  it("insertEditorTokensAt with createFunctionCallSkeleton inserts min() skeleton", () => {
    const tokens = parseFormulaToEditorTokens("a");
    const skeleton = createFunctionCallSkeleton("min");
    const next = insertEditorTokensAt(tokens, skeleton, 1);

    expect(next.map((entry) => entry.token)).toEqual([
      { type: "identifier", value: "a" },
      { type: "identifier", value: "min" },
      { type: "left_paren" },
      { type: "right_paren" }
    ]);
    expect(editorTokensToFormula(next)).toBe("a min()");
  });

  it("editorTokensToSegments renders min before ( as function and comma as comma", () => {
    const tokens = parseFormulaToEditorTokens("min(a, b)");
    const segments = editorTokensToSegments(tokens, new Map());

    expect(segments.map((segment) => segment.type)).toEqual([
      "function",
      "left_paren",
      "reference",
      "comma",
      "reference",
      "right_paren"
    ]);
    expect(segments[0]).toMatchObject({ type: "function", name: "min" });
  });

  it("parseFormulaToEditorTokens assigns stable function and comma token ids", () => {
    const formula = "min(a, b)";
    const first = parseFormulaToEditorTokens(formula);
    const second = parseFormulaToEditorTokens(formula);

    expect(first.map((entry) => entry.id)).toEqual(second.map((entry) => entry.id));
    expect(first.map((entry) => entry.id)).toEqual([
      "fet_0_fn_min",
      "fet_1_lp",
      "fet_2_ref_a",
      "fet_3_comma",
      "fet_4_ref_b",
      "fet_5_rp"
    ]);
  });

  it("getPaletteNodes keeps connected min node but excludes call args", () => {
    const edges = [makeEdge("current", "min"), makeEdge("current", "a"), makeEdge("current", "b")];
    const palette = getPaletteNodes(
      [makeNode("min", "Min Node"), makeNode("a", "A"), makeNode("b", "B")],
      "current",
      "min(a, b)",
      edges
    );
    expect(palette.map((n) => n.id)).toEqual(["min"]);
  });

  it("getReferencedNodeIds fallback skips function names when parse fails", () => {
    const referenced = getReferencedNodeIds("min(a, (");
    expect([...referenced]).toEqual(["a"]);
    expect(referenced.has("min")).toBe(false);
  });

  it("getReferencedNodeIds includes bare max as a reference", () => {
    const referenced = getReferencedNodeIds("max");
    expect([...referenced]).toEqual(["max"]);
  });

  it("createCommaToken returns a comma token", () => {
    expect(createCommaToken().token).toEqual({ type: "comma" });
  });

  it("defaultAppendIndex inserts inside trailing min() before closing paren", () => {
    const tokens = parseFormulaToEditorTokens("min()");
    expect(defaultAppendIndex(tokens)).toBe(2);
  });

  it("defaultAppendIndex inserts inside trailing min(a) before closing paren", () => {
    const tokens = parseFormulaToEditorTokens("min(a)");
    expect(defaultAppendIndex(tokens)).toBe(3);
  });

  it("defaultAppendIndex appends after plain expressions", () => {
    expect(defaultAppendIndex(parseFormulaToEditorTokens("a + b"))).toBe(3);
  });

  it("defaultAppendIndex appends after grouping parens, not inside", () => {
    expect(defaultAppendIndex(parseFormulaToEditorTokens("(a + b)"))).toBe(5);
  });

  it("defaultAppendIndex appends after min() when an operator follows the call", () => {
    const tokens = parseFormulaToEditorTokens("min() +");
    expect(defaultAppendIndex(tokens)).toBe(4);
  });

  it("resolveReferenceInsertIndex uses default append for drop zone", () => {
    expect(resolveReferenceInsertIndex(parseFormulaToEditorTokens("min()"))).toBe(2);
    expect(resolveReferenceInsertIndex(parseFormulaToEditorTokens("a + min(b)"))).toBe(5);
    expect(resolveReferenceInsertIndex(parseFormulaToEditorTokens("a + b"))).toBe(3);
  });

  it("resolveReferenceInsertIndex snaps only when dropping on trailing min/max call tokens", () => {
    const minTokens = parseFormulaToEditorTokens("min()");
    expect(resolveReferenceInsertIndex(minTokens, 0)).toBe(2);

    const mixedTokens = parseFormulaToEditorTokens("a + min(b)");
    expect(resolveReferenceInsertIndex(mixedTokens, 0)).toBe(0);
    expect(resolveReferenceInsertIndex(mixedTokens, 1)).toBe(1);
    expect(resolveReferenceInsertIndex(mixedTokens, 2)).toBe(5);
  });

  it("builds min(a, b) via skeleton and defaultAppendIndex", () => {
    let tokens = createFunctionCallSkeleton("min");
    tokens = insertEditorTokenAt(tokens, createReferenceToken("a"), defaultAppendIndex(tokens));
    tokens = insertEditorTokenAt(tokens, createCommaToken(), defaultAppendIndex(tokens));
    tokens = insertEditorTokenAt(tokens, createReferenceToken("b"), defaultAppendIndex(tokens));

    expect(editorTokensToFormula(tokens)).toBe("min(a, b)");
  });

  it("builds min(a, b) via skeleton, references, and comma helpers", () => {
    let tokens = createFunctionCallSkeleton("min");
    tokens = insertEditorTokensAt(tokens, [createReferenceToken("a")], 2);
    tokens = insertEditorTokensAt(tokens, [createCommaToken()], 3);
    tokens = insertEditorTokensAt(tokens, [createReferenceToken("b")], 4);

    expect(editorTokensToFormula(tokens)).toBe("min(a, b)");
    expect(editorTokensToSegments(tokens, new Map()).map((segment) => segment.type)).toEqual([
      "function",
      "left_paren",
      "reference",
      "comma",
      "reference",
      "right_paren"
    ]);
  });

  it("getPaletteNodes hides min call args but not unrelated connected drivers", () => {
    const formula = "min(effective_working_time, average_productivity)";
    const palette = getPaletteNodes(
      productionVolumeNodes,
      "production_volume",
      formula,
      productionVolumeEdges
    );

    expect(palette.map((node) => node.id)).toEqual([]);
  });
});
