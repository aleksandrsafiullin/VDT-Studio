"use client";

import {
  Brain,
  Cpu,
  Monitor,
  Palette,
  Plug,
  Sparkles,
  type LucideIcon
} from "lucide-react";
import { clsx } from "clsx";

export type SettingsSectionId =
  | "execution"
  | "memory"
  | "skills"
  | "mcp"
  | "appearance"
  | "display";

export interface SettingsSectionConfig {
  id: SettingsSectionId;
  label: string;
  icon: LucideIcon;
  enabled: boolean;
}

export const SETTINGS_SECTIONS: SettingsSectionConfig[] = [
  { id: "execution", label: "Execution mode", icon: Cpu, enabled: true },
  { id: "memory", label: "Memory", icon: Brain, enabled: false },
  { id: "skills", label: "Skills", icon: Sparkles, enabled: false },
  { id: "mcp", label: "MCP", icon: Plug, enabled: false },
  { id: "appearance", label: "Appearance", icon: Palette, enabled: false },
  { id: "display", label: "Display", icon: Monitor, enabled: true }
];

export const SETTINGS_SECTION_META: Record<
  SettingsSectionId,
  { title: string; subtitle: string }
> = {
  execution: {
    title: "Execution mode",
    subtitle: "Choose Local CLI or BYOK."
  },
  memory: {
    title: "Memory",
    subtitle: "Configure how the workspace remembers context."
  },
  skills: {
    title: "Skills",
    subtitle: "Manage installable agent skills."
  },
  mcp: {
    title: "MCP",
    subtitle: "Connect Model Context Protocol servers."
  },
  appearance: {
    title: "Appearance",
    subtitle: "Customize theme and visual styling."
  },
  display: {
    title: "Display",
    subtitle: "Adjust font and panel scale for this workspace."
  }
};

interface SettingsNavProps {
  activeSection: SettingsSectionId;
  onSelect: (section: SettingsSectionId) => void;
  layout?: "vertical" | "horizontal" | "responsive";
  className?: string;
}

export function SettingsNav({
  activeSection,
  onSelect,
  layout = "vertical",
  className
}: SettingsNavProps) {
  const isVertical = layout === "vertical";
  const isResponsive = layout === "responsive";

  return (
    <nav
      role="navigation"
      aria-label="Settings sections"
      className={clsx(
        isResponsive
          ? "flex gap-1 overflow-x-auto pb-1 md:flex-col md:gap-0.5 md:overflow-visible md:pb-0"
          : isVertical
            ? "flex flex-col gap-0.5"
            : "flex gap-1 overflow-x-auto pb-1",
        className
      )}
    >
      {SETTINGS_SECTIONS.map((section) => {
        const Icon = section.icon;
        const isActive = section.enabled && activeSection === section.id;
        const itemLayout = isResponsive ? "responsive" : layout;

        if (!section.enabled) {
          return (
            <div
              key={section.id}
              role="button"
              aria-disabled="true"
              tabIndex={0}
              data-testid={`settings-nav-${section.id}`}
              className={clsx(
                "flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium",
                "cursor-not-allowed text-muted opacity-60",
                itemLayout !== "vertical" && "whitespace-nowrap"
              )}
              onClick={(event) => event.preventDefault()}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                }
              }}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">{section.label}</span>
              <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted">
                Coming soon
              </span>
            </div>
          );
        }

        return (
          <button
            key={section.id}
            type="button"
            aria-current={isActive ? "page" : undefined}
            data-testid={`settings-nav-${section.id}`}
            className={clsx(
              "relative flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium transition",
              itemLayout !== "vertical" && "whitespace-nowrap",
              isActive
                ? "bg-slate-100 text-ink"
                : "text-muted hover:bg-slate-50 hover:text-ink"
            )}
            onClick={() => onSelect(section.id)}
          >
            {isActive && (isVertical || isResponsive) ? (
              <span
                className={clsx(
                  "absolute bottom-1 left-0 top-1 w-0.5 rounded-full bg-accent",
                  isResponsive && "hidden md:block"
                )}
                aria-hidden
              />
            ) : null}
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            <span>{section.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
