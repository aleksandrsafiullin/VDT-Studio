import type { AgentToolOperationReceiptV2 } from "@vdt-studio/vdt-agent-runtime";
import { productionVolumeProject } from "@vdt-studio/vdt-core";
import { expect, it } from "vitest";
import { verifiedScenarioComparisons, verifiedScenarioReport } from "./model-agent-verified-scenario";

const now = "2026-11-25T03:00:00.000Z";
const runId = "current_run";
const project = structuredClone(productionVolumeProject);
const values = new Map([
  ["calendar_time", 1000], ["planned_downtime", 0], ["unplanned_downtime", 110],
  ["nominal_rate", 2], ["yield_factor", 1]
]);
for (const node of project.graph.nodes) {
  if (values.has(node.id)) node.baselineValue = values.get(node.id);
}
const scenarioId = "recovery_after_correction";
project.scenarios.push({
  id: scenarioId, name: "Recovery", overrides: [{ nodeId: "unplanned_downtime", value: 90 }], createdAt: now, updatedAt: now
});

function comparisonReceipt(revision = 2, savedRevisionId: string | null = "saved-2", startedAt = now, targetId = scenarioId) {
  return {
    runId, receiptId: `receipt-${targetId}`, toolName: "scenario.compare", state: "completed", resultCode: "OK", startedAt,
    replayResult: {
      externalCallId: "compare", toolName: "scenario.compare", status: "succeeded",
      resultCode: "OK", resultHash: "sha256:" + "a".repeat(64),
      payload: { output: { revision, savedRevisionId, result: { scenarioId: targetId, scenarioValue: 1780 } } }
    }
  } satisfies Pick<AgentToolOperationReceiptV2, "receiptId" | "runId" | "toolName" | "state" | "resultCode" | "replayResult" | "startedAt">;
}

it("reports the current baseline, scenario output, delta and changed input using shared calculation", () => {
  const report = verifiedScenarioReport({ runId, project, revision: 2, savedRevisionId: "saved-2", instructionAt: now,
    receipts: [comparisonReceipt(), comparisonReceipt()] });
  expect(report).toContain("Baseline 1,780 tonnes/month");
  expect(report).toContain("Scenario “Recovery” 1,820 tonnes/month");
  expect(report).toContain("Change +40 tonnes/month");
  expect(report).toContain("110 hours/month → 90 hours/month");
  expect(report?.match(/Scenario “Recovery”/g)).toHaveLength(1);
});

it("ignores failed, foreign-run, earlier-instruction and stale-revision comparisons", () => {
  const report = verifiedScenarioReport({ runId, project, revision: 2, savedRevisionId: "saved-2", instructionAt: now,
    receipts: [
      { ...comparisonReceipt(), state: "failed", resultCode: "SCENARIO_NOT_FOUND" },
      { ...comparisonReceipt(), runId: "foreign_run" },
      comparisonReceipt(2, "saved-1"),
      comparisonReceipt(1, "saved-2"),
      comparisonReceipt(2, "saved-2", "2026-11-25T02:59:59.000Z"),
      comparisonReceipt(2, "saved-2", "invalid")
    ] });
  expect(report).toBeUndefined();
});

it("returns only a genuine receipt for the exact requested scenario in the current run", () => {
  const otherScenarioId = project.scenarios[0]!.id;
  const evidence = { runId, project, revision: 2, savedRevisionId: "saved-2", instructionAt: now,
    receipts: [comparisonReceipt(2, "saved-2", now, otherScenarioId)] };
  expect([...verifiedScenarioComparisons(evidence, scenarioId)]).toEqual([]);
  const receipt = comparisonReceipt();
  const withRequested = { ...evidence, receipts: [...evidence.receipts, receipt] };
  expect([...verifiedScenarioComparisons(withRequested, scenarioId)]).toEqual([{
    receiptId: receipt.receiptId,
    comparison: expect.objectContaining({ scenarioId, baselineValue: 1780, scenarioValue: 1820, absoluteChange: 40 })
  }]);
  expect([...verifiedScenarioComparisons({ ...withRequested, instructionAt: "invalid" }, scenarioId)]).toEqual([]);
  const unsaved = { ...evidence, savedRevisionId: null, receipts: [comparisonReceipt(2, null)] };
  expect([...verifiedScenarioComparisons(unsaved, scenarioId)]).toEqual([]);
  expect(verifiedScenarioReport(unsaved)).toContain("Scenario “Recovery” 1,820 tonnes/month");
});
