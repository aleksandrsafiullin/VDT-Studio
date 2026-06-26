import { describe, expect, it } from "vitest";
import { VdtBuilderSession } from "./session";

describe("VdtBuilderSession", () => {
  it("creates immutable drafts and adds revisioned driver change sets", () => {
    const builder = new VdtBuilderSession({
      providerId: "test_provider",
      now: () => "2026-06-26T00:00:00.000Z"
    });

    const draft = builder.createDraft({
      projectTitle: "Ore mined Driver Model",
      rootKpi: "Ore mined",
      unit: "tonnes",
      timePeriod: "monthly",
      industry: "Mining"
    });
    const before = draft.project;

    expect(draft.project.rootNodeId).toBe("ore_mined");
    expect(draft.revision).toBe(1);
    expect(before.graph.nodes).toHaveLength(1);

    const added = builder.addDriver({
      parentNodeId: "ore_mined",
      nodeId: "effective_working_time",
      name: "Effective working time",
      relation: "multiplicative_driver"
    });

    expect(added.revision).toBe(2);
    expect(added.changeSet?.additions[0]?.nodeId).toBe("effective_working_time");
    expect(added.event.revision).toBe(2);
    expect(before.graph.nodes).toHaveLength(1);
    expect(added.project.graph.nodes).toHaveLength(2);
  });

  it("validates formulas before mutation", () => {
    const builder = new VdtBuilderSession({ now: () => "2026-06-26T00:00:00.000Z" });
    builder.createDraft({ projectTitle: "Revenue", rootKpi: "Revenue" });

    expect(() => builder.setFormula({ nodeId: "revenue", formula: "units_sold *" })).toThrow(
      /Expected a number/
    );
    expect(builder.getProject().graph.nodes.find((node) => node.id === "revenue")?.formula).toBeUndefined();
  });

  it("rejects missing edge endpoints and root deletion", () => {
    const builder = new VdtBuilderSession({ now: () => "2026-06-26T00:00:00.000Z" });
    builder.createDraft({ projectTitle: "Production", rootKpi: "Production Volume" });

    expect(() =>
      builder.addEdge({
        sourceNodeId: "production_volume",
        targetNodeId: "missing",
        relation: "positive_driver"
      })
    ).toThrow(/does not exist/);
    expect(() => builder.deleteNode({ nodeId: "production_volume", cascadeEdges: true })).toThrow(/Root node/);
  });

  it("layouts and validates the draft graph", () => {
    const builder = new VdtBuilderSession({ now: () => "2026-06-26T00:00:00.000Z" });
    builder.createDraft({ projectTitle: "Available output", rootKpi: "Available output" });
    builder.addDriver({ parentNodeId: "available_output", nodeId: "capacity", name: "Capacity" });
    builder.addDriver({ parentNodeId: "available_output", nodeId: "utilization", name: "Utilization" });
    builder.setFormula({ nodeId: "available_output", formula: "capacity * utilization" });

    const layout = builder.layout();
    const validation = builder.validate();

    expect(layout.project.graph.nodes.every((node) => node.position)).toBe(true);
    expect(validation.validation.valid).toBe(true);
  });
});
