"use client";

import { Folder, GitBranch } from "lucide-react";
import { clsx } from "clsx";
import type { ReactNode } from "react";
import { hasActiveWorkspaceVdt, useVdtStudioStore, type WorkspacePanelMode } from "./vdt-store";

const modes: Array<{
  id: WorkspacePanelMode;
  label: string;
  icon: ReactNode;
}> = [
  {
    id: "project",
    label: "Project management",
    icon: <Folder className="h-4 w-4" />
  },
  {
    id: "vdt",
    label: "VDT management",
    icon: <GitBranch className="h-4 w-4" />
  }
];

export function WorkspaceModeRail({
  appleStyle = false,
  onProjectMode
}: {
  appleStyle?: boolean;
  onProjectMode?: () => void;
}) {
  const workspace = useVdtStudioStore((state) => state.workspace);
  const setWorkspacePanel = useVdtStudioStore((state) => state.setWorkspacePanel);
  const canOpenVdt = hasActiveWorkspaceVdt(workspace);
  const activePanel = canOpenVdt ? workspace.activePanel : "project";

  return (
    <nav
      aria-label="Workspace mode"
      className={clsx(
        "flex h-auto shrink-0 flex-row gap-1 p-2 lg:h-full lg:flex-col",
        appleStyle
          ? "border-b border-black/5 bg-white/70 backdrop-blur-xl lg:border-b-0 lg:border-r"
          : "border-b border-line bg-white shadow-panel lg:border-b-0 lg:border-r"
      )}
    >
      {modes.map((mode) => {
        const selected = activePanel === mode.id;
        const disabled = mode.id === "vdt" && !canOpenVdt;
        return (
          <button
            key={mode.id}
            type="button"
            title={disabled ? "Create or open a VDT first" : mode.label}
            aria-label={mode.label}
            aria-pressed={selected}
            disabled={disabled}
            data-testid={`workspace-mode-${mode.id}`}
            className={clsx(
              "flex h-9 w-9 items-center justify-center transition",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              "disabled:cursor-not-allowed disabled:opacity-35",
              appleStyle
                ? clsx(
                    "rounded-xl text-slate-600",
                    selected
                      ? "bg-accent/10 text-accent"
                      : "border border-transparent hover:bg-black/[0.04] hover:text-ink"
                  )
                : clsx(
                    "rounded-md border text-slate-600",
                    selected
                      ? "border-slate-900 bg-slate-900 text-white shadow-sm"
                      : "border-transparent hover:border-line hover:bg-slate-50 hover:text-ink"
                  )
            )}
            onClick={() => {
              if (mode.id === "project" && canOpenVdt && workspace.activePanel === "vdt") {
                onProjectMode?.();
                return;
              }
              setWorkspacePanel(mode.id);
            }}
          >
            {mode.icon}
            <span className="sr-only">{mode.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
