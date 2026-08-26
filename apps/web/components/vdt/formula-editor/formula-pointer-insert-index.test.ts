import { describe, expect, it } from "vitest";
import {
  formulaInsertSlotId,
  parseFormulaInsertSlotIndex,
  resolveInsertIndexFromPointer,
  type FormulaTokenRect
} from "./formula-pointer-insert-index";

const singleRowThreeTokens: FormulaTokenRect[] = [
  { id: "t0", x: 0, y: 0, width: 100, height: 20 },
  { id: "t1", x: 110, y: 0, width: 100, height: 20 },
  { id: "t2", x: 220, y: 0, width: 100, height: 20 }
];

const twoRowTokens: FormulaTokenRect[] = [
  { id: "A", x: 0, y: 0, width: 80, height: 20 },
  { id: "B", x: 100, y: 0, width: 80, height: 20 },
  { id: "C", x: 0, y: 30, width: 80, height: 20 }
];

describe("resolveInsertIndexFromPointer", () => {
  it("returns 0 for an empty formula", () => {
    expect(resolveInsertIndexFromPointer(10, 10, [])).toBe(0);
  });

  it("maps a single-row line of three tokens to indices 0, 1, 2, and 3", () => {
    expect(resolveInsertIndexFromPointer(-10, 10, singleRowThreeTokens)).toBe(0);
    expect(resolveInsertIndexFromPointer(105, 10, singleRowThreeTokens)).toBe(1);
    expect(resolveInsertIndexFromPointer(165, 10, singleRowThreeTokens)).toBe(2);
    expect(resolveInsertIndexFromPointer(330, 10, singleRowThreeTokens)).toBe(3);
  });

  it("resolves two-row layouts using row bands and horizontal gutters", () => {
    expect(resolveInsertIndexFromPointer(-10, 40, twoRowTokens)).toBe(2);
    expect(resolveInsertIndexFromPointer(90, 10, twoRowTokens)).toBe(1);
  });

  it("returns 0 above all rects and rects.length below all rects", () => {
    expect(resolveInsertIndexFromPointer(150, -10, singleRowThreeTokens)).toBe(0);
    expect(resolveInsertIndexFromPointer(150, 40, singleRowThreeTokens)).toBe(3);
  });

  it("uses the nearer row when the pointer is in a vertical gutter between rows", () => {
    expect(resolveInsertIndexFromPointer(10, 24, twoRowTokens)).toBe(0);
    expect(resolveInsertIndexFromPointer(10, 26, twoRowTokens)).toBe(2);
  });
});

describe("formulaInsertSlotId", () => {
  it("formats slot ids and parses them back to the insert index", () => {
    expect(formulaInsertSlotId(0)).toBe("formula-insert-slot-0");
    expect(formulaInsertSlotId(3)).toBe("formula-insert-slot-3");
    expect(parseFormulaInsertSlotIndex("formula-insert-slot-0")).toBe(0);
    expect(parseFormulaInsertSlotIndex("formula-insert-slot-3")).toBe(3);
  });

  it("returns null for non-slot ids", () => {
    expect(parseFormulaInsertSlotIndex("formula-editor-drop-zone")).toBeNull();
    expect(parseFormulaInsertSlotIndex("formula-insert-slot-")).toBeNull();
    expect(parseFormulaInsertSlotIndex("formula-insert-slot-1x")).toBeNull();
  });
});
