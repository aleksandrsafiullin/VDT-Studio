import type { ButtonHTMLAttributes, HTMLAttributes } from "react";
import { clsx } from "clsx";
import { PanelToggleIcon, type PanelToggleTarget } from "./panel-toggle-icons";

export function Panel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <section
      className={clsx("vdt-ui-scale relative border-line bg-white shadow-panel", className)}
      {...props}
    />
  );
}

export function PanelHeader({
  title,
  subtitle,
  action
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold text-ink">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-xs leading-5 text-muted">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

function panelToggleLabel(panel: PanelToggleTarget, expanded: boolean) {
  if (panel === "left") {
    return expanded ? "Collapse setup panel" : "Expand setup panel";
  }
  if (panel === "right") {
    return expanded ? "Collapse inspector panel" : "Expand inspector panel";
  }
  return expanded ? "Collapse scenario drawer" : "Expand scenario drawer";
}

export function PanelToggleButton({
  panel,
  expanded = true,
  onToggle,
  testId,
  className,
  ...props
}: {
  panel: PanelToggleTarget;
  expanded?: boolean;
  onToggle: () => void;
  testId?: string | undefined;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label={panelToggleLabel(panel, expanded)}
      data-testid={testId}
      className={clsx(
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted transition",
        "hover:bg-slate-100 hover:text-ink",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        "disabled:cursor-not-allowed disabled:opacity-45",
        className
      )}
      onClick={onToggle}
      {...props}
    >
      <PanelToggleIcon panel={panel} className="h-4 w-4" />
    </button>
  );
}

/** @deprecated Use PanelToggleButton */
export const PanelEdgeToggle = PanelToggleButton;

export function PanelCollapseTab({
  label,
  panel,
  onToggle,
  testId,
  expandTestId
}: {
  label: string;
  panel: PanelToggleTarget;
  onToggle: () => void;
  testId?: string;
  expandTestId?: string;
}) {
  return (
    <Panel
      className={clsx(
        "flex h-full min-h-0 flex-col items-center py-3",
        panel === "left" ? "border-r" : panel === "right" ? "border-l" : "border-t"
      )}
    >
      <PanelToggleButton
        panel={panel}
        expanded={false}
        testId={expandTestId ?? testId}
        onToggle={onToggle}
      />
      <span className="vdt-vertical-label mt-3">{label}</span>
    </Panel>
  );
}
