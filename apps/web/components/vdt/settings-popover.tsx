"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Bot, Monitor, RotateCcw, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AiProviderSettings } from "./ai-provider-settings";
import { useVdtStudioStore } from "./vdt-store";

const TRIGGER_ID = "settings-popover-trigger";

export function SettingsPopover() {
  const [open, setOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<"display" | "ai">("display");
  const containerRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const displayTabId = `${panelId}-display-tab`;
  const displayPanelId = `${panelId}-display-panel`;
  const aiTabId = `${panelId}-ai-tab`;
  const aiPanelId = `${panelId}-ai-panel`;
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

  function handleTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }

    event.preventDefault();
    const nextSection = activeSection === "display" ? "ai" : "display";
    setActiveSection(nextSection);
    requestAnimationFrame(() => {
      document.getElementById(nextSection === "display" ? displayTabId : aiTabId)?.focus();
    });
  }

  useEffect(() => {
    if (!open) {
      return;
    }

    requestAnimationFrame(() => {
      containerRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
    });

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
          className="absolute right-0 top-10 z-30 max-h-[min(78vh,680px)] w-[min(92vw,420px)] overflow-y-auto rounded-md border border-line bg-white shadow-panel"
          role="dialog"
          aria-label="Workspace settings"
        >
          <div className="border-b border-line px-4 py-3">
            <h3 className="text-sm font-semibold text-ink">Workspace settings</h3>
            <div className="mt-3 grid grid-cols-2 rounded-md border border-line bg-slate-50 p-1" role="tablist">
              <button
                id={displayTabId}
                type="button"
                role="tab"
                aria-selected={activeSection === "display"}
                aria-controls={displayPanelId}
                tabIndex={activeSection === "display" ? 0 : -1}
                className={
                  activeSection === "display"
                    ? "flex h-8 items-center justify-center gap-2 rounded bg-white px-3 text-xs font-semibold text-ink shadow-sm"
                    : "flex h-8 items-center justify-center gap-2 rounded px-3 text-xs font-medium text-muted hover:text-ink"
                }
                onClick={() => setActiveSection("display")}
                onKeyDown={handleTabKeyDown}
              >
                <Monitor className="h-4 w-4" />
                Display
              </button>
              <button
                id={aiTabId}
                type="button"
                role="tab"
                aria-selected={activeSection === "ai"}
                aria-controls={aiPanelId}
                tabIndex={activeSection === "ai" ? 0 : -1}
                className={
                  activeSection === "ai"
                    ? "flex h-8 items-center justify-center gap-2 rounded bg-white px-3 text-xs font-semibold text-ink shadow-sm"
                    : "flex h-8 items-center justify-center gap-2 rounded px-3 text-xs font-medium text-muted hover:text-ink"
                }
                onClick={() => setActiveSection("ai")}
                onKeyDown={handleTabKeyDown}
              >
                <Bot className="h-4 w-4" />
                AI
              </button>
            </div>
          </div>

          <div className="p-4">
            {activeSection === "display" ? (
              <div
                id={displayPanelId}
                role="tabpanel"
                aria-labelledby={displayTabId}
                className="space-y-4"
              >
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
            ) : (
              <div id={aiPanelId} role="tabpanel" aria-labelledby={aiTabId}>
                <AiProviderSettings />
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
