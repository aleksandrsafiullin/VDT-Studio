"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { RotateCcw, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useVdtStudioStore } from "./vdt-store";

const TRIGGER_ID = "settings-popover-trigger";

export function SettingsPopover() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const fontScale = useVdtStudioStore((state) => state.ui.fontScale);
  const panelScale = useVdtStudioStore((state) => state.ui.panelScale);
  const setUiPreference = useVdtStudioStore((state) => state.setUiPreference);
  const resetUiPreferences = useVdtStudioStore((state) => state.resetUiPreferences);

  const closePopover = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => {
      document.getElementById(TRIGGER_ID)?.focus();
    });
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        closePopover();
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closePopover();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, closePopover]);

  return (
    <div ref={containerRef} className="relative">
      <Button
        id={TRIGGER_ID}
        size="icon"
        variant="ghost"
        aria-label="Settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        data-testid="settings-button"
        icon={<Settings className="h-4 w-4" />}
        onClick={() => setOpen((current) => !current)}
      />
      {open ? (
        <div
          id={panelId}
          className="absolute right-0 top-10 z-30 w-72 rounded-md border border-line bg-white p-4 shadow-panel"
          role="dialog"
          aria-label="Display settings"
        >
          <h3 className="text-sm font-semibold text-ink">Display settings</h3>
          <p className="mt-1 text-xs text-muted">Adjust font and panel density for the workspace.</p>

          <div className="mt-4 space-y-4">
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
          </div>

          <Button
            className="mt-4 w-full"
            size="sm"
            icon={<RotateCcw className="h-4 w-4" />}
            data-testid="reset-ui-preferences"
            onClick={() => resetUiPreferences()}
          >
            Reset display defaults
          </Button>
          <p className="mt-2 text-xs text-muted">
            Restores all workspace display defaults, including font and panel scale and panel/drawer
            collapse state. Does not change your VDT project.
          </p>
        </div>
      ) : null}
    </div>
  );
}
