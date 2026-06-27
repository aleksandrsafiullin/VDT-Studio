# Formula editor — DnD conventions

Subtasks 05–06 wire drag-and-drop on top of these presentational components.

- Use a single `DndContext` in the parent (`FormulaEditorField`), wrapping both the token row and palette — not at app root.
- Configure `PointerSensor` with `activationConstraint: { distance: 4 }` so number inputs and remove buttons do not accidentally start drags.
- Drag handles live on chips only (reference chips in the row and palette); spread `dragHandleProps` from `@dnd-kit` onto the handle element, not the whole chip.
- Put `data-testid` on drag handles for Playwright (e.g. `formula-token-drag-handle-${index}`, palette handle ids in Subtask 06).
- Token state and mutations come from `useFormulaEditorState` only — leaf components accept props/callbacks; no duplicate local token arrays.
