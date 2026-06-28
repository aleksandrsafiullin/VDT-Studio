"use client";

import { clsx } from "clsx";

export interface FormulaInsertIndicatorProps {
  className?: string;
}

export function FormulaInsertIndicator({ className }: FormulaInsertIndicatorProps) {
  return (
    <span
      role="presentation"
      aria-hidden="true"
      data-testid="formula-insert-indicator"
      className={clsx(
        "inline-flex shrink-0 self-center px-0.5 text-xl font-light leading-none text-accent",
        className
      )}
    >
      |
    </span>
  );
}
