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

function renderComparison(project: VdtProject, scenarioId: string, locale?: ResultLocale) {
  const comparison = compareScenarioOperation(project, { scenarioId });
  if (comparison.status !== "ok" || comparison.result.errorCount) return;
  const { baselineValue, scenarioValue, absoluteChange, unit, rootNodeId, impactedNodes } = comparison.result;
  if (baselineValue === undefined || scenarioValue === undefined || absoluteChange === undefined
    || ![baselineValue, scenarioValue, absoluteChange].every(Number.isFinite)) return;
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

/** Only an actual successful compare in this instruction and revision selects
 * the scenario for reporting. The formula engine supplies every displayed value. */
export function verifiedScenarioReport(input: {
  project: VdtProject;
  revision: number;
  savedRevisionId?: string | null | undefined;
  instructionAt: string;
  receipts: readonly Pick<AgentToolOperationReceiptV2, "toolName" | "state" | "resultCode" | "replayResult" | "startedAt">[];
  locale?: ResultLocale | undefined;
}): string | undefined {
  const selected = new Set<string>();
  const reports: string[] = [];
  let bytes = 0;
  for (const receipt of [...input.receipts].reverse()) {
    if (receipt.toolName !== "scenario.compare" || receipt.state !== "completed" || receipt.resultCode !== "OK"
      || receipt.replayResult?.status !== "succeeded" || Date.parse(receipt.startedAt) < Date.parse(input.instructionAt)) continue;
    const checked = comparisonReceipt.safeParse(receipt.replayResult?.payload);
    if (!checked.success) continue;
    const { revision, savedRevisionId, result: { scenarioId } } = checked.data.output;
    if (revision !== input.revision || savedRevisionId !== (input.savedRevisionId ?? null) || selected.has(scenarioId)) continue;
    const report = renderComparison(input.project, scenarioId, input.locale);
    if (!report) continue;
    const formattedBytes = Buffer.byteLength(report, "utf8") + 2;
    if (bytes + formattedBytes > 8_000) continue;
    bytes += formattedBytes;
    selected.add(scenarioId);
    reports.unshift(report);
    if (reports.length >= reportLimit) break;
  }
  return reports.length ? reports.join("\n\n") : undefined;
}
