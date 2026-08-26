import { describe, expect, it } from "vitest";
import { parseFormulaToEditorTokens } from "./formula-editor-model";
import {
  FORMULA_EDITOR_DROP_ZONE_ID,
  resolveFormulaDropTarget,
  resolveFormulaDragInsertIndex,
  resolveFormulaInsertIndex,
  resolveReorderTargetIndex
} from "./formula-drag-insert-index";
import { formulaInsertSlotId } from "./formula-pointer-insert-index";

const tokens = [{ id: "a", token: { type: "identifier" as const, value: "a" } }];

describe("resolveFormulaInsertIndex", () => {
  it("returns null when there is no drop target", () => {
    expect(resolveFormulaInsertIndex(undefined, tokens)).toBeNull();
  });

  it("returns token length when hovering the drop zone for plain tokens", () => {
    expect(resolveFormulaInsertIndex(FORMULA_EDITOR_DROP_ZONE_ID, tokens)).toBe(1);
  });

  it("returns index before closing paren when hovering drop zone on min()", () => {
    const minTokens = parseFormulaToEditorTokens("min()");
    expect(resolveFormulaInsertIndex(FORMULA_EDITOR_DROP_ZONE_ID, minTokens)).toBe(2);
  });

  it("returns the explicit slot index without snapping on min()", () => {
    const minTokens = parseFormulaToEditorTokens("min()");
    expect(resolveFormulaInsertIndex(formulaInsertSlotId(0), minTokens)).toBe(0);
    expect(resolveFormulaInsertIndex(formulaInsertSlotId(2), minTokens)).toBe(2);
  });

  it("returns the hovered token index for palette and reorder drops", () => {
    expect(resolveFormulaInsertIndex("a", tokens)).toBe(0);
  });

  it("returns null when hovering the dragged token itself", () => {
    expect(resolveFormulaInsertIndex("a", tokens, "a")).toBeNull();
  });
});

describe("resolveFormulaDragInsertIndex", () => {
  it("prefers slot ids over drop-zone snap indices", () => {
    const minTokens = parseFormulaToEditorTokens("min()");
    expect(
      resolveFormulaDragInsertIndex({
        overId: formulaInsertSlotId(0),
        editorTokens: minTokens,
        pointer: null,
        tokenRects: []
      })
    ).toBe(0);
  });

  it("returns slot 0 on min() without snapping to inside min()", () => {
    const minTokens = parseFormulaToEditorTokens("min()");
    expect(
      resolveFormulaDragInsertIndex({
        overId: formulaInsertSlotId(0),
        editorTokens: minTokens,
        pointer: null,
        tokenRects: []
      })
    ).toBe(0);
    expect(
      resolveFormulaDragInsertIndex({
        overId: FORMULA_EDITOR_DROP_ZONE_ID,
        editorTokens: minTokens,
        pointer: null,
        tokenRects: []
      })
    ).toBe(2);
  });

  it("prefers pointer-over-token over drop-zone snap", () => {
    const minTokens = parseFormulaToEditorTokens("min()");
    const tokenRects = [{ id: "min-fn", x: 0, y: 0, width: 40, height: 20 }];

    expect(
      resolveFormulaDragInsertIndex({
        overId: FORMULA_EDITOR_DROP_ZONE_ID,
        editorTokens: minTokens,
        pointer: { x: 10, y: 10 },
        tokenRects
      })
    ).toBe(0);
  });

  it("returns null for sortable token ids without slot or pointer hit", () => {
    expect(
      resolveFormulaDragInsertIndex({
        overId: "a",
        editorTokens: tokens,
        pointer: null,
        tokenRects: []
      })
    ).toBeNull();
  });
});

describe("resolveFormulaDropTarget", () => {
  it("uses snap when only the drop zone is targeted", () => {
    expect(
      resolveFormulaDropTarget({
        overId: FORMULA_EDITOR_DROP_ZONE_ID,
        editorTokens: tokens,
        pointer: null,
        tokenRects: []
      })
    ).toEqual({ kind: "snap" });
  });

  it("uses explicit slot indices for palette drops", () => {
    expect(
      resolveFormulaDropTarget({
        overId: formulaInsertSlotId(0),
        editorTokens: parseFormulaToEditorTokens("min()"),
        pointer: null,
        tokenRects: []
      })
    ).toEqual({ kind: "explicit", index: 0 });
  });

  it("uses explicit pointer index when over drop zone but pointer is on a token", () => {
    const minTokens = parseFormulaToEditorTokens("min()");
    const tokenRects = [{ id: "min-fn", x: 0, y: 0, width: 40, height: 20 }];

    expect(
      resolveFormulaDropTarget({
        overId: FORMULA_EDITOR_DROP_ZONE_ID,
        editorTokens: minTokens,
        pointer: { x: 10, y: 10 },
        tokenRects
      })
    ).toEqual({ kind: "explicit", index: 0 });
  });
});

describe("resolveReorderTargetIndex", () => {
  it("shifts the insert index when moving forward in the list", () => {
    expect(resolveReorderTargetIndex(0, 3)).toBe(2);
  });

  it("keeps the insert index when moving backward in the list", () => {
    expect(resolveReorderTargetIndex(3, 1)).toBe(1);
  });
});
