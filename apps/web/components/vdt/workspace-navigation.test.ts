import { describe, expect, it } from "vitest";
import { useVdtStudioStore } from "./vdt-store";
import { consumeDeliberateHomeNavigation, markDeliberateHomeNavigation } from "./workspace-navigation";

describe("deliberate Home draft ownership", () => {
  it("consumes the exact successfully saved editor state once", () => {
    const saved = useVdtStudioStore.getState();
    markDeliberateHomeNavigation(saved);
    expect(consumeDeliberateHomeNavigation({ ...saved })).toBe(true);
    expect(consumeDeliberateHomeNavigation(saved)).toBe(false);
  });

  it("rejects a different workspace and consumes the stale mark", () => {
    const saved = useVdtStudioStore.getState();
    markDeliberateHomeNavigation(saved);
    expect(consumeDeliberateHomeNavigation({ ...saved, workspace: { ...saved.workspace, activeVdtId: "another-vdt" } })).toBe(false);
    expect(consumeDeliberateHomeNavigation(saved)).toBe(false);
  });

  it("protects edits made after a cancelled Home navigation", () => {
    const saved = useVdtStudioStore.getState();
    markDeliberateHomeNavigation(saved);
    expect(consumeDeliberateHomeNavigation({ ...saved, projectRevision: saved.projectRevision + 1 })).toBe(false);
    markDeliberateHomeNavigation(saved);
    expect(consumeDeliberateHomeNavigation({ ...saved, project: { ...saved.project, name: "New local edit" } })).toBe(false);
  });
});
