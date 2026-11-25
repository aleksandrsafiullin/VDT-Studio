import type { AgentToolOperationReceiptV2 } from "@vdt-studio/vdt-agent-runtime";
import { productionVolumeProject } from "@vdt-studio/vdt-core";
import { expect, it } from "vitest";
import { verifiedScenarioReport } from "./model-agent-verified-scenario";

const now = "2026-11-25T03:00:00.000Z";
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

function comparisonReceipt(revision = 2, savedRevisionId = "saved-2", startedAt = now) {
  return {
    toolName: "scenario.compare", state: "completed", resultCode: "OK", startedAt,
    replayResult: {
      externalCallId: "compare", toolName: "scenario.compare", status: "succeeded",
      resultCode: "OK", resultHash: "sha256:" + "a".repeat(64),
      payload: { output: { revision, savedRevisionId, result: { scenarioId, scenarioValue: 1780 } } }
    }
  } satisfies Pick<AgentToolOperationReceiptV2, "toolName" | "state" | "resultCode" | "replayResult" | "startedAt">;
}

it("reports the current baseline, scenario output, delta and changed input using shared calculation", () => {
  const report = verifiedScenarioReport({ project, revision: 2, savedRevisionId: "saved-2", instructionAt: now,
    receipts: [comparisonReceipt(), comparisonReceipt()] });
  expect(report).toContain("Baseline 1,780 tonnes/month");
  expect(report).toContain("Scenario “Recovery” 1,820 tonnes/month");
  expect(report).toContain("Change +40 tonnes/month");
  expect(report).toContain("110 hours/month → 90 hours/month");
  expect(report?.match(/Scenario “Recovery”/g)).toHaveLength(1);
});

it("ignores failed, earlier-instruction and stale-revision comparisons", () => {
  const report = verifiedScenarioReport({ project, revision: 2, savedRevisionId: "saved-2", instructionAt: now,
    receipts: [
      { ...comparisonReceipt(), state: "failed", resultCode: "SCENARIO_NOT_FOUND" },
      comparisonReceipt(2, "saved-1"),
      comparisonReceipt(1, "saved-2"),
      comparisonReceipt(2, "saved-2", "2026-11-25T02:59:59.000Z")
    ] });
  expect(report).toBeUndefined();
});
