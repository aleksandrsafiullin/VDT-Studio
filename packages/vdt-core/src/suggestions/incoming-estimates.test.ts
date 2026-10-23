import { describe, expect, it } from "vitest";
import { calculateGraph } from "../formula/calculate";
import { kpiCanonicalJson } from "./identity";
import { resolveIncomingKpiValues } from "./incoming-values";
import { compileIncomingKpiBatch } from "./incoming-compile";
import { createIncomingGraphFixture, fixtureContext, manualInput, manualKey } from "./incoming-contract.fixtures";

const second = `m_${"2".repeat(32)}` as const;
const host = { operationId: "smart_estimate_fixture", now: "2026-10-22T00:00:00Z" };
async function ratio(value = 4) {
  const project = createIncomingGraphFixture("measured"); project.graph.nodes[1]!.baselineValue = value;
  const input = manualInput(await fixtureContext(project));
  input.draft.manualChildren = [{ key: manualKey, selected: true, name: "Total distance", unit: "km" }, { key: second, selected: true, name: "Trips", unit: "trips" }];
  input.draft.formula = `${manualKey} / ${second}`; input.draft.estimateMissingValues = true;
  return { project, input };
}
describe("explicit illustrative Smart estimates", () => {
  it.each([0, 4])("offers finite estimated inputs that preserve a measured %s and saves assumption provenance", async value => {
    const { project, input } = await ratio(value), before = kpiCanonicalJson(project);
    expect(resolveIncomingKpiValues(project, input)).toMatchObject({ referenceValue: value, result: value, issues: [], inputs: [
      { value: value * 1000, source: "estimate", estimated: true }, { value: 1000, source: "estimate", estimated: true }
    ] });
    const compiled = await compileIncomingKpiBatch(project, input, host);
    expect(calculateGraph(compiled.preview).rootValue).toBe(value);
    for (const id of compiled.newNodeIds) expect(compiled.preview.graph.nodes.find(node => node.id === id)).toMatchObject({ valueStatus: "default_assumption", valueSource: { sourceTier: "assumption", acceptedByUserInDialog: true, note: expect.stringContaining("Not measured data") } });
    expect(compiled.preview.graph.nodes[1]!.valueSource).toEqual(project.graph.nodes[1]!.valueSource);
    expect(kpiCanonicalJson(project)).toBe(before);
  });

  it("splits additive missing amounts and preserves integer counts including zero", async () => {
    for (const unit of ["km/trip", "count"]) for (const value of [0, 1, 4]) {
      const { project, input } = await ratio(value);
      project.graph.nodes[1]!.unit = unit; project.graph.nodes[0]!.unit = unit;
      input.context = await fixtureContext(project); input.draft.contextHash = input.context.contextHash;
      for (const row of input.draft.manualChildren) row.unit = unit;
      input.draft.formula = `${manualKey} + ${second}`;
      const values = resolveIncomingKpiValues(project, input);
      expect(values.issues).toEqual([]); expect(values.result).toBe(value);
      if (unit === "count") expect(values.inputs.every(row => Number.isInteger(row.value) && row.value! >= 0)).toBe(true);
    }
  });

  it("never overwrites an explicit value or adjusts inconsistent numbers to fit", async () => {
    const { project, input } = await ratio();
    input.draft.inputValues = { [second]: "25" };
    expect(resolveIncomingKpiValues(project, input)).toMatchObject({ inputs: [{ value: 100, source: "derived" }, { value: 25, source: "user" }] });
    input.draft.inputValues[manualKey] = "120";
    expect(resolveIncomingKpiValues(project, input)).toMatchObject({ result: 4.8, issues: [{ code: "BASELINE_MISMATCH" }] });
    input.draft.inputValues[manualKey] = "-";
    expect(resolveIncomingKpiValues(project, input).issues[0]?.code).toBe("INVALID_INPUT_VALUE");
  });

  it("keeps edited estimates and their dependent derived amount marked as estimates", async () => {
    const { project, input } = await ratio(); input.draft.inputValues = { [second]: "25" }; input.draft.estimatedAliases = [second];
    expect(resolveIncomingKpiValues(project, input)).toMatchObject({ result: 4, issues: [], inputs: [
      { value: 100, source: "estimate", estimated: true }, { value: 25, source: "estimate", estimated: true }
    ] });
  });

  it("requires an explicit missing parent reference and marks an illustrative reference with its children", async () => {
    const { project, input } = await ratio(); delete project.graph.nodes[1]!.baselineValue;
    input.context = await fixtureContext(project); input.draft.contextHash = input.context.contextHash;
    expect(resolveIncomingKpiValues(project, input).issues[0]?.code).toBe("MISSING_REFERENCE_VALUE");
    input.draft.referenceValue = "0.2"; input.draft.referenceValueEstimated = true;
    const compiled = await compileIncomingKpiBatch(project, input, host);
    expect(compiled.values).toMatchObject({ referenceSource: "estimate", referenceEstimated: true, result: 0.2, inputs: [{ value: 200 }, { value: 1000 }] });
    expect(compiled.preview.graph.nodes[1]).toMatchObject({ baselineValue: 0.2, valueSource: { sourceTier: "assumption" }, assumptions: [expect.stringContaining("Illustrative")] });
    expect(calculateGraph(compiled.preview).rootValue).toBe(0.2);
  });

  it("can offer a non-unique min/max illustration, without relaxing reconciliation", async () => {
    const { project, input } = await ratio();
    for (const row of input.draft.manualChildren) row.unit = "km/trip";
    for (const fn of ["min", "max"]) {
      input.draft.formula = `${fn}(${manualKey}, ${second})`;
      expect(resolveIncomingKpiValues(project, input)).toMatchObject({ result: 4, issues: [], inputs: [{ value: 4, source: "estimate" }, { value: 4, source: "estimate" }] });
    }
  });

  it("preserves fractional discount bounds and does not guess a fractional trip count", async () => {
    const { project, input } = await ratio(70); project.graph.nodes[1]!.unit = "USD";
    input.context = await fixtureContext(project); input.draft.contextHash = input.context.contextHash;
    input.draft.manualChildren[0]!.unit = "USD"; input.draft.manualChildren[1]!.unit = "fraction";
    input.draft.formula = `${manualKey} * (1 - ${second})`;
    expect(resolveIncomingKpiValues(project, input)).toMatchObject({ result: 70, issues: [], inputs: [{ value: 140 }, { value: 0.5 }] });
    const reversed = await ratio(); reversed.input.draft.manualChildren.reverse();
    const resolved = resolveIncomingKpiValues(reversed.project, reversed.input);
    expect(resolved.result).toBe(4); expect(resolved.inputs.find(row => row.alias === second)?.value).toBe(1000);
  });

  it("keeps invalid units editable and rejects overflowing arithmetic instead of accepting infinity", async () => {
    const { project, input } = await ratio(); input.draft.manualChildren[0]!.unit = "km/";
    expect(() => resolveIncomingKpiValues(project, input)).not.toThrow();
    input.draft.manualChildren[0]!.unit = "km"; input.draft.formula = `${manualKey} * ${second}`;
    input.draft.inputValues = { [manualKey]: "1e308", [second]: "1e308" };
    expect(resolveIncomingKpiValues(project, input).issues[0]?.code).toBe("INVALID_INPUT_CALCULATION");
  });
});
