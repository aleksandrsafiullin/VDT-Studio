export const DEFAULT_SCENARIO_HIGHLIGHT_COLOR = "#e6eefb";

const DARK_TEXT = "#1d1d1f";
const BLACK = "#000000";
const WHITE = "#ffffff";

/** Opaque sRGB only, so the saved fill has one unambiguous contrast calculation. */
export function normalizeHighlightColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const color = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(color)) return color;
  if (/^#[0-9a-f]{3}$/.test(color)) {
    return `#${[...color.slice(1)].map(channel => channel + channel).join("")}`;
  }
  return undefined;
}

function rgb(color: string): number[] {
  return [1, 3, 5].map(offset => Number.parseInt(color.slice(offset, offset + 2), 16));
}

function luminance(color: string): number {
  const channels = rgb(color).map(channel => {
    const srgb = channel / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

/** WCAG 2.2 relative luminance / contrast ratio; do not round before comparison. */
export function highlightContrastRatio(first: string, second: string): number {
  const a = normalizeHighlightColor(first), b = normalizeHighlightColor(second);
  if (!a || !b) throw new Error("Contrast requires an opaque hexadecimal color.");
  const light = luminance(a), dark = luminance(b);
  return (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05);
}

function visibleCardBorder(fill: string): string {
  if (highlightContrastRatio(fill, WHITE) >= 3) return fill;
  const channels = rgb(fill);
  // Light fills, including white, still need a visible outline on the white card.
  for (let step = 1; step <= 20; step++) {
    const border = `#${channels.map(channel => Math.round(channel * (1 - step / 20)).toString(16).padStart(2, "0")).join("")}`;
    if (highlightContrastRatio(border, WHITE) >= 3) return border;
  }
  return BLACK;
}

export function getScenarioHighlightColors(value: unknown) {
  const fill = normalizeHighlightColor(value) ?? DEFAULT_SCENARIO_HIGHLIGHT_COLOR;
  // Graphite is preferred on light fills. Midtones that fail with both graphite
  // and white use true black; choosing by perceived brightness alone misses them.
  const text = highlightContrastRatio(fill, DARK_TEXT) >= 4.5
    ? DARK_TEXT
    : highlightContrastRatio(fill, WHITE) >= 4.5 ? WHITE : BLACK;
  return { fill, text, border: visibleCardBorder(fill), contrast: highlightContrastRatio(fill, text) };
}
