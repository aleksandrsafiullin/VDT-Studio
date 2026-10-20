import { describe, expect, it } from "vitest";
import { createSmartKpiMeasuredFixture } from "@vdt-studio/vdt-core";
import { resolveSmartKpiScope } from "./smart-kpi-scope";

describe("Smart scope uses actual period evidence", () => {
  it("keeps unknown/custom periods contextual and never uses a stale brief default", () => {
    const state = { project: createSmartKpiMeasuredFixture(), workspace: { projectSummaries: [] }, brief: { timePeriod: "monthly" } };
    expect(resolveSmartKpiScope(state).period).toEqual({ key: "unspecified:no-period-source", grain: "custom" });
    state.project.graph.nodes[0]!.assumptions = ["Time period: custom fiscal window"];
    expect(resolveSmartKpiScope(state).period).toEqual({ key: "explicit:custom fiscal window", grain: "custom" });
    state.project.graph.nodes[0]!.assumptions = ["Time period: daily"];
    expect(resolveSmartKpiScope(state).period).toEqual({ key: "explicit:daily", grain: "day" });
  });
  it("preserves the exact source, bounds oversized text and detects contradictory root assumptions", () => {
    const project = createSmartKpiMeasuredFixture(), state = { project, workspace: { activeProjectId: "owner_not_graph_id", projectSummaries: [] } };
    project.graph.nodes[0]!.assumptions = ["Time period: monthly", "Time period: daily"];
    expect(resolveSmartKpiScope(state)).toMatchObject({ workspaceId: "owner_not_graph_id", vdtId: null, period: { grain: "custom" } });
    project.graph.nodes[0]!.assumptions = [`Time period: ${"а".repeat(1000)}`];
    expect(resolveSmartKpiScope(state).period.key.length).toBeLessThanOrEqual(120);
    expect(resolveSmartKpiScope(state).period.grain).toBe("custom");
  });
  it("never turns a stored VDT with unavailable ownership into a scratch draft", () => {
    const scope = resolveSmartKpiScope({ project: createSmartKpiMeasuredFixture(), workspace: { activeProjectId: "owner", activeVdtId: "stored", projectSummaries: [] } });
    expect(scope.vdtId).toBe("stored"); expect(scope.blockedReason).toContain("Stored VDT ownership");
  });
});
