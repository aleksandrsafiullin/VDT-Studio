import type { HTMLAttributes } from "react";
import { clsx } from "clsx";

export function Panel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <section
      className={clsx("border-line bg-white shadow-panel", className)}
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
