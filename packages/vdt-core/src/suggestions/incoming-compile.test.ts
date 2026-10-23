import { afterEach, describe, expect, it, vi } from "vitest";
import { calculateGraph } from "../formula/calculate";
import { inspectDecompositionHierarchy } from "../graph/decomposition";
import { compileIncomingKpiBatch, previewIncomingKpiBatch } from "./incoming-compile";
import { createIncomingGraphFixture, existingKey, fixtureContext, manualInput, manualKey, modelProposal } from "./incoming-contract.fixtures";
import { incomingKpiProposalFormula } from "./incoming-contract";
import { kpiCanonicalJson } from "./identity";
const host = { operationId: "smart_formula_fixture", now: "2026-10-19T01:00:00.000Z" };
afterEach(() => vi.useRealTimers());

describe("formula-bearing incoming compilation", () => {
  it("repairs a formula-free calculated node declared as a measured input in the same Add, preserving its value and context", async () => {
    const project = createIncomingGraphFixture("measured");
    const measured = { ...structuredClone(project.graph.nodes[1]!), id: "waste_empty_km_trip", name: "Measured empty distance", type: "calculated" as const, value: 4,
      valueStatus: "calculated" as const, formula: undefined };
    project.graph.nodes.push(measured);
    project.graph.nodes[0]!.formula = "target + waste_empty_km_trip";
    project.graph.edges.push({ id: "edge_measured_distance", sourceNodeId: "output", targetNodeId: measured.id, relation: "formula_dependency", aiGenerated: false });
    project.graph.nodes[0]!.decompositionPlan!.nodes.push({ nodeId: measured.id, parentNodeId: "output", kind: "input" });
    project.graph.edges.find(edge => edge.targetNodeId === "old_context")!.sourceNodeId = measured.id;
    project.graph.nodes[0]!.decompositionPlan!.nodes.find(row => row.nodeId === "old_context")!.parentNodeId = measured.id;
    project.scenarios = [{ id: "zero_distance", name: "Zero distance", overrides: [{ nodeId: measured.id, value: 0 }], createdAt: host.now, updatedAt: host.now }];
    expect(inspectDecompositionHierarchy(project, "incremental_user_apply").errors).toEqual(["PLANNED_INPUT_MISMATCH: waste_empty_km_trip"]);
    const before = kpiCanonicalJson(project), input = manualInput(await fixtureContext(project));
    expect((await previewIncomingKpiBatch(project, input)).valid).toBe(true);
    const result = await compileIncomingKpiBatch(project, input, host);
    const repaired = result.preview.graph.nodes.find(node => node.id === measured.id)!;
    expect(repaired).toEqual({ ...measured, type: "input", updatedAt: host.now });
    expect(result.preview.graph.edges.filter(edge => edge.sourceNodeId === measured.id)).toEqual(project.graph.edges.filter(edge => edge.sourceNodeId === measured.id));
    expect(result.preview.graph.nodes[0]!.decompositionPlan!.nodes.find(row => row.nodeId === measured.id)?.kind).toBe("input");
    expect(result.changeSet.updates.find(update => update.nodeId === measured.id)?.patch).toEqual({ type: "input" });
    expect(result.outputPreview).toHaveLength(2);
    expect(inspectDecompositionHierarchy(result.preview, "incremental_user_apply").valid).toBe(true);
    expect(kpiCanonicalJson(project)).toBe(before);
  });

  it("still rejects a real formula or mathematical child contradicting a declared input", async () => {
    for (const defect of ["formula", "factor_child"] as const) {
      const project = createIncomingGraphFixture("measured");
      project.graph.nodes[1]!.type = "calculated";
      if (defect === "formula") project.graph.nodes[1]!.formula = "old_context";
      else project.graph.edges.find(edge => edge.targetNodeId === "old_context")!.relation = "formula_dependency";
      await expect(compileIncomingKpiBatch(project, manualInput(await fixtureContext(project)), host))
        .rejects.toMatchObject({ code: "INVALID_EXISTING_HIERARCHY" });
    }
  });

  it.each(["input", "calculated"] as const)("makes a measured non-root %s parent calculated, retains source/old contexts, then calculates from new values", async sourceType => {
    const project = createIncomingGraphFixture("measured"); project.graph.nodes[1]!.type = sourceType;
    const input = manualInput(await fixtureContext(project)), before = kpiCanonicalJson(project);
    const result = await compileIncomingKpiBatch(project, input, host), target = result.preview.graph.nodes.find(node => node.id === "target")!;
    expect(target).toMatchObject({ type: "calculated", baselineValue: 4, valueSource: { sourceTier: "file" }, dataMapping: { unit: "km/trip" } });
    expect(result.preview.graph.nodes.find(node => node.id === result.newNodeIds[0])).toMatchObject({ aiGenerated: false, status: "accepted", baselineValue: 4, valueStatus: "calculated", valueSource: { sourceTier: "derived" } });
    expect(result.outputPreview[0]).toMatchObject({ parentBefore: 4, parentAfter: 4, rootBefore: 4, rootAfter: 4 });
    expect(result.preview.graph.edges.find(edge => edge.targetNodeId === "old_context")!.relation).toBe("contextual_influence");
    expect(inspectDecompositionHierarchy(result.preview, "incremental_user_apply").valid).toBe(true);
    result.preview.graph.nodes.find(node => node.id === result.newNodeIds[0])!.baselineValue = 7;
    expect(calculateGraph(result.preview).rootValue).toBe(7); expect(kpiCanonicalJson(project)).toBe(before);
  });
  it("accepts six retained factors plus one own input with exactly one new node", async () => {
    const project = createIncomingGraphFixture("existing_six"), input = manualInput(await fixtureContext(project));
    input.draft.existingFactors = Array.from({ length: 6 }, (_, index) => ({ key: existingKey(index), nodeId: `factor_${index}`, selected: true }));
    input.draft.formula = [...input.draft.existingFactors.map(row => row.key), manualKey].join(" + ");
    const result = await compileIncomingKpiBatch(project, input, host);
    expect(result.newNodeIds).toHaveLength(1); expect(result.aliases.filter(row => row.kind === "existing")).toHaveLength(6);
    expect(result.preview.graph.edges.filter(edge => edge.sourceNodeId === "target")).toHaveLength(7);
    input.draft.existingFactors.pop(); input.draft.formula = [...input.draft.existingFactors.map(row => row.key), manualKey].join(" + ");
    await expect(compileIncomingKpiBatch(project, input, host)).rejects.toMatchObject({ code: "UNACCOUNTED_CHILDREN" });
  });
  it("uses shared measured distance without a second primary edge and rejects the derived-time ancestor cycle", async () => {
    const project = createIncomingGraphFixture("shared_speed"), input = manualInput(await fixtureContext(project));
    input.draft.manualChildren[0]!.name = "Independently measured moving time"; input.draft.manualChildren[0]!.unit = "h/trip";
    input.draft.existingFactors = [{ key: existingKey(0), nodeId: "distance", selected: true }];
    input.draft.formula = `${existingKey(0)} / ${manualKey}`;
    const result = await compileIncomingKpiBatch(project, input, host);
    expect(result.preview.graph.edges.filter(edge => edge.targetNodeId === "distance")).toEqual(project.graph.edges.filter(edge => edge.targetNodeId === "distance"));
    expect(result.preview.graph.nodes[0]!.decompositionPlan!.nodes.find(entry => entry.nodeId === "distance")!.sharedWith).toContain("target");
    input.draft.existingFactors[0]!.nodeId = "output"; input.draft.manualChildren[0]!.unit = "fraction";
    // An equal-unit expression would still be rejected by the graph cycle.
    input.draft.existingFactors.push({ key: existingKey(1), nodeId: "distance", selected: true });
    input.draft.formula = `${existingKey(1)} / ${existingKey(0)} * ${manualKey}`;
    await expect(compileIncomingKpiBatch(project, input, host)).rejects.toMatchObject({ code: "CYCLE" });
  });
  it("calculates an off-root reference model without activating it or changing root output", async () => {
    const project = createIncomingGraphFixture("off_root"), result = await compileIncomingKpiBatch(project, manualInput(await fixtureContext(project)), host);
    expect(result.preview.graph.nodes.find(node => node.id === "target")!.type).toBe("calculated");
    const plan = result.preview.graph.nodes[0]!.decompositionPlan!;
    expect(plan.nodes.find(entry => entry.nodeId === "target")!.kind).toBe("context");
    expect(plan.nodes.find(entry => entry.nodeId === result.newNodeIds[0])!.kind).toBe("context");
    expect(result.outputPreview[0]).toMatchObject({ rootBefore: 4, rootAfter: 4 });
  });
  it("activates a selected context model's mathematical closure while retaining its unrelated context", async () => {
    const project = createIncomingGraphFixture("measured"), context = project.graph.nodes.find(node => node.id === "old_context")!;
    context.unit = "km/trip"; context.formula = "old_context_input";
    const leaf = { ...context, id: "old_context_input", name: "Measured reference distance", formula: undefined, baselineValue: 2 };
    const sibling = { ...leaf, id: "unrelated_context", name: "Unrelated context", baselineValue: 8 };
    project.graph.nodes.push(leaf, sibling);
    for (const child of [leaf, sibling]) {
      project.graph.edges.push({ id: `edge_${child.id}`, sourceNodeId: context.id, targetNodeId: child.id, relation: "contextual_influence", aiGenerated: false });
      project.graph.nodes[0]!.decompositionPlan!.nodes.push({ nodeId: child.id, parentNodeId: context.id, kind: "context", rationale: "Existing reference branch." });
    }
    expect(inspectDecompositionHierarchy(project, "incremental_user_apply").valid).toBe(true);
    const input = manualInput(await fixtureContext(project));
    input.draft.existingFactors = [{ key: existingKey(0), nodeId: context.id, selected: true }];
    input.draft.formula = `${existingKey(0)} + ${manualKey}`;
    const result = await compileIncomingKpiBatch(project, input, host), plan = result.preview.graph.nodes[0]!.decompositionPlan!;
    expect(plan.nodes.find(row => row.nodeId === context.id)?.kind).toBe("calculated");
    expect(plan.nodes.find(row => row.nodeId === leaf.id)?.kind).toBe("input");
    expect(plan.nodes.find(row => row.nodeId === sibling.id)?.kind).toBe("context");
    expect(result.preview.graph.edges.find(row => row.targetNodeId === sibling.id)?.relation).toBe("contextual_influence");
    expect(result.preview.graph.nodes.find(row => row.id === context.id)?.type).toBe("calculated");
    expect(inspectDecompositionHierarchy(result.preview, "incremental_user_apply").valid).toBe(true);
    expect(result.outputPreview[0]).toMatchObject({ parentBefore: 4, parentAfter: 4 });
  });
  it("retains root role and permits subset+manual only after an explicitly edited coherent formula", async () => {
    const project = createIncomingGraphFixture("measured"), context = await fixtureContext(project), input = manualInput(context);
    input.proposal = modelProposal(context); input.draft.source = { kind: "proposal", proposalId: input.proposal.proposalId, groupId: "components" };
    input.draft.childKeys = ["second"]; input.draft.formulaAuthorship = "user_edited"; input.draft.formula = `p_2 + ${manualKey}`;
    input.draft.inputValues = { p_2: "1" };
    const result = await compileIncomingKpiBatch(project, input, host);
    expect(result.newNodeIds).toHaveLength(2); expect(result.lineage).toMatchObject({ requiresExecution: true });
    expect(result.preview.graph.nodes.find(node => node.id.endsWith(manualKey))).toMatchObject({ aiGenerated: false, status: "accepted", baselineValue: 3, valueStatus: "calculated" });
    expect(result.preview.graph.nodes.find(node => node.id.endsWith("_p_2"))).toMatchObject({ aiGenerated: true, status: "ai_suggested" });
    expect(result.preview.graph.nodes.filter(node => node.name === "First component")).toHaveLength(0);
    expect(result.preview.graph.nodes[0]!.type).toBe("root_kpi");
  });
  it("rejects zero/cancellation padding, mismatched scales and disguised model coefficients", async () => {
    const project = createIncomingGraphFixture("measured"), input = manualInput(await fixtureContext(project));
    for (const formula of [`0 * ${manualKey}`, `${manualKey} - ${manualKey}`, `min(0, 0) * ${manualKey}`]) {
      input.draft.formula = formula; await expect(compileIncomingKpiBatch(project, input, host)).rejects.toMatchObject({ code: "INEFFECTIVE_FACTOR" });
    }
    input.draft.formula = `60 * ${manualKey}`; input.draft.manualChildren[0]!.unit = "m/trip";
    await expect(compileIncomingKpiBatch(project, input, host)).rejects.toMatchObject({ code: "UNIT_MISMATCH" });
    input.draft.manualChildren[0]!.unit = "km/trip"; input.proposal = modelProposal(input.context);
    input.draft.manualChildren = []; input.draft.source = { kind: "proposal", proposalId: input.proposal.proposalId, groupId: "components" };
    input.draft.childKeys = ["first", "second"]; input.draft.formulaAuthorship = "model";
    input.draft.formula = incomingKpiProposalFormula(input.proposal, "components")!;
    input.draft.inputValues = { p_1: "1" };
    vi.useFakeTimers(); vi.setSystemTime(new Date(host.now));
    expect((await previewIncomingKpiBatch(project, input)).valid).toBe(true);
  });
  it("rejects a*b/b and a+(b-b) as dummy existing references", async () => {
    const project = createIncomingGraphFixture("shared_speed"), input = manualInput(await fixtureContext(project));
    input.draft.manualChildren[0]!.unit = "km/h";
    input.draft.existingFactors = [{ key: existingKey(0), nodeId: "distance", selected: true }];
    for (const formula of [`${manualKey} * ${existingKey(0)} / ${existingKey(0)}`, `${manualKey} + (${existingKey(0)} - ${existingKey(0)})`, `${manualKey} / ${existingKey(0)} * ${existingKey(0)}`]) {
      input.draft.formula = formula;
      await expect(compileIncomingKpiBatch(project, input, host)).rejects.toMatchObject({ code: "INEFFECTIVE_FACTOR" });
    }
  });
  it.each([true, false])("checks constant domains before zero/cancel masking with a plan=%s", async withPlan => {
    const project = createIncomingGraphFixture("measured");
    if (!withPlan) delete project.graph.nodes[0]!.decompositionPlan;
    const input = manualInput(await fixtureContext(project));
    input.draft.formula = `(${manualKey} * 0) / 0`;
    await expect(compileIncomingKpiBatch(project, input, host)).rejects.toMatchObject({ code: "DIVISION_BY_ZERO" });
    input.draft.formula = `${manualKey} * (${"9".repeat(200)} * ${"9".repeat(200)})`;
    await expect(compileIncomingKpiBatch(project, input, host)).rejects.toMatchObject({ code: "NONFINITE_CONSTANT" });
  });
});
