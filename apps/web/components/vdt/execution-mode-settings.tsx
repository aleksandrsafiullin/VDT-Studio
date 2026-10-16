"use client";

import { useEffect, useId, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { clsx } from "clsx";
import type { ByokGateway, ByokProtocol } from "@/lib/execution-mode-catalog";
import { hasLocalAiUi, resolveVdtAppMode } from "@/lib/app-mode";
import { resolveExecutionCategory, type ExecutionCategory } from "@/lib/execution-category";
import { LocalCliSettings, LocalExecutionOptions } from "./local-cli-settings";
import { LocalModelSettings } from "./local-model-settings";
import { ByokSettings } from "./byok-settings";
import { useVdtStudioStore } from "./vdt-store";

const PROTOCOL_LABELS: Record<ByokProtocol, string> = {
  anthropic: "Anthropic", openai: "OpenAI", azure: "Azure OpenAI", gemini: "Google Gemini"
};
const GATEWAY_LABELS: Record<ByokGateway, string> = {
  none: "Direct", ollama: "Ollama Cloud", senseaudio: "SenseAudio", aihubmix: "AIHubMix"
};
const TABS: readonly { id: ExecutionCategory; key: string; label: string }[] = [
  { id: "cli_subscriptions", key: "local-cli", label: "CLI" },
  { id: "local_models", key: "local-models", label: "Local models" },
  { id: "byok", key: "byok", label: "API keys" }
];

export function ExecutionModeSettings() {
  const panelId = useId();
  const executionSettings = useVdtStudioStore((state) => state.executionSettings);
  const setExecutionCategory = useVdtStudioStore((state) => state.setExecutionCategory);
  const appMode = resolveVdtAppMode();
  const localExecutionAvailable = hasLocalAiUi(appMode);
  const tabs = localExecutionAvailable ? TABS : TABS.filter((tab) => tab.id === "byok");
  const activeTab = localExecutionAvailable ? resolveExecutionCategory(executionSettings) : "byok";
  const selectedTab = tabs.find((tab) => tab.id === activeTab)!;
  const statusLine = activeTab === "byok"
    ? `API keys · ${PROTOCOL_LABELS[executionSettings.byokProtocol ?? "openai"]} · ${GATEWAY_LABELS[executionSettings.byokGateway ?? "none"]}`
    : activeTab === "cli_subscriptions" ? "CLI subscriptions · Provider account" : "Local models · On this computer";

  useEffect(() => {
    if (!localExecutionAvailable && executionSettings.executionMode !== "byok") setExecutionCategory("byok");
  }, [localExecutionAvailable, executionSettings.executionMode, setExecutionCategory]);

  function handleTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    const index = tabs.findIndex((tab) => tab.id === activeTab);
    let nextIndex: number;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") nextIndex = (index + tabs.length - 1) % tabs.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabs.length - 1;
    else return;
    event.preventDefault();
    const next = tabs[nextIndex]!;
    setExecutionCategory(next.id);
    requestAnimationFrame(() => document.getElementById(`${panelId}-${next.key}-tab`)?.focus());
  }

  return (
    <div className="space-y-5">
      <div className="space-y-3 border-b border-line pb-4">
        <div className={clsx("grid w-full gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1 sm:inline-flex sm:w-fit", tabs.length === 3 ? "grid-cols-3" : "grid-cols-1")} role="tablist" aria-label="Execution mode">
          {tabs.map((tab) => (
            <button key={tab.id} id={`${panelId}-${tab.key}-tab`} type="button" role="tab"
              aria-selected={activeTab === tab.id} aria-controls={`${panelId}-${tab.key}-panel`} tabIndex={activeTab === tab.id ? 0 : -1}
              data-testid={`execution-mode-tab-${tab.key}`}
              className={clsx("min-w-0 whitespace-nowrap rounded-md px-2 py-2 text-[11px] font-semibold transition sm:px-4 sm:text-xs", activeTab === tab.id ? "bg-ink text-white shadow-sm" : "text-slate-600 hover:bg-white/70 hover:text-ink")}
              onClick={() => setExecutionCategory(tab.id)} onKeyDown={handleTabKeyDown}>{tab.label}</button>
          ))}
        </div>
        <p className="px-1 text-[11px] font-medium text-slate-500">{statusLine}</p>
      </div>
      <div id={`${panelId}-${selectedTab.key}-panel`} role="tabpanel" aria-labelledby={`${panelId}-${selectedTab.key}-tab`} data-testid={`execution-mode-panel-${selectedTab.key}`}>
        {activeTab === "cli_subscriptions" ? <LocalCliSettings /> : activeTab === "local_models" ? <LocalModelSettings /> : (
          <>
            {!localExecutionAvailable ? <div data-testid="hosted-web-local-ai-note" className="mb-4 rounded-lg border border-line bg-slate-50 px-4 py-3 text-sm leading-5 text-slate-700">CLI subscriptions and local model servers are available in VDT Studio Desktop.</div> : null}
            <ByokSettings />
          </>
        )}
      </div>
      {activeTab !== "byok" ? <LocalExecutionOptions /> : null}
    </div>
  );
}
