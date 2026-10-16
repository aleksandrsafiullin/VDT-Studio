import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DataDiscoveryRunSnapshot, IncomingKpiOptions } from "@vdt-studio/data-harness";
import { IncomingKpiMappingReview } from "./incoming-kpi-mapping-review";

function snapshotFixture(): DataDiscoveryRunSnapshot {
  const options: IncomingKpiOptions = { tableId: "events", categoryColumns: ["Group", "Reason"], duration: { mode: "column", column: "Minutes", unit: "minutes" }, normalization: { mode: "period_total" } };
  return {
    runId: "run_file", datasetId: "dataset_file", projectId: "vdt_file", status: "waiting_review", phase: "user_review", events: [],
    file: { fileName: "downtime.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sizeBytes: 1234, contentHash: "sha256:original", storageRef: "project-source", uploadedAt: "2026-10-16T00:00:00Z" },
    tables: [{ tableId: "events", name: "Downtime events", rowCount: 12, columnCount: 13, columns: ["Group", "Reason", "Minutes", ...Array.from({ length: 10 }, (_item, i) => `Column ${i}`)], truncated: false }],
    warnings: [], observations: [], auditLog: [], cacheKeys: [], validationResults: [],
    createdAt: "2026-10-16T00:00:00Z", updatedAt: "2026-10-16T00:00:00Z",
    incomingKpi: {
      targetNodeId: "downtime", options,
      questions: [{ id: "confirm", field: "confirmed", message: "Confirm the calculation before staging.", required: true }, { id: "provider_0", field: "clarificationAnswers.provider_0", message: "Does the extract cover all equipment?", required: true }],
      hierarchy: Array.from({ length: 12 }, (_item, i) => ({ nodeId: `category_${i}`, parentNodeId: "downtime", name: `Category ${i}`, depth: i === 11 ? 2 : 1, path: [{ column: "Reason", value: `Category ${i}` }], baselineValue: i + 1, unit: "h", description: `Source: downtime.xlsx; sha256:original; Reason=Category ${i}; 1/12 rows` })),
      coverage: { totalRows: 12, includedRows: 12, excludedRows: 0, categoryCount: 12, complete: true },
      calculation: "sum(Minutes) / 60", blockingReasons: []
    }
  };
}

function render(snapshot = snapshotFixture(), extra: { mappingChanged?: boolean; options?: IncomingKpiOptions } = {}) {
  return renderToStaticMarkup(<IncomingKpiMappingReview snapshot={snapshot} options={extra.options ?? snapshot.incomingKpi!.options} running={false} mappingChanged={extra.mappingChanged ?? false} onOptionsChange={vi.fn()} onCalculate={vi.fn()} />);
}

describe("incoming KPI mapping review", () => {
  it("renders every legacy warning and validation occurrence even when their stored IDs collide", () => {
    const snapshot = snapshotFixture();
    const first = "Legacy warning about the full reporting period.";
    const second = "Legacy warning about the selected equipment.";
    snapshot.warnings = [first, second, first].map((message) => ({ id: "legacy_collision", severity: "warning", type: "data_discovery_low_confidence", message }));
    snapshot.validationResults = ["Legacy validation one.", "Legacy validation two."].map((message) => ({ id: "legacy_collision", status: "warning", message }));
    const html = render(snapshot);
    const notices = html.slice(html.indexOf('data-testid="data-import-warnings"'));
    expect(notices.split(first)).toHaveLength(3);
    expect(notices.split(second)).toHaveLength(2);
    expect(notices).toContain("Legacy validation one.");
    expect(notices).toContain("Legacy validation two.");
    expect(notices.match(/<li>/g)).toHaveLength(5);
  });

  it("shows every hierarchy category and column, coverage, values and source provenance", () => {
    const html = render();
    expect(html.match(/data-testid="data-import-hierarchy-row"/g)).toHaveLength(12);
    expect(html).toContain("Category 11");
    expect(html).toContain("Column 9");
    expect(html).toContain("12 of 12 rows included");
    expect(html).toContain("complete source coverage");
    expect(html).toContain("sha256:original");
    expect(html).toContain("sum(Minutes) / 60");
  });
  it("shows mandatory questions and unconfirmed results without making the calculate action available", () => {
    const html = render();
    expect(html).toContain("Confirm the calculation before staging.");
    expect(html).toContain("Does the extract cover all equipment?");
    expect(html).toContain("Update the mapping controls above if an answer changes the calculation.");
    expect(html).toContain("Values below are unconfirmed");
    expect(html).toMatch(/disabled=""[^>]*data-testid="data-import-calculate-preview"|data-testid="data-import-calculate-preview"[^>]*disabled=""/);
  });
  it("exposes timestamp, timezone and per-day denominator decisions and marks old preview values stale", () => {
    const snapshot = snapshotFixture();
    const options: IncomingKpiOptions = { ...snapshot.incomingKpi!.options, duration: { mode: "timestamps", startColumn: "Start", endColumn: "End" }, normalization: { mode: "per_day", basis: "entity_days" }, confirmed: true };
    const html = render(snapshot, { options, mappingChanged: true });
    for (const label of ["Timestamp format", "Timezone UTC offset, minutes", "Inclusive period start", "Denominator, including zero-event days", "Entity-days"]) expect(html).toContain(label);
    expect(html).toContain("Mapping changed. Calculate the preview before staging.");
    expect(html).toContain("Values below are unconfirmed");
  });
  it("supports additive non-time numeric values in the KPI's existing unit", () => {
    const snapshot = snapshotFixture();
    const options: IncomingKpiOptions = { ...snapshot.incomingKpi!.options, duration: { mode: "column", column: "Cost", unit: "target" }, normalization: { mode: "period_total" } };
    const html = render(snapshot, { options });
    expect(html).toContain("Numeric value / duration column");
    expect(html).toContain("KPI base unit (no conversion)");
    expect(html).toContain("Total value for the period");
  });
  it("explains authoritative Excel duration encoding and shows mixed-encoding blockers", () => {
    const snapshot = snapshotFixture();
    snapshot.incomingKpi!.calculation = "Excel duration encoding: serialized days across all relevant cells";
    snapshot.incomingKpi!.blockingReasons = ["The selected value column mixes Excel time/duration encodings with ordinary numeric or text cells."];
    const html = render(snapshot);
    expect(html).toContain("Excel stores formatted durations as fractions of a day.");
    expect(html).toContain("mixes Excel time/duration encodings");
  });
});
