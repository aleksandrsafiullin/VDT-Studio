import { describe, expect, it } from "vitest";
import { VdtBuilderSession, type VdtChangeSet } from "@vdt-studio/vdt-core";
import { proposeAndMaybeApplyMutation } from "./mutation-pipeline";
import { AgentRunStore } from "./run-store";
import type { AgentToolContext } from "./tool-registry";

const timestamp = "2026-06-29T00:00:00.000Z";

describe("mutation pipeline progressive scope", () => {
  it("allows progressive mutations beyond the legacy maxAutoDepth one layer at a time", () => {
    const { builder, context } = createMutationContext();

    applyLayer(context, "production_volume", [
      { nodeId: "throughput_rate", name: "Throughput rate", baselineValue: 10 },
      { nodeId: "working_time", name: "Working time" }
    ]);
    applyLayer(context, "working_time", [
      { nodeId: "scheduled_shift_time", name: "Scheduled shift time", baselineValue: 100 },
      { nodeId: "downtime", name: "Downtime" }
    ]);
    applyLayer(context, "downtime", [
      { nodeId: "planned_downtime", name: "Planned downtime", baselineValue: 10 },
      { nodeId: "unplanned_downtime", name: "Unplanned downtime", baselineValue: 5 }
    ]);

    applyLayer(context, "planned_downtime", [
      { nodeId: "maintenance_downtime", name: "Maintenance downtime", baselineValue: 2 }
    ]);

    expect(builder.getProject().graph.nodes.map((node) => node.id)).toContain("maintenance_downtime");
    expect(context.store.getSnapshot(context.runId).progressiveBuild).toMatchObject({
      currentDepth: 4,
      frontierNodeIds: expect.arrayContaining(["maintenance_downtime"])
    });
  });

  it("rejects one proposal that connects newly added nodes as parent and child", () => {
    const { builder, context } = createMutationContext();

    expect(() =>
      proposeAndMaybeApplyMutation(context, {
        title: "Deep layer rejected",
        summary: "Attempted to add a visible layer and its child in one proposal.",
        targetNodeId: "production_volume",
        changeSet: changeSet("deep_layer", [
          { nodeId: "working_time", parentNodeId: "production_volume", name: "Working time" },
          { nodeId: "planned_downtime", parentNodeId: "production_volume", name: "Planned downtime" }
        ], [
          {
            id: "edge_working_time_planned_downtime",
            action: "add",
            edge: {
              id: "edge_working_time_planned_downtime",
              sourceNodeId: "working_time",
              targetNodeId: "planned_downtime",
              relation: "subtractive_component"
            }
          }
        ])
      })
    ).toThrow(/cannot connect newly added nodes as parent and child/);

    expect(builder.getProject().graph.nodes.map((node) => node.id)).toEqual(["production_volume"]);
  });
});

function createMutationContext(): { builder: VdtBuilderSession; context: AgentToolContext } {
  const store = new AgentRunStore({ now: () => timestamp });
  const run = store.createRun({
    mode: "generate_vdt",
    input: {
      rootKpi: "Production Volume",
      unit: "tonnes",
      timePeriod: "month"
    },
    providerId: "mock",
    options: { autoApplyPatches: true }
  });
  const builder = new VdtBuilderSession({ now: () => timestamp });
  builder.createDraft({
    projectTitle: "Production Volume Driver Model",
    rootKpi: "Production Volume",
    unit: "tonnes",
    timePeriod: "month"
  });
  store.updateRun(run.runId, { builder, draftProject: builder.getProject() });
  const context: AgentToolContext = {
    runId: run.runId,
    store,
    emit: (event) => store.appendEvent(run.runId, event),
    getRun: () => store.getSnapshot(run.runId),
    updateRun: (patch) => {
      store.updateRun(run.runId, patch);
    },
    builder,
    signal: run.abortController.signal
  };
  return { builder, context };
}

function applyLayer(
  context: AgentToolContext,
  parentNodeId: string,
  nodes: Array<{ nodeId: string; name: string; baselineValue?: number | undefined }>
): void {
  proposeAndMaybeApplyMutation(context, {
    title: "Layer added",
    summary: `Added ${nodes.length} node${nodes.length === 1 ? "" : "s"} under ${parentNodeId}.`,
    targetNodeId: parentNodeId,
    changeSet: changeSet(`${parentNodeId}_${nodes.map((node) => node.nodeId).join("_")}`, nodes.map((node) => ({
      ...node,
      parentNodeId
    })))
  });
}

function changeSet(
  id: string,
  additions: Array<{
    nodeId: string;
    parentNodeId: string;
    name: string;
    baselineValue?: number | undefined;
  }>,
  edgeChanges: VdtChangeSet["edgeChanges"] = []
): VdtChangeSet {
  return {
    id: `changeset_${id}`,
    taskType: "generate_tree",
    backendId: "test",
    createdAt: timestamp,
    additions: additions.map((addition) => ({
      id: `add_${addition.nodeId}`,
      nodeId: addition.nodeId,
      parentNodeId: addition.parentNodeId,
      relation: "positive_driver",
      name: addition.name,
      type: addition.baselineValue === undefined ? "calculated" : "input",
      ...(addition.baselineValue !== undefined ? { baselineValue: addition.baselineValue } : {})
    })),
    updates: [],
    deletions: [],
    edgeChanges,
    assumptions: [],
    questions: [],
    warnings: []
  };
}
