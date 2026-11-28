import { describe, expect, it } from "vitest";
import { productionVolumeProject } from "../examples/production-volume";
import { calculateGraph } from "../formula/calculate";
import {
  applyDecompositionAssumptionOperation, readDecompositionAssumptions,
  type DecompositionAssumptionCommand, type QuantityRateDecompositionRelationship
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

const productStatement = "The total is the number of recordings multiplied by the effort per recording.";
const productEvidence = { kind: "user_confirmed", sourceId: "user:quantity-rate", quote: productStatement } as const;
const productRelationship: QuantityRateDecompositionRelationship = {
  kind: "quantity_rate", operandNodeIds: ["stage_a", "stage_b"], operandUnits: ["count", "h/item"], unit: "h"
};

function productFixture(outputUnit: string, quantityUnit: string, rateUnit: string) {
  const project = fixture("stage_a * stage_b", 3, 2.5);
  project.graph.nodes[0]!.unit = outputUnit;
  project.graph.nodes[1]!.unit = quantityUnit;
  project.graph.nodes[2]!.unit = rateUnit;
  return project;
}

function quantityRateCommand(
  relationship: QuantityRateDecompositionRelationship = productRelationship
): DecompositionAssumptionCommand {
  return { nodeId: "total", statement: productStatement, changesConclusionWhen: "The recorded population or unit changes.",
    evidence: productEvidence, relationship };
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

  it("writes v2 quantity/rate evidence and preserves neighboring historical notes and legacy v1 bytes", () => {
    const project = productFixture("h", "items", "hours/count");
    const v2 = applyDecompositionAssumptionOperation(project, quantityRateCommand(), operation);
    expect(v2.status).toBe("ok");
    if (v2.status !== "ok") return;
    const note = v2.result.note;
    expect(note.split("\n").at(-1)).toBe(`Decomposition relationship v2: ${JSON.stringify(productRelationship)}`);
    expect(v2.project.graph.nodes[0]!.assumptions).toEqual(["Historical note", note]);
    const reopened = JSON.parse(JSON.stringify(v2.project)) as typeof project;
    expect(readDecompositionAssumptions(reopened.graph.nodes[0]!)).toEqual([
      expect.objectContaining({ note, evidence: productEvidence, relationship: productRelationship })
    ]);
    expect(readDecompositionAssumptions({ assumptions: [note.replace("v2:", "v1:")] })).toEqual([]);
    expect(readDecompositionAssumptions({ assumptions: [note.replace("v2:", "v3:")] })).toEqual([]);
    expect(applyDecompositionAssumptionOperation(v2.project, quantityRateCommand(), operation))
      .toMatchObject({ status: "ok", project: v2.project });
    expect(applyDecompositionAssumptionOperation(v2.project, {
      ...quantityRateCommand(), previousNote: note, statement: "Different basis still needs confirmation.", evidence: provisional
    }, operation)).toMatchObject({ status: "error", code: "INVALID_ASSUMPTION" });

    const legacy = applyDecompositionAssumptionOperation(fixture("min(stage_a, stage_b)", 3, 2.5), {
      ...quantityRateCommand(), relationship: { kind: "serial_capacity", operandNodeIds: ["stage_a", "stage_b"], unit: "items/h" }
    }, operation);
    expect(legacy.status).toBe("ok");
    if (legacy.status !== "ok") return;
    expect(legacy.result.note.split("\n").at(-1)).toBe(
      'Decomposition relationship v1: {"kind":"serial_capacity","operandNodeIds":["stage_a","stage_b"],"unit":"items/h"}'
    );
    expect(readDecompositionAssumptions({ assumptions: [legacy.result.note.replace("v1:", "v2:")] })).toEqual([]);
  });

  it("allows a USD per-item rate in the same captured numerical basis", () => {
    const result = applyDecompositionAssumptionOperation(productFixture("USD", "count", "USD/item"),
      quantityRateCommand({ ...productRelationship, operandUnits: ["count", "USD/item"], unit: "USD" }), operation);
    expect(result.status).toBe("ok");
  });

  it.each([
    ["h", "count", "min/item"],
    ["h", "count", "h"],
    ["h", "assets", "h/asset"],
    ["h", "count", "h/asset"],
    ["h", "count", "h/percent"],
    ["MW", "count", "mW/item"],
    ["MW", "count", "MW/item"],
    ["unrecognized", "count", "unrecognized/item"],
    ["h", "count*widgets/widgets", "h/item"],
    ["h", "count", "h/item*widgets/widgets"],
    ["h", "count", "h/item*unknown^0"],
    ["h", "h/item", "count"]
  ])("rejects incompatible or unverifiable quantity/rate units %s, %s, %s", (unit, quantityUnit, rateUnit) => {
    const project = productFixture(unit, quantityUnit, rateUnit);
    expect(applyDecompositionAssumptionOperation(project,
      quantityRateCommand({ ...productRelationship, unit, operandUnits: [quantityUnit, rateUnit] }), operation))
      .toMatchObject({ status: "error", code: "INVALID_ASSUMPTION" });
  });

  it.each(["t^16", "t^-16"])("rejects unrepresentable same-scale units built from %s", term => {
    const unit = Array.from({ length: 7 }, () => term).join("*");
    const rateUnit = `${unit}/item`;
    expect(applyDecompositionAssumptionOperation(productFixture(unit, "count", rateUnit), quantityRateCommand({
      ...productRelationship, unit, operandUnits: ["count", rateUnit]
    }), operation)).toMatchObject({ status: "error", code: "INVALID_ASSUMPTION" });
  });

  it("keeps existing v1 formula unit compatibility for legacy equal bases", () => {
    const unit = "h*widgets/widgets";
    const project = productFixture(unit, "h", "h");
    expect(applyDecompositionAssumptionOperation(project, {
      ...quantityRateCommand(), relationship: { kind: "serial_capacity", operandNodeIds: ["stage_a", "stage_b"], unit }
    }, operation)).toMatchObject({ status: "ok", result: { note: expect.stringContaining("Decomposition relationship v1: ") } });
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
