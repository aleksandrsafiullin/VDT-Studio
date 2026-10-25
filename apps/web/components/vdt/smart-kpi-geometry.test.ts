import { describe, expect, it } from "vitest";
import { placeSmartKpiPanel, placeSmartKpiPreview, smartKpiRectsIntersect, visibleSmartKpiTargets } from "./smart-kpi-geometry";

describe("Smart KPI screen geometry", () => {
  it("places on the right when it fits and spans the pointer gap", () => {
    const placed = placeSmartKpiPanel({ left: 200, top: 200, width: 40, height: 132 }, 400, { width: 1200, height: 800 });
    expect(placed).toMatchObject({ left: 248, top: 66, width: 360, side: "right", bridge: { left: 240, width: 8 } });
  });
  it.each([0.34, 0.68, 1.5])("flips and clamps at viewport edges after graph zoom %s", zoom => {
    const anchor = { left: 950, top: 740, width: 40 * zoom, height: 132 * zoom };
    const placed = placeSmartKpiPanel(anchor, 520, { width: 1024, height: 768 });
    expect(placed.side).toBe("left"); expect(placed.left).toBeGreaterThanOrEqual(8); expect(placed.left + placed.width).toBeLessThanOrEqual(1016);
    expect(placed.top).toBeGreaterThanOrEqual(8); expect(placed.top + 520).toBeLessThanOrEqual(760); expect(placed.bridge.width).toBe(8);
  });
  it("fits a touch viewport and visual viewport offsets without horizontal overflow", () => {
    const placed = placeSmartKpiPanel({ left: 265, top: 310, width: 40, height: 132 }, 700, { width: 320, height: 430, left: 0, top: 100 });
    expect(placed.width).toBe(304); expect(placed.left).toBe(8); expect(placed.top).toBe(108); expect(placed.maxHeight).toBe(414);
  });
  it("counts partially visible nodes, excludes offscreen/selected nodes and caps visible preparation at six", () => {
    const nodes = Array.from({ length: 12 }, (_, index) => ({ id: `node_${index}`, x: index * 50 - 20, y: 0, width: 40, height: 40 }));
    expect(smartKpiRectsIntersect({ left: -20, top: 0, width: 40, height: 40 }, { left: 0, top: 0, width: 300, height: 300 })).toBe(true);
    const visible = visibleSmartKpiTargets(nodes, { x: 0, y: 0, zoom: 1 }, { width: 600, height: 200 }, "node_4");
    expect(visible).toHaveLength(6); expect(visible).not.toContain("node_4");
    expect(visibleSmartKpiTargets(nodes, { x: -3000, y: 0, zoom: 0.34 }, { width: 600, height: 200 })).toEqual([]);
  });
});

describe("Smart KPI transient canvas placement", () => {
  const target = { left: 520, top: 180, width: 238, height: 140 };
  it("extends to the right and centers a draft layer on its actual target", () => {
    expect(placeSmartKpiPreview(target, { width: 238, height: 400 }, [])).toEqual({ left: 870, top: 50, width: 238, height: 400 });
  });
  it("keeps both compact cards and expanded editing clear of existing KPI cards without moving them", () => {
    const obstacles = [{ left: 870, top: 40, width: 238, height: 150 }, { left: 870, top: 220, width: 238, height: 150 }];
    const before = structuredClone(obstacles);
    for (const width of [238, 360]) {
      const placed = placeSmartKpiPreview(target, { width, height: 400 }, obstacles);
      expect(placed.left).toBeGreaterThan(target.left + target.width);
      expect(obstacles.every(rect => !smartKpiRectsIntersect(placed, rect))).toBe(true);
    }
    expect(obstacles).toEqual(before);
  });
  it("finds room for a six-card layer in a populated tree", () => {
    const obstacles = Array.from({ length: 200 }, (_, index) => ({ left: 870 + index % 8 * 302, top: Math.floor(index / 8) * 180, width: 238, height: 140 }));
    const placed = placeSmartKpiPreview(target, { width: 238, height: 1100 }, obstacles);
    expect(obstacles.every(rect => !smartKpiRectsIntersect(placed, rect))).toBe(true);
  });
});
