import type { ButtonHTMLAttributes, HTMLAttributes } from "react";
import { clsx } from "clsx";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./button";

export function Panel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <section
      className={clsx("vdt-ui-scale border-line bg-white shadow-panel", className)}
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

export function PanelCollapseTab({
  label,
  side,
  onToggle,
  testId,
  expandTestId
}: {
  label: string;
  side: "left" | "right";
  onToggle: () => void;
  testId?: string;
  expandTestId?: string;
}) {
  const Icon = side === "left" ? ChevronRight : ChevronLeft;

  return (
    <Panel className={clsx("flex h-full min-h-0 flex-col items-center py-3", side === "left" ? "border-r" : "border-l")}>
      <Button
        size="icon"
        variant="ghost"
        aria-label={`Expand ${label}`}
        data-testid={expandTestId ?? testId}
        icon={<Icon className="h-4 w-4" />}
        onClick={onToggle}
      />
      <span className="vdt-vertical-label mt-3">{label}</span>
    </Panel>
  );
}

export function PanelCollapseButton({
  side,
  onToggle,
  testId,
  ...props
}: {
  side: "left" | "right";
  onToggle: () => void;
  testId?: string;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;

  return (
    <Button
      size="icon"
      variant="ghost"
      className="hidden lg:inline-flex"
      aria-label={side === "left" ? "Collapse setup panel" : "Collapse inspector panel"}
      data-testid={testId}
      icon={<Icon className="h-4 w-4" />}
      onClick={onToggle}
      {...props}
    />
  );
}
