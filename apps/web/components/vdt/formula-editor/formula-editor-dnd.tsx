"use client";

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier
} from "@dnd-kit/core";
import { clsx } from "clsx";
import { GripVertical } from "lucide-react";
import { useCallback, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { VdtNode } from "@vdt-studio/vdt-core";
import {
  editorTokensToSegments,
  resolveDisplayName,
  resolveInsertIndexAtCaret,
  type FormulaEditorFunctionName,
  type FormulaEditorOperator,
  type FormulaEditorSegment,
  type FormulaEditorToken
} from "./formula-editor-model";
import { FormulaNodePalette } from "./formula-node-palette";
import { FormulaOperatorToolbar } from "./formula-operator-toolbar";
import { FormulaReferenceChip } from "./formula-reference-chip";
import {
  FormulaSortableTokenRow,
  FormulaTokenGhostChip,
  type FormulaSortableTokenRowProps
} from "./formula-sortable-token-row";
import {
  FORMULA_EDITOR_DROP_ZONE_ID,
  getDragPointerCoordinates,
  resolveFormulaDragInsertIndex,
  resolveFormulaDropTarget,
  resolveReorderTargetIndex
} from "./formula-drag-insert-index";
import { parseFormulaInsertSlotIndex, type FormulaTokenRect } from "./formula-pointer-insert-index";

export { FORMULA_EDITOR_DROP_ZONE_ID } from "./formula-drag-insert-index";

const formulaEditorCollisionDetection: CollisionDetection = (args) => {
  const collisions = pointerWithin(args);
  if (collisions.length === 0) {
    return collisions;
  }

  const slotCollisions = collisions.filter(
    (collision) => parseFormulaInsertSlotIndex(String(collision.id)) !== null
  );

  return slotCollisions.length > 0 ? slotCollisions : collisions;
};

export const FORMULA_DRAG_TYPE = {
  paletteNode: "palette-node",
  sortableToken: "sortable-token"
} as const;

type PaletteDragData = {
  type: typeof FORMULA_DRAG_TYPE.paletteNode;
  nodeId: string;
};

type ActiveDragState =
  | { kind: typeof FORMULA_DRAG_TYPE.paletteNode; nodeId: string; displayName: string }
  | { kind: typeof FORMULA_DRAG_TYPE.sortableToken; segment: FormulaEditorSegment }
  | null;

function paletteDraggableId(nodeId: string) {
  return `palette-${nodeId}`;
}

function FormulaPaletteDraggableNode({
  node,
  editorTokens,
  caretIndex,
  onInsertReference
}: {
  node: VdtNode;
  editorTokens: FormulaEditorToken[];
  caretIndex: number;
  onInsertReference: (nodeId: string, atIndex: number) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: paletteDraggableId(node.id),
    data: { type: FORMULA_DRAG_TYPE.paletteNode, nodeId: node.id } satisfies PaletteDragData
  });
  const draggablePointerDown = listeners?.onPointerDown;

  return (
    <div ref={setNodeRef} className={clsx("inline-flex", isDragging && "opacity-0")}>
      <FormulaReferenceChip
        nodeId={node.id}
        displayName={node.name}
        testId={`formula-palette-node-${node.id}`}
        insertTestId={`formula-palette-insert-${node.id}`}
        onBodyClick={() =>
          onInsertReference(
            node.id,
            resolveInsertIndexAtCaret(editorTokens, caretIndex, "reference")
          )
        }
        dragHandle={
          <span
            {...attributes}
            {...listeners}
            onPointerDown={(event) => {
              event.stopPropagation();
              draggablePointerDown?.(event);
            }}
            className="inline-flex shrink-0 cursor-grab text-slate-400 active:cursor-grabbing"
            aria-label={`Drag ${node.name} into formula`}
            data-testid={`formula-palette-drag-handle-${node.id}`}
          >
            <GripVertical className="h-3.5 w-3.5" />
          </span>
        }
      />
    </div>
  );
}

function FormulaEditorDropZone({
  children,
  className,
  caretIndex,
  onCaretIndexChange
}: {
  children: ReactNode;
  className?: string;
  caretIndex: number;
  onCaretIndexChange: (index: number) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: FORMULA_EDITOR_DROP_ZONE_ID,
    data: { type: "formula-drop-zone" }
  });

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, [contenteditable=true]")) {
      return;
    }

    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }

    // Arrow keys move the caret only; reorder is pointer-driven via insert slots.
    event.stopPropagation();

    if (event.key === "ArrowLeft") {
      onCaretIndexChange(caretIndex - 1);
      return;
    }

    onCaretIndexChange(caretIndex + 1);
  };

  return (
    <div
      ref={setNodeRef}
      tabIndex={0}
      aria-label="Formula editor"
      onKeyDown={handleKeyDown}
      className={clsx(
        "flex min-h-10 flex-wrap content-start items-center gap-x-1 gap-y-2 rounded-lg border border-line bg-white p-2 outline-none focus-visible:ring-2 focus-visible:ring-blue-200/80",
        isOver && "ring-2 ring-blue-200/80",
        className
      )}
      data-testid={FORMULA_EDITOR_DROP_ZONE_ID}
    >
      {children}
    </div>
  );
}

export interface FormulaEditorDndProps
  extends Omit<FormulaSortableTokenRowProps, "className" | "activeDrag" | "dragInsertIndex"> {
  dndContextId: string;
  paletteNodes: VdtNode[];
  onInsertReference: (nodeId: string, atIndex?: number) => void;
  paletteEmptyMessage?: string;
  className?: string;
  dropZoneClassName?: string;
}

export function FormulaEditorDnd({
  dndContextId,
  editorTokens,
  nodes,
  paletteNodes,
  onReorder,
  onRemoveToken,
  onUpdateNumber,
  onInsertReference,
  caretIndex,
  onCaretIndexChange,
  isUnknownReference,
  paletteEmptyMessage,
  className,
  dropZoneClassName
}: FormulaEditorDndProps) {
  const [activeDrag, setActiveDrag] = useState<ActiveDragState>(null);
  const [insertIndex, setInsertIndex] = useState<number | null>(null);
  const tokenElementsRef = useRef(new Map<string, HTMLElement>());

  const nodesById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const segments = useMemo(
    () => editorTokensToSegments(editorTokens, nodesById),
    [editorTokens, nodesById]
  );

  const registerTokenElement = useCallback((tokenId: string, element: HTMLElement | null) => {
    if (element) {
      tokenElementsRef.current.set(tokenId, element);
      return;
    }

    tokenElementsRef.current.delete(tokenId);
  }, []);

  const collectTokenRects = useCallback(
    (excludeTokenId?: UniqueIdentifier): FormulaTokenRect[] => {
      const rects: FormulaTokenRect[] = [];

      for (const token of editorTokens) {
        if (excludeTokenId !== undefined && token.id === excludeTokenId) {
          continue;
        }

        const element = tokenElementsRef.current.get(token.id);
        if (!element) {
          continue;
        }

        const rect = element.getBoundingClientRect();
        rects.push({
          id: token.id,
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height
        });
      }

      return rects;
    },
    [editorTokens]
  );

  const isReorderDrag = useCallback(
    (activeId: UniqueIdentifier) => editorTokens.some((token) => token.id === activeId),
    [editorTokens]
  );

  const resolveDragInsertIndex = useCallback(
    (event: DragMoveEvent) =>
      resolveFormulaDragInsertIndex({
        overId: event.over?.id,
        editorTokens,
        pointer: getDragPointerCoordinates(event),
        tokenRects: collectTokenRects(
          isReorderDrag(event.active.id) ? event.active.id : undefined
        )
      }),
    [collectTokenRects, editorTokens, isReorderDrag]
  );

  // Pointer-only: reorder uses slot drops, not sortable keyboard coordinates.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const handleDragStart = (event: DragStartEvent) => {
    setInsertIndex(null);
    const dragType = event.active.data.current?.type;

    if (dragType === FORMULA_DRAG_TYPE.paletteNode) {
      const nodeId = String(event.active.data.current?.nodeId ?? "");
      setActiveDrag({
        kind: FORMULA_DRAG_TYPE.paletteNode,
        nodeId,
        displayName: resolveDisplayName(nodeId, nodesById)
      });
      return;
    }

    const segment = segments.find((entry) => entry.id === event.active.id);
    if (segment) {
      setActiveDrag({ kind: FORMULA_DRAG_TYPE.sortableToken, segment });
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    setInsertIndex(resolveDragInsertIndex(event));
  };

  const handleDragMove = (event: DragMoveEvent) => {
    setInsertIndex(resolveDragInsertIndex(event));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active } = event;
    const trackedInsertIndex = insertIndex;
    const pointer = getDragPointerCoordinates(event);
    const tokenRects = collectTokenRects(
      isReorderDrag(active.id) ? active.id : undefined
    );
    let dropTarget = resolveFormulaDropTarget({
      overId: event.over?.id,
      editorTokens,
      pointer,
      tokenRects
    });

    const dragType = active.data.current?.type;
    if (
      dropTarget.kind === "none" &&
      trackedInsertIndex !== null &&
      dragType === FORMULA_DRAG_TYPE.paletteNode
    ) {
      dropTarget = { kind: "explicit", index: trackedInsertIndex };
    }

    setActiveDrag(null);
    setInsertIndex(null);

    if (dropTarget.kind === "none") {
      return;
    }

    if (dragType === FORMULA_DRAG_TYPE.paletteNode) {
      const nodeId = String(active.data.current?.nodeId ?? "");
      if (!nodeId) {
        return;
      }

      if (dropTarget.kind === "snap") {
        onInsertReference(nodeId);
        return;
      }

      if (dropTarget.kind === "explicit") {
        onInsertReference(nodeId, dropTarget.index);
      }

      return;
    }

    const fromIndex = editorTokens.findIndex((token) => token.id === active.id);
    if (fromIndex === -1) {
      return;
    }

    if (dropTarget.kind !== "explicit") {
      return;
    }

    const toIndex = resolveReorderTargetIndex(fromIndex, dropTarget.index);
    if (fromIndex === toIndex) {
      return;
    }

    onReorder(fromIndex, toIndex);
  };

  const handleDragCancel = () => {
    setActiveDrag(null);
    setInsertIndex(null);
  };

  return (
    <DndContext
      id={dndContextId}
      sensors={sensors}
      collisionDetection={formulaEditorCollisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className={clsx("space-y-3", className)}>
        <FormulaEditorDropZone
          caretIndex={caretIndex}
          onCaretIndexChange={onCaretIndexChange}
          {...(dropZoneClassName !== undefined ? { className: dropZoneClassName } : {})}
        >
          <FormulaSortableTokenRow
            editorTokens={editorTokens}
            nodes={nodes}
            onReorder={onReorder}
            onRemoveToken={onRemoveToken}
            onUpdateNumber={onUpdateNumber}
            caretIndex={caretIndex}
            onCaretIndexChange={onCaretIndexChange}
            activeDrag={activeDrag !== null}
            dragInsertIndex={insertIndex}
            registerTokenElement={registerTokenElement}
            {...(isUnknownReference !== undefined ? { isUnknownReference } : {})}
            embedded
          />
        </FormulaEditorDropZone>

        <FormulaNodePalette
          nodes={paletteNodes}
          renderNode={(node) => (
            <FormulaPaletteDraggableNode
              node={node}
              editorTokens={editorTokens}
              caretIndex={caretIndex}
              onInsertReference={onInsertReference}
            />
          )}
          {...(paletteEmptyMessage !== undefined ? { emptyMessage: paletteEmptyMessage } : {})}
        />
      </div>

      <DragOverlay dropAnimation={null}>
        {activeDrag?.kind === FORMULA_DRAG_TYPE.paletteNode ? (
          <div className="cursor-grabbing shadow-md ring-2 ring-blue-200/80 rounded-md">
            <FormulaReferenceChip
              nodeId={activeDrag.nodeId}
              displayName={activeDrag.displayName}
              dragHandle={
                <span className="inline-flex shrink-0 text-slate-400" aria-hidden>
                  <GripVertical className="h-3.5 w-3.5" />
                </span>
              }
            />
          </div>
        ) : null}
        {activeDrag?.kind === FORMULA_DRAG_TYPE.sortableToken ? (
          <div className="cursor-grabbing shadow-md ring-2 ring-blue-200/80 rounded-md">
            <FormulaTokenGhostChip segment={activeDrag.segment} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

export interface FormulaEditorInteractionsProps extends FormulaEditorDndProps {
  onInsertOperator: (op: FormulaEditorOperator) => void;
  onInsertFunction: (name: FormulaEditorFunctionName) => void;
  onInsertComma: () => void;
  onInsertNumber: (raw?: string) => void;
}

export function FormulaEditorInteractions({
  onInsertOperator,
  onInsertFunction,
  onInsertComma,
  onInsertNumber,
  ...dndProps
}: FormulaEditorInteractionsProps) {
  return (
    <div className="space-y-3">
      <FormulaOperatorToolbar
        onInsert={onInsertOperator}
        onInsertFunction={onInsertFunction}
        onInsertComma={onInsertComma}
        onAddNumber={() => onInsertNumber()}
      />
      <FormulaEditorDnd {...dndProps} />
    </div>
  );
}
