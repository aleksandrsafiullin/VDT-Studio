"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { clsx } from "clsx";
import { GripVertical } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import type { VdtNode } from "@vdt-studio/vdt-core";
import {
  editorTokensToSegments,
  resolveDisplayName,
  type FormulaEditorSegment
} from "./formula-editor-model";
import { FormulaNodePalette } from "./formula-node-palette";
import { FormulaOperatorToolbar } from "./formula-operator-toolbar";
import { FormulaReferenceChip } from "./formula-reference-chip";
import {
  FormulaSortableTokenRow,
  FormulaTokenGhostChip,
  type FormulaSortableTokenRowProps
} from "./formula-sortable-token-row";
import type { FormulaEditorOperator } from "./formula-editor-model";

export const FORMULA_EDITOR_DROP_ZONE_ID = "formula-editor-drop-zone";

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

function FormulaPaletteDraggableNode({ node }: { node: VdtNode }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: paletteDraggableId(node.id),
    data: { type: FORMULA_DRAG_TYPE.paletteNode, nodeId: node.id } satisfies PaletteDragData
  });

  return (
    <div ref={setNodeRef} className={clsx("inline-flex", isDragging && "opacity-40")}>
      <FormulaReferenceChip
        nodeId={node.id}
        displayName={node.name}
        testId={`formula-palette-node-${node.id}`}
        dragHandle={
          <span
            {...attributes}
            {...listeners}
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
  className
}: {
  children: ReactNode;
  className?: string;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: FORMULA_EDITOR_DROP_ZONE_ID,
    data: { type: "formula-drop-zone" }
  });

  return (
    <div
      ref={setNodeRef}
      className={clsx(
        "flex min-h-[40px] flex-wrap items-center gap-1.5 rounded-lg border border-line bg-white p-2",
        isOver && "ring-2 ring-blue-200/80",
        className
      )}
      data-testid={FORMULA_EDITOR_DROP_ZONE_ID}
    >
      {children}
    </div>
  );
}

export interface FormulaEditorDndProps extends Omit<FormulaSortableTokenRowProps, "className"> {
  paletteNodes: VdtNode[];
  onInsertReference: (nodeId: string, atIndex?: number) => void;
  paletteEmptyMessage?: string;
  className?: string;
  dropZoneClassName?: string;
}

export function FormulaEditorDnd({
  editorTokens,
  nodes,
  paletteNodes,
  onReorder,
  onRemoveToken,
  onUpdateNumber,
  onInsertReference,
  isUnknownReference,
  paletteEmptyMessage,
  className,
  dropZoneClassName
}: FormulaEditorDndProps) {
  const [activeDrag, setActiveDrag] = useState<ActiveDragState>(null);

  const nodesById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const segments = useMemo(
    () => editorTokensToSegments(editorTokens, nodesById),
    [editorTokens, nodesById]
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragStart = (event: DragStartEvent) => {
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

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDrag(null);

    if (!over) {
      return;
    }

    const dragType = active.data.current?.type;

    if (dragType === FORMULA_DRAG_TYPE.paletteNode) {
      const nodeId = String(active.data.current?.nodeId ?? "");
      if (!nodeId) {
        return;
      }

      if (over.id === FORMULA_EDITOR_DROP_ZONE_ID) {
        onInsertReference(nodeId, editorTokens.length);
        return;
      }

      const overTokenIndex = editorTokens.findIndex((token) => token.id === over.id);
      if (overTokenIndex !== -1) {
        onInsertReference(nodeId, overTokenIndex);
      }

      return;
    }

    if (active.id === over.id) {
      return;
    }

    const fromIndex = editorTokens.findIndex((token) => token.id === active.id);
    const toIndex = editorTokens.findIndex((token) => token.id === over.id);

    if (fromIndex === -1 || toIndex === -1) {
      return;
    }

    onReorder(fromIndex, toIndex);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className={clsx("space-y-3", className)}>
        <FormulaEditorDropZone {...(dropZoneClassName !== undefined ? { className: dropZoneClassName } : {})}>
          {segments.length === 0 ? (
            <p className="text-xs text-muted">Drag nodes or use toolbar to build a formula.</p>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5" data-testid="formula-token-row">
              <FormulaSortableTokenRow
              editorTokens={editorTokens}
              nodes={nodes}
              onReorder={onReorder}
              onRemoveToken={onRemoveToken}
              onUpdateNumber={onUpdateNumber}
              {...(isUnknownReference !== undefined ? { isUnknownReference } : {})}
              embedded
            />
            </div>
          )}
        </FormulaEditorDropZone>

        <FormulaNodePalette
          nodes={paletteNodes}
          renderNode={(node) => <FormulaPaletteDraggableNode node={node} />}
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
  onInsertNumber: (raw?: string) => void;
}

export function FormulaEditorInteractions({
  onInsertOperator,
  onInsertNumber,
  ...dndProps
}: FormulaEditorInteractionsProps) {
  return (
    <div className="space-y-3">
      <FormulaOperatorToolbar
        onInsert={onInsertOperator}
        onAddNumber={() => onInsertNumber()}
      />
      <FormulaEditorDnd {...dndProps} />
    </div>
  );
}
