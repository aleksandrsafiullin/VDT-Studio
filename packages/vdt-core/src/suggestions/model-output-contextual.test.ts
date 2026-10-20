import { describe, expect, it } from "vitest";
import observedContexts from "./haulage-measured-contexts.fixture.json" with { type: "json" };
import { buildKpiSuggestionTaskInput, materializeKpiSuggestion, validateKpiSuggestionModelOutput } from "./model-output";
import { validateKpiSuggestionContext } from "./validation";
import { kpiSuggestionCacheKey } from "./identity";
import { KPI_SUGGESTION_RECIPES } from "./recipes";
import { KPI_SUGGESTION_PREPARATION_VERSION, type KpiSuggestionModelOutput } from "../index";

const execution = { mode: "api" as const, backendId: "openai_compatible", modelId: "gpt-6-luna", bindingVersion: "fixture", credentialEpoch: "fixture" };
const host = { proposalId: "observed_context_fixture", requestId: "one_call_fixture", now: "2026-10-20T00:00:00.000Z", execution };

/** Read-only projection of the reported stored graph, captured 2026-10-20.
 * It contains semantic context/knownness, no raw values, rows or credentials.
 * Candidate outputs below are deterministic contract fixtures, not live inference. */
describe("observed measured haulage input contexts", () => {
  it.each(observedContexts)("admits independent explanatory metrics for $targetNodeId", raw => {
    const context = validateKpiSuggestionContext(raw);
    expect(context.target).toMatchObject({ type: "input", valueKnown: true, valueStatus: "calculated", provenance: "sourced" });
    expect(context.children).toHaveLength(0);
    expect(Object.values(context.omissions).some(Boolean)).toBe(false);
    expect(context.ancestors.some(n => n.formula?.includes(context.targetNodeId))).toBe(true);
    expect(context.decompositionPlan?.nodes.find(n => n.nodeId === context.targetNodeId)?.kind).toBe("input");
    expect(context.period).toEqual({ key: "explicit:2026-10-05–2026-10-11", grain: "custom" });
    expect(() => buildKpiSuggestionTaskInput(context)).not.toThrow();

    const candidate = context.target.unit === "km/h"
      ? { key: "route_gradient", conceptKey: "haulage_route_gradient", name: "Средний уклон маршрута", unit: "%", description: "Гипотеза: профиль маршрута может влиять на скорость; нужны измерения по рейсам." }
      : { key: "service_queue_time", conceptKey: "service_queue_wait", name: "Время ожидания обслуживания на рейс", unit: "min/trip", description: "Гипотеза для проверки: очередь может объяснять часть внутрециклового ожидания; нужны метки событий." };
    const output: KpiSuggestionModelOutput = { status: "ready", rationale: "Контекстные измерения для проверки возможных причин; фактические значения неизвестны.",
      limitations: ["Наблюдения не устанавливают причинность и не меняют измеренный родительский KPI."],
      groups: [{ id: "contextual_metrics", title: "Возможные факторы для проверки", selectionMode: "independent", requiredKeys: [], formula: null, recipeId: null,
        limitations: [], children: [{ ...candidate, existingNodeId: null }] }] };
    const proposal = materializeKpiSuggestion(output, context, host)!;
    expect(proposal.groups[0]).toMatchObject({ selectionMode: "independent", requiredKeys: [], children: [{ unit: candidate.unit }] });
    expect(proposal.groups[0]).not.toHaveProperty("recipeBinding");
    expect(proposal.groups[0]).not.toHaveProperty("formula");
    expect(proposal.groups[0]!.children[0]).not.toHaveProperty("value");
  });

  it("keeps unsupported genuine empty results valid and separates preparation policy identity", () => {
    const result = { status: "empty", rationale: "The KPI definition does not establish a useful distinct next metric.", limitations: ["Provide a metric definition."], groups: [] };
    expect(validateKpiSuggestionModelOutput(result)).toEqual(result);
    const context = validateKpiSuggestionContext(observedContexts[0]);
    expect(materializeKpiSuggestion(result, context, host)).toBeUndefined();
    const frame = JSON.parse(kpiSuggestionCacheKey(context, KPI_SUGGESTION_RECIPES.version, execution));
    expect(frame.preparationVersion).toBe(KPI_SUGGESTION_PREPARATION_VERSION);
    const previous = { ...frame, preparationVersion: "smart-kpi-preparation.v1" };
    expect(previous).not.toEqual(frame);
  });

  it("materializes a generic measured speed definition on the actual custom-period context", () => {
    const context = validateKpiSuggestionContext(observedContexts.find(row => row.target.unit === "km/h"));
    const output: KpiSuggestionModelOutput = { status: "ready", rationale: "Скорость = расстояние / время движения.", limitations: [], groups: [{
      id: "distance_time", title: "Через расстояние и время", selectionMode: "all", requiredKeys: ["distance", "measured_time"],
      formula: "distance / measured_time", recipeId: null, limitations: [], children: [
        { key: "distance", conceptKey: "measured_distance_per_trip", name: "Пройденное расстояние на рейс", unit: "km/trip", description: null, existingNodeId: null },
        { key: "measured_time", conceptKey: "measured_moving_hours_per_trip", name: "Измеренное время движения на рейс", unit: "h/trip", description: null, existingNodeId: null }
      ] }] };
    const proposal = materializeKpiSuggestion(output, context, host)!;
    expect(proposal.groups[0]?.formula).toBe("distance / measured_time");
    expect(proposal.groups[0]?.recipeBinding).toBeUndefined();
    expect(proposal.groups[0]?.children.every(row => !("baselineValue" in row) && !("value" in row))).toBe(true);
    const oldPolicyFrame = { ...JSON.parse(kpiSuggestionCacheKey(context, KPI_SUGGESTION_RECIPES.version, execution)), preparationVersion: "smart-kpi-preparation.v2" };
    expect(oldPolicyFrame.preparationVersion).not.toBe(KPI_SUGGESTION_PREPARATION_VERSION);
    expect(() => materializeKpiSuggestion({ ...output, groups: [{ ...output.groups[0], formula: "2 * distance / measured_time" }] }, context, host)).toThrow();
    expect(() => materializeKpiSuggestion({ ...output, groups: [{ ...output.groups[0], children: [output.groups[0]!.children[0], { ...output.groups[0]!.children[1], unit: "min/trip" }] }] }, context, host)).toThrow(/scale|unit|basis/i);
  });
});
