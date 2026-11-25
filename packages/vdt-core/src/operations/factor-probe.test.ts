import { describe, expect, it } from "vitest";
import { productionVolumeProject } from "../examples/production-volume";
import type { VdtNode, VdtProject } from "../types";
import { applyDecompositionAssumptionOperation } from "./decomposition-assumption";
import { probeFactor } from "./factor-probe";

const now = "2026-11-24T00:00:00.000Z";
const context = { now, operationId: "test" };

function node(id: string, input: Partial<VdtNode>): VdtNode {
  return { id, name: id, type: "input", status: "accepted", aiGenerated: false, createdAt: now, updatedAt: now, ...input };
}

function project(nodes: VdtNode[]): VdtProject {
  return {
    ...productionVolumeProject, rootNodeId: "root",
    graph: { nodes, edges: [] },
    scenarios: [{ ...productionVolumeProject.scenarios[0]!, overrides: [{ nodeId: "a", value: 200 }] }]
  };
}

describe("probeFactor", () => {
  it.each([
    { formula: "min(a, b)", statement: "The stages are serial.", baseline: 70, simulated: 70, delta: 0 },
    { formula: "a + b", statement: "The stages are independent and parallel.", baseline: 160, simulated: 170, delta: 10 }
  ])("isolates b using $formula and cites the recorded relationship", ({ formula, statement, baseline, simulated, delta }) => {
    const input = project([
      node("root", { type: "root_kpi", formula: "throughput", unit: "t/h" }),
      node("throughput", { type: "calculated", formula, unit: "t/h" }),
      node("a", { baselineValue: 70, unit: "t/h" }),
      node("b", { baselineValue: 90, unit: "t/h" })
    ]);
    const evidence = { kind: "user_confirmed", sourceId: "user:test", quote: statement } as const;
    const assumption = applyDecompositionAssumptionOperation(input, {
      nodeId: "throughput", statement, evidence, changesConclusionWhen: "The flow relationship changes."
    }, context);
    if (assumption.status !== "ok") throw new Error(assumption.message);
    const model = assumption.project;
    const before = structuredClone(model);

    expect(probeFactor(model, { nodeId: "b", value: 100 })).toMatchObject({
      status: "ok", result: {
        kind: "modeled_sensitivity",
        input: { nodeId: "b", baselineValue: 90, simulatedValue: 100, unit: "t/h" },
        root: { nodeId: "root", baselineValue: baseline, simulatedValue: simulated, absoluteChange: delta, unit: "t/h" },
        assumptions: [{ nodeId: "throughput", statement, evidence, changesConclusionWhen: "The flow relationship changes." }],
        errorCount: 0
      }
    });
    expect(model).toEqual(before);
  });

  it("models disjoint costs and accepts a zero override", () => {
    const input = project([
      node("root", { type: "root_kpi", formula: "a + b", unit: "USD" }),
      node("a", { name: "Preventive maintenance", baselineValue: 40, unit: "USD" }),
      node("b", { name: "Corrective maintenance", baselineValue: 15, unit: "USD" })
    ]);
    const assumption = applyDecompositionAssumptionOperation(input, {
      nodeId: "root", statement: "The accounts are disjoint.", evidence: { kind: "provisional" },
      changesConclusionWhen: "One account starts including work from the other."
    }, context);
    if (assumption.status !== "ok") throw new Error(assumption.message);

    expect(probeFactor(assumption.project, { nodeId: "b", value: 0 })).toMatchObject({
      status: "ok", result: {
        root: { baselineValue: 55, simulatedValue: 40, absoluteChange: -15, unit: "USD" },
        assumptions: [{ nodeId: "root", evidence: { kind: "provisional" } }]
      }
    });
  });

  it("reports an unavailable baseline and delta when the measured input is unknown", () => {
    const input = project([
      node("root", { type: "root_kpi", formula: "a + b" }),
      node("a", { baselineValue: 10 }),
      node("b", { valueStatus: "unknown" })
    ]);

    expect(probeFactor(input, { nodeId: "b", value: 5 })).toMatchObject({
      status: "ok", result: {
        input: { baselineValue: null, simulatedValue: 5 },
        root: { baselineValue: null, simulatedValue: 15, absoluteChange: null },
        errors: expect.arrayContaining([expect.objectContaining({ type: "missing_value", nodeId: "b" })])
      }
    });
  });

  it("rejects fixed, missing and non-input KPIs and non-finite overrides", () => {
    const input = project([
      node("root", { type: "root_kpi", formula: "a + b" }),
      node("a", { baselineValue: 10, fixedInScenario: true }),
      node("b", { baselineValue: 1 })
    ]);
    expect(probeFactor(input, { nodeId: "a", value: 0 })).toMatchObject({ code: "SCENARIO_INPUT_FIXED" });
    expect(probeFactor(input, { nodeId: "missing", value: 0 })).toMatchObject({ code: "NODE_NOT_FOUND" });
    expect(probeFactor(input, { nodeId: "root", value: 0 })).toMatchObject({ code: "NOT_SCENARIO_INPUT" });
    expect(probeFactor(input, { nodeId: "b", value: Infinity })).toMatchObject({ code: "INVALID_SCENARIO_VALUE" });
  });
});
