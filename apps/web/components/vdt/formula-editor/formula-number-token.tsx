"use client";

import { clsx } from "clsx";
import { GripVertical, X } from "lucide-react";
import { useEffect, useState, type HTMLAttributes, type ReactNode } from "react";

export interface FormulaNumberTokenProps {
  raw: string;
  tokenId?: string;
  onChange: (raw: string) => void;
  onBlur?: () => void;
  onRemove?: () => void;
  dragHandle?: ReactNode;
  dragHandleProps?: HTMLAttributes<HTMLElement>;
  className?: string;
}

export function FormulaNumberToken({
  raw,
  tokenId,
  onChange,
  onBlur,
  onRemove,
  dragHandle,
  dragHandleProps,
  className
}: FormulaNumberTokenProps) {
  const [draft, setDraft] = useState(raw);

  useEffect(() => {
    setDraft(raw);
  }, [raw]);

  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1 py-0.5",
        className
      )}
    >
      {dragHandle ?? (
        <span
          {...dragHandleProps}
          className={clsx(
            "inline-flex shrink-0 cursor-grab text-slate-400 active:cursor-grabbing",
            dragHandleProps?.className
          )}
          aria-hidden={dragHandleProps ? undefined : true}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </span>
      )}
      <input
        type="text"
        inputMode="decimal"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          onChange(draft);
          onBlur?.();
        }}
        className="w-14 min-w-0 bg-transparent px-1 py-0.5 text-xs font-medium text-slate-800 outline-none"
        aria-label="Formula number"
        data-testid="formula-number-token"
      />
      {onRemove ? (
        <button
          type="button"
          className="inline-flex shrink-0 rounded p-0.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          aria-label="Remove number"
          data-testid={tokenId ? `formula-number-remove-${tokenId}` : "formula-number-remove"}
          onClick={onRemove}
        >
          <X className="h-3 w-3" />
        </button>
      ) : null}
    </span>
  );
}
