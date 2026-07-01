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

export function WorkspaceModeRail() {
  const workspace = useVdtStudioStore((state) => state.workspace);
  const setWorkspacePanel = useVdtStudioStore((state) => state.setWorkspacePanel);
  const canOpenVdt = hasActiveWorkspaceVdt(workspace);
  const activePanel = canOpenVdt ? workspace.activePanel : "project";

  return (
    <nav
      aria-label="Workspace mode"
      className="flex h-auto shrink-0 flex-row gap-1 border-b border-line bg-white p-2 shadow-panel lg:h-full lg:flex-col lg:border-b-0 lg:border-r"
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
              "flex h-9 w-9 items-center justify-center rounded-md border text-slate-600 transition",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              "disabled:cursor-not-allowed disabled:opacity-35",
              selected
                ? "border-slate-900 bg-slate-900 text-white shadow-sm"
                : "border-transparent hover:border-line hover:bg-slate-50 hover:text-ink"
            )}
            onClick={() => setWorkspacePanel(mode.id)}
          >
            {mode.icon}
            <span className="sr-only">{mode.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
