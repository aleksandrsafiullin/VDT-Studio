"use client";

import {
  Brain,
  Cpu,
  Monitor,
  Mic,
  Palette,
  type LucideIcon
} from "lucide-react";
import { clsx } from "clsx";
import styles from "./settings-modal.module.css";

export type SettingsSectionId =
  | "execution"
  | "voice"
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
  { id: "voice", label: "Voice input", icon: Mic, enabled: true },
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
    subtitle: "Choose a provider CLI, a local model server, or API keys."
  },
  voice: {
    title: "Voice input",
    subtitle: "Download a speech model and dictate locally into chat."
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
  return (
    <nav
      role="navigation"
      aria-label="Settings sections"
      className={clsx(
        styles.navigation,
        layout === "responsive" ? styles.navResponsive : layout === "horizontal" ? styles.navHorizontal : undefined,
        className
      )}
    >
      {SETTINGS_SECTIONS.map((section) => {
        const Icon = section.icon;
        const isActive = section.enabled && activeSection === section.id;

        if (!section.enabled) {
          return (
            <div
              key={section.id}
              role="button"
              aria-disabled="true"
              tabIndex={0}
              data-testid={`settings-nav-${section.id}`}
              className={styles.navItem}
              onClick={(event) => event.preventDefault()}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                }
              }}
            >
              <Icon size={16} aria-hidden />
              <span className={styles.navLabel}>{section.label}</span>
              <span className={styles.soonBadge}>
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
            className={styles.navItem}
            onClick={() => onSelect(section.id)}
          >
            <Icon size={16} aria-hidden />
            <span className={styles.navLabel}>{section.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
