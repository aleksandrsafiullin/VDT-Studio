import { describe, expect, it } from "vitest";
import {
  FORMULA_EDITOR_DROP_ZONE_ID,
  resolveFormulaInsertIndex
} from "./formula-drag-insert-index";

const tokens = [{ id: "a", token: { type: "identifier" as const, value: "a" } }];

describe("resolveFormulaInsertIndex", () => {
  it("returns null when there is no drop target", () => {
    expect(resolveFormulaInsertIndex(undefined, tokens)).toBeNull();
  });

  it("returns token length when hovering the drop zone", () => {
    expect(resolveFormulaInsertIndex(FORMULA_EDITOR_DROP_ZONE_ID, tokens)).toBe(1);
  });

  it("returns the hovered token index for palette and reorder drops", () => {
    expect(resolveFormulaInsertIndex("a", tokens)).toBe(0);
  });

  it("returns null when hovering the dragged token itself", () => {
    expect(resolveFormulaInsertIndex("a", tokens, "a")).toBeNull();
  });
});
