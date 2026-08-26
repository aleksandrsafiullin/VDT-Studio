import { describe, expect, it } from "vitest";
import { parseFormulaToEditorTokens } from "./formula-editor-model";
import {
  FORMULA_EDITOR_DROP_ZONE_ID,
  resolveFormulaInsertIndex
} from "./formula-drag-insert-index";

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

  it("returns the hovered token index for palette and reorder drops", () => {
    expect(resolveFormulaInsertIndex("a", tokens)).toBe(0);
  });

  it("returns null when hovering the dragged token itself", () => {
    expect(resolveFormulaInsertIndex("a", tokens, "a")).toBeNull();
  });
});
