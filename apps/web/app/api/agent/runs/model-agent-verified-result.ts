import {
  buildGoalSeekPlan,
  extractReferencesFromAst,
  type CalculationTraceItem,
  type GraphCalculationResult,
  type VdtProject
} from "@vdt-studio/vdt-core";
import { z } from "zod";
import type { ResultLocale } from "./model-agent-result-language";

const MAX_REPORTED_DRIVERS = 8;
const MAX_REPORTED_ESTIMATES = 4;
const MAX_NAME_LENGTH = 200;
const MAX_UNIT_LENGTH = 80;
const factorSchema = z.object({
  id: z.string().max(160), name: z.string().max(MAX_NAME_LENGTH), value: z.number(), unit: z.string().max(MAX_UNIT_LENGTH).optional(),
  estimated: z.boolean()
});

export const verifiedResultSchema = z.object({
  name: z.string().max(MAX_NAME_LENGTH), value: z.number(), unit: z.string().max(MAX_UNIT_LENGTH).optional(), formula: z.string().max(500),
  drivers: z.array(factorSchema).max(MAX_REPORTED_DRIVERS), driverCount: z.number().int().nonnegative(),
  estimateCount: z.number().int().nonnegative(),
  additionalEstimates: z.array(factorSchema).max(MAX_REPORTED_ESTIMATES),
  additionalEstimateCount: z.number().int().nonnegative()
});

type VerifiedResult = z.infer<typeof verifiedResultSchema>;
type ReportFactor = z.infer<typeof factorSchema>;

function boundedText(value: string, limit: number): string {
  const text = value.replace(/\s+/gu, " ").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1).replace(/[\uD800-\uDBFF]$/u, "")}…`;
}

function reportFactor(trace: CalculationTraceItem | undefined, estimated: boolean): ReportFactor | undefined {
  if (trace?.value === undefined || !Number.isFinite(trace.value)) return undefined;
  return {
    id: trace.nodeId,
    name: boundedText(trace.nodeName, MAX_NAME_LENGTH),
    value: trace.value,
    ...(trace.unit ? { unit: boundedText(trace.unit, MAX_UNIT_LENGTH) } : {}),
    estimated
  };
}

/** Read the actual formula inputs and their provenance from the verified
 * Baseline calculation, including assumptions under calculated factors. */
export function summarizeVerifiedResult(project: VdtProject, calculation: GraphCalculationResult): VerifiedResult | undefined {
  const traceById = new Map(calculation.trace.map((trace) => [trace.nodeId, trace]));
  const root = traceById.get(project.rootNodeId);
  const value = calculation.rootValue;
  if (!root?.formula || value === undefined || !Number.isFinite(value)) return undefined;

  const nodesById = new Map(project.graph.nodes.map((node) => [node.id, node]));
  const visited = new Set<string>();
  const estimateIds = new Set<string>();
  const pending = root.inputs.map((input) => input.nodeId).reverse();
  while (pending.length > 0) {
    const id = pending.pop()!;
    const trace = traceById.get(id);
    if (!trace || visited.has(id)) continue;
    visited.add(id);
    if (trace.goalSeek) {
      const inverse = buildGoalSeekPlan(project.graph, id);
      pending.push(...extractReferencesFromAst(inverse.expression).reverse());
    } else if (trace.formula) {
      pending.push(...trace.inputs.map((input) => input.nodeId).reverse());
    } else {
      const node = nodesById.get(id);
      const source = node?.valueSource?.sourceTier;
      if (node?.valueStatus === "default_assumption" || source === "assumption" || source === "default_assumption") {
        estimateIds.add(id);
      }
    }
  }
  const drivers = root.inputs.slice(0, MAX_REPORTED_DRIVERS).flatMap(({ nodeId }) =>
    reportFactor(traceById.get(nodeId), estimateIds.has(nodeId)) ?? []);
  const shownDrivers = new Set(drivers.map(({ id }) => id));
  const additionalIds = [...estimateIds].filter((id) => !shownDrivers.has(id));
  return {
    name: boundedText(root.nodeName, MAX_NAME_LENGTH),
    value,
    ...(root.unit ? { unit: boundedText(root.unit, MAX_UNIT_LENGTH) } : {}),
    formula: boundedText(root.formula, 500),
    drivers,
    driverCount: root.inputs.length,
    estimateCount: estimateIds.size,
    additionalEstimates: additionalIds.slice(0, MAX_REPORTED_ESTIMATES).flatMap((id) =>
      reportFactor(traceById.get(id), true) ?? []),
    additionalEstimateCount: additionalIds.length
  };
}

function formatValue(value: number, unit: string | undefined, locale: ResultLocale | undefined): string {
  const magnitude = Math.abs(value);
  const notation = magnitude >= 1e21 || (magnitude > 0 && magnitude < 1e-6) ? "scientific" : "standard";
  const amount = locale
    ? new Intl.NumberFormat(locale, { notation, maximumSignificantDigits: 21 }).format(value)
    : String(value);
  return unit ? `${amount} ${unit}` : amount;
}

export function formatVerifiedResult(locale: ResultLocale | undefined, result: VerifiedResult): string {
  const labels = locale === "ru"
    ? { formula: "Формула", drivers: "Факторы расчёта", estimate: "редактируемая оценка", estimates: "Другие оценки в расчёте",
        caveat: "В расчёте использованы редактируемые оценки." }
    : locale === "en"
      ? { formula: "Formula", drivers: "Calculation drivers", estimate: "editable estimate", estimates: "Other estimates in the calculation",
          caveat: "The calculation uses editable estimates." }
      : undefined;
  const value = formatValue(result.value, result.unit, locale);
  const heading = locale === "ru" ? `Итог расчёта «${result.name}» — ${value}.`
    : locale === "en" ? `The calculated result for “${result.name}” is ${value}.`
      : `${result.name} ${result.estimateCount ? "≈" : "—"} ${value}`;
  const sections = [heading];
  if (result.estimateCount && labels) sections.push(labels.caveat);
  sections.push(labels ? `**${labels.formula}**\n${result.formula}` : result.formula);

  const factorList = (factors: ReportFactor[], total: number, label?: string) => [
    ...(label ? [`**${label}**`] : []),
    ...factors.map((factor) => {
      const name = factor.name === factor.id ? factor.name : `${factor.name} (${factor.id})`;
      const marker = factor.estimated && !labels ? "≈" : "—";
      const estimate = factor.estimated && labels ? ` (${labels.estimate})` : "";
      return `- ${name} ${marker} ${formatValue(factor.value, factor.unit, locale)}${estimate}`;
    }),
    ...(total > factors.length ? [`- … (+${total - factors.length})`] : [])
  ].join("\n");
  if (result.driverCount) sections.push(factorList(result.drivers, result.driverCount, labels?.drivers));
  if (result.additionalEstimateCount) sections.push(factorList(result.additionalEstimates, result.additionalEstimateCount, labels?.estimates));
  return sections.join("\n\n");
}
