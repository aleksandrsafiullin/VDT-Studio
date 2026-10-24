import { describe, expect, it } from "vitest";
import { DEFAULT_SCENARIO_HIGHLIGHT_COLOR, getScenarioHighlightColors, highlightContrastRatio, normalizeHighlightColor } from "./scenario-highlight-color";

describe("scenario highlight contrast", () => {
  it("accepts opaque hex colors and expands shorthand without accepting CSS or alpha", () => {
    expect(normalizeHighlightColor(" #AbC ")).toBe("#aabbcc");
    expect(normalizeHighlightColor("#AABBCC")).toBe("#aabbcc");
    for (const invalid of [undefined, null, 123, "", "red", "#12", "#1234", "#12345678", "rgb(0,0,0)", "url(test)"]) {
      expect(normalizeHighlightColor(invalid)).toBeUndefined();
    }
    expect(getScenarioHighlightColors("invalid").fill).toBe(DEFAULT_SCENARIO_HIGHLIGHT_COLOR);
  });

  it("matches known WCAG contrast ratios before rounding", () => {
    expect(highlightContrastRatio("#000000", "#ffffff")).toBe(21);
    expect(highlightContrastRatio("#fff", "#fff")).toBe(1);
    expect(highlightContrastRatio("#ff0000", "#ffffff")).toBeCloseTo(3.99847677, 6);
    expect(highlightContrastRatio("#ffffff", "#000000")).toBe(21);
  });

  it("uses white on black, graphite on white and black for the difficult middle gray", () => {
    expect(getScenarioHighlightColors("#000000").text).toBe("#ffffff");
    expect(getScenarioHighlightColors("#ffffff").text).toBe("#1d1d1f");
    expect(highlightContrastRatio("#777777", "#ffffff")).toBeLessThan(4.5);
    expect(highlightContrastRatio("#777777", "#1d1d1f")).toBeLessThan(4.5);
    expect(getScenarioHighlightColors("#777777").text).toBe("#000000");
  });

  it("keeps text at least 4.5:1 and card outlines at least 3:1 across a color grid", () => {
    const channel = (value: number) => value.toString(16).padStart(2, "0");
    const verify = (fill: string) => {
      const colors = getScenarioHighlightColors(fill);
      expect(colors.fill).toBe(fill);
      expect(highlightContrastRatio(fill, colors.text), fill).toBeGreaterThanOrEqual(4.5);
      expect(highlightContrastRatio(colors.border, "#ffffff"), fill).toBeGreaterThanOrEqual(3);
    };
    for (let gray = 0; gray <= 255; gray++) verify(`#${channel(gray).repeat(3)}`);
    for (let red = 0; red <= 255; red += 17) {
      for (let green = 0; green <= 255; green += 17) {
        for (let blue = 0; blue <= 255; blue += 17) verify(`#${channel(red)}${channel(green)}${channel(blue)}`);
      }
    }
  });
});
