import type { UniqueIdentifier } from "@dnd-kit/core";
import { defaultAppendIndex, type FormulaEditorToken } from "./formula-editor-model";

export const FORMULA_EDITOR_DROP_ZONE_ID = "formula-editor-drop-zone";

export function resolveFormulaInsertIndex(
  overId: UniqueIdentifier | undefined,
  editorTokens: FormulaEditorToken[],
  activeId?: UniqueIdentifier
): number | null {
  if (overId === undefined) {
    return null;
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
