import { clsx } from "clsx";
import type { FormulaEditorFunctionName } from "./formula-editor-model";

export interface FormulaFunctionTokenProps {
  name: FormulaEditorFunctionName;
  className?: string;
}

export function FormulaFunctionToken({ name, className }: FormulaFunctionTokenProps) {
  return (
    <span
      className={clsx(
        "inline-flex items-center justify-center rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700",
        className
      )}
      data-testid={`formula-function-${name}`}
      aria-hidden
    >
      {name}
    </span>
  );
}
