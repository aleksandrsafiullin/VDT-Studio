import { clsx } from "clsx";
import type { FormulaEditorOperator } from "./formula-editor-model";

const operatorLabels: Record<FormulaEditorOperator, string> = {
  "+": "+",
  "-": "−",
  "*": "×",
  "/": "÷",
  "(": "(",
  ")": ")"
};

const operatorTestIds: Record<FormulaEditorOperator, string> = {
  "+": "formula-operator-plus",
  "-": "formula-operator-minus",
  "*": "formula-operator-multiply",
  "/": "formula-operator-divide",
  "(": "formula-operator-left-paren",
  ")": "formula-operator-right-paren"
};

export interface FormulaOperatorTokenProps {
  operator: FormulaEditorOperator;
  className?: string;
}

export function FormulaOperatorToken({ operator, className }: FormulaOperatorTokenProps) {
  return (
    <span
      className={clsx(
        "inline-flex items-center justify-center rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700",
        className
      )}
      data-testid={operatorTestIds[operator]}
      aria-hidden
    >
      {operatorLabels[operator]}
    </span>
  );
}
