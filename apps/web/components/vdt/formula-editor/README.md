# Formula Editor Drag-And-Drop Conventions

These conventions describe the implemented component boundary:

- Use one `DndContext` in `FormulaEditorField`, wrapping token row and palette; do not put it at app root.
- Configure `PointerSensor` with `activationConstraint: { distance: 4 }` so inputs and remove buttons do not start drags accidentally.
- Drag handles belong on reference/palette chips; spread `dragHandleProps` onto the handle, not the whole chip.
- Keep stable `data-testid` values on drag handles for browser tests.
- `useFormulaEditorState` owns token state and mutations. Leaf components receive props/callbacks and must not create duplicate token arrays.
- Formula syntax and current unit limitations are documented in `docs/FORMULA_ENGINE.md`.
