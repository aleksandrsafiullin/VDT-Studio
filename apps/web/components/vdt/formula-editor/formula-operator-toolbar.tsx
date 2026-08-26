"use client";

import { clsx } from "clsx";
import type { FormulaEditorFunctionName, FormulaEditorOperator } from "./formula-editor-model";

const toolbarItems: Array<{ op: FormulaEditorOperator; label: string; ariaLabel: string }> = [
  { op: "+", label: "+", ariaLabel: "Insert plus" },
  { op: "-", label: "−", ariaLabel: "Insert minus" },
  { op: "*", label: "×", ariaLabel: "Insert multiply" },
  { op: "/", label: "÷", ariaLabel: "Insert divide" },
  { op: "(", label: "(", ariaLabel: "Insert left parenthesis" },
  { op: ")", label: ")", ariaLabel: "Insert right parenthesis" }
];

const functionToolbarItems: Array<{ name: FormulaEditorFunctionName; ariaLabel: string }> = [
  { name: "min", ariaLabel: "Insert min function" },
  { name: "max", ariaLabel: "Insert max function" }
];

export interface FormulaOperatorToolbarProps {
  onInsert: (op: FormulaEditorOperator) => void;
  onInsertFunction: (name: FormulaEditorFunctionName) => void;
  onInsertComma: () => void;
  onAddNumber: () => void;
  className?: string;
}

export function FormulaOperatorToolbar({
  onInsert,
  onInsertFunction,
  onInsertComma,
  onAddNumber,
  className
}: FormulaOperatorToolbarProps) {
  return (
    <div
      className={clsx("flex flex-wrap items-center gap-1.5", className)}
      role="toolbar"
      aria-label="Formula operators"
      data-testid="formula-operator-toolbar"
    >
      {toolbarItems.map(({ op, label, ariaLabel }) => (
        <button
          key={op}
          type="button"
          className="inline-flex h-8 min-w-8 items-center justify-center rounded-md border border-slate-200 bg-white px-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          aria-label={ariaLabel}
          data-testid={`formula-toolbar-${op === "*" ? "multiply" : op === "/" ? "divide" : op === "-" ? "minus" : op === "+" ? "plus" : op === "(" ? "left-paren" : "right-paren"}`}
          onClick={() => onInsert(op)}
        >
          {label}
        </button>
      ))}
      {functionToolbarItems.map(({ name, ariaLabel }) => (
        <button
          key={name}
          type="button"
          className="inline-flex h-8 min-w-8 items-center justify-center rounded-md border border-slate-200 bg-white px-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          aria-label={ariaLabel}
          data-testid={`formula-toolbar-${name}`}
          onClick={() => onInsertFunction(name)}
        >
          {name}
        </button>
      ))}
      <button
        type="button"
        className="inline-flex h-8 min-w-8 items-center justify-center rounded-md border border-slate-200 bg-white px-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
        aria-label="Insert comma"
        data-testid="formula-toolbar-comma"
        onClick={onInsertComma}
      >
        ,
      </button>
      <button
        type="button"
        className="inline-flex h-8 items-center justify-center rounded-md border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
        aria-label="Add number"
        data-testid="formula-toolbar-add-number"
        onClick={onAddNumber}
      >
        Add number
      </button>
    </div>
  );
}
