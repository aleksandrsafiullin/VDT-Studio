"use client";

import { clsx } from "clsx";
import { GripVertical, X } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";

export interface FormulaReferenceChipProps {
  nodeId: string;
  displayName: string;
  tokenId?: string;
  testId?: string;
  unknownRef?: boolean;
  onRemove?: () => void;
  dragHandle?: ReactNode;
  dragHandleProps?: HTMLAttributes<HTMLElement>;
  className?: string;
}

export function FormulaReferenceChip({
  nodeId,
  displayName,
  tokenId,
  testId,
  unknownRef = false,
  onRemove,
  dragHandle,
  dragHandleProps,
  className
}: FormulaReferenceChipProps) {
  const removeTestId = tokenId ? `formula-ref-remove-${tokenId}` : `formula-ref-remove-${nodeId}`;

  return (
    <span
      className={clsx(
        "inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-1 text-xs font-medium",
        unknownRef
          ? "border-orange-300 bg-orange-50 text-orange-800"
          : "border-slate-200 bg-blue-50 text-blue-700",
        className
      )}
      data-testid={testId ?? `formula-ref-chip-${nodeId}`}
    >
      {dragHandle ?? (
        <span
          {...dragHandleProps}
          className={clsx(
            "inline-flex shrink-0 cursor-grab text-slate-400 active:cursor-grabbing",
            dragHandleProps?.className
          )}
          data-testid={dragHandleProps ? undefined : `formula-ref-drag-handle-${nodeId}`}
          aria-hidden={dragHandleProps ? undefined : true}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </span>
      )}
      <span className="truncate" title={displayName}>
        {displayName}
      </span>
      {onRemove ? (
        <button
          type="button"
          className="inline-flex shrink-0 rounded p-0.5 text-slate-500 hover:bg-white/70 hover:text-slate-700"
          aria-label={`Remove ${displayName}`}
          data-testid={removeTestId}
          onClick={onRemove}
        >
          <X className="h-3 w-3" />
        </button>
      ) : null}
    </span>
  );
}
