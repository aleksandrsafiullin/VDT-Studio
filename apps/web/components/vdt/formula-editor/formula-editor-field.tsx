"use client";

import { ChevronDown } from "lucide-react";
import { clsx } from "clsx";
import { useCallback, useMemo, useState } from "react";
import type { VdtEdge, VdtNode } from "@vdt-studio/vdt-core";
import { TextArea } from "@/components/ui/field";
import { FormulaEditorInteractions } from "./formula-editor-dnd";
import { useFormulaEditorState } from "./use-formula-editor-state";

export interface FormulaEditorFieldProps {
  formula: string | undefined;
  currentNodeId: string;
  nodes: VdtNode[];
  edges: VdtEdge[];
  onChange: (formula: string | undefined) => void;
  errors?: Array<{ type: string; message: string }>;
}

function formulaDndContextId(nodeId: string): string {
  return `formula-editor-${nodeId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

export function FormulaEditorField({
  formula,
  currentNodeId,
  nodes,
  edges,
  onChange,
  errors
}: FormulaEditorFieldProps) {
  const [editAsTextOpen, setEditAsTextOpen] = useState(false);

  const handleFormulaChange = useCallback(
    (next: string) => {
      onChange(next ? next : undefined);
    },
    [onChange]
  );

  const {
    editorTokens,
    paletteNodes,
    paletteEmptyMessage,
    validation,
    formulaString,
    reorder,
    insertReference,
    insertOperator,
    insertNumber,
    updateNumber,
    removeToken,
    setFromFormulaString
  } = useFormulaEditorState(formula ?? "", nodes, edges, currentNodeId, handleFormulaChange);

  const nodeIds = useMemo(() => new Set(nodes.map((node) => node.id)), [nodes]);

  const isUnknownReference = useCallback(
    (nodeId: string) => !nodeIds.has(nodeId),
    [nodeIds]
  );

  const inlineErrorMessages = useMemo(() => {
    if (errors && errors.length > 0) {
      return errors.map((entry) => entry.message);
    }
    if (!validation.ok) {
      return [validation.message];
    }
    return [];
  }, [errors, validation]);

  const showErrorBanner = inlineErrorMessages.length > 0;

  return (
    <div className="grid gap-1.5">
      <span
        id="formula-editor-label"
        className="text-[11px] font-semibold uppercase tracking-normal text-slate-500"
      >
        Formula
      </span>
      <div className="space-y-3" data-testid="formula-editor" aria-labelledby="formula-editor-label">
        {showErrorBanner ? (
          <div
            className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-800"
            data-testid="formula-editor-error"
          >
            {inlineErrorMessages.map((message, index) => (
              <p key={`${index}-${message}`}>{message}</p>
            ))}
          </div>
        ) : null}

        <FormulaEditorInteractions
          dndContextId={formulaDndContextId(currentNodeId)}
          editorTokens={editorTokens}
          nodes={nodes}
          paletteNodes={paletteNodes}
          paletteEmptyMessage={paletteEmptyMessage}
          onReorder={reorder}
          onRemoveToken={removeToken}
          onUpdateNumber={updateNumber}
          onInsertReference={insertReference}
          onInsertOperator={insertOperator}
          onInsertNumber={insertNumber}
          isUnknownReference={isUnknownReference}
        />

        <div className="rounded-lg border border-line bg-white">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium text-ink"
            aria-expanded={editAsTextOpen}
            data-testid="formula-edit-as-text"
            onClick={() => setEditAsTextOpen((current) => !current)}
          >
            Edit as text
            <ChevronDown
              className={clsx("h-4 w-4 shrink-0 text-muted transition", editAsTextOpen && "rotate-180")}
              aria-hidden="true"
            />
          </button>
          {editAsTextOpen ? (
            <div className="border-t border-line px-3 pb-3 pt-2">
              <TextArea
                value={formulaString}
                onChange={(event) => setFromFormulaString(event.target.value)}
                placeholder="e.g. effective_working_time * average_productivity"
                spellCheck={false}
              />
            </div>
          ) : null}
        </div>
      </div>
      <span className="text-xs leading-4 text-muted">Build formula from drivers below</span>
    </div>
  );
}
