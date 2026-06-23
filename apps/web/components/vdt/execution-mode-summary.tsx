"use client";

import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { hasLocalAiUi, resolveVdtAppMode } from "@/lib/app-mode";
import { formatExecutionModeSummary } from "@/lib/format-execution-summary";
import { useVdtStudioStore } from "./vdt-store";

interface ExecutionModeSummaryCardProps {
  onConfigure: () => void;
}

export function ExecutionModeSummaryCard({ onConfigure }: ExecutionModeSummaryCardProps) {
  const executionSettings = useVdtStudioStore((state) => state.executionSettings);
  const localAiAvailable = hasLocalAiUi(resolveVdtAppMode());
  const summary =
    executionSettings.executionMode === "local_cli" && !localAiAvailable
      ? {
          modeLabel: "API keys",
          primary: "Hosted web",
          secondary: "Local AI is available in VDT Studio Desktop"
        }
      : formatExecutionModeSummary(executionSettings);

  return (
    <div
      className="rounded-lg border border-line bg-slate-50/80 px-3 py-3"
      data-testid="execution-mode-summary"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">{summary.modeLabel}</p>
          <p className="text-sm font-semibold text-ink">{summary.primary}</p>
          {summary.secondary ? <p className="text-xs text-muted">{summary.secondary}</p> : null}
        </div>
        <Button
          size="sm"
          variant="secondary"
          data-testid="execution-mode-configure"
          icon={<Settings2 className="h-3.5 w-3.5" />}
          onClick={onConfigure}
        >
          Configure
        </Button>
      </div>
    </div>
  );
}
