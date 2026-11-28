import { describe, expect, it } from "vitest";
import {
  WORKSPACE_MODEL_READINESS_POLICY_VERSION,
  VdtBuilderSession,
  applyDecompositionAssumptionOperation,
  probeFactor,
  verifyDecompositionRelationship,
  type SameUnitDecompositionRelationship,
  evaluateModelReadiness,
  productionVolumeProject,
  validateGraph,
  type ModelReadinessPurpose,
  type VdtNode,
  type VdtProject
} from "../index";

function project(formula = "gross * (1 - discount / 100)"): VdtProject {
  const template = productionVolumeProject.graph.nodes[0]!;
  const node = (id: string, patch: Partial<VdtNode>): VdtNode => ({
    id,
    name: id,
    type: "input",
    status: "accepted",
    aiGenerated: false,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
    ...patch
  });
  return {
    ...productionVolumeProject,
    rootNodeId: "net",
    graph: {
      nodes: [
        node("net", { type: "root_kpi", unit: "USD", formula }),
        node("gross", { unit: "USD", baselineValue: 100 }),
        node("discount", { unit: "%", value: 10 })
      ],
      edges: ["gross", "discount"].map(id => ({
        id: `net-${id}`, sourceNodeId: "net", targetNodeId: id, relation: "formula_dependency", aiGenerated: false
      }))
    }
  };
}

describe("workspace model readiness", () => {
  it("uses explicit percentage scaling for both purposes while legacy validation stays readable", () => {
    const unscaled = project("gross * (1 - discount)");
    expect(validateGraph(unscaled).valid).toBe(true);
    for (const purpose of ["structural_model", "calculated_baseline"] as const) {
      const result = evaluateModelReadiness(unscaled, { purpose });
      expect(result).toMatchObject({ accepted: false, policyVersion: WORKSPACE_MODEL_READINESS_POLICY_VERSION });
      expect(result.issues).toContainEqual(expect.objectContaining({ code: "UNIT_MISMATCH", nodeId: "net" }));
    }
    expect(evaluateModelReadiness(project(), { purpose: "calculated_baseline" })).toMatchObject({
      accepted: true, missingInputs: [], calculation: { rootValue: 90 }
    });
  });

  it("accepts explicitly unfilled input leaves for structure and keeps zero as a known baseline", () => {
    const input = project();
    const [ , gross, discount ] = input.graph.nodes;
    gross!.baselineValue = 0;
    discount!.value = undefined;
    discount!.valueStatus = "unknown";
    const before = structuredClone(input);
    const structure = evaluateModelReadiness(input, { purpose: "structural_model" });
    expect(structure).toMatchObject({
      accepted: true, missingInputs: [{ nodeId: "discount", explicit: true, requiredForRoot: true }]
    });
    expect(structure.calculation).toBeUndefined();
    expect(evaluateModelReadiness(input, { purpose: "calculated_baseline" })).toMatchObject({
      accepted: false, missingInputs: structure.missingInputs
    });
    expect(input).toEqual(before);
    discount!.valueStatus = "user_provided_value";
    discount!.baselineValue = 10;
    expect(evaluateModelReadiness(input, { purpose: "calculated_baseline" })).toMatchObject({
      accepted: true, calculation: { rootValue: 0 }
    });
  });

  it("surfaces implicit legacy gaps and keeps explicitly unknown retained values out of calculation", () => {
    const input = project();
    input.graph.nodes[1]!.baselineValue = undefined;
    input.graph.nodes[2]!.valueStatus = "unknown";
    const result = evaluateModelReadiness(input, { purpose: "calculated_baseline" });
    expect(result).toMatchObject({
      accepted: false,
      missingInputs: [
        { nodeId: "gross", explicit: false, requiredForRoot: true },
        { nodeId: "discount", explicit: true, requiredForRoot: true }
      ]
    });
    expect(result.calculation?.values).toEqual({});
    expect(input.graph.nodes[2]!.value).toBe(10);
  });

  it.each<ModelReadinessPurpose>(["structural_model", "calculated_baseline"])("rejects broken references and formula/visual cycles for %s", purpose => {
    expect(evaluateModelReadiness(project("missing"), { purpose }).issues).toContainEqual(expect.objectContaining({
      code: "UNKNOWN_REFERENCE", nodeId: "net", severity: "error"
    }));
    const cyclic = project();
    cyclic.graph.nodes[1]!.formula = "net";
    cyclic.graph.edges.push({ id: "cycle", sourceNodeId: "gross", targetNodeId: "net", relation: "formula_dependency", aiGenerated: false });
    const result = evaluateModelReadiness(cyclic, { purpose });
    expect(result.accepted).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "CIRCULAR_DEPENDENCY", edgeId: "cycle" }));
    expect(result.issues).toContainEqual(expect.objectContaining({ id: expect.stringContaining("validation-formula-cycle-") }));
  });

  it("rejects real calculation failures and applies construction requirements only when requested", () => {
    expect(evaluateModelReadiness(project("gross / ((discount - discount) / 100)"), { purpose: "calculated_baseline" }).issues)
      .toContainEqual(expect.objectContaining({ code: "DIVISION_BY_ZERO", nodeId: "net" }));
    const input = project();
    expect(evaluateModelReadiness(input, { purpose: "structural_model", requireHierarchy: true }).issues)
      .toContainEqual(expect.objectContaining({ code: "HIERARCHY_INCOMPLETE" }));
    const root = input.graph.nodes[0]!;
    root.formula = "0";
    input.graph = { nodes: [root], edges: [] };
    expect(evaluateModelReadiness(input, { purpose: "calculated_baseline" }).accepted).toBe(true);
    expect(evaluateModelReadiness(input, { purpose: "structural_model", requireDerivedRoot: true }).issues)
      .toContainEqual(expect.objectContaining({ code: "ROOT_NOT_DERIVED" }));
    expect(evaluateModelReadiness(input, { purpose: "structural_model", policyVersion: "future" }).issues)
      .toContainEqual(expect.objectContaining({ code: "UNSUPPORTED_POLICY_VERSION" }));
  });
});


function modeledRelationship(
  kind: SameUnitDecompositionRelationship["kind"], formula: string, baselineA?: number, baselineB?: number
) {
  const builder = new VdtBuilderSession();
  builder.createDraft({ rootKpi: "Throughput", projectTitle: "Two stages", unit: "t/h" });
  const { rootNodeId } = builder.getProject();
  builder.addDriver({ parentNodeId: rootNodeId, nodeId: "stage_a", name: "Stage A", unit: "t/h", baselineValue: baselineA });
  builder.addDriver({ parentNodeId: rootNodeId, nodeId: "stage_b", name: "Stage B", unit: "t/h", baselineValue: baselineB });
  builder.setFormula({ nodeId: rootNodeId, formula });
  const statement = kind === "serial_capacity" ? "The same material flows through A and then B without bypass." : "A and B process separate flows without overlap.";
  const operation = applyDecompositionAssumptionOperation(builder.getProject(), {
    nodeId: rootNodeId, statement, changesConclusionWhen: "The routing or measurement unit changes.",
    evidence: { kind: "user_confirmed", sourceId: "user_message", quote: statement },
    relationship: { kind, operandNodeIds: ["stage_a", "stage_b"], unit: "t/h" }
  }, { operationId: "test_relationship", now: "2026-11-25T00:00:00Z" });
  if (operation.status !== "ok") throw new Error(operation.message);
  return operation.project;
}

it.each([
  ["serial_capacity", "stage_a + stage_b"],
  ["independent_additive", "min(stage_a, stage_b)"]
] as const)("rejects a contradictory %s formula on both shared readiness paths", (kind, formula) => {
  const model = modeledRelationship(kind, formula, 70, 90);
  for (const purpose of ["structural_model", "calculated_baseline"] as const) {
    const result = evaluateModelReadiness(model, { purpose });
    expect(result).toMatchObject({
      accepted: false, validation: { valid: false, errors: [{ code: "RELATIONSHIP_FORMULA_MISMATCH", nodeId: model.rootNodeId }] },
      relationshipChecks: [{ result: { status: "mismatch" } }]
    });
  }
});

it.each([
  ["serial_capacity", "stage_a + stage_b - max(stage_a, stage_b)", 70, 70],
  ["independent_additive", "stage_b + stage_a", 160, 170]
] as const)("verifies equivalent %s formulas without filling missing inputs", (kind, formula, baseline, simulated) => {
  const structure = modeledRelationship(kind, formula);
  const before = structuredClone(structure);
  expect(evaluateModelReadiness(structure, { purpose: "structural_model" })).toMatchObject({
    accepted: true, missingInputs: [{ nodeId: "stage_a" }, { nodeId: "stage_b" }],
    relationshipChecks: [{ result: { status: "passed", sampleCount: 7 } }]
  });
  expect(evaluateModelReadiness(structure, { purpose: "calculated_baseline" }).accepted).toBe(false);
  expect(structure).toEqual(before);

  const measured = modeledRelationship(kind, formula, 70, 90);
  const measuredBefore = structuredClone(measured);
  expect(evaluateModelReadiness(measured, { purpose: "calculated_baseline" })).toMatchObject({
    accepted: true, calculation: { rootValue: baseline }
  });
  expect(probeFactor(measured, { nodeId: "stage_b", value: 100 })).toMatchObject({
    status: "ok", result: { root: { baselineValue: baseline, simulatedValue: simulated },
      assumptions: [{ relationship: { kind }, verification: { status: "passed", sampleCount: 8 } }]
    }
  });
  expect(measured).toEqual(measuredBefore);
});

it("checks the actual measured pair and rejects stale units even when fixed samples pass", () => {
  const model = modeledRelationship("serial_capacity", "min(stage_a, stage_b) + max(0, stage_a - 1000)", 2000, 90);
  const result = evaluateModelReadiness(model, { purpose: "structural_model" });
  expect(result.relationshipChecks).toMatchObject([{ result: { status: "mismatch", inputs: [2000, 90], expected: 90, actual: 1090 } }]);

  const unitChanged = modeledRelationship("serial_capacity", "min(stage_a, stage_b)", 0, 90);
  expect(evaluateModelReadiness(unitChanged, { purpose: "calculated_baseline" })).toMatchObject({ accepted: true, calculation: { rootValue: 0 } });
  const second = unitChanged.graph.nodes.find(node => node.id === "stage_b")!;
  second.unit = "tonnes/hour";
  expect(evaluateModelReadiness(unitChanged, { purpose: "structural_model" }).accepted).toBe(true);
  second.unit = "t/min";
  expect(evaluateModelReadiness(unitChanged, { purpose: "structural_model" })).toMatchObject({
    accepted: false, relationshipChecks: [{ result: { status: "unverified" } }]
  });
});

it("keeps free-form custom topology readable without granting formula verification", () => {
  const model = modeledRelationship("serial_capacity", "stage_a + stage_b", 70, 90);
  const root = model.graph.nodes.find(node => node.id === model.rootNodeId)!;
  root.assumptions = ["Decomposition assumption: Local custom process\nReconsider if: Scheduling changes\nEvidence: Provisional"];
  const result = evaluateModelReadiness(model, { purpose: "structural_model" });
  expect(result.accepted).toBe(true);
  expect(result.relationshipChecks).toBeUndefined();

  root.assumptions[0] += "\nDecomposition relationship v1: invalid";
  expect(evaluateModelReadiness(model, { purpose: "structural_model" })).toMatchObject({
    accepted: false, issues: [expect.objectContaining({ code: "RELATIONSHIP_UNVERIFIED" })]
  });
});


function quantityRateModel(formula: string, quantity?: number, rate?: number) {
  const builder = new VdtBuilderSession();
  builder.createDraft({ rootKpi: "Total effort", projectTitle: "Recorded inventory", unit: "h" });
  const { rootNodeId } = builder.getProject();
  builder.addDriver({ parentNodeId: rootNodeId, nodeId: "quantity", name: "Recordings", unit: "count", baselineValue: quantity });
  builder.addDriver({ parentNodeId: rootNodeId, nodeId: "rate", name: "Effort per recording", unit: "h/item", baselineValue: rate });
  builder.setFormula({ nodeId: rootNodeId, formula });
  const statement = "The effort per recording applies to each counted recording.";
  const outcome = applyDecompositionAssumptionOperation(builder.getProject(), {
    nodeId: rootNodeId, statement, changesConclusionWhen: "The population or effort basis changes.",
    evidence: { kind: "user_confirmed", sourceId: "user:quantity-rate", quote: statement },
    relationship: { kind: "quantity_rate", operandNodeIds: ["quantity", "rate"], operandUnits: ["count", "h/item"], unit: "h" }
  }, { operationId: "test_quantity_rate", now: "2026-11-25T00:00:00Z" });
  if (outcome.status !== "ok") throw new Error(outcome.message);
  return outcome.project;
}

it("validates either product operand order with blank inputs and checks the real measured pair", () => {
  const structural = quantityRateModel("(rate) * (quantity)");
  const before = structuredClone(structural);
  expect(evaluateModelReadiness(structural, { purpose: "structural_model", requireDerivedRoot: true })).toMatchObject({
    accepted: true, missingInputs: [{ nodeId: "quantity" }, { nodeId: "rate" }],
    relationshipChecks: [{ result: { status: "passed", sampleCount: 7 } }]
  });
  expect(evaluateModelReadiness(structural, { purpose: "calculated_baseline" }).accepted).toBe(false);
  expect(structural).toEqual(before);

  const measured = quantityRateModel("quantity * rate", 12, 2.5);
  const measuredBefore = structuredClone(measured);
  expect(evaluateModelReadiness(measured, { purpose: "calculated_baseline" })).toMatchObject({
    accepted: true, calculation: { rootValue: 30 }, relationshipChecks: [{ result: { status: "passed", sampleCount: 8 } }]
  });
  expect(probeFactor(measured, { nodeId: "quantity", value: 0 })).toMatchObject({
    status: "ok", result: { root: { baselineValue: 30, simulatedValue: 0 },
      assumptions: [{ relationship: { kind: "quantity_rate" }, verification: { status: "passed", sampleCount: 8 } }] }
  });
  expect(measured).toEqual(measuredBefore);
  const actualMismatch = quantityRateModel("quantity * rate * (1 + max(0, quantity - 1000) / max(1, quantity))", 2000, 2.5);
  expect(evaluateModelReadiness(actualMismatch, { purpose: "structural_model" }).relationshipChecks)
    .toMatchObject([{ result: { status: "mismatch", inputs: [2000, 2.5], expected: 5000, actual: 7500 } }]);
});

it.each(["quantity + rate", "min(quantity, rate)", "quantity * rate * 2"])(
  "keeps the manual draft editable but refuses to verify the wrong quantity/rate formula %s", formula => {
    const draft = quantityRateModel(formula);
    expect(draft.graph.nodes.find(node => node.id === draft.rootNodeId)?.formula).toBe(formula);
    for (const purpose of ["structural_model", "calculated_baseline"] as const) {
      expect(evaluateModelReadiness(draft, { purpose })).toMatchObject({
        accepted: false, relationshipChecks: [{ result: { status: "mismatch" } }]
      });
    }
  }
);

it("leaves a clamped product unverified even when all numeric samples and the measured pair agree", () => {
  const formula = "min(quantity * rate, 1000)";
  const draft = quantityRateModel(formula, 12, 2.5);
  const before = structuredClone(draft);
  expect(evaluateModelReadiness(draft, { purpose: "structural_model" })).toMatchObject({
    accepted: false, relationshipChecks: [{ result: { status: "unverified", reason: expect.stringContaining("direct product") } }]
  });
  expect(draft).toEqual(before);
});

it("fails closed when a clamped calculation hides an overflowing expected product", () => {
  const draft = quantityRateModel("min(quantity * rate, 1000)", 1e308, 2);
  const nodes = new Map(draft.graph.nodes.map(node => [node.id, node]));
  const target = nodes.get(draft.rootNodeId)!;
  expect(verifyDecompositionRelationship(target, {
    kind: "quantity_rate", operandNodeIds: ["quantity", "rate"], operandUnits: ["count", "h/item"], unit: "h"
  }, nodes, { quantity: 1e308, rate: 2 })).toMatchObject({
    status: "unverified", reason: expect.stringContaining("finite numerical range")
  });
  expect(draft.graph.nodes.find(node => node.id === "quantity")?.baselineValue).toBe(1e308);
});

it("fails closed when a saved operand changes scale or a typed v2 line cannot be read", () => {
  const model = quantityRateModel("quantity * rate");
  model.graph.nodes.find(node => node.id === "rate")!.unit = "min/item";
  expect(evaluateModelReadiness(model, { purpose: "structural_model" })).toMatchObject({
    accepted: false, relationshipChecks: [{ result: { status: "unverified" } }]
  });
  const root = model.graph.nodes.find(node => node.id === model.rootNodeId)!;
  root.assumptions = root.assumptions!.map(note => note.replace("v2:", "v3:"));
  expect(evaluateModelReadiness(model, { purpose: "structural_model" })).toMatchObject({
    accepted: false, issues: expect.arrayContaining([expect.objectContaining({ code: "RELATIONSHIP_UNVERIFIED" })])
  });
  expect(root.assumptions[0]).toContain("Decomposition relationship v3:");
});

it("blocks a malformed no-space typed marker without treating the note as an ordinary assumption", () => {
  const model = quantityRateModel("quantity * rate");
  const root = model.graph.nodes.find(node => node.id === model.rootNodeId)!;
  root.assumptions = root.assumptions!.map(note => note.replace("v2: ", "v2:"));
  const before = structuredClone(model);
  expect(evaluateModelReadiness(model, { purpose: "structural_model" })).toMatchObject({
    accepted: false, relationshipChecks: [{ result: { status: "unverified" } }],
    issues: expect.arrayContaining([expect.objectContaining({ code: "RELATIONSHIP_UNVERIFIED" })])
  });
  expect(model).toEqual(before);
});

it("does not verify a product that depends on an unconfirmed third input", () => {
  const model = quantityRateModel("quantity * rate");
  const root = model.graph.nodes.find(node => node.id === model.rootNodeId)!;
  const quantity = model.graph.nodes.find(node => node.id === "quantity")!;
  model.graph.nodes.push({ ...quantity, id: "extra", name: "Unconfirmed factor", unit: "1", baselineValue: 1 });
  root.formula = "quantity * rate * extra";
  const before = structuredClone(model);
  expect(evaluateModelReadiness(model, { purpose: "structural_model" })).toMatchObject({
    accepted: false, relationshipChecks: [{ result: { status: "unverified", reason: expect.stringContaining("outside the two confirmed operands") } }]
  });
  expect(model).toEqual(before);
});
