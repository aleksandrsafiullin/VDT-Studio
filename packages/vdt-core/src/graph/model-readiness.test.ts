import { describe, expect, it } from "vitest";
import {
  WORKSPACE_MODEL_READINESS_POLICY_VERSION,
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
