import { describe, expect, it } from "vitest";
import { VdtBuilderSession, type VdtChangeSet } from "@vdt-studio/vdt-core";
import { applyPendingMutationProposal, proposeAndMaybeApplyMutation } from "./mutation-pipeline";
import { AgentRunStore } from "./run-store";
import type { AgentToolContext } from "./tool-registry";

const timestamp = "2026-06-29T00:00:00.000Z";

describe("mutation pipeline progressive scope", () => {
  it("marks only approval-pausing proposals for an immediate public snapshot refresh", () => {
    const automatic = createMutationContext({ autoApplyPatches: true });
    applyLayer(automatic.context, "production_volume", [
      { nodeId: "auto_child", name: "Auto child", baselineValue: 1 }
    ]);
    expect(automatic.context.store.getState(automatic.context.runId).events.find(
      (event) => event.type === "mutation_proposed"
    )?.metadata?.approvalRequired).toBe(false);

    const approval = createMutationContext({ autoApplyPatches: false });
    applyLayer(approval.context, "production_volume", [
      { nodeId: "approval_child", name: "Approval child", baselineValue: 1 }
    ]);
    expect(approval.context.store.getState(approval.context.runId).events.find(
      (event) => event.type === "mutation_proposed"
    )?.metadata?.approvalRequired).toBe(true);
    expect(approval.context.store.getSnapshot(approval.context.runId).status).toBe("waiting_approval");
  });

  it("never applies an approved proposal after the project head changed", () => {
    const { builder, context } = createMutationContext({ autoApplyPatches: false });
    applyLayer(context, "production_volume", [
      { nodeId: "stale_child", name: "Stale child", baselineValue: 1 }
    ]);
    const proposalRevision = context.store.getState(context.runId).pendingMutationProposal?.baseRevision;

    builder.updateNode({
      nodeId: "production_volume",
      patch: { name: "Manually renamed production" }
    });

    expect(() => applyPendingMutationProposal(context)).toThrow(/is stale/);
    expect(builder.getRevision()).not.toBe(proposalRevision);
    expect(builder.getProject().graph.nodes.map((node) => node.id)).not.toContain("stale_child");
    expect(context.store.getState(context.runId).pendingMutationProposal).toBeUndefined();
    expect(context.store.getState(context.runId).mutationProposals?.at(-1)).toMatchObject({
      status: "failed",
      failureReason: expect.stringContaining("is stale")
    });
  });

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

  it("bypasses the generic one-layer bound only when explicitly allowed and never for deepen_node", () => {
    const ordinaryAllowedLayer = createMutationContext();
    const ordinaryAllowedProposal = proposeAndMaybeApplyMutation(ordinaryAllowedLayer.context, {
      title: "Allowed ordinary layer",
      summary: "Existing skill-defined layers keep progressive bookkeeping.",
      targetNodeId: "production_volume",
      changeSet: changeSet("allowed_ordinary_layer", [
        { nodeId: "ordinary_child", parentNodeId: "production_volume", name: "Ordinary child" }
      ]),
      allowSkillDefinedDepth: true
    });
    expect(ordinaryAllowedProposal.proposal.progressiveScope).toMatchObject({
      targetNodeId: "production_volume",
      allowGrandchildrenInSingleMutation: false
    });

    const deepChangeSet = changeSet("explicit_deep_tree", [
      { nodeId: "working_time", parentNodeId: "production_volume", name: "Working time" },
      { nodeId: "planned_downtime", parentNodeId: "working_time", name: "Planned downtime" }
    ]);
    const ordinary = createMutationContext();
    expect(() => proposeAndMaybeApplyMutation(ordinary.context, {
      title: "Ordinary deep tree",
      summary: "Ordinary tools remain one-layer bounded.",
      targetNodeId: "production_volume",
      changeSet: deepChangeSet
    })).toThrow(/only one target node|cannot add grandchildren/);
    expect(ordinary.builder.getProject().graph.nodes.map((node) => node.id)).toEqual(["production_volume"]);

    const explicitlyAllowed = createMutationContext();
    proposeAndMaybeApplyMutation(explicitlyAllowed.context, {
      title: "Explicit deep tree",
      summary: "A deterministic domain tool may submit a prevalidated subtree.",
      targetNodeId: "production_volume",
      changeSet: deepChangeSet,
      allowSkillDefinedDepth: true
    });
    expect(explicitlyAllowed.builder.getProject().graph.nodes.map((node) => node.id)).toEqual([
      "production_volume",
      "working_time",
      "planned_downtime"
    ]);

    const deepen = createMutationContext({ mode: "deepen_node", selectedNodeId: "production_volume" });
    expect(() => proposeAndMaybeApplyMutation(deepen.context, {
      title: "Deepen mode deep tree",
      summary: "Deepen mode remains one-layer bounded.",
      targetNodeId: "production_volume",
      changeSet: deepChangeSet,
      allowSkillDefinedDepth: true
    })).toThrow(/immediate children/);
    expect(deepen.builder.getProject().graph.nodes.map((node) => node.id)).toEqual(["production_volume"]);
  });

  it("keeps deepen_node runs on the selected KPI's immediate child layer", () => {
    const { builder, context } = createMutationContext({
      mode: "deepen_node",
      selectedNodeId: "production_volume"
    });

    applyLayer(context, "production_volume", [
      { nodeId: "throughput_rate", name: "Throughput rate" },
      { nodeId: "working_time", name: "Working time" }
    ]);

    expect(() =>
      applyLayer(context, "working_time", [
        { nodeId: "scheduled_shift_time", name: "Scheduled shift time" }
      ])
    ).toThrow(/only the selected KPI "production_volume"/);

    expect(builder.getProject().graph.nodes.map((node) => node.id)).toEqual([
      "production_volume",
      "throughput_rate",
      "working_time"
    ]);
  });
});

function createMutationContext(options: {
  mode?: "generate_vdt" | "deepen_node";
  selectedNodeId?: string | undefined;
  autoApplyPatches?: boolean | undefined;
} = {}): { builder: VdtBuilderSession; context: AgentToolContext } {
  const store = new AgentRunStore({ now: () => timestamp });
  const run = store.createRun({
    mode: options.mode ?? "generate_vdt",
    input: {
      rootKpi: "Production Volume",
      unit: "tonnes",
      timePeriod: "month",
      ...(options.selectedNodeId ? { selectedNodeId: options.selectedNodeId } : {})
    },
    providerId: "mock",
    options: { autoApplyPatches: options.autoApplyPatches ?? true }
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
