"use client";

import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useVdtStudioStore } from "./vdt-store";

export function DisplaySettings() {
  const fontScale = useVdtStudioStore((state) => state.ui.fontScale);
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
            onClick={() => resetUiPreferences()}
          >
            Reset display defaults
          </Button>
        </div>
      </section>
    </div>
  );
}
