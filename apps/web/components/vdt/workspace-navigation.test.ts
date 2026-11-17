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

  it("consumes a saved Home intent across a metadata-only workspace refresh", () => {
    const state = useVdtStudioStore.getState();
    const saved = { ...state, workspace: {
      ...state.workspace, activeProjectId: "project", activeVdtId: "vdt", activePanel: "vdt" as const, isLoading: true
    } };
    markDeliberateHomeNavigation(saved);

    const refreshed = { ...saved, workspace: {
      ...saved.workspace, isLoading: false, projectSummaries: [...saved.workspace.projectSummaries]
    } };
    expect(consumeDeliberateHomeNavigation(refreshed)).toBe(true);
    expect(consumeDeliberateHomeNavigation(refreshed)).toBe(false);
  });

  it("rejects a different workspace and consumes the stale mark", () => {
    const saved = useVdtStudioStore.getState();
    markDeliberateHomeNavigation(saved);
    expect(consumeDeliberateHomeNavigation({ ...saved, workspace: { ...saved.workspace, activeVdtId: "another-vdt" } })).toBe(false);
    expect(consumeDeliberateHomeNavigation(saved)).toBe(false);
  });

  it.each([
    ["project", { activeProjectId: "another-project" }],
    ["panel", { activePanel: "vdt" as const }],
    ["revision base", { draftRevisionBase: null }],
    ["commit journal", { pendingRevisionCommit: { vdtId: "vdt" } }],
    ["create journal", { pendingVdtCreate: {} }]
  ])("rejects a changed %s despite otherwise unchanged editor identity", (_label, workspaceChange) => {
    const saved = useVdtStudioStore.getState();
    markDeliberateHomeNavigation(saved);
    // These sentinels stand in for newly replaced state fields. The guard must
    // reject on identity before it uses any journal content.
    const workspace = { ...saved.workspace, ...workspaceChange } as typeof saved.workspace;
    expect(consumeDeliberateHomeNavigation({ ...saved, workspace })).toBe(false);
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
