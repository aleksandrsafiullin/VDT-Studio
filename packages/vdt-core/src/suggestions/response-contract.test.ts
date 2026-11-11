import { describe, expect, it } from "vitest";
import { buildKpiSuggestionContext } from "./identity";
import { createSmartKpiMeasuredFixture } from "./fixtures";
import { buildKpiSuggestionTaskInput, materializeKpiSuggestion, validateKpiSuggestionTaskInput } from "./model-output";
import { KPI_SUGGESTION_LIMITS } from "./types";

async function sales(unit = "USD") {
  const project = createSmartKpiMeasuredFixture(10000);
  Object.assign(project.graph.nodes[0]!, { name: "Net product revenue", unit });
  return buildKpiSuggestionContext(project, { workspaceId: "contract_qa", vdtId: null, targetNodeId: project.rootNodeId, period: { key: "2026-10", grain: "month" } });
}

describe("Smart model response requirements", () => {
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
