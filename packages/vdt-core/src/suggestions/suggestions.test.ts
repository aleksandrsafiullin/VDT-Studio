import { describe, expect, it } from "vitest";
import { calculateGraph } from "../formula/calculate";
import { calculateScenarioGraph } from "../scenario/scenario";
import { decompositionPlanErrors, inspectDecompositionHierarchy } from "../graph/decomposition";
import { exportProjectJson, importProjectJson } from "../export/export";
import { cloneProject } from "../utils";
import type { VdtProject } from "../types";
import { compileKpiSuggestion } from "./compile";
import { createSmartKpiMeasuredFixture, SMART_KPI_FIXTURE_TIME as now } from "./fixtures";
import { buildKpiSuggestionContext, fingerprintKpiProject, kpiContentHash, kpiSuggestionCacheKey, smartMutationBlockReason } from "./identity";
import { kpiSuggestionEnvelopeBytes } from "./model-output";
import { buildRecipeKpiSuggestions, KPI_SUGGESTION_RECIPES as catalog, validateKpiSuggestionForContext } from "./recipes";
import type { KpiSuggestionSet, KpiSuggestionContext, KpiRecipeBinding, KpiSuggestionExecutionIdentity, KpiSuggestionSelection } from "./types";
import { kpiFormulaAvailability, smartUnitDimension, verifyKpiRecipeGroup } from "./units";
import { validateKpiSuggestionContext, validateKpiSuggestionSet, resolveKpiSuggestionSelection } from "./validation";

const host = { operationId: "smart_fixture_operation", now };
const contextFor = (project: VdtProject, targetNodeId = project.rootNodeId) => buildKpiSuggestionContext(project, {
  workspaceId: "workspace_fixture", vdtId: "stored_fixture", targetNodeId, period: { key: "2026-10", grain: "month" }
});
function bindingFor(context: KpiSuggestionContext, id: string): KpiRecipeBinding {
  const recipe = catalog.recipes.find(r => r.id === id)!;
  return { id: "decision_fixture", recipeId: id, recipeHash: recipe.recipeHash, skillHash: recipe.skillHash, targetRole: recipe.targetRole,
    contextHash: context.contextHash, basis: "selected_skill", sourceRef: "explicit_skill_selection_fixture", rationale: "Explicit QA selection for this metric role and period." };
}
async function prepared(project = createSmartKpiMeasuredFixture(), recipeId = "production.time_rate", refs?: Record<string, string>) {
  const context = await contextFor(project);
  const proposal = buildRecipeKpiSuggestions(context, [{ binding: bindingFor(context, recipeId), ...(refs ? { existingChildren: refs } : {}) }], { now, proposalId: "proposal_fixture" })!;
  return { context, proposal, project };
}
const selectionFor = (proposal: KpiSuggestionSet, mode: KpiSuggestionSelection["mode"] = "contextual"): KpiSuggestionSelection => ({
  groupId: proposal.groups[0]!.id, childKeys: proposal.groups[0]!.children.map(c => c.key), mode
});
function addNode(project: VdtProject, id: string, unit = "h/month", name = id) {
  project.graph.nodes.push({ id, name, unit, type: "input", status: "accepted", baselineValue: 2, aiGenerated: false, createdAt: now, updatedAt: now });
  project.graph.edges.push({ id: `edge_${id}`, sourceNodeId: project.rootNodeId, targetNodeId: id, relation: "contextual_influence", aiGenerated: false });
}
function plannedFixture() {
  const p = createSmartKpiMeasuredFixture(0), measured = p.graph.nodes[0]!;
  measured.type = "data_mapped";
  p.graph.nodes.push({ ...measured, id: "side_output", name: "Separate measured output", type: "input", baselineValue: 5 });
  p.rootNodeId = "plant_output";
  p.graph.nodes.unshift({ id: p.rootNodeId, name: "Total measured plant output", unit: "t/month", type: "root_kpi", status: "accepted", formula: "measured_output + side_output",
    decompositionPlan: { version: 1, goal: "QA plant outputs with independent source lineages.", nodes: [
      { nodeId: "measured_output", parentNodeId: p.rootNodeId, kind: "input" }, { nodeId: "side_output", parentNodeId: p.rootNodeId, kind: "input" }
    ] }, aiGenerated: false, createdAt: now, updatedAt: now });
  p.graph.edges = ["measured_output", "side_output"].map(id => ({ id: `edge_${id}`, sourceNodeId: p.rootNodeId, targetNodeId: id, relation: "additive_component", aiGenerated: false }));
  return p;
}
async function preparedPlanned(p: VdtProject, targetNodeId: string) {
  const context = await contextFor(p, targetNodeId);
  const proposal = buildRecipeKpiSuggestions(context, [{ binding: bindingFor(context, "production.time_rate") }], { now, proposalId: "planned_proposal" })!;
  return { context, proposal };
}

describe("Smart context and preparation identity", () => {
  it("bounds high-degree/DAG excerpts, marks omissions, and traverses a cycle safely", async () => {
    const project = createSmartKpiMeasuredFixture();
    for (let i = 0; i < 220; i++) addNode(project, `node_${i}`);
    project.graph.edges.push({ id: "shared_dag_edge", sourceNodeId: "node_0", targetNodeId: "node_219", relation: "contextual_influence", aiGenerated: false });
    const context = await contextFor(project);
    expect(context.children.length).toBeGreaterThan(0);
    expect(context.children.length).toBeLessThanOrEqual(12);
    expect(context.children.length + context.omissions.directChildren).toBe(220);
    expect(kpiSuggestionEnvelopeBytes(context)).toBeLessThanOrEqual(24 * 1024);
    expect(JSON.stringify(context).length).toBeLessThan(24 * 1024);
    project.graph.edges.push({ id: "cycle_edge", sourceNodeId: "node_219", targetNodeId: project.rootNodeId, relation: "contextual_influence", aiGenerated: false });
    expect((await contextFor(project)).omissions.cyclic).toBe(true);
  });
  it("ignores numeric/layout/scenario motion but invalidates knownness, distant/shared semantics and mapping", async () => {
    const p = createSmartKpiMeasuredFixture(), original = await fingerprintKpiProject(p);
    p.graph.nodes[0]!.baselineValue = 0; p.graph.nodes[0]!.position = { x: 300, y: 42 }; p.updatedAt = "2026-10-19T01:00:00.000Z";
    p.scenarios[0]!.overrides[0]!.value = 200;
    expect(await fingerprintKpiProject(p)).toBe(original);
    p.graph.nodes[0]!.dataMapping!.field = "different_output"; expect(await fingerprintKpiProject(p)).not.toBe(original);
    const changed = await fingerprintKpiProject(p); delete p.graph.nodes[0]!.baselineValue;
    expect(await fingerprintKpiProject(p)).not.toBe(changed);
    const graph = createSmartKpiMeasuredFixture(); addNode(graph, "distant"); const first = await fingerprintKpiProject(graph);
    graph.graph.nodes[1]!.formula = "measured_output"; expect(await fingerprintKpiProject(graph)).not.toBe(first);
  });
  it("binds business/period/target and uses stable execution identity across re-admission", async () => {
    const project = createSmartKpiMeasuredFixture(), context = await contextFor(project);
    const execution: KpiSuggestionExecutionIdentity = { mode: "api", backendId: "openai", modelId: "test-model", bindingVersion: "adapter-v1", credentialEpoch: "credential-2" };
    const key = kpiSuggestionCacheKey(context, catalog.version, execution);
    expect(kpiSuggestionCacheKey(context, catalog.version, { ...execution, admissionId: "one_use_new", sessionId: "new_session", expectedHead: "new_head" } as KpiSuggestionExecutionIdentity)).toBe(key);
    for (const patch of [{ modelId: "other" }, { backendId: "other" }, { bindingVersion: "v2" }, { credentialEpoch: "credential-3" }])
      expect(kpiSuggestionCacheKey(context, catalog.version, { ...execution, ...patch })).not.toBe(key);
    const otherPeriod = await buildKpiSuggestionContext(project, { workspaceId: context.workspaceId, vdtId: context.vdtId, targetNodeId: context.targetNodeId, period: { key: "2026-11", grain: "month" } });
    expect(otherPeriod.contextHash).not.toBe(context.contextHash);
    project.businessContext = "A different production boundary"; expect((await contextFor(project)).contextHash).not.toBe(context.contextHash);
  });
  it("has separate exact-content identity and rejects unresolved ordinary or Smart commits before another mutation", async () => {
    const p = createSmartKpiMeasuredFixture(), first = await kpiContentHash(p), semantic = await fingerprintKpiProject(p);
    p.scenarios[0]!.overrides[0]!.value = 0;
    expect(await kpiContentHash(p)).not.toBe(first); expect(await fingerprintKpiProject(p)).toBe(semantic);
    expect(smartMutationBlockReason({ pendingRevisionCommit: true, pendingSmartCommit: false, mutatingAgent: false })).toBe("reconcile_pending_commit");
    expect(smartMutationBlockReason({ pendingRevisionCommit: false, pendingSmartCommit: true, mutatingAgent: true })).toBe("reconcile_pending_commit");
    expect(smartMutationBlockReason({ pendingRevisionCommit: false, pendingSmartCommit: false, mutatingAgent: true })).toBe("mutating_agent_active");
  });
  it("rejects unknown context fields, invented summaries, oversized contexts and invalid periods", async () => {
    const { context } = await prepared();
    expect(() => validateKpiSuggestionContext({ ...context, rawRows: [1] })).toThrow();
    expect(() => validateKpiSuggestionContext({ ...context, target: { ...context.target, baselineValue: 10 } })).toThrow();
    expect(() => validateKpiSuggestionContext({ ...context, period: { ...context.period, grain: "hour" } })).toThrow();
    expect(() => validateKpiSuggestionContext({ ...context, business: { ...context.business, context: "x".repeat(30_000) } })).toThrow();
  });
  it("keeps nearest ancestors first and multiple-parent DAG relationships, not only an ancestor bag", async () => {
    const p = createSmartKpiMeasuredFixture(); addNode(p, "a"); addNode(p, "b"); addNode(p, "leaf");
    p.graph.edges.find(e => e.targetNodeId === "b")!.sourceNodeId = "a";
    p.graph.edges.find(e => e.targetNodeId === "leaf")!.sourceNodeId = "b";
    const first = await contextFor(p, "leaf");
    const q = cloneProject(p);
    q.graph.edges.find(e => e.targetNodeId === "a")!.sourceNodeId = "b";
    q.graph.edges.find(e => e.targetNodeId === "b")!.sourceNodeId = q.rootNodeId;
    q.graph.edges.find(e => e.targetNodeId === "leaf")!.sourceNodeId = "a";
    const second = await contextFor(q, "leaf");
    expect(first.ancestors.map(n => n.id).sort()).toEqual(second.ancestors.map(n => n.id).sort());
    expect(first.ancestors[0]!.id).toBe("b");
    expect(second.ancestors[0]!.id).toBe("a");
    expect(first.parentRelationships).not.toEqual(second.parentRelationships);
    expect(first.contextHash).not.toBe(second.contextHash);
    q.graph.edges.push({ id: "second_parent", sourceNodeId: "b", targetNodeId: "leaf", relation: "contextual_influence", aiGenerated: false });
    const dag = await contextFor(q, "leaf");
    expect(dag.parentRelationships.filter(e => e.childNodeId === "leaf").map(e => e.parentNodeId)).toEqual(["a", "b"]);
    expect(dag.omissions.relationships).toBe(0);
  });
});

describe("Smart strict proposals and coherent selection", () => {
  it("requires explicit applicable canonical binding; names and generic fallback never select a recipe", async () => {
    const { context, proposal } = await prepared();
    expect(buildRecipeKpiSuggestions({ ...context, target: { ...context.target, name: "Revenue" } }, [], { now, proposalId: "none" })).toBeUndefined();
    const binding = bindingFor(context, "production.time_rate");
    for (const patch of [{ contextHash: `sha256:${"0".repeat(64)}` }, { targetRole: "unrelated" }, { skillHash: `sha256:${"1".repeat(64)}` }, { recipeId: "generic_fallback" }])
      expect(buildRecipeKpiSuggestions(context, [{ binding: { ...binding, ...patch } }], { now, proposalId: "none" })).toBeUndefined();
    expect(validateKpiSuggestionSet(proposal, Date.parse(now))).toBe(proposal);
    expect(proposal.groups[0]!.children.every(c => !("baselineValue" in c))).toBe(true);
  });
  it("rejects missing/unknown authority, numeric baseline, child formula, deeper parent and oversized groups", async () => {
    const { proposal } = await prepared();
    for (const extra of [{ actor: "model" }, { value: 10 }, { baselineValue: 0 }, { formula: "1" }, { parentNodeId: "new_child" }]) {
      const forged = cloneProject(proposal); Object.assign(forged.groups[0]!.children[0]!, extra);
      expect(() => validateKpiSuggestionSet(forged)).toThrow();
    }
    expect(() => validateKpiSuggestionSet({ ...proposal, origin: { ...proposal.origin, apiKey: "secret" } })).toThrow();
    const missing = cloneProject(proposal) as Partial<KpiSuggestionSet>; delete missing.origin;
    expect(() => validateKpiSuggestionSet(missing)).toThrow();
    expect(() => validateKpiSuggestionSet({ ...proposal, groups: Array.from({ length: 4 }, () => proposal.groups[0]) })).toThrow();
  });
  it("keeps mutually exclusive alternatives and required factors coherent", async () => {
    const { proposal } = await prepared();
    const second = { id: "by_channel", title: "Revenue context by channel", selectionMode: "independent" as const,
      requiredKeys: [], children: [{ key: "channel", conceptKey: "confirmed_channel", name: "User-confirmed channel", unit: "USD/month" }], limitations: ["Context only; no claim of complete revenue coverage."] };
    proposal.groups.push(second); validateKpiSuggestionSet(proposal);
    expect(() => resolveKpiSuggestionSelection(proposal, { ...selectionFor(proposal), childKeys: ["working_time"] })).toThrow(/complete/i);
    expect(() => resolveKpiSuggestionSelection(proposal, { ...selectionFor(proposal), childKeys: ["working_time", "channel"] })).toThrow();
    expect(() => resolveKpiSuggestionSelection(proposal, { groupId: second.id, childKeys: ["channel"], mode: "formula" })).toThrow();
    expect(resolveKpiSuggestionSelection(proposal, { groupId: second.id, childKeys: ["channel"], mode: "contextual" })).toBe(second);
  });
  it("rejects hidden numeric assumptions, dropped factors, zero masking and expired artifacts", async () => {
    const { proposal } = await prepared();
    for (const formula of ["working_time * 0", "working_time * productivity * (1 - 1)", "working_time * 100", "working_time", "1"]) {
      const forged = cloneProject(proposal); forged.groups[0]!.formula = formula;
      expect(() => validateKpiSuggestionSet(forged)).toThrow();
    }
    expect(() => validateKpiSuggestionSet(proposal, Date.parse(now) + 8 * 24 * 60 * 60 * 1000)).toThrow(/expired/i);
  });
  it("revalidates cached canonical provenance even when applying contextual-only children", async () => {
    const { context, proposal } = await prepared();
    const corrupt = cloneProject(proposal); corrupt.groups[0]!.recipeBinding!.recipeHash = `sha256:${"0".repeat(64)}`;
    expect(() => validateKpiSuggestionForContext(corrupt, context)).toThrow(/provenance/i);
    const unbound = cloneProject(proposal); delete unbound.groups[0]!.recipeBinding;
    expect(() => validateKpiSuggestionForContext(unbound, context)).toThrow(/binding/i);
  });
});

describe("audited narrow Smart unit/period contracts", () => {
  it.each([
    ["production.time_rate", "t/month", ["h/month", "t/h"]],
    ["production.time_losses", "hours/month", ["hours/month", "hours/month", "hours/month"]],
    ["production.rate_yield", "tonnes/hour", ["tonnes/hour", "fraction"]],
    ["revenue.quantity_price_net", "USD/month", ["units/month", "USD/unit", "fraction", "USD/month"]]
  ])("verifies %s with explicit period and no conversions", async (recipeId, unit, expectedUnits) => {
    const project = createSmartKpiMeasuredFixture(); project.graph.nodes[0]!.unit = unit;
    const { context, proposal } = await prepared(project, recipeId as string);
    const group = proposal.groups[0]!;
    expect(group.children.map(c => c.unit)).toEqual(expectedUnits);
    expect(kpiFormulaAvailability(catalog.recipes.find(r => r.id === recipeId), context, group)).toEqual({ available: true });
  });
  it("refuses incompatible time, currency, percent-scale, mass conversions and model-certified formulas", async () => {
    const { context, proposal } = await prepared(); const recipe = catalog.recipes.find(r => r.id === "production.time_rate")!;
    for (const unit of ["h/year", "months", "USD/h", "%", "kt/h"]) {
      const group = cloneProject(proposal.groups[0]!); group.children[0]!.unit = unit;
      expect(() => verifyKpiRecipeGroup(recipe, context, group)).toThrow();
    }
    const revenueProject = createSmartKpiMeasuredFixture(); revenueProject.graph.nodes[0]!.unit = "USD/month";
    const revenue = await prepared(revenueProject, "revenue.quantity_price_net"), revenueGroup = revenue.proposal.groups[0]!;
    revenueGroup.children[1]!.unit = "EUR/unit";
    expect(() => verifyKpiRecipeGroup(catalog.recipes.find(r => r.id === "revenue.quantity_price_net")!, revenue.context, revenueGroup)).toThrow();
    revenueGroup.children[1]!.unit = "USD/unit"; revenueGroup.children[2]!.unit = "%";
    expect(() => verifyKpiRecipeGroup(catalog.recipes.find(r => r.id === "revenue.quantity_price_net")!, revenue.context, revenueGroup)).toThrow();
    expect(() => smartUnitDimension("h/month", { ...context, period: { key: "2026", grain: "year" } })).toThrow();
    const custom = cloneProject(proposal.groups[0]!); delete custom.recipeBinding;
    expect(kpiFormulaAvailability(recipe, context, custom).available).toBe(false);
  });
});

describe("Smart full-project one-layer compiler", () => {
  it("extends the real plan below a measured planned input, preserving numeric/scenario output and all prior entries", async () => {
    const p = plannedFixture(), originalPlan = cloneProject(p.graph.nodes[0]!.decompositionPlan!), { context, proposal } = await preparedPlanned(p, "measured_output");
    expect(inspectDecompositionHierarchy(p).valid).toBe(true);
    const result = await compileKpiSuggestion(p, context, proposal, selectionFor(proposal), host);
    const plan = result.preview.graph.nodes[0]!.decompositionPlan!;
    expect(plan.nodes.slice(0, originalPlan.nodes.length)).toEqual(originalPlan.nodes);
    expect(plan.nodes.slice(originalPlan.nodes.length).every(n => n.kind === "context" && n.parentNodeId === "measured_output" && n.rationale)).toBe(true);
    expect(inspectDecompositionHierarchy(result.preview).valid).toBe(true);
    expect(result.outputPreview.map(p => [p.rootBefore, p.rootAfter])).toEqual([[5, 5], [155, 155]]);
    expect(result.newNodeIds).toHaveLength(2);
    const roundTrip = importProjectJson(exportProjectJson(result.preview));
    expect(inspectDecompositionHierarchy(roundTrip).valid).toBe(true);
    expect(calculateGraph(roundTrip).rootValue).toBe(5);
  });
  it("executes the next audited formula in a normal multi-branch plan without treating unrelated plan scope as truncation", async () => {
    const p = plannedFixture(), { context, proposal } = await preparedPlanned(p, "measured_output");
    expect(context.planScope).toMatchObject({ totalNodes: 2, excludedUnrelatedNodes: 1 });
    expect(Object.values(context.omissions).some(Boolean)).toBe(false);
    expect(kpiFormulaAvailability(catalog.recipes.find(r => r.id === "production.time_rate"), context, proposal.groups[0]!)).toEqual({ available: true });
    const result = await compileKpiSuggestion(p, context, proposal, selectionFor(proposal, "formula"), host);
    const plan = result.preview.graph.nodes[0]!.decompositionPlan!;
    expect(plan.nodes.find(n => n.nodeId === "measured_output")!.kind).toBe("calculated");
    expect(plan.nodes.find(n => n.nodeId === "side_output")).toEqual(p.graph.nodes[0]!.decompositionPlan!.nodes[1]);
    expect(plan.nodes.slice(2).every(n => n.kind === "input" && n.parentNodeId === "measured_output")).toBe(true);
    expect(inspectDecompositionHierarchy(result.preview).valid).toBe(true);
    expect(result.outputPreview[0]).toMatchObject({ parentBefore: 0, parentAfter: undefined, rootBefore: 5, rootAfter: undefined });
  });
  it("keeps root context one layer, warns for incremental user apply and still fails default full-construction grouping", async () => {
    const p = plannedFixture(), { context, proposal } = await preparedPlanned(p, p.rootNodeId);
    const result = await compileKpiSuggestion(p, context, proposal, selectionFor(proposal), host);
    expect(result.newNodeIds).toHaveLength(2);
    expect(result.changeSet.additions.every(a => a.parentNodeId === p.rootNodeId)).toBe(true);
    expect(result.constructionWarnings.join()).toContain("ROOT_CONTEXT_LEAVES_REQUIRE_GROUP");
    expect(inspectDecompositionHierarchy(result.preview, "incremental_user_apply").valid).toBe(true);
    expect(inspectDecompositionHierarchy(result.preview).errors.join()).toContain("ROOT_CONTEXT_LEAVES_REQUIRE_GROUP");
    const malformed = cloneProject(result.preview); const badEntry = malformed.graph.nodes[0]!.decompositionPlan!.nodes.find(n => n.nodeId === "measured_output")!;
    badEntry.kind = "context"; badEntry.rationale = "Attempt to disguise an active factor";
    expect(inspectDecompositionHierarchy(malformed, "incremental_user_apply").errors.join()).toContain("ACTIVE_FACTOR_MARKED_CONTEXT");
    const factorUnderInput = cloneProject(result.preview.graph.nodes[0]!.decompositionPlan!);
    factorUnderInput.nodes.push({ nodeId: "bad_factor", parentNodeId: "measured_output", kind: "input" });
    expect(decompositionPlanErrors(factorUnderInput, p.rootNodeId).join()).toContain("PLAN_INPUT_HAS_CHILDREN");
  });
  it.each([0, 100])("contextual adds preserve measured/mapped parent and actual scenario/root outputs at baseline %s", async value => {
    const { project, context, proposal } = await prepared(createSmartKpiMeasuredFixture(value));
    const result = await compileKpiSuggestion(project, context, proposal, selectionFor(proposal), host);
    expect(result.newNodeIds).toHaveLength(2); expect(result.changeSet.updates).toEqual([]);
    expect(result.preview.graph.nodes[0]).toEqual(project.graph.nodes[0]);
    expect(result.changeSet.additions.every(a => a.parentNodeId === project.rootNodeId && a.relation === "contextual_influence" && a.valueStatus === "unknown" && a.formula === undefined && a.value === undefined && a.baselineValue === undefined)).toBe(true);
    expect(calculateGraph(result.preview).rootValue).toBe(value);
    expect(calculateScenarioGraph(result.preview, result.preview.scenarios[0]!).rootValue).toBe(150);
    expect(result.outputPreview.map(p => [p.rootBefore, p.rootAfter])).toEqual([[value, value], [150, 150]]);
    expect(result.preview.graph.nodes.filter(n => result.newNodeIds.includes(n.id)).every(n => !n.formula && n.baselineValue === undefined)).toBe(true);
    expect(await compileKpiSuggestion(project, context, proposal, selectionFor(proposal), host)).toEqual(result);
  });
  it("contextual additions preserve an existing formula and its downstream/scenario calculation", async () => {
    const project = createSmartKpiMeasuredFixture();
    addNode(project, "site_hours", "h/month"); addNode(project, "site_rate", "t/h");
    project.graph.nodes[0]!.formula = "site_hours * site_rate";
    project.graph.nodes[1]!.baselineValue = 20; project.graph.nodes[2]!.baselineValue = 3;
    project.scenarios[0]!.overrides = [{ nodeId: "site_hours", value: 10 }];
    const { context, proposal } = await prepared(project);
    const result = await compileKpiSuggestion(project, context, proposal, selectionFor(proposal), host);
    expect(result.outputPreview.map(p => [p.parentBefore, p.parentAfter])).toEqual([[60, 60], [30, 30]]);
    expect(result.preview.graph.nodes[0]!.formula).toBe("site_hours * site_rate");
  });
  it("explicit formula use previews a measured zero becoming unknown, retains source metadata and adds no defaults", async () => {
    const { project, context, proposal } = await prepared(createSmartKpiMeasuredFixture(0));
    const result = await compileKpiSuggestion(project, context, proposal, selectionFor(proposal, "formula"), host);
    expect(result.calculation.before.rootValue).toBe(0); expect(result.calculation.after.rootValue).toBeUndefined();
    expect(result.preview.graph.nodes[0]!.dataMapping).toEqual(project.graph.nodes[0]!.dataMapping);
    expect(result.preview.graph.nodes[0]!.baselineValue).toBe(0);
    expect(result.outputPreview[0]).toMatchObject({ parentBefore: 0, parentAfter: undefined });
    expect(result.calculation.after.errors.every(e => e.type === "missing_value")).toBe(true);
    expect(result.changeSet.additions.every(a => a.parentNodeId === project.rootNodeId && a.formula === undefined)).toBe(true);
  });
  it("supports explicit complete direct-child reuse and previews an existing formula replacement numerically", async () => {
    const project = createSmartKpiMeasuredFixture(); addNode(project, "site_hours", "h/month"); addNode(project, "site_rate", "t/h");
    project.graph.nodes[1]!.baselineValue = 20; project.graph.nodes[2]!.baselineValue = 3;
    project.graph.nodes[0]!.formula = "site_hours * site_rate + site_hours * site_rate";
    project.scenarios[0]!.overrides = [{ nodeId: "site_hours", value: 10 }];
    const { context, proposal } = await prepared(project, "production.time_rate", { working_time: "site_hours", productivity: "site_rate" });
    const result = await compileKpiSuggestion(project, context, proposal, selectionFor(proposal, "formula"), host);
    expect(result.newNodeIds).toEqual([]);
    expect(result.outputPreview.map(p => [p.rootBefore, p.rootAfter])).toEqual([[120, 60], [60, 30]]);
    expect(result.changeSet.edgeChanges).toHaveLength(2);
  });
  it("rejects stale target/business/catalog and validates complete current project rather than omitted children", async () => {
    const { project, context, proposal } = await prepared();
    project.graph.nodes[0]!.unit = "USD/month";
    await expect(compileKpiSuggestion(project, context, proposal, selectionFor(proposal), host)).rejects.toMatchObject({ code: "STALE_PROPOSAL" });
    const crowded = createSmartKpiMeasuredFixture(); for (let i = 0; i < 20; i++) addNode(crowded, `old_${String(i).padStart(2, "0")}`);
    crowded.graph.nodes[20]!.name = "Effective working time";
    const ready = await prepared(crowded);
    expect(ready.context.children.some(c => c.name === "Effective working time")).toBe(false);
    await expect(compileKpiSuggestion(crowded, ready.context, ready.proposal, selectionFor(ready.proposal), host)).rejects.toMatchObject({ code: "DUPLICATE_CONCEPT" });
    await expect(compileKpiSuggestion(crowded, ready.context, ready.proposal, selectionFor(ready.proposal, "formula"), host)).rejects.toMatchObject({ code: "INCOMPLETE_CONTEXT" });
  });
  it("rejects shared-node reparenting, normalized duplicate concepts, visual-only cycles and unaccounted factors", async () => {
    const project = createSmartKpiMeasuredFixture(); addNode(project, "other_branch"); addNode(project, "shared_rate", "t/h");
    project.graph.edges.find(e => e.targetNodeId === "shared_rate")!.sourceNodeId = "other_branch";
    const ready = await prepared(project, "production.time_rate", { productivity: "shared_rate" });
    await expect(compileKpiSuggestion(project, ready.context, ready.proposal, selectionFor(ready.proposal), host)).rejects.toMatchObject({ code: "UNSAFE_REUSE" });
    const dup = createSmartKpiMeasuredFixture(); addNode(dup, "not_canonical", "hours/month", "Ｅffective_working time");
    const d = await prepared(dup); await expect(compileKpiSuggestion(dup, d.context, d.proposal, selectionFor(d.proposal), host)).rejects.toMatchObject({ code: "DUPLICATE_CONCEPT" });
    const cyclic = createSmartKpiMeasuredFixture(); addNode(cyclic, "a"); addNode(cyclic, "b");
    cyclic.graph.edges.push({ id: "a_b", sourceNodeId: "a", targetNodeId: "b", relation: "contextual_influence", aiGenerated: false },
      { id: "b_a", sourceNodeId: "b", targetNodeId: "a", relation: "contextual_influence", aiGenerated: false });
    const c = await prepared(cyclic); await expect(compileKpiSuggestion(cyclic, c.context, c.proposal, selectionFor(c.proposal), host)).rejects.toMatchObject({ code: "CYCLE" });
    const old = createSmartKpiMeasuredFixture(); addNode(old, "existing_factor"); old.graph.edges[0]!.relation = "multiplicative_driver";
    const o = await prepared(old); await expect(compileKpiSuggestion(old, o.context, o.proposal, selectionFor(o.proposal, "formula"), host)).rejects.toMatchObject({ code: "UNACCOUNTED_CHILDREN" });
  });
});
