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
  it.each(["Часы неплановых технических событий", "Измеренные часы организационных событий"])("rejects an identity formula that only renames the target: %s", name => {
    expect(() => validateKpiSuggestionModelOutput({ status: "ready", rationale: "Same total with a different name.", limitations: [], groups: [{
      id: "renamed_total", title: "Loss hours", selectionMode: "all", requiredKeys: ["hours"], formula: "hours", recipeId: null, limitations: [],
      children: [{ key: "hours", conceptKey: "loss_hours", name, unit: "h", description: null, existingNodeId: null }]
    }] })).toThrow(/at least two distinct component KPIs/);
  });
  it.each(observedContexts)("rejects a single explanatory metric as a decomposition for $targetNodeId", raw => {
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
    expect(() => materializeKpiSuggestion(output, context, host)).toThrow(/at least two distinct component KPIs/);
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

  it("materializes a proposed two-category waiting-time breakdown on a custom-period context", () => {
    const context = validateKpiSuggestionContext(observedContexts.find(row => row.target.unit === "min/trip"));
    const output: KpiSuggestionModelOutput = { status: "ready", rationale: "Ожидание: очередь на погрузку и очередь на разгрузку.", limitations: ["Confirm these disjoint categories cover the target population."], groups: [{
      id: "waiting_categories", title: "Составляющие ожидания", selectionMode: "all", requiredKeys: ["loading_queue", "unloading_queue"],
      formula: "loading_queue + unloading_queue", recipeId: null, limitations: [], children: [
        { key: "loading_queue", conceptKey: "loading_queue_wait", name: "Ожидание в очереди на погрузку", unit: "min/trip", description: null, existingNodeId: null },
        { key: "unloading_queue", conceptKey: "unloading_queue_wait", name: "Ожидание в очереди на разгрузку", unit: "min/trip", description: null, existingNodeId: null }
      ] }] };
    const proposal = materializeKpiSuggestion(output, context, host)!;
    expect(proposal.groups[0]?.formula).toBe("loading_queue + unloading_queue");
    expect(proposal.groups[0]?.recipeBinding).toBeUndefined();
    expect(proposal.groups[0]?.children.every(row => !("baselineValue" in row) && !("value" in row))).toBe(true);
    const oldPolicyFrame = { ...JSON.parse(kpiSuggestionCacheKey(context, KPI_SUGGESTION_RECIPES.version, execution)), preparationVersion: "smart-kpi-preparation.v2" };
    expect(oldPolicyFrame.preparationVersion).not.toBe(KPI_SUGGESTION_PREPARATION_VERSION);
    expect(() => materializeKpiSuggestion({ ...output, groups: [{ ...output.groups[0], formula: "2 * loading_queue + unloading_queue" }] }, context, host)).toThrow();
    expect(() => materializeKpiSuggestion({ ...output, groups: [{ ...output.groups[0], children: [output.groups[0]!.children[0], { ...output.groups[0]!.children[1], unit: "h/trip" }] }] }, context, host)).toThrow(/scale|unit|basis/i);
  });
});
