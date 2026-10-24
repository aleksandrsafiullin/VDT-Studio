"use client";

import { useId, useState } from "react";
import { Check, RotateCcw } from "lucide-react";
import { clsx } from "clsx";
import { Button } from "@/components/ui/button";
import { useVdtStudioStore } from "./vdt-store";
import { DEFAULT_SCENARIO_HIGHLIGHT_COLOR, getScenarioHighlightColors, normalizeHighlightColor } from "./scenario-highlight-color";
import styles from "./display-settings.module.css";
import cardStyles from "./vdt-canvas.module.css";
import workspaceStyles from "./workspace-shell.module.css";

const HIGHLIGHT_PRESETS = [
  { name: "Blue", color: DEFAULT_SCENARIO_HIGHLIGHT_COLOR },
  { name: "Purple", color: "#eee5ff" },
  { name: "Green", color: "#def2e5" },
  { name: "Amber", color: "#fff0c2" },
  { name: "Graphite", color: "#1d1d1f" },
  { name: "Black", color: "#000000" }
];

export function DisplaySettings() {
  const fontScale = useVdtStudioStore((state) => state.ui.fontScale);
  const highlightColor = useVdtStudioStore((state) => state.ui.scenarioHighlightColor ?? DEFAULT_SCENARIO_HIGHLIGHT_COLOR);
  const setUiPreference = useVdtStudioStore((state) => state.setUiPreference);
  const resetUiPreferences = useVdtStudioStore((state) => state.resetUiPreferences);
  const [colorDraft, setColorDraft] = useState<string | null>(null);
  const [colorError, setColorError] = useState(false);
  const colorHelpId = useId();
  const colors = getScenarioHighlightColors(highlightColor);

  function chooseColor(value: string) {
    setUiPreference("scenarioHighlightColor", value);
    setColorDraft(null);
    setColorError(false);
  }

  function commitColor() {
    const normalized = normalizeHighlightColor(colorDraft ?? highlightColor);
    if (normalized) chooseColor(normalized);
    else setColorError(true);
  }

  return (
    <div className="space-y-4" data-testid="display-settings">
      <section data-settings-card className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <label className="grid gap-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-ink">Font scale</h3>
              <p className="mt-1 text-xs leading-5 text-muted">Canvas and panel text density</p>
            </div>
            <span className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-ink">
              {Math.round(fontScale * 100)}%
            </span>
          </div>
          <input
            type="range"
            min={75}
            max={110}
            step={1}
            value={Math.round(fontScale * 100)}
            aria-valuemin={75}
            aria-valuemax={110}
            aria-valuenow={Math.round(fontScale * 100)}
            aria-valuetext={`${Math.round(fontScale * 100)}%`}
            data-testid="font-scale-slider"
            className="w-full accent-accent"
            onChange={(event) => setUiPreference("fontScale", Number(event.target.value) / 100)}
          />
        </label>
      </section>

      <section data-settings-card data-testid="scenario-highlight-settings" className="rounded-lg border bg-white p-4">
        <div className={styles.colorHeader}>
          <div>
            <h3>Scenario highlight</h3>
            <p className="mt-1 text-xs leading-5 text-muted">Color for Potential values that differ from Base.</p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => chooseColor(DEFAULT_SCENARIO_HIGHLIGHT_COLOR)}
            disabled={highlightColor === DEFAULT_SCENARIO_HIGHLIGHT_COLOR && colorDraft === null}>
            Reset color
          </Button>
        </div>
        <div className={styles.colorLayout}>
          <div className={styles.colorControls}>
            <div>
              <label className={styles.colorLabel} htmlFor={`${colorHelpId}-picker`}>Fill color</label>
              <div className={styles.colorInputs}>
                <input id={`${colorHelpId}-picker`} type="color" value={colors.fill} className={styles.colorPicker}
                  aria-label="Scenario highlight fill color" data-testid="scenario-highlight-color-picker"
                  onChange={event => chooseColor(event.target.value)} />
                <input type="text" value={colorDraft ?? highlightColor} maxLength={7} spellCheck={false} autoComplete="off"
                  className={styles.hexInput} aria-label="Scenario highlight hex color" aria-describedby={colorHelpId}
                  aria-invalid={colorError} data-testid="scenario-highlight-hex-input"
                  onChange={event => { setColorDraft(event.target.value); setColorError(false); }} onBlur={commitColor}
                  onKeyDown={event => {
                    if (event.key === "Enter") { event.preventDefault(); commitColor(); }
                    if (event.key === "Escape") {
                      event.stopPropagation(); setColorDraft(null); setColorError(false);
                    }
                  }} />
              </div>
            </div>
            <div className={styles.presets} role="group" aria-label="Highlight color presets">
              {HIGHLIGHT_PRESETS.map(preset => {
                const presetColors = getScenarioHighlightColors(preset.color);
                return <button key={preset.color} type="button" className={styles.preset}
                  aria-label={`${preset.name} highlight`} title={preset.name} aria-pressed={colors.fill === preset.color}
                  style={{ backgroundColor: preset.color, color: presetColors.text }} onClick={() => chooseColor(preset.color)}>
                  {colors.fill === preset.color ? <Check className="h-4 w-4" aria-hidden /> : null}
                </button>;
              })}
            </div>
            <p id={colorHelpId} className={colorError ? styles.colorError : styles.colorHint} role={colorError ? "alert" : undefined}>
              {colorError ? "Enter a color as #RGB or #RRGGBB." : "Text switches automatically between dark and white for contrast."}
            </p>
          </div>
          <div className={clsx(workspaceStyles.shell, styles.preview)} data-testid="scenario-highlight-preview"
            style={{
              background: "transparent",
              ["--vdt-scenario-highlight-fill" as string]: colors.fill,
              ["--vdt-scenario-highlight-text" as string]: colors.text,
              ["--vdt-scenario-highlight-border" as string]: colors.border
            }}>
            <div className={clsx(cardStyles.card, cardStyles.scenarioChanged, styles.previewCard)}>
              <div className={cardStyles.header}>
                <p className={styles.previewTitle}>Example KPI</p>
                <span className={cardStyles.unit}>t/trip</span>
              </div>
              <div className={cardStyles.values}>
                <div className={cardStyles.value}><p className={cardStyles.valueLabel}>Base</p><p className={cardStyles.amount}>80</p></div>
                <div className={clsx(cardStyles.value, cardStyles.changedValue)}><p className={cardStyles.valueLabel}>Potential</p><p className={clsx(cardStyles.amount, cardStyles.changed)}>85</p></div>
              </div>
            </div>
            <p className={styles.previewCaption}>Preview · {colors.text === "#ffffff" ? "White" : "Dark"} text</p>
          </div>
        </div>
      </section>

      <section data-settings-card className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-5 text-muted">
            Drag the vertical handles between panels on the canvas workspace to resize the setup and inspector rails.
            KPI block spacing is on the canvas toolbar next to Auto-distribute.
          </p>

          <Button
            className="shrink-0"
            size="sm"
            icon={<RotateCcw className="h-4 w-4" />}
            data-testid="reset-ui-preferences"
            onClick={() => { resetUiPreferences(); setColorDraft(null); setColorError(false); }}
          >
            Reset display defaults
          </Button>
        </div>
      </section>
    </div>
  );
}
