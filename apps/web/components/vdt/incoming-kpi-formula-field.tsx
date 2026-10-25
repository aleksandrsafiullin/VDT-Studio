"use client";

import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { TextArea } from "@/components/ui/field";
import { FormulaReferenceChip } from "./formula-editor/formula-reference-chip";

export interface IncomingKpiFormulaReference {
  alias: string;
  name: string;
  unit?: string;
  selected?: boolean;
}

export interface IncomingKpiFormulaFieldProps {
  rawValue: string;
  onChange: (rawValue: string) => void;
  references: readonly IncomingKpiFormulaReference[];
  error?: string;
  disabled?: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  children?: ReactNode;
  compact?: boolean;
}

const rawFormulaLimit = 1024;
const referenceAlias = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type IncomingKpiReadablePart = { kind: "text"; text: string }
  | { kind: "reference"; reference: IncomingKpiFormulaReference };

/** Display-only token labels; raw text and the submitted expression are never
 * rewritten. This also names references in temporarily invalid expressions. */
export function incomingKpiReadableFormula(rawValue: string, references: readonly IncomingKpiFormulaReference[]): IncomingKpiReadablePart[] {
  const names = new Map(references.map(reference => [reference.alias, reference]));
  const result: IncomingKpiReadablePart[] = [];
  let cursor = 0;
  for (const match of rawValue.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
    const reference = names.get(match[0]);
    if (!reference) continue;
    if (match.index > cursor) result.push({ kind: "text", text: rawValue.slice(cursor, match.index) });
    result.push({ kind: "reference", reference }); cursor = match.index + match[0].length;
  }
  if (cursor < rawValue.length) result.push({ kind: "text", text: rawValue.slice(cursor) });
  return result;
}

function insertFormulaText(rawValue: string, text: string, selectionStart = rawValue.length, selectionEnd = selectionStart) {
  const start = Number.isFinite(selectionStart) ? Math.max(0, Math.min(rawValue.length, Math.trunc(selectionStart))) : rawValue.length;
  const end = Number.isFinite(selectionEnd) ? Math.max(start, Math.min(rawValue.length, Math.trunc(selectionEnd))) : start;
  const before = rawValue.slice(0, start), after = rawValue.slice(end);
  const inserted = `${before && !/\s$/.test(before) ? " " : ""}${text}${after && !/^\s/.test(after) ? " " : ""}`;
  const next = `${before}${inserted}${after}`;
  return next.length > rawFormulaLimit ? undefined : { rawValue: next, caret: before.length + inserted.length };
}

/** Insert only the chosen reference. Arithmetic remains the user's expression. */
export function insertIncomingKpiFormulaReference(
  rawValue: string,
  alias: string,
  selectionStart = rawValue.length,
  selectionEnd = selectionStart
): { rawValue: string; caret: number } | undefined {
  if (!referenceAlias.test(alias)) return undefined;
  return insertFormulaText(rawValue, alias, selectionStart, selectionEnd);
}

/** Local text only: this component never parses, saves or prepares suggestions. */
export function IncomingKpiFormulaField({
  rawValue,
  onChange,
  references,
  error,
  disabled = false,
  expanded,
  onExpandedChange,
  children,
  compact = false
}: IncomingKpiFormulaFieldProps) {
  const id = useId();
  const [textOpen, setTextOpen] = useState(false);
  const editorOpen = expanded ?? textOpen;
  const setEditorOpen = (open: boolean) => { setTextOpen(open); onExpandedChange?.(open); };
  const textarea = useRef<HTMLTextAreaElement>(null);
  const knownReferences = useRef(new Map<string, IncomingKpiFormulaReference>());
  for (const [alias, reference] of knownReferences.current) knownReferences.current.set(alias, { ...reference, selected: false });
  for (const reference of references) knownReferences.current.set(reference.alias, reference);
  while (knownReferences.current.size > 128) knownReferences.current.delete(knownReferences.current.keys().next().value!);
  const readableParts = incomingKpiReadableFormula(rawValue, [...knownReferences.current.values()]);
  const hasSelection = useRef(false);
  const pendingCaret = useRef<{ rawValue: string; caret: number } | undefined>(undefined);
  const errorId = `${id}-error`;

  useLayoutEffect(() => {
    const pending = pendingCaret.current;
    if (!pending) return;
    pendingCaret.current = undefined;
    if (pending.rawValue !== rawValue || disabled || !editorOpen) return;
    textarea.current?.focus({ preventScroll: true });
    textarea.current?.setSelectionRange(pending.caret, pending.caret);
  }, [rawValue, disabled, editorOpen]);

  const insert = (text: string, operator = false) => {
    if (disabled) return;
    const field = textarea.current;
    const next = (operator ? insertFormulaText : insertIncomingKpiFormulaReference)(
      rawValue,
      text,
      editorOpen && hasSelection.current ? field?.selectionStart : undefined,
      editorOpen && hasSelection.current ? field?.selectionEnd : undefined
    );
    if (!next) return;
    hasSelection.current = true;
    if (next.rawValue === rawValue) {
      if (editorOpen) { field?.focus({ preventScroll: true }); field?.setSelectionRange(next.caret, next.caret); }
      return;
    }
    pendingCaret.current = next;
    onChange(next.rawValue);
  };

  return (
    <div className="space-y-2" data-testid="incoming-kpi-formula-field">
      {!compact ? <p className="text-[11px] font-medium text-muted">Formula</p> : null}
      <div data-testid="incoming-kpi-readable-formula" aria-label="Formula in KPI names" className={compact ? "text-[11px] leading-5 text-muted" : "rounded-md bg-slate-50 px-2.5 py-2 text-xs leading-5"}>
        {readableParts.length ? readableParts.map((part, index) => part.kind === "reference" ? <span key={index}
          className={part.reference.selected === false ? "font-medium text-amber-800 underline decoration-dotted" : "font-medium"}>{part.reference.name}</span> :
          <span key={index} className="whitespace-pre-wrap">{part.text.replaceAll("*", "×").replaceAll("/", "÷")}</span>) : <span className="text-muted">Enter a formula in Edit.</span>}
      </div>
      <details open={editorOpen} onToggle={event => { if (event.currentTarget.open !== editorOpen) setEditorOpen(event.currentTarget.open); }} data-testid="incoming-kpi-edit">
        <summary className="cursor-pointer text-xs text-muted">Edit</summary>
        <div className="mt-3 space-y-3">
        {children}
        <label htmlFor={id} className="block text-xs font-medium">Formula</label>
        <TextArea
        ref={textarea}
        id={id}
        value={rawValue}
        disabled={disabled}
        maxLength={rawFormulaLimit}
        rows={2}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        data-testid="incoming-kpi-formula-input"
        className="min-h-16 px-2 py-1.5 font-mono text-xs"
        onFocus={() => { hasSelection.current = true; }}
        onChange={event => {
          pendingCaret.current = undefined;
          onChange(event.currentTarget.value);
        }}
        />
      <div role="group" aria-label="Formula operators" className="flex flex-wrap gap-1">
        {[["+", "+"], ["-", "−"], ["*", "×"], ["/", "÷"], ["(", "("], [")", ")"]].map(([operator, label]) => <button key={operator}
          type="button" disabled={disabled} aria-label={`Insert ${label}`} className="h-7 min-w-7 rounded border border-line bg-white px-1.5 text-xs disabled:opacity-50"
          onClick={() => insert(operator!, true)}>{label}</button>)}
      </div>
      {references.length > 0 ? (
        <div role="group" aria-label="Insert KPI reference" className="flex flex-wrap gap-1">
          {references.filter(reference => reference.selected !== false).map(reference => (
            <button
              key={reference.alias}
              type="button"
              disabled={disabled || !referenceAlias.test(reference.alias)}
              aria-label={`Insert ${reference.name}${reference.unit ? ` (${reference.unit})` : ""}`}
              data-reference-alias={reference.alias}
              className="inline-flex max-w-full items-center gap-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-blue-200 disabled:opacity-50"
              onClick={() => insert(reference.alias)}
            >
              <FormulaReferenceChip
                nodeId={reference.alias}
                displayName={reference.name}
                dragHandle={<></>}
                className="py-0.5"
              />
              {reference.unit ? <span className="shrink-0 text-[10px] text-muted">{reference.unit}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
        </div>
      </details>
      {error ? <p id={errorId} role="alert" className="text-xs text-amber-800">{error}</p> : null}
    </div>
  );
}
