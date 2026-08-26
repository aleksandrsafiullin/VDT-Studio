import type { UniqueIdentifier } from "@dnd-kit/core";
import type { DragMoveEvent } from "@dnd-kit/core";
import { getEventCoordinates } from "@dnd-kit/utilities";
import { defaultAppendIndex, type FormulaEditorToken } from "./formula-editor-model";
import {
  parseFormulaInsertSlotIndex,
  resolveInsertIndexFromPointer,
  type FormulaTokenRect
} from "./formula-pointer-insert-index";

export const FORMULA_EDITOR_DROP_ZONE_ID = "formula-editor-drop-zone";

export function getDragPointerCoordinates(
  event: Pick<DragMoveEvent, "activatorEvent" | "delta">
): { x: number; y: number } | null {
  const origin = getEventCoordinates(event.activatorEvent);
  if (!origin) {
    return null;
  }

  return {
    x: origin.x + event.delta.x,
    y: origin.y + event.delta.y
  };
}

export function isPointerOverTokenRect(
  clientX: number,
  clientY: number,
  rects: FormulaTokenRect[]
): boolean {
  return rects.some(
    (rect) =>
      clientX >= rect.x &&
      clientX <= rect.x + rect.width &&
      clientY >= rect.y &&
      clientY <= rect.y + rect.height
  );
}

export function resolveFormulaInsertIndex(
  overId: UniqueIdentifier | undefined,
  editorTokens: FormulaEditorToken[],
  activeId?: UniqueIdentifier
): number | null {
  if (overId === undefined) {
    return null;
  }

  const slotIndex = parseFormulaInsertSlotIndex(String(overId));
  if (slotIndex !== null) {
    return slotIndex;
  }

  if (overId === FORMULA_EDITOR_DROP_ZONE_ID) {
    return defaultAppendIndex(editorTokens);
  }

  const overIndex = editorTokens.findIndex((token) => token.id === overId);
  if (overIndex === -1) {
    return null;
  }

  if (activeId !== undefined && activeId === overId) {
    return null;
  }

  return overIndex;
}

export function resolveFormulaDragInsertIndex(input: {
  overId: UniqueIdentifier | undefined;
  editorTokens: FormulaEditorToken[];
  pointer: { x: number; y: number } | null;
  tokenRects: FormulaTokenRect[];
}): number | null {
  const { overId, editorTokens, pointer, tokenRects } = input;

  if (overId !== undefined) {
    const slotIndex = parseFormulaInsertSlotIndex(String(overId));
    if (slotIndex !== null) {
      return slotIndex;
    }
  }

  if (
    pointer &&
    tokenRects.length > 0 &&
    isPointerOverTokenRect(pointer.x, pointer.y, tokenRects)
  ) {
    return resolveInsertIndexFromPointer(pointer.x, pointer.y, tokenRects);
  }

  if (overId === FORMULA_EDITOR_DROP_ZONE_ID) {
    return defaultAppendIndex(editorTokens);
  }

  return null;
}

export type FormulaDropTarget =
  | { kind: "snap" }
  | { kind: "explicit"; index: number }
  | { kind: "none" };

export function resolveFormulaDropTarget(input: {
  overId: UniqueIdentifier | undefined;
  editorTokens: FormulaEditorToken[];
  pointer: { x: number; y: number } | null;
  tokenRects: FormulaTokenRect[];
}): FormulaDropTarget {
  const { overId, editorTokens, pointer, tokenRects } = input;

  if (overId !== undefined) {
    const slotIndex = parseFormulaInsertSlotIndex(String(overId));
    if (slotIndex !== null) {
      return { kind: "explicit", index: slotIndex };
    }
  }

  if (
    pointer &&
    tokenRects.length > 0 &&
    isPointerOverTokenRect(pointer.x, pointer.y, tokenRects)
  ) {
    return {
      kind: "explicit",
      index: resolveInsertIndexFromPointer(pointer.x, pointer.y, tokenRects)
    };
  }

  if (overId === FORMULA_EDITOR_DROP_ZONE_ID) {
    return { kind: "snap" };
  }

  return { kind: "none" };
}

export function resolveReorderTargetIndex(fromIndex: number, toSlotIndex: number): number {
  return fromIndex < toSlotIndex ? toSlotIndex - 1 : toSlotIndex;
}
