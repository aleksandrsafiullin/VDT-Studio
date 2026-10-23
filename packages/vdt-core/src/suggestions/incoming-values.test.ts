import { describe, expect, it } from "vitest";
import { calculateGraph } from "../formula/calculate";
import { kpiCanonicalJson } from "./identity";
import { resolveIncomingKpiValues } from "./incoming-values";
import { compileIncomingKpiBatch, previewIncomingKpiBatch } from "./incoming-compile";
import { createIncomingGraphFixture, existingKey, fixtureContext, manualInput, manualKey } from "./incoming-contract.fixtures";

const second = `m_${"2".repeat(32)}` as const;
const host = { operationId: "smart_values_fixture", now: "2026-10-21T18:00:00Z" };
async function ratio() {
  const project = createIncomingGraphFixture("measured"), input = manualInput(await fixtureContext(project));
  input.draft.manualChildren = [{ key: manualKey, selected: true, name: "Total distance", unit: "km" }, { key: second, selected: true, name: "Measured trips", unit: "trip" }];
  input.draft.formula = `${manualKey} / ${second}`;
  return { project, input };
}
describe("incoming baseline values", () => {
  it("blocks empty inputs without mutating the source, then derives the numerator from a supplied denominator", async () => {
    const { project, input } = await ratio(), before = kpiCanonicalJson(project);
    expect(await previewIncomingKpiBatch(project, input)).toMatchObject({ valid: false, issues: [{ code: "MISSING_INPUT_VALUES" }] });
    input.draft.inputValues = { [second]: "25" };
    const resolution = resolveIncomingKpiValues(project, input);
    expect(resolution).toMatchObject({ referenceValue: 4, result: 4, issues: [], inputs: [
      { alias: manualKey, value: 100, source: "derived" }, { alias: second, value: 25, source: "user" }
    ] });
    const compiled = await compileIncomingKpiBatch(project, input, host);
    expect(calculateGraph(compiled.preview).rootValue).toBe(4);
    expect(compiled.preview.graph.nodes.find(node => node.id.endsWith(manualKey))).toMatchObject({ baselineValue: 100, valueStatus: "calculated", valueSource: { sourceTier: "derived" } });
    expect(compiled.preview.graph.nodes.find(node => node.id.endsWith(second))).toMatchObject({ baselineValue: 25, valueStatus: "user_provided_value", valueSource: { sourceTier: "user" } });
    expect(kpiCanonicalJson(project)).toBe(before);
  });

  it("rejects a numeric decomposition that changes the current KPI", async () => {
    const { project, input } = await ratio(); input.draft.inputValues = { [manualKey]: "120", [second]: "25" };
    await expect(compileIncomingKpiBatch(project, input, host)).rejects.toMatchObject({ code: "BASELINE_MISMATCH" });
    expect(resolveIncomingKpiValues(project, input)).toMatchObject({ referenceValue: 4, result: 4.8 });
  });

  it.each([0, 4])("preserves a measured %s and keeps zero distinct from missing", async value => {
    const project = createIncomingGraphFixture("measured"); project.graph.nodes[1]!.baselineValue = value;
    const input = manualInput(await fixtureContext(project)), compiled = await compileIncomingKpiBatch(project, input, host);
    expect(calculateGraph(compiled.preview).rootValue).toBe(value);
    expect(compiled.preview.graph.nodes.find(node => node.id.endsWith(manualKey))!.baselineValue).toBe(value);
  });

  it("uses current formula evaluation ahead of stale stored reference evidence", async () => {
    const project = createIncomingGraphFixture("existing_six"), input = manualInput(await fixtureContext(project));
    input.draft.existingFactors = Array.from({ length: 6 }, (_, index) => ({ key: existingKey(index), nodeId: `factor_${index}`, selected: true }));
    input.draft.formula = [...input.draft.existingFactors.map(row => row.key), manualKey].join(" + ");
    const compiled = await compileIncomingKpiBatch(project, input, host);
    expect(compiled.values).toMatchObject({ referenceSource: "current", referenceValue: 6, result: 6 });
    expect(compiled.preview.graph.nodes.find(node => node.id.endsWith(manualKey))!.baselineValue).toBe(0);
  });

  it("never guesses two missing inputs or a non-unique min/max input", async () => {
    const { project, input } = await ratio();
    expect(resolveIncomingKpiValues(project, input).inputs.every(row => row.value === undefined)).toBe(true);
    input.draft.manualChildren[0]!.unit = "km/trip"; input.draft.manualChildren[1]!.unit = "km/trip";
    input.draft.formula = `min(${manualKey}, ${second})`; input.draft.inputValues = { [second]: "4" };
    expect(resolveIncomingKpiValues(project, input).issues[0]?.code).toBe("MISSING_INPUT_VALUES");
  });

  it.each([
    [`${manualKey} + ${second}`, 2], [`${second} - ${manualKey}`, -2],
    [`${manualKey} - ${second}`, 6], [`${manualKey} * ${second}`, 2],
    [`${manualKey} / ${second}`, 8], [`${second} / ${manualKey}`, 0.5],
    [`(-${manualKey}) + ${second}`, -2], [`(${second} + 1) / ${manualKey}`, 0.75]
  ])("inverts a unique arithmetic input in %s", async (formula, expected) => {
    const { project, input } = await ratio(); input.draft.formula = formula;
    input.draft.inputValues = { [second]: "2" };
    expect(resolveIncomingKpiValues(project, input)).toMatchObject({ result: 4, issues: [], inputs: [{ alias: manualKey, value: expected, source: "derived" }, { alias: second, value: 2 }] });
  });

  it.each(["NaN", "Infinity", "1e999", "-", "1,2,3"])("rejects invalid numeric text %s", async raw => {
    const { project, input } = await ratio(); input.draft.inputValues = { [manualKey]: "100", [second]: raw };
    expect(resolveIncomingKpiValues(project, input).issues.some(issue => issue.code === "INVALID_INPUT_VALUE")).toBe(true);
    expect((await previewIncomingKpiBatch(project, input)).valid).toBe(false);
  });

  it("blocks zero denominators and impossible inversion, including a zero parent", async () => {
    const { project, input } = await ratio(); input.draft.inputValues = { [manualKey]: "100", [second]: "0" };
    expect(resolveIncomingKpiValues(project, input).issues).toContainEqual(expect.objectContaining({ code: "INVALID_INPUT_CALCULATION" }));
    project.graph.nodes[1]!.baselineValue = 0; input.draft.inputValues = { [manualKey]: "100" };
    expect(resolveIncomingKpiValues(project, input).inputs.find(row => row.alias === second)?.value).toBeUndefined();
  });

  it("repairs existing empty inputs in the same formula and retains known reference values", async () => {
    const { project, input } = await ratio();
    for (const [index, name, unit] of [[0, "Known trips", "trip"], [1, "Empty distance", "km"]] as const) project.graph.nodes.push({
      ...project.graph.nodes[1]!, id: `ref_${index}`, name, unit, formula: undefined, baselineValue: index === 0 ? 25 : undefined, valueSource: undefined, dataMapping: undefined
    });
    delete project.graph.nodes[0]!.decompositionPlan;
    project.graph.nodes[1]!.formula = "ref_1 / ref_0"; project.graph.nodes[1]!.type = "calculated";
    project.graph.edges.push(...[0, 1].map(index => ({ id: `ref_edge_${index}`, sourceNodeId: "target", targetNodeId: `ref_${index}`, relation: "formula_dependency" as const, aiGenerated: false })));
    input.context = await fixtureContext(project); input.draft.contextHash = input.context.contextHash;
    input.draft.manualChildren = []; input.draft.existingFactors = [0, 1].map(index => ({ key: existingKey(index), nodeId: `ref_${index}`, selected: true }));
    input.draft.formula = `${existingKey(1)} / ${existingKey(0)}`;
    const compiled = await compileIncomingKpiBatch(project, input, host);
    expect(compiled.newNodeIds).toEqual([]);
    expect(compiled.preview.graph.nodes.find(node => node.id === "ref_1")!.baselineValue).toBe(100);
    expect(compiled.preview.graph.nodes.find(node => node.id === "ref_0")).toEqual(project.graph.nodes.find(node => node.id === "ref_0"));
    expect(calculateGraph(compiled.preview).values.target).toBe(4);
    input.draft.inputValues = { [existingKey(0)]: "26" };
    expect(resolveIncomingKpiValues(project, input).issues[0]?.code).toBe("INVALID_INPUT_VALUE");
  });

  it("requires an explicit reference when the parent has no number, and accepts decimal comma", async () => {
    const { project, input } = await ratio(); delete project.graph.nodes[1]!.baselineValue;
    input.context = await fixtureContext(project); input.draft.contextHash = input.context.contextHash;
    input.draft.inputValues = { [second]: "25" };
    expect(resolveIncomingKpiValues(project, input).issues[0]?.code).toBe("MISSING_REFERENCE_VALUE");
    input.draft.referenceValue = "4,2";
    const compiled = await compileIncomingKpiBatch(project, input, host);
    expect(calculateGraph(compiled.preview).rootValue).toBe(4.2);
    expect(compiled.preview.graph.nodes.find(node => node.id === "target")).toMatchObject({ baselineValue: 4.2, valueSource: { sourceTier: "user" } });
  });
});
