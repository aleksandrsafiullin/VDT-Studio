import { describe, expect, it } from "vitest";
import { calculateGraph } from "../formula/calculate";
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
    builder.addDriver({ parentNodeId: "available_output", nodeId: "working_time", name: "Working time" });
    builder.setFormula({ nodeId: "available_output", formula: "capacity * working_time" });

    const layout = builder.layout();
    const validation = builder.validate();

    expect(layout.project.graph.nodes.every((node) => node.position)).toBe(true);
    expect(validation.validation.valid).toBe(true);
  });

  it("persists a user-supplied value and calculates a fully populated tree", () => {
    const builder = new VdtBuilderSession({ now: () => "2026-09-13T00:00:00.000Z" });
    builder.createDraft({ projectTitle: "Annual haulage", rootKpi: "Annual haulage" });
    const leaves = [
      { nodeId: "truck_count", name: "Truck count", value: 12 },
      { nodeId: "payload_t_per_trip", name: "Payload t per trip", value: 40 },
      { nodeId: "trips_per_hour_per_truck", name: "Trips per hour per truck", value: 2 },
      { nodeId: "scheduled_hours_per_year", name: "Scheduled hours per year", value: 5000 },
      { nodeId: "mechanical_availability", name: "Mechanical availability", value: 0.9 },
      { nodeId: "operating_utilization", name: "Operating utilization", value: 0.8 }
    ] as const;
    for (const leaf of leaves) {
      builder.addDriver({
        parentNodeId: "annual_haulage",
        nodeId: leaf.nodeId,
        name: leaf.name,
        type: "input",
        relation: "multiplicative_driver"
      });
    }
    builder.setFormula({
      nodeId: "annual_haulage",
      formula: "truck_count * payload_t_per_trip * trips_per_hour_per_truck * scheduled_hours_per_year * mechanical_availability * operating_utilization"
    });
    for (const leaf of leaves) {
      builder.updateNode({
        nodeId: leaf.nodeId,
        patch: {
          value: leaf.value,
          baselineValue: leaf.value,
          valueStatus: "user_provided_value",
          valueSource: {
            acceptedByUserInDialog: true,
            note: "User supplied"
          }
        }
      });
    }

    const truck = builder.getProject().graph.nodes.find((node) => node.id === "truck_count");
    expect(truck).toMatchObject({
      value: 12,
      baselineValue: 12,
      valueStatus: "user_provided_value",
      valueSource: { acceptedByUserInDialog: true, note: "User supplied" }
    });

    const calculation = calculateGraph(builder.getProject());
    expect(calculation.errors).toHaveLength(0);
    expect(calculation.rootValue).toBeCloseTo(12 * 40 * 2 * 5000 * 0.9 * 0.8);
  });
});
