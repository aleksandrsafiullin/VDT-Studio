export const BASE_LEFT_PANEL_WIDTH = 300;
export const BASE_RIGHT_PANEL_WIDTH = 328;
export const BASE_SCENARIO_DRAWER_HEIGHT = 248;
export const SCENARIO_DRAWER_COLLAPSED_HEIGHT = 44;
export const BASE_WORKSPACE_SECTION_MIN_HEIGHT = 820;
export const COLLAPSED_PANEL_WIDTH = 32;

export interface UiPreferences {
  fontScale: number;
  panelScale: number;
  leftPanelCollapsed: boolean;
  rightPanelCollapsed: boolean;
  scenarioDrawerCollapsed: boolean;
}

export const DEFAULT_UI: UiPreferences = {
  fontScale: 0.9,
  panelScale: 0.85,
  leftPanelCollapsed: false,
  rightPanelCollapsed: false,
  scenarioDrawerCollapsed: false
};

export function scaledPanelWidth(base: number, panelScale: number) {
  return Math.round(base * panelScale);
}

/** Collapsed scenario drawer chrome height, scaled and clamped to ~40–52px. */
export function scaledScenarioDrawerCollapsedHeight(panelScale: number, fontScale: number) {
  const combined = (panelScale + fontScale) / 2;
  const scaled = Math.round(SCENARIO_DRAWER_COLLAPSED_HEIGHT * combined);
  return Math.min(52, Math.max(40, scaled));
}

export function clampFontScale(value: number) {
  return Math.min(1.1, Math.max(0.75, value));
}

export function clampPanelScale(value: number) {
  return Math.min(1, Math.max(0.7, value));
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

export function mergeUiPreferences(persisted?: Partial<UiPreferences>): UiPreferences {
  const merged = { ...DEFAULT_UI, ...persisted };

  return {
    fontScale: sanitizeScale(merged.fontScale, clampFontScale, DEFAULT_UI.fontScale),
    panelScale: sanitizeScale(merged.panelScale, clampPanelScale, DEFAULT_UI.panelScale),
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
  if (field === "panelScale" && typeof value === "number") {
    nextValue = clampPanelScale(value) as UiPreferences[K];
  }
  return { ...ui, [field]: nextValue };
}

export const UI_PERSIST_KEYS: (keyof UiPreferences)[] = [
  "fontScale",
  "panelScale",
  "leftPanelCollapsed",
  "rightPanelCollapsed",
  "scenarioDrawerCollapsed"
];
