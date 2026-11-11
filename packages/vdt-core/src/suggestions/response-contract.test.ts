import { describe, expect, it } from "vitest";
import { buildKpiSuggestionContext } from "./identity";
import { createSmartKpiMeasuredFixture } from "./fixtures";
import { createIncomingGraphFixture, fixtureContext } from "./incoming-contract.fixtures";
import { buildKpiSuggestionTaskInput, kpiSuggestionApiResponseSchema, kpiSuggestionPromptInput, materializeKpiSuggestion, validateKpiSuggestionTaskInput, type KpiSuggestionModelOutput } from "./model-output";
import { KPI_SUGGESTION_LIMITS, type KpiSuggestionContext } from "./types";

const host = { proposalId: "contract_qa", requestId: "contract_request", now: "2026-10-20T00:00:00.000Z",
  execution: { mode: "api" as const, backendId: "openai_compatible", modelId: "selected", bindingVersion: "v1", credentialEpoch: "qa" } };

async function sales(unit = "USD") {
  const project = createSmartKpiMeasuredFixture(10000);
  Object.assign(project.graph.nodes[0]!, { name: "Net product revenue", unit });
  return buildKpiSuggestionContext(project, { workspaceId: "contract_qa", vdtId: null, targetNodeId: project.rootNodeId, period: { key: "2026-10", grain: "month" } });
}

function apiGroups(context: KpiSuggestionContext) {
  const schema = kpiSuggestionApiResponseSchema(buildKpiSuggestionTaskInput(context).responseContract);
  type GroupSchema = {
    properties: { recipeId: { type: string; const?: string }; children: { items: unknown }; requiredKeys: { items: unknown } }
  };
  const { items } = schema.properties.groups as { items: GroupSchema | { anyOf: GroupSchema[] } };
  return ("anyOf" in items ? items.anyOf : [items]).map(group => group.properties);
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
    expect(materializeKpiSuggestion(output, context, host)?.groups).toHaveLength(1);
  });
  it("excludes the ancestor's sales recipe when its refund input is the selected target", async () => {
    const project = createSmartKpiMeasuredFixture();
    delete project.businessContext;
    const root = project.graph.nodes[0]!;
    Object.assign(root, { name: "Чистая выручка", unit: "USD", formula: "unit_price * (units * (1 - discount_pct / 100)) - returns_amount" });
    for (const [id, name, unit] of [
      ["units", "Quantity Sold", "items"], ["unit_price", "Price per item", "USD/item"],
      ["discount_pct", "Discount percent", "%"], ["returns_amount", "Returns amount", "USD"]
    ] as const) {
      project.graph.nodes.push({ ...root, id, name, type: "input", unit, formula: undefined });
      project.graph.edges.push({ id: `edge_${id}`, sourceNodeId: root.id, targetNodeId: id, relation: "formula_dependency", aiGenerated: false });
    }
    const contextFor = (targetNodeId: string) => buildKpiSuggestionContext(project, { workspaceId: "contract_qa", vdtId: null, targetNodeId, period: { key: "2026-10", grain: "month" } });
    const refund = project.graph.nodes.find(node => node.id === "returns_amount")!;
    const context = await contextFor(refund.id);
    const recipeId = "revenue.quantity_price_net";
    const recipe = buildKpiSuggestionTaskInput(await sales()).responseContract.recipes.find(candidate => candidate.id === recipeId)!;
    for (const label of ["Returns", "Returns amount", "returns_after_discount_usd", "Возвраты", "Returns in USD", "Returns amount in USD", "Возвраты в USD"]) {
      refund.name = label;
      const contract = buildKpiSuggestionTaskInput(await contextFor(refund.id)).responseContract;
      expect(contract.recipes).toEqual([]);
      expect(contract.excludedAncestorRecipes).toEqual([{ recipeId, targetNodeId: refund.id, repeatedTargetLabel: "Refunds", unit: "USD" }]);
      expect(contract.references.openAiCustomFactorKeys).toEqual(["p_1", "p_2"]);
    }
    for (const label of ["Returns by channel in USD", "Affiliate channel net revenue in USD"]) {
      refund.name = label;
      const contract = buildKpiSuggestionTaskInput(await contextFor(refund.id)).responseContract;
      expect(contract.excludedAncestorRecipes).toEqual([]);
      expect(contract.references.openAiCustomFactorKeys).toBeUndefined();
    }
    refund.name = "Returns in USD";
    expect(apiGroups(context).map(group => group.recipeId)).toEqual([{ type: "null" }]);
    const targetPlan = (rationale: string) => ({ version: 1 as const, goal: "Preserve the selected target definition.", nodes: [{
      nodeId: context.targetNodeId, parentNodeId: root.id, kind: "input" as const, rationale
    }] });
    for (const [description, rationale] of [
      ["Total returns value after discounts", "Total returns value after discounts."],
      ["Returns amount after discount", "Returns amount after discount"],
      ["Total returns in USD (after discounts)", "Total returns in USD (already discounted)."],
      ["Total returns already discounted in USD", "Total returns after discounts (in USD)"]
    ] as const) {
      const saved = { ...context, target: { ...context.target, description }, decompositionPlan: targetPlan(rationale) };
      const task = buildKpiSuggestionTaskInput(saved);
      expect(task.context.decompositionPlan).toEqual(saved.decompositionPlan);
      expect(task.responseContract.references.openAiCustomFactorKeys).toEqual(["p_1", "p_2"]);
      expect(kpiSuggestionPromptInput(task).context).toEqual({ targetNodeId: context.targetNodeId, target: saved.target, period: context.period });
    }
    const { unit: _unit, ...unitlessChild } = context.target;
    const authoredDescription = { ...context, target: { ...context.target,
      description: "Merchandise refunds + service allowances" } };
    const documentedContexts: KpiSuggestionContext[] = [
      { ...context, children: [{ ...unitlessChild, id: "recorded_cause", name: "Recorded adjustment cause" }] },
      { ...context, omissions: { ...context.omissions, directChildren: 1 } },
      { ...context, omissions: { ...context.omissions, planNodes: 1 } },
      { ...context, target: { ...context.target, formula: "retained_amount" } },
      { ...context, target: { ...context.target, type: "calculated" } },
      { ...context, target: { ...context.target, assumptions: ["The documented source separates returned items and service allowances."] } },
      authoredDescription,
      { ...context, target: { ...context.target, description: "Returns/allowances by channel" } },
      { ...context, target: { ...context.target, description: "Returns in USD by channel (after discounts)" } },
      { ...context, business: { ...context.business, context: "Only documented disjoint adjustment groups belong to this target." } },
      { ...context, business: { ...context.business, description: "This target's authored formula uses separately measured adjustments." } },
      { ...context, decompositionPlan: targetPlan("Sum merchandise refunds and service allowances in USD (already discounted).") },
      { ...context, decompositionPlan: { ...targetPlan("Returns amount after discount"), nodes: [
        ...targetPlan("Returns amount after discount").nodes,
        { nodeId: "documented_refund_source", parentNodeId: context.targetNodeId, kind: "input" }
      ] } }
    ];
    for (const documented of documentedContexts) {
      const task = buildKpiSuggestionTaskInput(documented);
      expect(kpiSuggestionPromptInput(task).context).toEqual(documented);
      expect(task.responseContract.references).not.toHaveProperty("openAiCustomFactorKeys");
      expect(apiGroups(documented)).toHaveLength(1);
    }
    const repeated: KpiSuggestionModelOutput["groups"][number] = {
      id: "returns_layer", title: "Returns amount decomposition", selectionMode: "all", recipeId: null,
      requiredKeys: ["returns_amount", "refunds_pending"], formula: "returns_amount - refunds_pending", limitations: [],
      children: [
        { key: "returns_amount", conceptKey: "returns_amount", name: "Returns amount (USD)", unit: "USD",
          description: "Gross returns/allowances before adjustments", existingNodeId: null },
        { key: "refunds_pending", conceptKey: "refunds_pending", name: "Refunds pending (USD)", unit: "USD",
          description: "Expected refunds to offset gross returns", existingNodeId: null }
      ]
    };
    const replayOutput: KpiSuggestionModelOutput = { status: "ready", rationale: "Target-specific decomposition.", limitations: [], groups: [repeated] };
    expect(() => materializeKpiSuggestion(replayOutput, context, host)).toThrow(/target KPI ID/);
    const renamed = { ...repeated, formula: "p_1 - p_2", requiredKeys: ["p_1", "p_2"], children: [
      { ...repeated.children[0]!, key: "p_1", conceptKey: "renamed_target" }, { ...repeated.children[1]!, key: "p_2" }
    ] };
    expect(() => materializeKpiSuggestion({ ...replayOutput, groups: [renamed] }, context, host)).toThrow(/operand in an ancestor recipe/);
    const distinct = { ...renamed, formula: "p_1 + p_2", children: [
      { ...renamed.children[0]!, conceptKey: "merchandise_refunds", name: "Recorded merchandise return amounts", description: "Merchandise returns after discounts." },
      { ...renamed.children[1]!, conceptKey: "service_allowances", name: "Recorded service allowance amounts", description: "Service allowances after discounts." }
    ] };
    expect(materializeKpiSuggestion({ ...replayOutput, groups: [distinct] }, context, host)?.groups[0]?.formula).toBe("p_1 + p_2");
    expect(materializeKpiSuggestion({ ...replayOutput, groups: [distinct] }, authoredDescription, host)?.groups[0]?.formula).toBe("p_1 + p_2");
    expect(materializeKpiSuggestion({ status: "empty", rationale: "The target population is ambiguous.", limitations: [], groups: [] }, context, host)).toBeUndefined();
    const names = ["Units sold", "Average selling price", "Discount rate", "Refunds"];
    const replay: KpiSuggestionModelOutput["groups"][number] = {
      id: "net_revenue", title: "Net revenue", selectionMode: "all", recipeId, formula: recipe.formula, limitations: [],
      requiredKeys: recipe.children.map(child => child.key),
      children: recipe.children.map((child, index) => ({ ...child, name: names[index]!, description: null, existingNodeId: null }))
    };
    const aliases = ["sale_count", "mean_ticket", "discount_fraction", "returned_value"];
    for (const group of [
      replay,
      { ...replay, recipeId: null },
      { ...replay, recipeId: null, formula: "sale_count * mean_ticket * (1 - discount_fraction) - returned_value",
        requiredKeys: aliases, children: replay.children.map((child, index) => ({ ...child, key: aliases[index]!, conceptKey: aliases[index]! })) }
    ]) {
      const output: KpiSuggestionModelOutput = { status: "ready", rationale: "Use the standard revenue definition.", limitations: [], groups: [group] };
      expect(() => materializeKpiSuggestion(output, context, host)).toThrow(/operand in an ancestor recipe/);
    }
    const output: KpiSuggestionModelOutput = { status: "ready", rationale: "Use actual refunds on the same returned items.", limitations: [], groups: [{
      id: "refund_measurement", title: "Returned items and amount", selectionMode: "all", recipeId: null,
      formula: "returned_items * mean_refund", requiredKeys: ["returned_items", "mean_refund"], limitations: [],
      children: [
        { key: "returned_items", conceptKey: "returned_items", name: "Refunded item count", unit: "item", description: null, existingNodeId: null },
        { key: "mean_refund", conceptKey: "mean_refund", name: "Average net refund per returned item", unit: "USD/item", description: null, existingNodeId: null }
      ]
    }] };
    expect(materializeKpiSuggestion(output, context, host)?.groups[0]?.formula).toBe(output.groups[0]?.formula);
    const withDirectChild = structuredClone(project);
    withDirectChild.graph.nodes.push({ ...refund, id: "stored_refund_count", name: "Recorded refund count", unit: "item" });
    withDirectChild.graph.edges.push({ id: "edge_retained_refund_count", sourceNodeId: refund.id, targetNodeId: "stored_refund_count",
      relation: "formula_dependency", aiGenerated: false });
    const childContext = await buildKpiSuggestionContext(withDirectChild, { workspaceId: "contract_qa", vdtId: null,
      targetNodeId: refund.id, period: { key: "2026-10", grain: "month" } });
    expect(buildKpiSuggestionTaskInput(childContext).responseContract.references).not.toHaveProperty("openAiCustomFactorKeys");
    expect(kpiSuggestionPromptInput(buildKpiSuggestionTaskInput(childContext)).context).toEqual(childContext);
    expect(apiGroups(childContext)[0]?.children.items).toMatchObject({ properties: { existingNodeId: { anyOf: [
      { type: "string", enum: ["stored_refund_count"] }, { type: "null" }
    ] } } });
    const reuse = output.groups[0]!;
    const reuseOutput = { ...output, groups: [{ ...reuse, children: [
      { ...reuse.children[0]!, existingNodeId: "stored_refund_count" }, reuse.children[1]!
    ] }] };
    expect(materializeKpiSuggestion(reuseOutput, childContext, host)?.groups[0]?.children[0]?.existingNodeId).toBe("stored_refund_count");
    project.graph.nodes.push({ ...root, id: "partner_revenue", name: "Partner net revenue", type: "input", formula: undefined });
    project.graph.edges.push({ id: "edge_partner_revenue", sourceNodeId: root.id, targetNodeId: "partner_revenue", relation: "contextual_influence", aiGenerated: false });
    const partner = await contextFor("partner_revenue");
    expect(buildKpiSuggestionTaskInput(partner).responseContract.recipes.map(candidate => candidate.id)).toContain(recipeId);
    root.name = "Marketplace retained net revenue";
    root.description = "Recognized net sales less the affiliate channel's independently recorded net revenue share.";
    root.formula = root.formula!.replace(refund.id, "affiliate_net_revenue");
    project.graph.edges.find(edge => edge.targetNodeId === refund.id)!.targetNodeId = "affiliate_net_revenue";
    refund.id = "affiliate_net_revenue";
    refund.name = "Affiliate channel net revenue";
    refund.description = "Independently measured net revenue from affiliate orders with a separate cohort, price, discounts and refunds.";
    const affiliate = await contextFor(refund.id);
    const affiliateContract = buildKpiSuggestionTaskInput(affiliate).responseContract;
    expect(affiliateContract.recipes.map(candidate => candidate.id)).toContain(recipeId);
    expect(affiliateContract.excludedAncestorRecipes).toEqual([]);
    expect(kpiSuggestionPromptInput(buildKpiSuggestionTaskInput(affiliate)).context).toEqual(affiliate);
    const affiliateOutput: KpiSuggestionModelOutput = {
      status: "ready", rationale: refund.description, limitations: [], groups: [{
        ...replay,
        children: replay.children.map(child => ({ ...child, name: `Affiliate ${child.name.toLowerCase()}` }))
      }]
    };
    expect(materializeKpiSuggestion(affiliateOutput, affiliate, host)?.groups[0]?.formula).toBe(replay.formula);
  });
  it("preserves a revenue recipe and a disjoint subgroup split under an unlike ancestor", async () => {
    const project = createSmartKpiMeasuredFixture();
    const root = project.graph.nodes[0]!;
    Object.assign(root, { name: "Total net revenue", unit: "USD", formula: "online_revenue + store_revenue" });
    for (const [id, name] of [["online_revenue", "Online net revenue"], ["store_revenue", "Store net revenue"]] as const) {
      project.graph.nodes.push({ ...root, id, name, type: "input", formula: undefined });
      project.graph.edges.push({ id: `edge_${id}`, sourceNodeId: root.id, targetNodeId: id, relation: "additive_component", aiGenerated: false });
    }
    const context = await buildKpiSuggestionContext(project, { workspaceId: "contract_qa", vdtId: null, targetNodeId: "online_revenue", period: { key: "2026-10", grain: "month" } });
    expect(buildKpiSuggestionTaskInput(context).responseContract.recipes.map(recipe => recipe.id)).toContain("revenue.quantity_price_net");
    const output: KpiSuggestionModelOutput = { status: "ready", rationale: "Disjoint channel totals.", limitations: [], groups: [{
      id: "online_channels", title: "Online channels", selectionMode: "all", recipeId: null,
      formula: "web + mobile_app", requiredKeys: ["web", "mobile_app"], limitations: [],
      children: [
        { key: "web", conceptKey: "web", name: "Web net revenue", unit: "USD", description: null, existingNodeId: null },
        { key: "mobile_app", conceptKey: "mobile_app", name: "Mobile app net revenue", unit: "USD", description: null, existingNodeId: null }
      ]
    }] };
    expect(materializeKpiSuggestion(output, context, host)?.groups[0]?.formula).toBe(output.groups[0]?.formula);
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
