"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, CircleAlert, Globe, X } from "lucide-react";
import type { ResearchMode } from "@/lib/agent-client";
import styles from "./agent-chat.module.css";

export interface ResearchStatus {
  providerConfigured: boolean;
  providerId: string;
  checkFailed?: boolean;
}

export const WEB_SEARCH_MODES: { mode: ResearchMode; label: string; description: string }[] = [
  { mode: "off", label: "Off", description: "Do not search the web." },
  { mode: "auto", label: "Auto", description: "Let the agent search when it needs more context." },
  { mode: "on", label: "On", description: "Use web search for missing or current information." }
];

export function researchModeTooltip(mode: ResearchMode, status: ResearchStatus | undefined): string {
  const description = WEB_SEARCH_MODES.find((option) => option.mode === mode)!.description;
  if (mode === "off") return `Web search is off. ${description}`;
  if (status?.checkFailed) return `${description} Search availability could not be checked.`;
  if (status?.providerConfigured === false) return `${description} Search provider is not configured.`;
  return description;
}

export function WebSearchControl({ mode, status, onChange }: {
  mode: ResearchMode;
  status: ResearchStatus | undefined;
  onChange: (mode: ResearchMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const label = WEB_SEARCH_MODES.find((option) => option.mode === mode)!.label;
  const needsSetup = mode !== "off" && status?.providerConfigured === false;

  useEffect(() => {
    if (!open) return;
    popupRef.current?.querySelector<HTMLInputElement>("input:checked")?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return <div ref={containerRef} className={styles.contextMenu}>
    <button
      ref={triggerRef}
      type="button"
      className={styles.researchButton}
      aria-label={`Web search: ${label}${needsSetup ? " — needs setup" : ""}`}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls="agent-web-search-options"
      title={researchModeTooltip(mode, status)}
      data-testid="agent-research-mode-toggle"
      data-research-mode={mode}
      data-provider-configured={status?.providerConfigured ?? "unknown"}
      onClick={() => setOpen((value) => !value)}
    >
      <Globe size={14} aria-hidden="true" /><span>{label}</span>
      {needsSetup ? <CircleAlert size={12} aria-hidden="true" /> : <ChevronDown size={10} aria-hidden="true" />}
    </button>
    {open ? <div ref={popupRef} className={styles.researchPopover} role="dialog" aria-label="Web search" id="agent-web-search-options">
      <div className={styles.researchHeading}><span>Web search</span><button type="button" className={styles.iconButton} aria-label="Close web search settings" onClick={() => { setOpen(false); triggerRef.current?.focus(); }}><X size={13} aria-hidden="true" /></button></div>
      <fieldset>
        <legend className="sr-only">Web search mode</legend>
        {WEB_SEARCH_MODES.map((option) => <label key={option.mode} className={styles.researchOption}>
          <input type="radio" name="agent-web-search-mode" value={option.mode} checked={mode === option.mode} onChange={() => onChange(option.mode)} data-testid={`research-mode-${option.mode}`} />
          <span><strong>{option.label}</strong><span>{option.description}</span></span>
        </label>)}
      </fieldset>
      {needsSetup ? <p className={styles.researchNotice} role="status"><CircleAlert size={13} aria-hidden="true" />{status?.checkFailed ? "Search availability could not be checked." : "Search provider is not configured."}</p> : null}
    </div> : null}
  </div>;
}
