import { beforeEach, describe, expect, it, vi } from "vitest";

const rows = new Map<string, string>();
let denyWrite = false;
vi.stubGlobal("localStorage", {
  getItem: (key: string) => rows.get(key) ?? null,
  setItem: (key: string, value: string) => {
    if (denyWrite) throw new DOMException("Storage is full", "QuotaExceededError");
    rows.set(key, value);
  },
  removeItem: (key: string) => rows.delete(key)
});
const { useVdtStudioStore: store } = await import("./vdt-store");
beforeEach(() => {
  denyWrite = false; rows.clear();
  store.setState({ ...store.getInitialState(), personalisation: { instructions: [] },
    workspace: { ...store.getInitialState().workspace, projectSummaries: [] } }, true);
});

describe("saved instruction list", () => {
  it("hydrates the old single instruction, then retains several independent entries across reload", async () => {
    rows.set("vdt-studio-state", JSON.stringify({ version: 2, state: { personalisation: { enabled: false, text: "Retain my old text." } } }));
    await store.persist.rehydrate();
    const migrated = store.getState().personalisation;
    expect(migrated.instructions).toEqual([{ id: "legacy-user-instruction", enabled: false, text: "Retain my old text." }]);
    const preferences = { instructions: [...migrated.instructions, { id: "second", enabled: true, text: "Explain assumptions." }] };
    expect(store.getState().savePersonalisation(preferences)).toBe(true);
    await store.persist.rehydrate();
    expect(store.getState().personalisation).toEqual(preferences);
    const remaining = { instructions: preferences.instructions.slice(1) };
    expect(store.getState().savePersonalisation(remaining)).toBe(true);
    await store.persist.rehydrate();
    expect(store.getState().personalisation).toEqual(remaining);
  });

  it("rejects a denied storage write without claiming reload persistence", async () => {
    const old = { instructions: [{ id: "old", enabled: false, text: "Retain my disabled text." }] };
    expect(store.getState().savePersonalisation(old)).toBe(true);
    denyWrite = true;
    expect(store.getState().savePersonalisation({ instructions: [{ id: "new", enabled: true, text: "Unsaved new instructions" }] })).toBe(false);
    expect(store.getState().personalisation.instructions[0]?.text).toBe("Unsaved new instructions");
    await store.persist.rehydrate();
    expect(store.getState().personalisation).toEqual(old);
  });
});
