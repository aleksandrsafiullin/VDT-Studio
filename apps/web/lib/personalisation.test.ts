import { describe, expect, it } from "vitest";
import { workspacePersonalisation } from "./personalisation";
import { resolveSmartKpiScope } from "./smart-kpi-scope";
import { createSmartKpiMeasuredFixture } from "@vdt-studio/vdt-core";
import type { StoredProjectSummary } from "./vdt-storage-client";

const summary = (id: string, text: string): StoredProjectSummary => ({
  project: { id, name: id, createdAt: "2026-10-26T00:00:00Z", updatedAt: "2026-10-26T00:00:00Z", metadata: { personalisation: { enabled: true, text } } },
  runtimeState: { schemaVersion: "project_runtime_state.v1", projectId: id, runtimeGeneration: "v1", generationVersion: 1, migrationState: "not_started", writeState: "enabled", updatedAt: "2026-10-26T00:00:00Z" },
  counts: { vdts: 0, revisions: 0, conversations: 0, agentRuns: 0, mutationProposals: 0, comparisons: 0 }, vdts: []
});
describe("workspace instruction scopes", () => {
  it("uses only user instructions regardless of project owner or retained project rules", () => {
    const state = { personalisation: { instructions: [{ id: "general", enabled: true, text: "General preferences" }] }, project: createSmartKpiMeasuredFixture(),
      workspace: { activeProjectId: "project_b", projectSummaries: [summary("project_a", "Rules A"), summary("project_b", "Rules B")] } };
    expect(workspacePersonalisation(state)).toEqual({ userInstructions: "General preferences" });
    expect(resolveSmartKpiScope(state).personalisation).toEqual(workspacePersonalisation(state));
    state.workspace.activeProjectId = "missing";
    expect(workspacePersonalisation(state)).toEqual({ userInstructions: "General preferences" });
    state.personalisation.instructions[0]!.enabled = false;
    expect(workspacePersonalisation(state)).toEqual({});
  });
});
