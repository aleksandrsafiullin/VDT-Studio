"use client";

import { clsx } from "clsx";
import type { ReactNode } from "react";
import type { FormulaEditorSegment } from "./formula-editor-model";
import { FormulaNumberToken } from "./formula-number-token";
import { FormulaOperatorToken } from "./formula-operator-token";
import { FormulaReferenceChip } from "./formula-reference-chip";

export interface FormulaTokenRowProps {
  tokens: FormulaEditorSegment[];
  onRemoveToken: (tokenId: string) => void;
  onUpdateNumber: (tokenId: string, raw: string) => void;
  isUnknownReference?: (nodeId: string) => boolean;
  renderTokenDragHandle?: (segment: FormulaEditorSegment, index: number) => ReactNode;
  className?: string;
}

export function FormulaTokenRow({
  tokens,
  onRemoveToken,
  onUpdateNumber,
  isUnknownReference,
  renderTokenDragHandle,
  className
}: FormulaTokenRowProps) {
  return (
    <div
      className={clsx("flex min-h-[40px] flex-wrap items-center gap-1.5 rounded-lg border border-line bg-white p-2", className)}
      data-testid="formula-token-row"
    >
      {tokens.length === 0 ? (
        <p className="text-xs text-muted">Drag nodes or use toolbar to build a formula.</p>
      ) : (
        tokens.map((segment, index) => {
          const dragHandle = renderTokenDragHandle?.(segment, index);

          switch (segment.type) {
            case "reference":
              return (
                <FormulaReferenceChip
                  key={segment.id}
                  nodeId={segment.nodeId}
                  displayName={segment.displayName}
                  tokenId={segment.id}
                  unknownRef={isUnknownReference?.(segment.nodeId) ?? false}
                  onRemove={() => onRemoveToken(segment.id)}
                  dragHandle={dragHandle}
                />
              );
            case "number":
              return (
                <FormulaNumberToken
                  key={segment.id}
                  raw={segment.raw}
                  tokenId={segment.id}
                  onChange={(raw) => onUpdateNumber(segment.id, raw)}
                  onRemove={() => onRemoveToken(segment.id)}
                  dragHandle={dragHandle}
                />
              );
            case "operator":
              return (
                <span key={segment.id} className="inline-flex items-center gap-1">
                  {dragHandle}
                  <FormulaOperatorToken operator={segment.value} />
                  <button
                    type="button"
                    className="inline-flex rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    aria-label={`Remove ${segment.value} operator`}
                    data-testid={`formula-operator-remove-${segment.id}`}
                    onClick={() => onRemoveToken(segment.id)}
                  >
                    ×
                  </button>
                </span>
              );
            case "left_paren":
              return (
                <span key={segment.id} className="inline-flex items-center gap-1">
                  {dragHandle}
                  <FormulaOperatorToken operator="(" />
                  <button
                    type="button"
                    className="inline-flex rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    aria-label="Remove left parenthesis"
                    data-testid={`formula-operator-remove-${segment.id}`}
                    onClick={() => onRemoveToken(segment.id)}
                  >
                    ×
                  </button>
                </span>
              );
            case "right_paren":
              return (
                <span key={segment.id} className="inline-flex items-center gap-1">
                  {dragHandle}
                  <FormulaOperatorToken operator=")" />
                  <button
                    type="button"
                    className="inline-flex rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    aria-label="Remove right parenthesis"
                    data-testid={`formula-operator-remove-${segment.id}`}
                    onClick={() => onRemoveToken(segment.id)}
                  >
                    ×
                  </button>
                </span>
              );
            default:
              return null;
          }
        })
      )}
    </div>
  );
}
