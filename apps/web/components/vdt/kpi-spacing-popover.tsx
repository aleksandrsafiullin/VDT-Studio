"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowDownBackwardAndArrowUpForwardSquare } from "./canvas-toolbar-icons";
import { SpacingSlider } from "./spacing-slider";
import { useVdtStudioStore } from "./vdt-store";
import {
  MAX_KPI_HORIZONTAL_GAP,
  MAX_KPI_VERTICAL_GAP,
  MIN_KPI_HORIZONTAL_GAP,
  MIN_KPI_VERTICAL_GAP
} from "./ui-preferences";

export function KpiSpacingPopover() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const kpiHorizontalGap = useVdtStudioStore((state) => state.ui.kpiHorizontalGap);
  const kpiVerticalGap = useVdtStudioStore((state) => state.ui.kpiVerticalGap);
  const setUiPreference = useVdtStudioStore((state) => state.setUiPreference);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative inline-flex items-center">
      <Button
        size="sm"
        className="h-8"
        aria-label="KPI block spacing"
        aria-controls="kpi-spacing-panel"
        aria-expanded={open}
        aria-haspopup="dialog"
        data-testid="kpi-spacing-toggle"
        icon={<ArrowDownBackwardAndArrowUpForwardSquare />}
        onClick={() => setOpen((current) => !current)}
      >
        Spacing
      </Button>

      {open ? (
        <div
          id="kpi-spacing-panel"
          role="dialog"
          aria-label="KPI block spacing"
          data-testid="kpi-spacing-panel"
          className="absolute left-0 top-full z-30 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-md border border-line bg-white p-4 shadow-lg"
        >
          <h3 className="mb-3 text-sm font-semibold text-ink">KPI block spacing</h3>
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
        </div>
      ) : null}
    </div>
  );
}
