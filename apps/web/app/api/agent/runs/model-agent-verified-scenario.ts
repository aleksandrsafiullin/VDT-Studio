import type { AgentToolOperationReceiptV2 } from "@vdt-studio/vdt-agent-runtime";
import { compareScenarioOperation, type VdtProject } from "@vdt-studio/vdt-core";
import { z } from "zod";
import type { ResultLocale } from "./model-agent-result-language";

const comparisonReceipt = z.object({
  output: z.object({
    revision: z.number().int().nonnegative(),
    savedRevisionId: z.string().nullable(),
    result: z.object({ scenarioId: z.string() })
  })
});
const reportLimit = 4;
const label = (value: string) => value.replace(/\s+/gu, " ").trim().slice(0, 160)
  .replace(/[\\<>&\x60*_{}\[\]()~|]/g, "\\$&");
const units = (value: string | undefined) => value ? " " + label(value) : "";

type ScenarioComparison = Extract<ReturnType<typeof compareScenarioOperation>, { status: "ok" }>["result"];

function renderComparison(project: VdtProject, comparison: ScenarioComparison, locale?: ResultLocale) {
  const { scenarioId, baselineValue, scenarioValue, absoluteChange, unit, rootNodeId, impactedNodes } = comparison;
  if (baselineValue === undefined || scenarioValue === undefined || absoluteChange === undefined) return;
  const scenario = project.scenarios.find(entry => entry.id === scenarioId)!;
  const kpi = project.graph.nodes.find(node => node.id === rootNodeId);
  const formatter = new Intl.NumberFormat(locale ?? "en", { maximumSignificantDigits: 16 });
  const signed = new Intl.NumberFormat(locale ?? "en", { maximumSignificantDigits: 16, signDisplay: "exceptZero" });
  const overrides = new Set(scenario.overrides.map(({ nodeId }) => nodeId));
  const inputs = impactedNodes.filter(({ nodeId }) => nodeId !== rootNodeId && overrides.has(nodeId)).slice(0, reportLimit);
  const labels = locale === "ru"
    ? { headline: "Модельное сравнение", baseline: "Базовый вариант", scenario: "Сценарий", delta: "Изменение" }
    : { headline: "Modeled comparison", baseline: "Baseline", scenario: "Scenario", delta: "Change" };
  return [
    "**" + labels.headline + " · " + label(kpi?.name ?? rootNodeId) + "**",
    "",
    "- " + labels.baseline + " " + formatter.format(baselineValue) + units(unit),
    "- " + labels.scenario + " “" + label(scenario.name) + "” " + formatter.format(scenarioValue) + units(unit),
    "- " + labels.delta + " " + signed.format(absoluteChange) + units(unit),
    ...inputs.flatMap(input => input.baselineValue !== undefined && input.scenarioValue !== undefined ? [
      "- " + label(input.nodeName) + " "
        + formatter.format(input.baselineValue) + units(input.unit) + " → " + formatter.format(input.scenarioValue) + units(input.unit)
    ] : [])
  ].join("\n");
}

interface ScenarioComparisonEvidence {
  runId: string;
  project: VdtProject;
  revision: number;
  savedRevisionId?: string | null | undefined;
  instructionAt: string;
  receipts: readonly Pick<AgentToolOperationReceiptV2, "receiptId" | "runId" | "toolName" | "state" | "resultCode" | "replayResult" | "startedAt">[];
}

/** Check the gateway ledger against one run, instruction and revision.
 * An explicit target requires a saved revision and does not infer intent. */
export function* verifiedScenarioComparisons(input: ScenarioComparisonEvidence, targetId?: string) {
  const instructionAt = Date.parse(input.instructionAt);
  if (!Number.isFinite(instructionAt) || (targetId !== undefined && !input.savedRevisionId)) return;
  const verified = new Set<string>();
  for (let index = input.receipts.length - 1; index >= 0; index--) {
    const receipt = input.receipts[index]!;
    if (receipt.runId !== input.runId || receipt.toolName !== "scenario.compare" || receipt.state !== "completed"
      || receipt.resultCode !== "OK" || receipt.replayResult?.status !== "succeeded"
      || !(Date.parse(receipt.startedAt) >= instructionAt)) continue;
    const checked = comparisonReceipt.safeParse(receipt.replayResult?.payload);
    if (!checked.success) continue;
    const { revision, savedRevisionId, result: { scenarioId } } = checked.data.output;
    if (revision !== input.revision || savedRevisionId !== (input.savedRevisionId ?? null)
      || verified.has(scenarioId) || (targetId !== undefined && targetId !== scenarioId)) continue;
    const comparison = compareScenarioOperation(input.project, { scenarioId });
    if (comparison.status !== "ok" || comparison.result.errorCount) continue;
    const { baselineValue, scenarioValue, absoluteChange } = comparison.result;
    if (![baselineValue, scenarioValue, absoluteChange].every(Number.isFinite)) continue;
    verified.add(scenarioId);
    yield { receiptId: receipt.receiptId, comparison: comparison.result };
  }
}

/** Only actual comparisons in this instruction and revision are reported.
 * The formula engine supplies every displayed value. */
export function verifiedScenarioReport(input: ScenarioComparisonEvidence & { locale?: ResultLocale | undefined }): string | undefined {
  const reports: string[] = [];
  let bytes = 0;
  for (const { comparison } of verifiedScenarioComparisons(input)) {
    const report = renderComparison(input.project, comparison, input.locale);
    if (!report) continue;
    const formattedBytes = Buffer.byteLength(report, "utf8") + 2;
    if (bytes + formattedBytes > 8_000) continue;
    bytes += formattedBytes;
    reports.unshift(report);
    if (reports.length >= reportLimit) break;
  }
  return reports.length ? reports.join("\n\n") : undefined;
}
