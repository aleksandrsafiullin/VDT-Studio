"use client";

import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useVdtStudioStore } from "./vdt-store";

export function DisplaySettings() {
  const fontScale = useVdtStudioStore((state) => state.ui.fontScale);
  const panelScale = useVdtStudioStore((state) => state.ui.panelScale);
  const setUiPreference = useVdtStudioStore((state) => state.setUiPreference);
  const resetUiPreferences = useVdtStudioStore((state) => state.resetUiPreferences);

  return (
    <div className="space-y-4">
      <label className="grid gap-2">
        <div className="flex items-center justify-between text-xs font-medium text-ink">
          <span>Font scale</span>
          <span>{Math.round(fontScale * 100)}%</span>
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

      <label className="grid gap-2">
        <div className="flex items-center justify-between text-xs font-medium text-ink">
          <span>Panel scale</span>
          <span>{Math.round(panelScale * 100)}%</span>
        </div>
        <input
          type="range"
          min={70}
          max={100}
          step={1}
          value={Math.round(panelScale * 100)}
          aria-valuemin={70}
          aria-valuemax={100}
          aria-valuenow={Math.round(panelScale * 100)}
          aria-valuetext={`${Math.round(panelScale * 100)}%`}
          data-testid="panel-scale-slider"
          className="w-full accent-accent"
          onChange={(event) => setUiPreference("panelScale", Number(event.target.value) / 100)}
        />
      </label>

      <Button
        className="w-full"
        size="sm"
        icon={<RotateCcw className="h-4 w-4" />}
        data-testid="reset-ui-preferences"
        onClick={() => resetUiPreferences()}
      >
        Reset display defaults
      </Button>
    </div>
  );
}
