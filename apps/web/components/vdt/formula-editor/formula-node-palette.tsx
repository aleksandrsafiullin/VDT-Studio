"use client";

import { clsx } from "clsx";
import type { VdtNode } from "@vdt-studio/vdt-core";
import type { HTMLAttributes, ReactNode } from "react";
import { FormulaReferenceChip } from "./formula-reference-chip";

export interface FormulaPaletteNodeItem {
  node: VdtNode;
  dragHandle?: ReactNode;
  dragHandleProps?: HTMLAttributes<HTMLElement>;
}

export interface FormulaNodePaletteProps {
  nodes: VdtNode[];
  renderNode?: (node: VdtNode) => FormulaPaletteNodeItem | ReactNode;
  emptyMessage?: string;
  className?: string;
}

export function FormulaNodePalette({ nodes, renderNode, emptyMessage, className }: FormulaNodePaletteProps) {
  return (
    <div className={clsx("space-y-2", className)} data-testid="formula-node-palette">
      <p className="text-[11px] font-semibold uppercase tracking-normal text-slate-500">Available nodes</p>
      {nodes.length === 0 ? (
        <p className="text-xs text-muted">
          {emptyMessage ?? "All connected drivers are already in the formula."}
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {nodes.map((node) => {
            const rendered = renderNode?.(node);
            if (rendered && typeof rendered === "object" && "node" in rendered) {
              const item = rendered as FormulaPaletteNodeItem;
              return (
                <FormulaReferenceChip
                  key={node.id}
                  nodeId={node.id}
                  displayName={node.name}
                  testId={`formula-palette-node-${node.id}`}
                  {...(item.dragHandle !== undefined ? { dragHandle: item.dragHandle } : {})}
                  {...(item.dragHandleProps !== undefined ? { dragHandleProps: item.dragHandleProps } : {})}
                />
              );
            }

            if (rendered) {
              return <span key={node.id}>{rendered}</span>;
            }

            return (
              <FormulaReferenceChip
                key={node.id}
                nodeId={node.id}
                displayName={node.name}
                testId={`formula-palette-node-${node.id}`}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
