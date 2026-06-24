import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadEvaluationDataset,
  runProviderEvaluation,
  validateEvaluationDataset
} from "./evaluate-providers.mjs";

const tempDirs: string[] = [];

async function tempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vdt-eval-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("provider evaluation gate", () => {
  it("loads the canonical 20-KPI dataset", async () => {
    const dataset = await loadEvaluationDataset();

    expect(dataset.cases).toHaveLength(20);
    expect(new Set(dataset.cases.map((entry) => entry.id)).size).toBe(20);
    expect(dataset.cases[0]).toMatchObject({
      id: "production-volume",
      rootKpi: "Production Volume",
      expectedRootUnit: "tonnes/month",
      acceptance: { minNodes: 6, maxNodes: 16, minEdges: 5, minDepth: 2 }
    });
  });

  it("rejects incomplete or duplicate datasets", () => {
    expect(() => validateEvaluationDataset({ schemaVersion: 1, cases: [] })).toThrow(/exactly 20/);

    const cases = Array.from({ length: 20 }, (_value, index) => ({
      id: index === 1 ? "duplicate" : index === 0 ? "duplicate" : `case-${index}`,
      rootKpi: "KPI",
      industry: "Test",
      businessContext: "Context",
      goal: "Goal",
      expectedRootUnit: "%",
      timePeriod: "monthly",
      expectations: {
        minimumDepth: 1,
        acceptableNodeCountRange: [1, 10],
        requiredBusinessDrivers: ["Driver"],
        prohibitedDuplicatePatterns: ["Duplicate"],
        formulaExpectations: ["Formula"],
        unitConsistencyExpectations: ["Unit"]
      },
      acceptance: { minNodes: 1, maxNodes: 10, minEdges: 1, minDepth: 1 }
    }));

    expect(() => validateEvaluationDataset({ schemaVersion: 1, cases })).toThrow(/duplicate/);
  });

  it("runs the mock provider evaluation and writes a report", async () => {
    const dir = await tempDir();
    const reportPath = path.join(dir, "report.json");
    const report = await runProviderEvaluation({ providerId: "mock", reportPath });

    expect(report).toMatchObject({ ok: true, providerId: "mock", caseCount: 20, passed: 20, failed: 0 });
    expect(report.results.every((entry) => entry.nodeCount >= 6 && entry.edgeCount >= 5)).toBe(true);
    expect(report.results.every((entry) => entry.generatedRootKpi === entry.expectedRootKpi)).toBe(true);
    expect(report.results.every((entry) => entry.generatedRootUnit === entry.expectedRootUnit)).toBe(true);
    expect(report.results.every((entry) => entry.requiredDriverCoverage === 1)).toBe(true);
    expect(report.results.every((entry) => entry.duplicateNameCount === 0)).toBe(true);
    expect(report.metrics.formulaCoverageRate).toBe(1);
    expect(report.metrics.averageDepth).toBeGreaterThanOrEqual(2);
  });

  it("fails closed for unsupported provider ids", async () => {
    await expect(runProviderEvaluation({ providerId: "live-provider", writeReport: false })).rejects.toThrow(
      /unsupported evaluation provider/
    );
  });
});
