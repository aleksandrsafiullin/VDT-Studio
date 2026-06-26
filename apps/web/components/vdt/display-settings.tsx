"use client";

import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useVdtStudioStore } from "./vdt-store";
import {
  MAX_KPI_HORIZONTAL_GAP,
  MAX_KPI_VERTICAL_GAP,
  MIN_KPI_HORIZONTAL_GAP,
  MIN_KPI_VERTICAL_GAP
} from "./ui-preferences";

function SpacingSlider({
  label,
  value,
  min,
  max,
  step,
  testId,
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  testId: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid gap-2">
      <div className="flex items-center justify-between gap-3 text-xs font-medium text-ink">
        <span>{label}</span>
        <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-semibold">
          {value}px
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={`${value}px`}
        data-testid={testId}
        className="w-full accent-accent"
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export function DisplaySettings() {
  const fontScale = useVdtStudioStore((state) => state.ui.fontScale);
  const kpiHorizontalGap = useVdtStudioStore((state) => state.ui.kpiHorizontalGap);
  const kpiVerticalGap = useVdtStudioStore((state) => state.ui.kpiVerticalGap);
  const setUiPreference = useVdtStudioStore((state) => state.setUiPreference);
  const resetUiPreferences = useVdtStudioStore((state) => state.resetUiPreferences);

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
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

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-ink">KPI block spacing</h3>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <SpacingSlider
            label="Horizontal"
            value={kpiHorizontalGap}
            min={MIN_KPI_HORIZONTAL_GAP}
            max={MAX_KPI_HORIZONTAL_GAP}
            step={10}
            testId="kpi-horizontal-gap-slider"
            onChange={(value) => setUiPreference("kpiHorizontalGap", value)}
          />
          <SpacingSlider
            label="Vertical"
            value={kpiVerticalGap}
            min={MIN_KPI_VERTICAL_GAP}
            max={MAX_KPI_VERTICAL_GAP}
            step={4}
            testId="kpi-vertical-gap-slider"
            onChange={(value) => setUiPreference("kpiVerticalGap", value)}
          />
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-5 text-muted">
            Drag the vertical handles between panels on the canvas workspace to resize the setup and inspector rails.
          </p>

          <Button
            className="shrink-0"
            size="sm"
            icon={<RotateCcw className="h-4 w-4" />}
            data-testid="reset-ui-preferences"
            onClick={() => resetUiPreferences()}
          >
            Reset display defaults
          </Button>
        </div>
      </section>
    </div>
  );
}
