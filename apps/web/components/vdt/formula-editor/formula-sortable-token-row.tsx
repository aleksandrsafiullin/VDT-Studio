"use client";

import {
  SortableContext,
  rectSortingStrategy,
  useSortable
} from "@dnd-kit/sortable";
import type { DraggableAttributes } from "@dnd-kit/core";
import { clsx } from "clsx";
import { GripVertical } from "lucide-react";
import { Fragment, useMemo, type MouseEvent, type ReactNode } from "react";
import type { VdtNode } from "@vdt-studio/vdt-core";
import {
  editorTokensToSegments,
  type FormulaEditorSegment,
  type FormulaEditorToken
} from "./formula-editor-model";
import { FormulaInsertSlot } from "./formula-insert-slot";
import { FormulaFunctionToken } from "./formula-function-token";
import { FormulaNumberToken } from "./formula-number-token";
import { FormulaOperatorToken, FormulaCommaToken } from "./formula-operator-token";
import { FormulaReferenceChip } from "./formula-reference-chip";

export interface FormulaSortableTokenRowProps {
  editorTokens: FormulaEditorToken[];
  nodes: VdtNode[];
  onReorder: (fromIndex: number, toIndex: number) => void;
  onRemoveToken: (tokenId: string) => void;
  onUpdateNumber: (tokenId: string, raw: string) => void;
  caretIndex: number;
  onCaretIndexChange: (index: number) => void;
  activeDrag: boolean | null;
  dragInsertIndex?: number | null;
  isUnknownReference?: (nodeId: string) => boolean;
  className?: string;
  /** When true, renders only sortable items (drop zone wrapper lives in FormulaEditorDnd). */
  embedded?: boolean;
  registerTokenElement?: (tokenId: string, element: HTMLElement | null) => void;
}

interface SortableTokenItemProps {
  id: string;
  index: number;
  segment: FormulaEditorSegment;
  onRemoveToken: (tokenId: string) => void;
  onUpdateNumber: (tokenId: string, raw: string) => void;
  onCaretIndexChange: (index: number) => void;
  registerTokenElement?: (tokenId: string, element: HTMLElement | null) => void;
  isUnknownReference?: (nodeId: string) => boolean;
}

function TokenDragHandle({
  index,
  setActivatorNodeRef,
  attributes,
  listeners,
  className
}: {
  index: number;
  setActivatorNodeRef: (element: HTMLElement | null) => void;
  attributes: DraggableAttributes;
  listeners: ReturnType<typeof useSortable>["listeners"];
  className?: string;
}) {
  return (
    <button
      ref={setActivatorNodeRef}
      type="button"
      className={clsx(
        "inline-flex shrink-0 cursor-grab rounded p-0.5 text-slate-400 hover:text-slate-600 active:cursor-grabbing",
        className
      )}
      aria-label="Drag to reorder formula token"
      data-testid={`formula-token-drag-handle-${index}`}
      {...attributes}
      {...listeners}
    >
      <GripVertical className="h-3.5 w-3.5" />
    </button>
  );
}

function handleTokenBodyClick(event: MouseEvent<HTMLDivElement>, index: number, onCaretIndexChange: (index: number) => void) {
  const target = event.target as HTMLElement;
  if (target.closest("button, input, textarea")) {
    return;
  }

  const rect = event.currentTarget.getBoundingClientRect();
  const midpoint = rect.left + rect.width / 2;
  onCaretIndexChange(event.clientX < midpoint ? index : index + 1);
}

function SortableTokenItem({
  id,
  index,
  segment,
  onRemoveToken,
  onUpdateNumber,
  onCaretIndexChange,
  registerTokenElement,
  isUnknownReference
}: SortableTokenItemProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useSortable({
    id,
    animateLayoutChanges: () => false
  });

  const style = {
    opacity: isDragging ? 0 : 1
  };

  const dragHandle = (
    <TokenDragHandle
      index={index}
      setActivatorNodeRef={setActivatorNodeRef}
      attributes={attributes}
      listeners={listeners}
    />
  );

  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        registerTokenElement?.(id, node);
      }}
      style={style}
      className="inline-flex shrink-0 cursor-text items-center"
      onClick={(event) => handleTokenBodyClick(event, index, onCaretIndexChange)}
    >
      {renderSegmentToken(segment, {
        dragHandle,
        onRemoveToken,
        onUpdateNumber,
        ...(isUnknownReference !== undefined ? { isUnknownReference } : {})
      })}
    </div>
  );
}

function renderSegmentToken(
  segment: FormulaEditorSegment,
  {
    dragHandle,
    onRemoveToken,
    onUpdateNumber,
    isUnknownReference
  }: {
    dragHandle: ReactNode;
    onRemoveToken: (tokenId: string) => void;
    onUpdateNumber: (tokenId: string, raw: string) => void;
    isUnknownReference?: (nodeId: string) => boolean;
  }
) {
  switch (segment.type) {
    case "reference":
      return (
        <FormulaReferenceChip
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
          raw={segment.raw}
          tokenId={segment.id}
          onChange={(raw) => onUpdateNumber(segment.id, raw)}
          onRemove={() => onRemoveToken(segment.id)}
          dragHandle={dragHandle}
        />
      );
    case "operator":
      return (
        <span className="inline-flex items-center gap-1">
          {dragHandle}
          <FormulaOperatorToken operator={segment.value} />
          <button
            type="button"
            className="inline-flex rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label={`Remove ${segment.value} operator`}
            data-testid={`formula-operator-remove-${segment.id}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onRemoveToken(segment.id)}
          >
            ×
          </button>
        </span>
      );
    case "left_paren":
      return (
        <span className="inline-flex items-center gap-1">
          {dragHandle}
          <FormulaOperatorToken operator="(" />
          <button
            type="button"
            className="inline-flex rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Remove left parenthesis"
            data-testid={`formula-operator-remove-${segment.id}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onRemoveToken(segment.id)}
          >
            ×
          </button>
        </span>
      );
    case "right_paren":
      return (
        <span className="inline-flex items-center gap-1">
          {dragHandle}
          <FormulaOperatorToken operator=")" />
          <button
            type="button"
            className="inline-flex rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Remove right parenthesis"
            data-testid={`formula-operator-remove-${segment.id}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onRemoveToken(segment.id)}
          >
            ×
          </button>
        </span>
      );
    case "function":
      return (
        <span className="inline-flex items-center gap-1">
          {dragHandle}
          <FormulaFunctionToken name={segment.name} />
          <button
            type="button"
            className="inline-flex rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label={`Remove ${segment.name} function`}
            data-testid={`formula-operator-remove-${segment.id}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onRemoveToken(segment.id)}
          >
            ×
          </button>
        </span>
      );
    case "comma":
      return (
        <span className="inline-flex items-center gap-1">
          {dragHandle}
          <FormulaCommaToken />
          <button
            type="button"
            className="inline-flex rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Remove comma"
            data-testid={`formula-operator-remove-${segment.id}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onRemoveToken(segment.id)}
          >
            ×
          </button>
        </span>
      );
    default:
      return null;
  }
}

export function FormulaTokenGhostChip({ segment }: { segment: FormulaEditorSegment }) {
  switch (segment.type) {
    case "reference":
      return (
        <FormulaReferenceChip
          nodeId={segment.nodeId}
          displayName={segment.displayName}
          tokenId={segment.id}
          dragHandle={
            <span className="inline-flex shrink-0 text-slate-400" aria-hidden>
              <GripVertical className="h-3.5 w-3.5" />
            </span>
          }
        />
      );
    case "number":
      return (
        <FormulaNumberToken
          raw={segment.raw}
          tokenId={segment.id}
          onChange={() => undefined}
          dragHandle={
            <span className="inline-flex shrink-0 text-slate-400" aria-hidden>
              <GripVertical className="h-3.5 w-3.5" />
            </span>
          }
        />
      );
    case "operator":
      return (
        <span className="inline-flex items-center gap-1">
          <span className="inline-flex shrink-0 text-slate-400" aria-hidden>
            <GripVertical className="h-3.5 w-3.5" />
          </span>
          <FormulaOperatorToken operator={segment.value} />
        </span>
      );
    case "left_paren":
      return (
        <span className="inline-flex items-center gap-1">
          <span className="inline-flex shrink-0 text-slate-400" aria-hidden>
            <GripVertical className="h-3.5 w-3.5" />
          </span>
          <FormulaOperatorToken operator="(" />
        </span>
      );
    case "right_paren":
      return (
        <span className="inline-flex items-center gap-1">
          <span className="inline-flex shrink-0 text-slate-400" aria-hidden>
            <GripVertical className="h-3.5 w-3.5" />
          </span>
          <FormulaOperatorToken operator=")" />
        </span>
      );
    case "function":
      return (
        <span className="inline-flex items-center gap-1">
          <span className="inline-flex shrink-0 text-slate-400" aria-hidden>
            <GripVertical className="h-3.5 w-3.5" />
          </span>
          <FormulaFunctionToken name={segment.name} />
        </span>
      );
    case "comma":
      return (
        <span className="inline-flex items-center gap-1">
          <span className="inline-flex shrink-0 text-slate-400" aria-hidden>
            <GripVertical className="h-3.5 w-3.5" />
          </span>
          <FormulaCommaToken />
        </span>
      );
    default:
      return null;
  }
}

function SortableTokenItems({
  editorTokens,
  nodes,
  onRemoveToken,
  onUpdateNumber,
  caretIndex,
  onCaretIndexChange,
  activeDrag,
  dragInsertIndex = null,
  isUnknownReference,
  registerTokenElement
}: Omit<FormulaSortableTokenRowProps, "onReorder" | "className" | "embedded">) {
  const nodesById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const segments = useMemo(
    () => editorTokensToSegments(editorTokens, nodesById),
    [editorTokens, nodesById]
  );
  const sortableIds = useMemo(() => editorTokens.map((token) => token.id), [editorTokens]);

  return (
    <div
      data-testid="formula-token-row"
      className="flex flex-wrap content-start items-center gap-x-1 gap-y-2"
    >
      <FormulaInsertSlot
        index={0}
        showCaret={caretIndex === 0}
        activeDrag={activeDrag}
        dragInsertIndex={dragInsertIndex}
        onClick={() => onCaretIndexChange(0)}
      />
      {segments.length === 0 ? (
        <p className="pointer-events-none text-xs text-muted">
          Drag nodes or use toolbar to build a formula.
        </p>
      ) : null}
      <SortableContext items={sortableIds} strategy={rectSortingStrategy}>
        {segments.map((segment, index) => (
          <Fragment key={segment.id}>
            <SortableTokenItem
              id={segment.id}
              index={index}
              segment={segment}
              onRemoveToken={onRemoveToken}
              onUpdateNumber={onUpdateNumber}
              onCaretIndexChange={onCaretIndexChange}
              {...(registerTokenElement !== undefined ? { registerTokenElement } : {})}
              {...(isUnknownReference !== undefined ? { isUnknownReference } : {})}
            />
            <FormulaInsertSlot
              index={index + 1}
              showCaret={caretIndex === index + 1}
              activeDrag={activeDrag}
              dragInsertIndex={dragInsertIndex}
              onClick={() => onCaretIndexChange(index + 1)}
            />
          </Fragment>
        ))}
      </SortableContext>
    </div>
  );
}

export function FormulaSortableTokenRow({
  editorTokens,
  nodes,
  onRemoveToken,
  onUpdateNumber,
  caretIndex,
  onCaretIndexChange,
  activeDrag,
  dragInsertIndex = null,
  isUnknownReference,
  className,
  embedded = false,
  registerTokenElement
}: FormulaSortableTokenRowProps) {
  const row = (
    <SortableTokenItems
      editorTokens={editorTokens}
      nodes={nodes}
      onRemoveToken={onRemoveToken}
      onUpdateNumber={onUpdateNumber}
      caretIndex={caretIndex}
      onCaretIndexChange={onCaretIndexChange}
      activeDrag={activeDrag}
      dragInsertIndex={dragInsertIndex}
      {...(registerTokenElement !== undefined ? { registerTokenElement } : {})}
      {...(isUnknownReference !== undefined ? { isUnknownReference } : {})}
    />
  );

  if (embedded) {
    return row;
  }

  return (
    <div
      className={clsx(
        "rounded-lg border border-line bg-white p-2",
        className
      )}
    >
      {row}
    </div>
  );
}
