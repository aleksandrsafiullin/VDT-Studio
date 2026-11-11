import { expect, it } from "vitest";
import { calculateGraph, VdtBuilderSession } from "@vdt-studio/vdt-core";
import { resultLocale } from "./model-agent-result-language";
import { formatVerifiedResult, summarizeVerifiedResult } from "./model-agent-verified-result";

it("uses the user's current language and honors explicit reply instructions", () => {
  const request = "Помоги построить VDT чистой выручки за апрель. Продали 120 товаров.";
  expect(resultLocale(request)).toBe("ru");
  expect(resultLocale(request, "Reply in English.")).toBe("en");
  expect(resultLocale("Построй дерево. Ответь на русском.", "Reply in English.")).toBe("ru");
  expect(resultLocale("Build a revenue tree with three inputs.")).toBe("en");
  expect(resultLocale("Построй дерево. Ответь на испанском.")).toBeUndefined();
});

it("formats the verified KPI name, value and unit in the selected locale", () => {
  const result = {
    name: "Чистая выручка", value: 4900, unit: "USD", formula: "gross - refunds",
    drivers: [], driverCount: 0, estimateCount: 0, additionalEstimates: [], additionalEstimateCount: 0
  };
  expect(formatVerifiedResult("ru", result)).toMatch(/Итог расчёта «Чистая выручка» — 4\s900 USD\./u);
  expect(formatVerifiedResult("en", { ...result, name: "Net revenue" }))
    .toContain("The calculated result for “Net revenue” is 4,900 USD.");
  expect(formatVerifiedResult(undefined, { ...result, name: "Chiffre d’affaires", value: 0, unit: undefined }))
    .toContain("Chiffre d’affaires — 0");
});

it("reports an estimate below a calculated driver and ignores a separate contextual estimate", () => {
  const builder = new VdtBuilderSession();
  builder.createDraft({ projectTitle: "Marge", rootKpi: "Marge", unit: "EUR" });
  const rootNodeId = builder.getProject().rootNodeId;
  builder.addDriver({ nodeId: "margin", parentNodeId: rootNodeId, name: "Marge locale", unit: "EUR", type: "calculated" });
  builder.addDriver({ nodeId: "sales", parentNodeId: "margin", name: "Ventes", unit: "EUR", baselineValue: 100 });
  builder.addDriver({ nodeId: "cost", parentNodeId: "margin", name: "Coût", unit: "EUR", baselineValue: 20 });
  builder.addDriver({ nodeId: "benchmark", parentNodeId: rootNodeId, name: "Référence", unit: "EUR", baselineValue: 500, relation: "contextual_influence" });
  for (const nodeId of ["cost", "benchmark"]) builder.updateNode({ nodeId, patch: { valueStatus: "default_assumption" } });
  builder.setFormula({ nodeId: "margin", formula: "sales - cost" });
  builder.setFormula({ nodeId: rootNodeId, formula: "margin" });
  const project = builder.getProject();
  const summary = summarizeVerifiedResult(project, calculateGraph(project))!;
  expect(summary).toMatchObject({
    value: 80, estimateCount: 1,
    drivers: [{ id: "margin", value: 80, estimated: false }],
    additionalEstimates: [{ id: "cost", value: 20, estimated: true }]
  });
  const text = formatVerifiedResult(undefined, summary);
  expect(text).toContain("Marge ≈ 80 EUR");
  expect(text).toContain("Coût (cost) ≈ 20 EUR");
  expect(text).not.toContain("Référence");
});
