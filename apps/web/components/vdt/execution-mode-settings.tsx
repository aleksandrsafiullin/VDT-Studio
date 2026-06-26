"use client";

import { useEffect, useId, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { clsx } from "clsx";
import type { ByokGateway, ByokProtocol, ExecutionMode } from "@/lib/execution-mode-catalog";
import { hasLocalAiUi, resolveVdtAppMode } from "@/lib/app-mode";
import { LocalCliSettings } from "./local-cli-settings";
import { ByokSettings } from "./byok-settings";
import { useVdtStudioStore } from "./vdt-store";

const PROTOCOL_LABELS: Record<ByokProtocol, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  azure: "Azure OpenAI",
  gemini: "Google Gemini"
};

const GATEWAY_LABELS: Record<ByokGateway, string> = {
  none: "Direct",
  ollama: "Ollama Cloud",
  senseaudio: "SenseAudio",
  aihubmix: "AIHubMix"
};

export function ExecutionModeSettings() {
  const panelId = useId();
  const localCliTabId = `${panelId}-local-cli-tab`;
  const localCliPanelId = `${panelId}-local-cli-panel`;
  const byokTabId = `${panelId}-byok-tab`;
  const byokPanelId = `${panelId}-byok-panel`;
  const executionMode = useVdtStudioStore((state) => state.executionSettings.executionMode);
  const byokProtocol = useVdtStudioStore((state) => state.executionSettings.byokProtocol ?? "openai");
  const byokGateway = useVdtStudioStore((state) => state.executionSettings.byokGateway ?? "none");
  const setExecutionMode = useVdtStudioStore((state) => state.setExecutionMode);
  const localAiAvailable = hasLocalAiUi(resolveVdtAppMode());
  const [activeTab, setActiveTab] = useState<ExecutionMode>(localAiAvailable ? executionMode : "byok");
  const statusLine =
    activeTab === "byok"
      ? `API keys · ${PROTOCOL_LABELS[byokProtocol]} · ${GATEWAY_LABELS[byokGateway]}`
      : "Local AI · Desktop runtime";

  useEffect(() => {
    if (!localAiAvailable && executionMode === "local_cli") {
      setExecutionMode("byok");
      setActiveTab("byok");
      return;
    }

    setActiveTab(localAiAvailable ? executionMode : "byok");
  }, [executionMode, localAiAvailable, setExecutionMode]);

  function selectTab(nextTab: ExecutionMode) {
    setActiveTab(nextTab);
    setExecutionMode(nextTab);
  }

  function handleTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }

    event.preventDefault();
    if (!localAiAvailable) {
      return;
    }

    const nextTab: ExecutionMode = activeTab === "local_cli" ? "byok" : "local_cli";
    selectTab(nextTab);
    requestAnimationFrame(() => {
      document.getElementById(nextTab === "local_cli" ? localCliTabId : byokTabId)?.focus();
    });
  }

  return (
    <div className="space-y-5">
      <div
        className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between"
      >
        <div
          className="inline-flex w-fit rounded-lg border border-slate-200 bg-slate-100 p-1"
          role="tablist"
          aria-label="Execution mode"
        >
          {localAiAvailable ? (
            <button
              id={localCliTabId}
              type="button"
              role="tab"
              aria-selected={activeTab === "local_cli"}
              aria-controls={localCliPanelId}
              tabIndex={activeTab === "local_cli" ? 0 : -1}
              data-testid="execution-mode-tab-local-cli"
              className={clsx(
                "rounded-md px-4 py-2 text-xs font-semibold transition",
                activeTab === "local_cli"
                  ? "bg-ink text-white shadow-sm"
                  : "text-slate-600 hover:bg-white/70 hover:text-ink"
              )}
              onClick={() => selectTab("local_cli")}
              onKeyDown={handleTabKeyDown}
            >
              Local AI
            </button>
          ) : null}
          <button
            id={byokTabId}
            type="button"
            role="tab"
            aria-selected={activeTab === "byok"}
            aria-controls={byokPanelId}
            tabIndex={activeTab === "byok" ? 0 : -1}
            data-testid="execution-mode-tab-byok"
            className={clsx(
              "rounded-md px-4 py-2 text-xs font-semibold transition",
              activeTab === "byok"
                ? "bg-ink text-white shadow-sm"
                : "text-slate-600 hover:bg-white/70 hover:text-ink"
            )}
            onClick={() => selectTab("byok")}
            onKeyDown={handleTabKeyDown}
          >
            API keys
          </button>
        </div>

        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">
          {statusLine}
        </div>
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
          {!localAiAvailable ? (
            <div
              data-testid="hosted-web-local-ai-note"
              className="mb-4 rounded-lg border border-line bg-slate-50 px-4 py-3 text-sm leading-5 text-slate-700"
            >
              Local subscriptions and local models are available in VDT Studio Desktop.
            </div>
          ) : null}
          <ByokSettings />
        </div>
      )}
    </div>
  );
}
