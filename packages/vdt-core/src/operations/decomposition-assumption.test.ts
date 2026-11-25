import { describe, expect, it } from "vitest";
import { productionVolumeProject } from "../examples/production-volume";
import { calculateGraph } from "../formula/calculate";
import {
  applyDecompositionAssumptionOperation, readDecompositionAssumptions,
  type DecompositionAssumptionCommand
} from "./decomposition-assumption";

const operation = { operationId: "test", now: "2026-11-24T00:00:00Z" };
const provisional = { kind: "provisional" } as const;

function fixture(formula: string, first: number, second: number) {
  const template = structuredClone(productionVolumeProject);
  const [root, left, right] = template.graph.nodes;
  return {
    ...template, rootNodeId: "total",
    graph: {
      nodes: [
        { ...root!, id: "total", formula, unit: "items/h", assumptions: ["Historical note"] },
        { ...left!, id: "stage_a", type: "input" as const, formula: undefined, unit: "items/h", baselineValue: first },
        { ...right!, id: "stage_b", type: "input" as const, formula: undefined, unit: "items/h", baselineValue: second }
      ],
      edges: []
    }
  };
}

describe("relationship assumptions", () => {
  it("records unresolved scope provisionally and revises it from a confirmed user source", () => {
    const project = fixture("min(stage_a, stage_b)", 70, 90);
    const choices = {
      nodeId: "total", statement: "If these stages are serial, capacity is limited by the slower stage.",
      changesConclusionWhen: "Are both stages required in sequence for the same items and measurement period, or are the outputs independent?",
      evidence: provisional
    };
    const initial = applyDecompositionAssumptionOperation(project, choices, operation);
    expect(initial.status).toBe("ok");
    if (initial.status !== "ok") return;
    expect(initial.result.evidence.kind).toBe("provisional");

    const quote = "Both stages are required in sequence for the same items and measurement period.";
    const confirm = applyDecompositionAssumptionOperation(initial.project, {
      ...choices, statement: quote, previousNote: initial.result.note,
      changesConclusionWhen: "Independent outputs over the same period could be added.",
      evidence: { kind: "user_confirmed", sourceId: "run_1:chat:7", quote }
    }, operation);
    expect(confirm.status).toBe("ok");
    if (confirm.status !== "ok") return;
    expect(readDecompositionAssumptions(confirm.project.graph.nodes[0]!)).toEqual([
      expect.objectContaining({ statement: quote, evidence: { kind: "user_confirmed", sourceId: "run_1:chat:7", quote } })
    ]);
    expect(confirm.project.graph.nodes[0]!.assumptions).toContain("Historical note");
    expect(project.graph.nodes[0]!.assumptions).toEqual(["Historical note"]);
    expect(calculateGraph(confirm.project).rootValue).toBe(70);
    expect(applyDecompositionAssumptionOperation(confirm.project, {
      ...choices, previousNote: initial.result.note
    }, operation)).toMatchObject({ status: "error", code: "STALE_ASSUMPTION" });
  });

  it.each([
    ["stage_a + stage_b", 70, 90, "The independent parallel lines produce separate items from the same reporting period.", "Shared flow would require a bottleneck or overlap adjustment.", 160],
    ["stage_a + stage_b", 80, 30, "Preventive cost and corrective cost use disjoint accounts.", "Remove overlap if the corrective total already contains any preventive costs.", 110],
    ["stage_a * stage_b", 20, 5, "The fixed rate applies to each of these completed jobs.", "Separate the rates if some jobs attract a different charge.", 100]
  ] as const)("preserves calculation %s for a distinct business relationship", (formula, left, right, statement, changesConclusionWhen, total) => {
    const project = fixture(formula, left, right);
    const command: DecompositionAssumptionCommand = {
      nodeId: "total", statement, changesConclusionWhen, evidence: provisional
    };
    const added = applyDecompositionAssumptionOperation(project, command, operation);
    expect(added.status).toBe("ok");
    if (added.status !== "ok") return;
    expect(calculateGraph(added.project).rootValue).toBe(total);
    expect(applyDecompositionAssumptionOperation(added.project, command, operation))
      .toMatchObject({ status: "ok", project: added.project });
  });
});
