"use client";

import { useEffect, useId, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { clsx } from "clsx";
import type { ExecutionMode } from "@/lib/execution-mode-catalog";
import { LocalCliSettings } from "./local-cli-settings";
import { ByokSettings } from "./byok-settings";
import { useVdtStudioStore } from "./vdt-store";

export function ExecutionModeSettings() {
  const panelId = useId();
  const localCliTabId = `${panelId}-local-cli-tab`;
  const localCliPanelId = `${panelId}-local-cli-panel`;
  const byokTabId = `${panelId}-byok-tab`;
  const byokPanelId = `${panelId}-byok-panel`;
  const executionMode = useVdtStudioStore((state) => state.executionSettings.executionMode);
  const setExecutionMode = useVdtStudioStore((state) => state.setExecutionMode);
  const [activeTab, setActiveTab] = useState<ExecutionMode>(executionMode);

  useEffect(() => {
    setActiveTab(executionMode);
  }, [executionMode]);

  function selectTab(nextTab: ExecutionMode) {
    setActiveTab(nextTab);
    setExecutionMode(nextTab);
  }

  function handleTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }

    event.preventDefault();
    const nextTab: ExecutionMode = activeTab === "local_cli" ? "byok" : "local_cli";
    selectTab(nextTab);
    requestAnimationFrame(() => {
      document.getElementById(nextTab === "local_cli" ? localCliTabId : byokTabId)?.focus();
    });
  }

  return (
    <div className="space-y-4">
      <div
        className="inline-flex rounded-md border border-line bg-slate-50 p-1"
        role="tablist"
        aria-label="Execution mode"
      >
        <button
          id={localCliTabId}
          type="button"
          role="tab"
          aria-selected={activeTab === "local_cli"}
          aria-controls={localCliPanelId}
          tabIndex={activeTab === "local_cli" ? 0 : -1}
          data-testid="execution-mode-tab-local-cli"
          className={clsx(
            "rounded px-4 py-1.5 text-xs font-semibold transition",
            activeTab === "local_cli"
              ? "bg-white text-ink shadow-sm"
              : "text-muted hover:text-ink"
          )}
          onClick={() => selectTab("local_cli")}
          onKeyDown={handleTabKeyDown}
        >
          Local CLI
        </button>
        <button
          id={byokTabId}
          type="button"
          role="tab"
          aria-selected={activeTab === "byok"}
          aria-controls={byokPanelId}
          tabIndex={activeTab === "byok" ? 0 : -1}
          data-testid="execution-mode-tab-byok"
          className={clsx(
            "rounded px-4 py-1.5 text-xs font-semibold transition",
            activeTab === "byok" ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink"
          )}
          onClick={() => selectTab("byok")}
          onKeyDown={handleTabKeyDown}
        >
          BYOK
        </button>
      </div>

      {activeTab === "local_cli" ? (
        <div
          id={localCliPanelId}
          role="tabpanel"
          aria-labelledby={localCliTabId}
          data-testid="execution-mode-panel-local-cli"
        >
          <LocalCliSettings />
        </div>
      ) : (
        <div
          id={byokPanelId}
          role="tabpanel"
          aria-labelledby={byokTabId}
          data-testid="execution-mode-panel-byok"
        >
          <ByokSettings />
        </div>
      )}
    </div>
  );
}
