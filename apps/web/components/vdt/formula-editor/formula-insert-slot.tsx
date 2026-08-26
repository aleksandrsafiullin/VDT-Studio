"use client";

import { useDroppable } from "@dnd-kit/core";
import { clsx } from "clsx";
import { FormulaInsertIndicator } from "./formula-insert-indicator";
import { formulaInsertSlotId } from "./formula-pointer-insert-index";

export interface FormulaInsertSlotProps {
  index: number;
  showCaret: boolean;
  activeDrag: boolean | null;
  dragInsertIndex?: number | null;
  onClick: () => void;
  className?: string;
}

export function FormulaInsertSlot({
  index,
  showCaret,
  activeDrag,
  dragInsertIndex = null,
  onClick,
  className
}: FormulaInsertSlotProps) {
  const { setNodeRef } = useDroppable({
    id: formulaInsertSlotId(index),
    data: { type: "formula-insert-slot", index }
  });
  const showIndicator = activeDrag ? dragInsertIndex === index : showCaret;

  return (
    <button
      ref={setNodeRef}
      type="button"
      className={clsx(
        "inline-flex min-h-8 min-w-[11px] items-center justify-center self-stretch rounded-sm",
        className
      )}
      data-testid={formulaInsertSlotId(index)}
      aria-label={`Insert at position ${index}`}
      onClick={onClick}
    >
      {showIndicator ? <FormulaInsertIndicator /> : null}
    </button>
  );
}
