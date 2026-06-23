export const BASE_LEFT_PANEL_WIDTH = 300;
export const BASE_RIGHT_PANEL_WIDTH = 328;
export const BASE_SCENARIO_DRAWER_HEIGHT = 248;
export const SCENARIO_DRAWER_COLLAPSED_HEIGHT = 44;
export const BASE_WORKSPACE_SECTION_MIN_HEIGHT = 820;
export const COLLAPSED_PANEL_WIDTH = 32;

export const DEFAULT_LEFT_PANEL_WIDTH = Math.round(BASE_LEFT_PANEL_WIDTH * 0.85);
export const DEFAULT_RIGHT_PANEL_WIDTH = Math.round(BASE_RIGHT_PANEL_WIDTH * 0.85);

export const MIN_LEFT_PANEL_WIDTH = 220;
export const MAX_LEFT_PANEL_WIDTH = 480;
export const MIN_RIGHT_PANEL_WIDTH = 240;
export const MAX_RIGHT_PANEL_WIDTH = 520;

export interface UiPreferences {
  fontScale: number;
  leftPanelWidth: number;
  rightPanelWidth: number;
  leftPanelCollapsed: boolean;
  rightPanelCollapsed: boolean;
  scenarioDrawerCollapsed: boolean;
}

export const DEFAULT_UI: UiPreferences = {
  fontScale: 0.9,
  leftPanelWidth: DEFAULT_LEFT_PANEL_WIDTH,
  rightPanelWidth: DEFAULT_RIGHT_PANEL_WIDTH,
  leftPanelCollapsed: false,
  rightPanelCollapsed: false,
  scenarioDrawerCollapsed: false
};

export function clampLeftPanelWidth(value: number) {
  return Math.min(MAX_LEFT_PANEL_WIDTH, Math.max(MIN_LEFT_PANEL_WIDTH, Math.round(value)));
}

export function clampRightPanelWidth(value: number) {
  return Math.min(MAX_RIGHT_PANEL_WIDTH, Math.max(MIN_RIGHT_PANEL_WIDTH, Math.round(value)));
}

/** Collapsed scenario drawer chrome height, scaled by fontScale and clamped to 40–52px. */
export function scenarioDrawerCollapsedHeight(fontScale: number) {
  const scaled = Math.round(SCENARIO_DRAWER_COLLAPSED_HEIGHT * fontScale);
  return Math.min(52, Math.max(40, scaled));
}

export function clampFontScale(value: number) {
  return Math.min(1.1, Math.max(0.75, value));
}

function sanitizeScale(
  value: unknown,
  clamp: (n: number) => number,
  fallback: number
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return clamp(value);
}

function sanitizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function clampLegacyPanelScale(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0.85;
  }
  return Math.min(1, Math.max(0.7, value));
}

function resolvePanelWidths(persisted: Partial<UiPreferences> & { panelScale?: number }) {
  const hasLeft =
    typeof persisted.leftPanelWidth === "number" && Number.isFinite(persisted.leftPanelWidth);
  const hasRight =
    typeof persisted.rightPanelWidth === "number" && Number.isFinite(persisted.rightPanelWidth);

  if (hasLeft && hasRight) {
    return {
      leftPanelWidth: clampLeftPanelWidth(persisted.leftPanelWidth!),
      rightPanelWidth: clampRightPanelWidth(persisted.rightPanelWidth!)
    };
  }

  const panelScale = clampLegacyPanelScale(persisted.panelScale);
  return {
    leftPanelWidth: clampLeftPanelWidth(Math.round(BASE_LEFT_PANEL_WIDTH * panelScale)),
    rightPanelWidth: clampRightPanelWidth(Math.round(BASE_RIGHT_PANEL_WIDTH * panelScale))
  };
}

export function mergeUiPreferences(persisted?: Partial<UiPreferences> & { panelScale?: number }): UiPreferences {
  const merged = { ...DEFAULT_UI, ...persisted };
  const widths = resolvePanelWidths(persisted ?? {});

  return {
    fontScale: sanitizeScale(merged.fontScale, clampFontScale, DEFAULT_UI.fontScale),
    leftPanelWidth: widths.leftPanelWidth,
    rightPanelWidth: widths.rightPanelWidth,
    leftPanelCollapsed: sanitizeBoolean(merged.leftPanelCollapsed, DEFAULT_UI.leftPanelCollapsed),
    rightPanelCollapsed: sanitizeBoolean(merged.rightPanelCollapsed, DEFAULT_UI.rightPanelCollapsed),
    scenarioDrawerCollapsed: sanitizeBoolean(
      merged.scenarioDrawerCollapsed,
      DEFAULT_UI.scenarioDrawerCollapsed
    )
  };
}

export function applyUiPreference<K extends keyof UiPreferences>(
  ui: UiPreferences,
  field: K,
  value: UiPreferences[K]
): UiPreferences {
  let nextValue = value;
  if (field === "fontScale" && typeof value === "number") {
    nextValue = clampFontScale(value) as UiPreferences[K];
  }
  if (field === "leftPanelWidth" && typeof value === "number") {
    nextValue = clampLeftPanelWidth(value) as UiPreferences[K];
  }
  if (field === "rightPanelWidth" && typeof value === "number") {
    nextValue = clampRightPanelWidth(value) as UiPreferences[K];
  }
  return { ...ui, [field]: nextValue };
}

export function setPanelWidth(
  ui: UiPreferences,
  side: "left" | "right",
  width: number
): UiPreferences {
  if (side === "left") {
    return { ...ui, leftPanelWidth: clampLeftPanelWidth(width) };
  }
  return { ...ui, rightPanelWidth: clampRightPanelWidth(width) };
}

export const UI_PERSIST_KEYS: (keyof UiPreferences)[] = [
  "fontScale",
  "leftPanelWidth",
  "rightPanelWidth",
  "leftPanelCollapsed",
  "rightPanelCollapsed",
  "scenarioDrawerCollapsed"
];
