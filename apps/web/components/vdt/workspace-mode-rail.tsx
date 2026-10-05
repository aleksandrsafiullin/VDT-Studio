"use client";

import Link from "next/link";
import { Home, GitBranch } from "lucide-react";
import { clsx } from "clsx";
import type { ReactNode } from "react";
import { hasActiveWorkspaceVdt, useVdtStudioStore } from "./vdt-store";

const modes: Array<{
  id: "home" | "vdt";
  label: string;
  icon: ReactNode;
}> = [
  {
    id: "home",
    label: "Home",
    icon: <Home className="h-4 w-4" />
  },
  {
    id: "vdt",
    label: "VDT management",
    icon: <GitBranch className="h-4 w-4" />
  }
];

export function WorkspaceModeRail({
  appleStyle = false
}: {
  appleStyle?: boolean;
}) {
  const workspace = useVdtStudioStore((state) => state.workspace);
  const setWorkspacePanel = useVdtStudioStore((state) => state.setWorkspacePanel);
  const canOpenVdt = hasActiveWorkspaceVdt(workspace);
  const activePanel = canOpenVdt ? workspace.activePanel : "project";

  return (
    <nav
      aria-label="Workspace navigation"
      className={clsx(
        "flex h-auto shrink-0 flex-row gap-1 p-2 lg:h-full lg:flex-col",
        appleStyle
          ? "border-b border-black/5 bg-white/70 backdrop-blur-xl lg:border-b-0 lg:border-r"
          : "border-b border-line bg-white shadow-panel lg:border-b-0 lg:border-r"
      )}
    >
      {modes.map((mode) => {
        const selected = mode.id === "vdt" && activePanel === "vdt";
        const disabled = mode.id === "vdt" && !canOpenVdt;
        const className = clsx(
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
        );
        if (mode.id === "home") {
          return (
            <Link
              key={mode.id}
              href="/"
              title={mode.label}
              aria-label={mode.label}
              data-testid="workspace-home"
              className={className}
            >
              {mode.icon}
              <span className="sr-only">{mode.label}</span>
            </Link>
          );
        }
        return (
          <button
            key={mode.id}
            type="button"
            title={disabled ? "Create or open a VDT first" : mode.label}
            aria-label={mode.label}
            aria-pressed={selected}
            disabled={disabled}
            data-testid={`workspace-mode-${mode.id}`}
            className={className}
            onClick={() => setWorkspacePanel("vdt")}
          >
            {mode.icon}
            <span className="sr-only">{mode.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
