"use client";

import {
  Brain,
  Cpu,
  Monitor,
  Palette,
  type LucideIcon
} from "lucide-react";
import { clsx } from "clsx";

export type SettingsSectionId =
  | "execution"
  | "memory"
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
  { id: "appearance", label: "Appearance", icon: Palette, enabled: false },
  { id: "display", label: "Display", icon: Monitor, enabled: true }
];

export const SETTINGS_SECTION_META: Record<
  SettingsSectionId,
  { title: string; subtitle: string }
> = {
  execution: {
    title: "Execution mode",
    subtitle: "Choose API keys or desktop local AI."
  },
  memory: {
    title: "Memory",
    subtitle: "Configure how the workspace remembers context."
  },
  appearance: {
    title: "Appearance",
    subtitle: "Customize theme and visual styling."
  },
  display: {
    title: "Display",
    subtitle: "Adjust font scale and panel layout for this workspace."
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
          ? "grid grid-cols-2 gap-2 md:flex md:flex-col md:gap-2"
          : isVertical
            ? "flex flex-col gap-2"
            : "flex gap-1 overflow-x-auto pb-1",
        className
      )}
    >
      {SETTINGS_SECTIONS.map((section) => {
        const Icon = section.icon;
        const isActive = section.enabled && activeSection === section.id;
        const isStacked = isVertical || isResponsive;

        if (!section.enabled) {
          return (
            <div
              key={section.id}
              role="button"
              aria-disabled="true"
              tabIndex={0}
              data-testid={`settings-nav-${section.id}`}
              className={clsx(
                "flex shrink-0 items-center gap-2 rounded-lg border border-transparent px-3 py-2.5 text-left text-sm font-medium",
                "cursor-not-allowed text-slate-400/75",
                layout === "horizontal" && "whitespace-nowrap"
              )}
              onClick={(event) => event.preventDefault()}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                }
              }}
            >
              <Icon className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
              <span className="min-w-0 flex-1">{section.label}</span>
              <span className="hidden shrink-0 rounded-full border border-white/10 bg-white/[0.08] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-normal text-slate-300 sm:inline-flex md:inline-flex">
                Soon
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
              "relative flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm font-medium transition",
              layout === "horizontal" && "whitespace-nowrap",
              isActive
                ? "border-white/15 bg-white/[0.13] text-white shadow-[0_10px_28px_rgba(0,0,0,0.18)]"
                : "border-transparent text-slate-300 hover:bg-white/[0.08] hover:text-white"
            )}
            onClick={() => onSelect(section.id)}
          >
            {isActive && isStacked ? (
              <span
                className={clsx(
                  "absolute bottom-2 left-0 top-2 w-0.5 rounded-full bg-[#7dd3fc]",
                  isResponsive && "hidden md:block"
                )}
                aria-hidden
              />
            ) : null}
            <Icon
              className={clsx("h-4 w-4 shrink-0", isActive ? "text-blue-100" : "text-slate-400")}
              aria-hidden
            />
            <span>{section.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
