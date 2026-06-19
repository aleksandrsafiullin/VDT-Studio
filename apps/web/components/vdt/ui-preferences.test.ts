import { describe, expect, it } from "vitest";
import {
  applyUiPreference,
  DEFAULT_UI,
  mergeUiPreferences,
  scaledPanelWidth,
  scaledScenarioDrawerCollapsedHeight,
  UI_PERSIST_KEYS,
  type UiPreferences
} from "./ui-preferences";

describe("ui-preferences", () => {
  it("scales panel width with rounding", () => {
    expect(scaledPanelWidth(300, 0.85)).toBe(255);
    expect(scaledPanelWidth(328, 1)).toBe(328);
  });

  it("scales collapsed scenario drawer height within 40–52px", () => {
    expect(scaledScenarioDrawerCollapsedHeight(0.85, 0.9)).toBe(40);
    expect(scaledScenarioDrawerCollapsedHeight(1, 1.1)).toBe(46);
    expect(scaledScenarioDrawerCollapsedHeight(1, 1)).toBe(44);
  });

  it("clamps fontScale and panelScale via setUiPreference helper", () => {
    const ui = applyUiPreference(DEFAULT_UI, "fontScale", 0.5);
    expect(ui.fontScale).toBe(0.75);

    const ui2 = applyUiPreference(ui, "fontScale", 2);
    expect(ui2.fontScale).toBe(1.1);

    const ui3 = applyUiPreference(ui2, "panelScale", 0.5);
    expect(ui3.panelScale).toBe(0.7);

    const ui4 = applyUiPreference(ui3, "panelScale", 1.5);
    expect(ui4.panelScale).toBe(1);
  });

  it("merges persisted ui without clobbering defaults for missing keys", () => {
    expect(mergeUiPreferences()).toEqual(DEFAULT_UI);
    expect(mergeUiPreferences(undefined)).toEqual(DEFAULT_UI);
    expect(mergeUiPreferences({ fontScale: 1 })).toEqual({
      ...DEFAULT_UI,
      fontScale: 1
    });
  });

  it("clamps out-of-range fontScale and panelScale on hydrate", () => {
    expect(mergeUiPreferences({ fontScale: 0.5, panelScale: 0.5 })).toEqual({
      ...DEFAULT_UI,
      fontScale: 0.75,
      panelScale: 0.7
    });
    expect(mergeUiPreferences({ fontScale: 2, panelScale: 1.5 })).toEqual({
      ...DEFAULT_UI,
      fontScale: 1.1,
      panelScale: 1
    });
  });

  it("preserves defaults for undefined or corrupt scale values on hydrate", () => {
    expect(
      mergeUiPreferences({
        fontScale: undefined,
        panelScale: undefined
      } as unknown as Partial<UiPreferences>)
    ).toEqual(DEFAULT_UI);
    expect(
      mergeUiPreferences({
        fontScale: "large" as unknown as number,
        panelScale: null as unknown as number
      })
    ).toEqual(DEFAULT_UI);
    expect(mergeUiPreferences({ fontScale: Number.NaN, panelScale: Number.POSITIVE_INFINITY })).toEqual(
      DEFAULT_UI
    );
  });

  it("preserves defaults for corrupt boolean collapse flags on hydrate", () => {
    expect(
      mergeUiPreferences({
        leftPanelCollapsed: "yes" as unknown as boolean,
        rightPanelCollapsed: 1 as unknown as boolean,
        scenarioDrawerCollapsed: null as unknown as boolean
      })
    ).toEqual(DEFAULT_UI);

    expect(
      mergeUiPreferences({
        leftPanelCollapsed: true,
        rightPanelCollapsed: false,
        scenarioDrawerCollapsed: true
      })
    ).toEqual({
      ...DEFAULT_UI,
      leftPanelCollapsed: true,
      scenarioDrawerCollapsed: true
    });
  });

  it("defines the full persist shape for ui preferences", () => {
    expect(UI_PERSIST_KEYS).toEqual([
      "fontScale",
      "panelScale",
      "leftPanelCollapsed",
      "rightPanelCollapsed",
      "scenarioDrawerCollapsed"
    ]);
  });
});
