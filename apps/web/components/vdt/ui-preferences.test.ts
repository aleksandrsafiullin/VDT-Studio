import { describe, expect, it } from "vitest";
import {
  applyUiPreference,
  BASE_LEFT_PANEL_WIDTH,
  BASE_RIGHT_PANEL_WIDTH,
  DEFAULT_LEFT_PANEL_WIDTH,
  DEFAULT_RIGHT_PANEL_WIDTH,
  DEFAULT_UI,
  MAX_KPI_HORIZONTAL_GAP,
  MAX_KPI_VERTICAL_GAP,
  MIN_KPI_HORIZONTAL_GAP,
  MIN_KPI_VERTICAL_GAP,
  mergeUiPreferences,
  setPanelWidth,
  UI_PERSIST_KEYS,
  type UiPreferences
} from "./ui-preferences";

describe("ui-preferences", () => {
  it("uses default panel widths derived from legacy scale", () => {
    expect(DEFAULT_LEFT_PANEL_WIDTH).toBe(255);
    expect(DEFAULT_RIGHT_PANEL_WIDTH).toBe(279);
  });

  it("clamps fontScale and panel widths via applyUiPreference helper", () => {
    const ui = applyUiPreference(DEFAULT_UI, "fontScale", 0.5);
    expect(ui.fontScale).toBe(0.75);

    const ui2 = applyUiPreference(ui, "fontScale", 2);
    expect(ui2.fontScale).toBe(1.1);

    const ui3 = applyUiPreference(ui2, "leftPanelWidth", 100);
    expect(ui3.leftPanelWidth).toBe(220);

    const ui4 = applyUiPreference(ui3, "rightPanelWidth", 900);
    expect(ui4.rightPanelWidth).toBe(520);
  });

  it("clamps KPI block spacing via applyUiPreference helper", () => {
    const ui = applyUiPreference(DEFAULT_UI, "kpiHorizontalGap", 40);
    expect(ui.kpiHorizontalGap).toBe(MIN_KPI_HORIZONTAL_GAP);

    const ui2 = applyUiPreference(ui, "kpiHorizontalGap", 900);
    expect(ui2.kpiHorizontalGap).toBe(MAX_KPI_HORIZONTAL_GAP);

    const ui3 = applyUiPreference(ui2, "kpiVerticalGap", 4);
    expect(ui3.kpiVerticalGap).toBe(MIN_KPI_VERTICAL_GAP);

    const ui4 = applyUiPreference(ui3, "kpiVerticalGap", 400);
    expect(ui4.kpiVerticalGap).toBe(MAX_KPI_VERTICAL_GAP);
  });

  it("clamps panel widths via setPanelWidth", () => {
    expect(setPanelWidth(DEFAULT_UI, "left", 500).leftPanelWidth).toBe(480);
    expect(setPanelWidth(DEFAULT_UI, "right", 200).rightPanelWidth).toBe(240);
  });

  it("merges persisted ui without clobbering defaults for missing keys", () => {
    expect(mergeUiPreferences()).toEqual(DEFAULT_UI);
    expect(mergeUiPreferences(undefined)).toEqual(DEFAULT_UI);
    expect(mergeUiPreferences({ fontScale: 1 })).toEqual({
      ...DEFAULT_UI,
      fontScale: 1
    });
    expect(mergeUiPreferences({ kpiHorizontalGap: 300, kpiVerticalGap: 72 })).toEqual({
      ...DEFAULT_UI,
      kpiHorizontalGap: 300,
      kpiVerticalGap: 72
    });
  });

  it("migrates legacy panelScale when explicit widths are absent", () => {
    expect(mergeUiPreferences({ panelScale: 0.75 })).toEqual({
      ...DEFAULT_UI,
      leftPanelWidth: Math.round(BASE_LEFT_PANEL_WIDTH * 0.75),
      rightPanelWidth: Math.round(BASE_RIGHT_PANEL_WIDTH * 0.75)
    });
  });

  it("prefers explicit widths over legacy panelScale", () => {
    expect(
      mergeUiPreferences({
        leftPanelWidth: 320,
        rightPanelWidth: 360,
        panelScale: 0.75
      })
    ).toEqual({
      ...DEFAULT_UI,
      leftPanelWidth: 320,
      rightPanelWidth: 360
    });
  });

  it("does not expose panelScale in merged output shape", () => {
    const ui = mergeUiPreferences({ panelScale: 0.8 });
    expect("panelScale" in ui).toBe(false);
  });

  it("clamps out-of-range fontScale on hydrate", () => {
    expect(mergeUiPreferences({ fontScale: 0.5 })).toEqual({
      ...DEFAULT_UI,
      fontScale: 0.75
    });
    expect(mergeUiPreferences({ fontScale: 2 })).toEqual({
      ...DEFAULT_UI,
      fontScale: 1.1
    });
  });

  it("preserves defaults for undefined or corrupt scale values on hydrate", () => {
    expect(
      mergeUiPreferences({
        fontScale: undefined,
        leftPanelWidth: undefined
      } as unknown as Partial<UiPreferences>)
    ).toEqual(DEFAULT_UI);
    expect(
      mergeUiPreferences({
        fontScale: "large" as unknown as number,
        leftPanelWidth: null as unknown as number
      })
    ).toEqual(DEFAULT_UI);
    expect(mergeUiPreferences({ fontScale: Number.NaN, rightPanelWidth: Number.POSITIVE_INFINITY })).toEqual(
      DEFAULT_UI
    );
  });

  it("preserves defaults for corrupt KPI spacing values on hydrate", () => {
    expect(
      mergeUiPreferences({
        kpiHorizontalGap: "wide" as unknown as number,
        kpiVerticalGap: null as unknown as number
      })
    ).toEqual(DEFAULT_UI);

    expect(
      mergeUiPreferences({
        kpiHorizontalGap: Number.NEGATIVE_INFINITY,
        kpiVerticalGap: Number.NaN
      })
    ).toEqual(DEFAULT_UI);
  });

  it("preserves defaults for corrupt boolean collapse flags on hydrate", () => {
    expect(
      mergeUiPreferences({
        leftPanelCollapsed: "yes" as unknown as boolean,
        rightPanelCollapsed: 1 as unknown as boolean
      })
    ).toEqual(DEFAULT_UI);

    expect(
      mergeUiPreferences({
        leftPanelCollapsed: true,
        rightPanelCollapsed: false
      })
    ).toEqual({
      ...DEFAULT_UI,
      leftPanelCollapsed: true
    });
  });

  it("ignores legacy scenarioDrawerCollapsed on hydrate", () => {
    const ui = mergeUiPreferences({
      scenarioDrawerCollapsed: true
    });
    expect(ui).toEqual(DEFAULT_UI);
    expect("scenarioDrawerCollapsed" in ui).toBe(false);
  });

  it("defines the full persist shape for ui preferences", () => {
    expect(UI_PERSIST_KEYS).toEqual([
      "fontScale",
      "kpiHorizontalGap",
      "kpiVerticalGap",
      "leftPanelWidth",
      "rightPanelWidth",
      "leftPanelCollapsed",
      "rightPanelCollapsed"
    ]);
  });
});
