import type { VdtProject } from "../types";

/** Deterministic non-business-data fixtures, shared by compiler/transport/UX QA. */
export const SMART_KPI_FIXTURE_TIME = "2026-10-19T00:00:00.000Z";
export function createSmartKpiMeasuredFixture(baselineValue = 100): VdtProject {
  return {
    id: "smart_fixture_project", name: "Smart KPI QA", industry: "Mining",
    businessContext: "QA fixture only: monthly useful tonnes from productive hours and rate.", rootNodeId: "measured_output",
    graph: { nodes: [{ id: "measured_output", name: "Measured useful output", unit: "t/month", type: "root_kpi", status: "accepted",
      baselineValue, valueStatus: "user_provided_value", dataMapping: { sourceId: "fixture_source", field: "output", aggregation: "sum", unit: "t/month" },
      valueSource: { sourceTier: "file", note: "Fictitious QA source." }, aiGenerated: false, createdAt: SMART_KPI_FIXTURE_TIME, updatedAt: SMART_KPI_FIXTURE_TIME }], edges: [] },
    dataSources: [{ id: "fixture_source", name: "Fictitious fixture", type: "file" }],
    scenarios: [{ id: "fixture_scenario", name: "QA scenario", overrides: [{ nodeId: "measured_output", value: 150 }],
      createdAt: SMART_KPI_FIXTURE_TIME, updatedAt: SMART_KPI_FIXTURE_TIME }],
    aiSettings: { defaultProviderId: "mock" }, versions: [], createdAt: SMART_KPI_FIXTURE_TIME, updatedAt: SMART_KPI_FIXTURE_TIME
  };
}
