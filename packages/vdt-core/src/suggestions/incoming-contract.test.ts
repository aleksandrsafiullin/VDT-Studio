import { describe, expect, it } from "vitest";
import observedHaulage from "./haulage-measured-contexts.fixture.json" with { type: "json" };
import { incomingKpiProposalFormula, incomingKpiProposedAlias, inspectIncomingKpiDraft, newIncomingKpiExistingKey,
  newIncomingKpiManualKey, parseIncomingKpiFormula, expandIncomingKpiFormula, validateIncomingKpiBatchDraft } from "./incoming-contract";
import { createIncomingGraphFixture, existingKey, fixtureContext, fixtureExecution, manualInput, manualKey, modelProposal } from "./incoming-contract.fixtures";
import { parseIncomingKpiUnit } from "./incoming-unit-contract";
import { INCOMING_KPI_UNIT_POLICY } from "./incoming-types";
import { kpiCanonicalJson } from "./identity";
import { validateKpiSuggestionContext } from "./validation";

describe("FM-01 incoming draft and immutable source contract", () => {
  it("preserves incomplete raw text/blank unselected rows without mutating the input", async () => {
    const input = manualInput(await fixtureContext(createIncomingGraphFixture("measured")));
    input.draft.formula = `${manualKey} * (`;
    input.draft.manualChildren.push({ key: `m_${"2".repeat(32)}`, selected: false, name: "", unit: "" });
    const before = kpiCanonicalJson(input);
    expect(validateIncomingKpiBatchDraft(input.draft).formula).toBe(input.draft.formula);
    expect(inspectIncomingKpiDraft(input)).toMatchObject({ readyForCompile: false, issues: [{ code: "INVALID_FORMULA" }] });
    expect(kpiCanonicalJson(input)).toBe(before);
    input.draft.formula = manualKey;
    expect(inspectIncomingKpiDraft(input)).toMatchObject({ readyForCompile: true, newNodeCount: 1, lineage: { kind: "manual", requiresExecution: false } });
  });
  it("rejects unknown authority/value fields and invalid aliases instead of treating them as manual provenance", async () => {
    const input = manualInput(await fixtureContext(createIncomingGraphFixture("measured")));
    for (const field of ["value", "baselineValue", "execution", "requiresExecution", "nodeId"])
      expect(() => validateIncomingKpiBatchDraft({ ...input.draft, [field]: 1 })).toThrow();
    for (const key of ["m_label", "m_bad-key", `m_${"a".repeat(33)}`, "e_1"])
      expect(() => validateIncomingKpiBatchDraft({ ...input.draft, manualChildren: [{ ...input.draft.manualChildren[0], key }] })).toThrow();
    expect(newIncomingKpiManualKey()).toMatch(/^m_[0-9a-f]{32}$/);
    expect(newIncomingKpiExistingKey()).toMatch(/^e_[0-9a-f]{32}$/);
  });
  it("keeps original-order proposal aliases after deselection/renaming and retains model lineage for a partial + own mix", async () => {
    const context = await fixtureContext(createIncomingGraphFixture("measured")), proposal = modelProposal(context);
    const input = manualInput(context); input.proposal = proposal;
    input.draft.source = { kind: "proposal", proposalId: proposal.proposalId, groupId: "components" };
    input.draft.childKeys = ["second"]; input.draft.formula = `p_2 + ${manualKey}`; input.draft.formulaAuthorship = "user_edited";
    input.draft.manualChildren[0]!.name = "My renamed component";
    const result = inspectIncomingKpiDraft(input);
    expect(result).toMatchObject({ readyForCompile: true, newNodeCount: 2, lineage: { kind: "model", requiresExecution: true, execution: fixtureExecution },
      bindings: [{ alias: "p_2", proposalChildKey: "second" }, { alias: manualKey, name: "My renamed component" }] });
    input.draft.formulaAuthorship = "user";
    expect(inspectIncomingKpiDraft(input)).toMatchObject({ readyForCompile: false, issues: [{ code: "INVALID_AUTHORSHIP" }] });
    input.draft.formulaAuthorship = "user_edited"; input.draft.childKeys = []; input.draft.formula = manualKey;
    expect(inspectIncomingKpiDraft(input)).toMatchObject({ readyForCompile: true, lineage: { requiresExecution: true, execution: fixtureExecution } });
    expect(incomingKpiProposedAlias(1)).toBe("p_2");
  });
  it("starts from the exact proposal formula, marks subset edits, and rejects missing/unused factors", async () => {
    const context = await fixtureContext(createIncomingGraphFixture("measured")), proposal = modelProposal(context);
    const input = manualInput(context); input.proposal = proposal; input.draft.manualChildren = [];
    input.draft.source = { kind: "proposal", proposalId: proposal.proposalId, groupId: "components" };
    input.draft.childKeys = ["first", "second"]; input.draft.formulaAuthorship = "model";
    input.draft.formula = incomingKpiProposalFormula(proposal, "components")!;
    expect(input.draft.formula).toBe("(p_1 + p_2)");
    expect(inspectIncomingKpiDraft(input).readyForCompile).toBe(true);
    input.draft.childKeys = ["second"];
    expect(inspectIncomingKpiDraft(input)).toMatchObject({ readyForCompile: false, issues: [{ code: "FORMULA_EDIT_REQUIRED" }] });
    input.draft.formulaAuthorship = "user_edited";
    expect(inspectIncomingKpiDraft(input)).toMatchObject({ readyForCompile: false, issues: [{ code: "UNSELECTED_REFERENCE" }] });
    input.draft.childKeys = ["first", "second"]; input.draft.formula = "p_2";
    expect(inspectIncomingKpiDraft(input)).toMatchObject({ readyForCompile: false, issues: [{ code: "UNUSED_FACTOR" }] });
    delete proposal.groups[0]!.formula;
    expect(incomingKpiProposalFormula(proposal, "components")).toBeUndefined();
  });
  it("keeps six existing factors plus one new row valid and rejects seven NEW/17 existing rows", async () => {
    const project = createIncomingGraphFixture("existing_six"), input = manualInput(await fixtureContext(project));
    input.draft.existingFactors = Array.from({ length: 6 }, (_, i) => ({ key: existingKey(i), nodeId: `factor_${i}`, selected: true }));
    input.draft.formula = [...input.draft.existingFactors.map(row => row.key), manualKey].join(" + ");
    expect(inspectIncomingKpiDraft(input, project)).toMatchObject({ readyForCompile: true, newNodeCount: 1, existingReferenceCount: 6 });
    const tooMany = structuredClone(input);
    tooMany.draft.manualChildren = Array.from({ length: 7 }, (_, i) => ({ key: `m_${i.toString(16).padStart(32, "0")}` as const, name: `Own${i}`, unit: "km/trip", selected: true }));
    expect(inspectIncomingKpiDraft(tooMany, project).readyForCompile).toBe(false);
    tooMany.draft.manualChildren = input.draft.manualChildren;
    tooMany.draft.existingFactors = Array.from({ length: 17 }, (_, i) => ({ key: existingKey(i), nodeId: `factor_${i}`, selected: true }));
    expect(inspectIncomingKpiDraft(tooMany, project).readyForCompile).toBe(false);
  });
  it("captures observed measured haulage scope and shared/cycle/off-root fixtures without claiming full-graph acceptance", async () => {
    for (const raw of observedHaulage) {
      const context = validateKpiSuggestionContext(raw);
      expect(inspectIncomingKpiDraft(manualInput(context))).toMatchObject({ readyForCompile: true, lineage: { kind: "manual" } });
      expect(context.target.valueKnown).toBe(true);
    }
    for (const kind of ["measured", "shared_speed", "off_root"] as const) {
      const project = createIncomingGraphFixture(kind), before = kpiCanonicalJson(project), context = await fixtureContext(project);
      const input = manualInput(context);
      if (kind === "shared_speed") {
        input.draft.manualChildren[0]!.unit = "h/trip";
        input.draft.existingFactors = [{ key: existingKey(0), nodeId: "distance", selected: true }];
        input.draft.formula = `${existingKey(0)} / ${manualKey}`;
        expect(inspectIncomingKpiDraft(input, project)).toMatchObject({ readyForCompile: true, existingReferenceCount: 1 });
        // This next version has a real ancestor cycle; FM-02 must reject it.
        input.draft.existingFactors[0]!.nodeId = "output";
        expect(inspectIncomingKpiDraft(input, project).readyForCompile).toBe(true);
      } else expect(inspectIncomingKpiDraft(input, project).readyForCompile).toBe(true);
      expect(kpiCanonicalJson(project)).toBe(before);
      expect(project.graph.nodes.find(n => n.id === "target")!.baselineValue).toBe(kind === "shared_speed" ? 14 : 4);
    }
  });
});

describe("FM-01 bounded AST/ID mapping and same-scale unit grammar", () => {
  it("maps full AST identifiers once and bounds local/expanded formula and complexity", () => {
    const formula = `max(p_1, ${manualKey})`;
    expect(expandIncomingKpiFormula(formula, [
      { alias: "p_1", nodeId: "existing_distance", kind: "existing", origin: "proposed" },
      { alias: manualKey, nodeId: "smart_owned_new_factor", kind: "new", origin: "manual" }
    ])).toBe("max(existing_distance, smart_owned_new_factor)");
    expect(() => parseIncomingKpiFormula("p_1 ".repeat(257), "user")).toThrow();
    expect(() => parseIncomingKpiFormula("-".repeat(25) + "p_1", "user")).toThrow();
    expect(() => parseIncomingKpiFormula(Array.from({ length: 65 }, () => "p_1").join(" + "), "user")).toThrow();
    let terms = Array.from({ length: 50 }, () => "p_1");
    while (terms.length > 1) terms = Array.from({ length: Math.ceil(terms.length / 2) }, (_, i) => terms[i * 2 + 1] ? `(${terms[i * 2]} + ${terms[i * 2 + 1]})` : terms[i * 2]!);
    expect(() => expandIncomingKpiFormula(terms[0]!, [
      { alias: "p_1", nodeId: "x".repeat(160), kind: "existing", origin: "existing" }
    ])).toThrow("4,096");
    for (const raw of ["target", "p_7", "sin(p_1)", "1"])
      expect(() => parseIncomingKpiFormula(raw, "user")).toThrow();
  });
  it("does not accept model coefficients disguised as literals/constant expressions/repetition, while retaining explicit user edits", () => {
    for (const raw of ["2 * p_1", "60 * p_1", "100% * p_1", "(1 + 1) * p_1", "p_1 + p_1"])
      expect(() => parseIncomingKpiFormula(raw, "model")).toThrow();
    expect(parseIncomingKpiFormula("p_1 * (1 - p_2)", "model").references).toEqual(["p_1", "p_2"]);
    expect(parseIncomingKpiFormula("0.5 * p_1 + 0.5 * p_2", "user_edited").references).toEqual(["p_1", "p_2"]);
  });
  it("retains distinct time/distance/percent/currency scales and case-sensitive opaque atoms", () => {
    const period = { key: "explicit:2026-10-05–2026-10-11", grain: "custom" as const };
    expect(INCOMING_KPI_UNIT_POLICY.literalConversionProof).toBe(false);
    expect(parseIncomingKpiUnit("km/h", period)).toEqual({ dimensions: { length: 1, time: -1 }, scales: { "length:km": 1, "time:h": -1 } });
    expect(parseIncomingKpiUnit("h/trip", period)).toEqual({ dimensions: { time: 1, trip: -1 }, scales: { "time:h": 1, "trip:trip": -1 } });
    for (const [a, b] of [["h", "min"], ["km", "m"], ["%", "fraction"], ["USD", "EUR"], ["MW", "mW"]])
      expect(parseIncomingKpiUnit(a!, period)).not.toEqual(parseIncomingKpiUnit(b!, period));
    expect(parseIncomingKpiUnit("hours", period)).toEqual(parseIncomingKpiUnit("h", period));
    expect(parseIncomingKpiUnit("score/score", period)).toEqual({ dimensions: {}, scales: {} });
    expect(() => parseIncomingKpiUnit("h/month", period)).toThrow("matching period");
    expect(parseIncomingKpiUnit("h/month", { key: "explicit:October", grain: "month" }).dimensions).toHaveProperty("period:month:explicit:October", -1);
    for (const unit of ["km//h", "f(x)", "h^99", "km + h", "", "km/h/trip"])
      expect(() => parseIncomingKpiUnit(unit, period)).toThrow();
  });
});
