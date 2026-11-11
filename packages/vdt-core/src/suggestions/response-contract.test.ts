import { describe, expect, it } from "vitest";
import { buildKpiSuggestionContext } from "./identity";
import { createSmartKpiMeasuredFixture } from "./fixtures";
import { createIncomingGraphFixture, fixtureContext } from "./incoming-contract.fixtures";
import { buildKpiSuggestionTaskInput, kpiSuggestionApiResponseSchema, materializeKpiSuggestion, validateKpiSuggestionTaskInput } from "./model-output";
import { KPI_SUGGESTION_LIMITS, type KpiSuggestionContext } from "./types";

async function sales(unit = "USD") {
  const project = createSmartKpiMeasuredFixture(10000);
  Object.assign(project.graph.nodes[0]!, { name: "Net product revenue", unit });
  return buildKpiSuggestionContext(project, { workspaceId: "contract_qa", vdtId: null, targetNodeId: project.rootNodeId, period: { key: "2026-10", grain: "month" } });
}

function apiGroups(context: KpiSuggestionContext) {
  const schema = kpiSuggestionApiResponseSchema(buildKpiSuggestionTaskInput(context).responseContract);
  const groups = schema.properties.groups as { items: { anyOf: {
    properties: { recipeId: { type: string; const?: string }; children: { items: unknown } }
  }[] } };
  return groups.items.anyOf.map(group => group.properties);
}

describe("Smart model response requirements", () => {
  it("requires new factor identities for an undecomposed input with contextual siblings", async () => {
    const context = await fixtureContext(createIncomingGraphFixture("shared_speed"));
    expect(context.siblings.map(node => node.id)).toEqual(["distance"]);
    expect(context.children).toEqual([]);
    const custom = apiGroups(context).find(group => group.recipeId.type === "null");
    expect(custom?.children.items).toMatchObject({ properties: { existingNodeId: { type: "null" } } });
  });
  it("limits existing factor identities to active direct children and exact recipe units", async () => {
    const project = createSmartKpiMeasuredFixture();
    const root = project.graph.nodes[0]!;
    root.unit = "USD";
    for (const { id, unit, status } of [
      { id: "amount", unit: "USD", status: "accepted" },
      { id: "count", unit: "units", status: "accepted" },
      { id: "missing_unit", unit: undefined, status: "accepted" },
      { id: "rejected", unit: "USD", status: "rejected" }
    ] as const) {
      project.graph.nodes.push({ ...root, id, name: id, type: "input", unit, status });
      project.graph.edges.push({ id: `edge_${id}`, sourceNodeId: root.id, targetNodeId: id, relation: "contextual_influence", aiGenerated: false });
    }
    const context = await buildKpiSuggestionContext(project, { workspaceId: "contract_qa", vdtId: null, targetNodeId: root.id, period: { key: "2026-10", grain: "month" } });
    const groups = apiGroups(context);
    const reference = (...ids: string[]) => ({ anyOf: [{ type: "string", enum: ids }, { type: "null" }] });
    const custom = groups.find(group => group.recipeId.type === "null");
    expect(custom?.children.items).toMatchObject({ properties: { existingNodeId: reference("amount", "count") } });
    const recipe = groups.find(group => group.recipeId.const === "revenue.quantity_price_net");
    const recipeChild = (unit: string, existingNodeId: object) => expect.objectContaining({
      properties: expect.objectContaining({ unit: { type: "string", const: unit }, existingNodeId })
    });
    expect(recipe?.children.items).toMatchObject({ anyOf: expect.arrayContaining([
      recipeChild("USD", reference("amount")),
      recipeChild("USD/unit", { type: "null" })
    ]) });
  });
  it("provides resolved, executable recipe units for the exact target and period", async () => {
    const context = await sales("Usd"), input = buildKpiSuggestionTaskInput(context);
    const contract = input.responseContract;
    expect(contract.units.target.parsed?.dimensions).toEqual({ "currency:USD": 1 });
    expect(contract.limits).toMatchObject({ minFactors: 2, maxFactors: KPI_SUGGESTION_LIMITS.children, outputTokens: KPI_SUGGESTION_LIMITS.outputTokens });
    expect(contract.references.reusableDirectChildren).toEqual([]);
    const recipe = contract.recipes.find(r => r.id === "revenue.quantity_price_net")!;
    expect(recipe.children.map(c => c.unit)).toEqual(["units", "USD/unit", "fraction", "Usd"]);
    const output = { status: "ready", rationale: "Complete net revenue definition.", limitations: [], groups: [{ id: "net_revenue", title: "Net revenue", selectionMode: "all",
      children: recipe.children.map(child => ({ ...child, name: child.key, description: null, existingNodeId: null })),
      requiredKeys: recipe.children.map(child => child.key), formula: recipe.formula, recipeId: recipe.id, limitations: [] }] };
    expect(materializeKpiSuggestion(output, context, { proposalId: "contract_qa", requestId: "contract_request", now: "2026-10-20T00:00:00.000Z",
      execution: { mode: "api", backendId: "openai_compatible", modelId: "selected", bindingVersion: "v1", credentialEpoch: "qa" } })?.groups).toHaveLength(1);
  });
  it("resolves rate periods without adding a divisor to period totals", async () => {
    const total = buildKpiSuggestionTaskInput(await sales());
    const rate = buildKpiSuggestionTaskInput(await sales("USD/month"));
    expect(total.responseContract.recipes[0]!.children[0]!.unit).toBe("units");
    expect(rate.responseContract.recipes[0]!.children[0]!.unit).toBe("units/month");
  });
  it("rebuilds historical task envelopes and rejects weakened caller-owned requirements", async () => {
    const input = buildKpiSuggestionTaskInput(await sales());
    const { responseContract, ...historical } = input;
    expect(validateKpiSuggestionTaskInput(historical).responseContract).toEqual(responseContract);
    expect(() => validateKpiSuggestionTaskInput({ ...input, responseContract: { ...responseContract, formula: {} } })).toThrow(/host validator/);
    const foreign = buildKpiSuggestionTaskInput(await sales("USD/month"));
    expect(() => validateKpiSuggestionTaskInput({ ...input, responseContract: foreign.responseContract })).toThrow(/host validator/);
  });
});
