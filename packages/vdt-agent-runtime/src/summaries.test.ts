import { describe, expect, it } from "vitest";
import { calculateGraph, VdtBuilderSession } from "@vdt-studio/vdt-core";
import { buildFormulaBacklog, summarizeCalculation, summarizeEvents, summarizeProjectForDecision } from "./summaries";

describe("calculation summaries", () => {
  it("omits missing values and contains only dense JSON properties", () => {
    const builder = new VdtBuilderSession({
      now: () => "2026-08-25T00:00:00.000Z"
    });
    builder.createDraft({
      projectTitle: "Progressive haulage model",
      rootKpi: "Ore shipped"
    });
    builder.addDriver({
      parentNodeId: "ore_shipped",
      nodeId: "truck_count",
      name: "Truck count",
      type: "input",
      relation: "multiplicative_driver",
      baselineValue: 18
    });
    builder.addDriver({
      parentNodeId: "ore_shipped",
      nodeId: "trips_per_truck",
      name: "Trips per truck",
      type: "calculated",
      relation: "multiplicative_driver"
    });

    const calculation = calculateGraph(builder.getProject());
    expect(calculation.rootValue).toBeUndefined();
    expect(calculation.errors.some((error) => error.type === "missing_value")).toBe(true);

    const summary = summarizeCalculation(calculation);
    expect(summary).not.toHaveProperty("rootValue");
    expect(summary).toStrictEqual(JSON.parse(JSON.stringify(summary)));
  });
});

describe("decision context summaries", () => {
  it("prioritizes root, bottom-up formula backlog, frontier paths, and caps context at 24 nodes", () => {
    const builder = new VdtBuilderSession({ now: () => "2026-08-25T00:00:00.000Z" });
    builder.createDraft({ projectTitle: "Revenue", rootKpi: "Revenue" });
    builder.addDriver({
      parentNodeId: "revenue",
      nodeId: "working_time",
      name: "Working time",
      type: "calculated"
    });
    builder.addDriver({ parentNodeId: "working_time", nodeId: "hours", name: "Hours", type: "input", baselineValue: 8 });
    builder.addDriver({ parentNodeId: "working_time", nodeId: "days", name: "Days", type: "input", baselineValue: 250 });
    for (let index = 0; index < 28; index += 1) {
      builder.addDriver({
        parentNodeId: "revenue",
        nodeId: `input_${index}`,
        name: `Input ${index}`,
        type: "input",
        baselineValue: index + 1
      });
    }
    const project = builder.getProject();

    expect(buildFormulaBacklog(project).map((item) => item.nodeId)).toEqual(["working_time", "revenue"]);
    const summary = summarizeProjectForDecision(project, ["input_27"]);
    expect(summary.nodes).toHaveLength(24);
    expect(summary.truncated).toBe(true);
    expect(summary.nodes.map((node) => node.id)).toEqual(expect.arrayContaining([
      "revenue",
      "working_time",
      "input_27"
    ]));
  });

  it("keeps only the last 12 significant events by default", () => {
    const events = Array.from({ length: 20 }, (_, index) => ({
      id: `event_${index}`,
      runId: "run",
      seq: index + 1,
      timestamp: "2026-08-25T00:00:00.000Z",
      phase: "building_graph" as const,
      type: "graph_patch" as const,
      title: `Event ${index}`,
      message: `Message ${index}`
    }));

    expect(summarizeEvents(events).map((event) => event.id)).toEqual(
      Array.from({ length: 12 }, (_, index) => `event_${index + 8}`)
    );
  });

  it("does not let decision transport noise displace completed tool calls", () => {
    const events = [
      {
        id: "skill_read",
        runId: "run",
        seq: 1,
        timestamp: "2026-08-25T00:00:00.000Z",
        phase: "reading_skills" as const,
        type: "tool_call_completed" as const,
        title: "Tool completed",
        message: "Read skill",
        metadata: { toolName: "skill.read" }
      },
      ...Array.from({ length: 20 }, (_, index) => ({
        id: `decision_${index}`,
        runId: "run",
        seq: index + 2,
        timestamp: "2026-08-25T00:00:00.000Z",
        phase: "planning_decomposition" as const,
        type: index % 2 === 0 ? "tool_call_started" as const : "tool_call_completed" as const,
        title: "AI decision",
        message: "Decision transport event",
        metadata: { taskType: "agent_decision" }
      }))
    ];

    expect(summarizeEvents(events)).toEqual([
      expect.objectContaining({ id: "skill_read", metadata: { toolName: "skill.read" } })
    ]);
  });
});
