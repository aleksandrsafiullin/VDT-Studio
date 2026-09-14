import { describe, expect, it } from "vitest";
import { z } from "zod";
import { VdtBuilderSession } from "@vdt-studio/vdt-core";
import { AgentRunStore } from "./run-store";
import { ToolRegistry, type AgentToolContext } from "./tool-registry";
import { SCHEMA_ISSUE_SUMMARY_MAX_CHARS } from "./schema-issue-summary";
import { createDefaultToolRegistry } from "./tools";

describe("ToolRegistry", () => {
  it("rejects unknown tools and emits a recoverable event", async () => {
    const store = new AgentRunStore({ now: () => "2026-06-26T00:00:00.000Z" });
    const run = store.createRun({
      mode: "generate_vdt",
      input: { rootKpi: "Revenue" },
      providerId: "mock",
      options: { autoApplyPatches: true }
    });
    const registry = new ToolRegistry();

    const result = await registry.run("missing.tool", {}, {
      runId: run.runId,
      store,
      emit: (event) => store.appendEvent(run.runId, event),
      getRun: () => store.getSnapshot(run.runId),
      updateRun: (patch) => {
        store.updateRun(run.runId, patch);
      },
      signal: run.abortController.signal
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("UNKNOWN_TOOL");
    expect(store.getSnapshot(run.runId).events.at(-1)?.type).toBe("tool_call_completed");
  });

  it("validates tool args with zod before running handler", async () => {
    const store = new AgentRunStore({ now: () => "2026-06-26T00:00:00.000Z" });
    const run = store.createRun({
      mode: "generate_vdt",
      input: { rootKpi: "Revenue" },
      providerId: "mock",
      options: { autoApplyPatches: true }
    });
    const registry = new ToolRegistry();
    registry.register({
      name: "test.echo",
      description: "Echo bounded input.",
      inputSchema: z.object({ value: z.string() }),
      outputSchema: z.object({ value: z.string() }),
      run: (_context, input) => input
    });

    const result = await registry.run("test.echo", { value: 1 }, {
      runId: run.runId,
      store,
      emit: (event) => store.appendEvent(run.runId, event),
      getRun: () => store.getSnapshot(run.runId),
      updateRun: (patch) => {
        store.updateRun(run.runId, patch);
      },
      signal: run.abortController.signal
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_TOOL_ARGS");
    expect(result.error?.message).toContain("value (invalid_type: expected=string received=number)");
    expect(store.getSnapshot(run.runId).events.at(-1)?.message).toContain("value (invalid_type: expected=string received=number)");
  });

  it("normalizes common VDT builder enum aliases before validation", async () => {
    const store = new AgentRunStore({ now: () => "2026-06-26T00:00:00.000Z" });
    const run = store.createRun({
      mode: "generate_vdt",
      input: { rootKpi: "Revenue" },
      providerId: "mock",
      options: { autoApplyPatches: true }
    });
    const builder = new VdtBuilderSession({ now: () => "2026-06-26T00:00:00.000Z" });
    builder.createDraft({ projectTitle: "Revenue", rootKpi: "Revenue" });
    store.updateRun(run.runId, { builder, draftProject: builder.getProject() });
    const registry = createDefaultToolRegistry();

    const result = await registry.run("vdt.add_driver", {
      parentNodeId: "revenue",
      name: "Price",
      type: "driver",
      relation: "determines",
      baselineValue: null
    }, {
      runId: run.runId,
      store,
      emit: (event) => store.appendEvent(run.runId, event),
      getRun: () => store.getSnapshot(run.runId),
      updateRun: (patch) => {
        store.updateRun(run.runId, patch);
      },
      builder,
      signal: run.abortController.signal
    });

    expect(result.ok).toBe(true);
    const project = builder.getProject();
    expect(project.graph.nodes.find((node) => node.name === "Price")).toMatchObject({ type: "input" });
    expect(project.graph.edges.at(-1)).toMatchObject({ relation: "positive_driver" });
  });

  it("adds multiple VDT drivers and normalizes live enum aliases in one batch tool call", async () => {
    const store = new AgentRunStore({ now: () => "2026-06-26T00:00:00.000Z" });
    const run = store.createRun({
      mode: "generate_vdt",
      input: { rootKpi: "Excavation", unit: "tonnes/year", timePeriod: "year" },
      providerId: "mock",
      options: { autoApplyPatches: true }
    });
    const builder = new VdtBuilderSession({ now: () => "2026-06-26T00:00:00.000Z" });
    builder.createDraft({
      projectTitle: "Excavation Driver Model",
      rootKpi: "Excavation",
      unit: "tonnes/year",
      timePeriod: "year"
    });
    store.updateRun(run.runId, { builder, draftProject: builder.getProject() });
    const registry = createDefaultToolRegistry();

    const result = await registry.run("vdt.add_drivers_batch", {
      drivers: [
        {
          parentNodeId: "excavation",
          nodeId: "excavator_count",
          name: "Excavator count",
          type: "input_kpi",
          unit: "units",
          relation: "multiply",
          baselineValue: 5
        },
        {
          parentNodeId: "excavation",
          nodeId: "shift_count",
          name: "Shift count",
          type: "calculated_kpi",
          unit: "shifts/day",
          relation: "multiply"
        }
      ],
      parentFormula: "excavator_count * shift_count"
    }, {
      runId: run.runId,
      store,
      emit: (event) => store.appendEvent(run.runId, event),
      getRun: () => store.getSnapshot(run.runId),
      updateRun: (patch) => {
        store.updateRun(run.runId, patch);
      },
      builder,
      signal: run.abortController.signal
    });

    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({ nodeIds: ["excavator_count", "shift_count"] });
    const project = builder.getProject();
    expect(project.graph.nodes.map((node) => node.id)).toEqual(expect.arrayContaining([
      "excavator_count",
      "shift_count"
    ]));
    expect(project.graph.nodes.find((node) => node.id === "excavator_count")?.type).toBe("input");
    expect(project.graph.nodes.find((node) => node.id === "shift_count")?.type).toBe("calculated");
    expect(project.graph.nodes.find((node) => node.id === "excavation")?.formula).toBe("excavator_count * shift_count");
    expect(project.graph.edges.slice(-2).map((edge) => edge.relation)).toEqual([
      "multiplicative_driver",
      "multiplicative_driver"
    ]);
    expect(store.getSnapshot(run.runId).events.some((event) => event.message.includes("Added 2 drivers"))).toBe(true);
  });

  it("names field paths and expected types when add_drivers_batch arguments are invalid", async () => {
    const store = new AgentRunStore({ now: () => "2026-06-26T00:00:00.000Z" });
    const run = store.createRun({
      mode: "generate_vdt",
      input: { rootKpi: "Excavation" },
      providerId: "mock",
      options: { autoApplyPatches: true }
    });
    const builder = new VdtBuilderSession({ now: () => "2026-06-26T00:00:00.000Z" });
    builder.createDraft({ projectTitle: "Excavation", rootKpi: "Excavation" });
    store.updateRun(run.runId, { builder, draftProject: builder.getProject() });
    const registry = createDefaultToolRegistry();
    const secret = "echo-me-not-load-per-trip-12t";

    const result = await registry.run("vdt.add_drivers_batch", {
      drivers: [
        { parentNodeId: 1, name: true, assumptions: secret },
        { parentNodeId: null, name: { leaked: secret }, assumptions: secret }
      ]
    }, {
      runId: run.runId,
      store,
      emit: (event) => store.appendEvent(run.runId, event),
      getRun: () => store.getSnapshot(run.runId),
      updateRun: (patch) => {
        store.updateRun(run.runId, patch);
      },
      builder,
      signal: run.abortController.signal
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_TOOL_ARGS");
    const message = result.error?.message ?? "";
    expect(message).toContain("drivers.0.parentNodeId (invalid_type: expected=string received=number)");
    expect(message).toContain("drivers.0.name (invalid_type: expected=string received=boolean)");
    expect(message).toContain("drivers.0.assumptions (invalid_type: expected=array received=string)");
    expect(message).toContain("drivers.1.parentNodeId (invalid_type: expected=string received=null)");
    expect(message).not.toContain(secret);
    expect(message.length).toBeLessThanOrEqual(SCHEMA_ISSUE_SUMMARY_MAX_CHARS);
    expect(store.getSnapshot(run.runId).draftProject?.graph.nodes).toHaveLength(1);
  });


  it("persists a user-supplied number through vdt.update_node and calculates the root", async () => {
    const store = new AgentRunStore({ now: () => "2026-06-26T00:00:00.000Z" });
    const run = store.createRun({
      mode: "generate_vdt",
      input: { rootKpi: "Haulage" },
      providerId: "mock",
      options: { autoApplyPatches: true }
    });
    const builder = new VdtBuilderSession({ now: () => "2026-06-26T00:00:00.000Z" });
    builder.createDraft({ projectTitle: "Haulage", rootKpi: "Haulage" });
    builder.addDriver({
      parentNodeId: "haulage",
      nodeId: "truck_count",
      name: "Truck count",
      type: "input",
      relation: "multiplicative_driver"
    });
    builder.addDriver({
      parentNodeId: "haulage",
      nodeId: "payload_t",
      name: "Payload t",
      type: "input",
      relation: "multiplicative_driver"
    });
    builder.setFormula({ nodeId: "haulage", formula: "truck_count * payload_t" });
    store.updateRun(run.runId, {
      builder,
      draftProject: builder.getProject(),
      answers: { truck_count: 12, payload_t: 40 }
    });
    const registry = createDefaultToolRegistry();
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

    const truck = await registry.run("vdt.update_node", {
      nodeId: "truck_count",
      patch: {
        value: 12,
        baselineValue: 12,
        valueStatus: "user_provided_value",
        valueSource: { acceptedByUserInDialog: true, note: "User supplied" }
      }
    }, context);
    const payload = await registry.run("vdt.update_node", {
      nodeId: "payload_t",
      patch: {
        value: 40,
        baselineValue: 40,
        valueStatus: "user_provided_value",
        valueSource: { acceptedByUserInDialog: true, note: "User supplied" }
      }
    }, context);
    expect(truck.ok).toBe(true);
    expect(payload.ok).toBe(true);

    const project = builder.getProject();
    expect(project.graph.nodes.find((node) => node.id === "truck_count")).toMatchObject({
      value: 12,
      baselineValue: 12,
      valueStatus: "user_provided_value",
      valueSource: { acceptedByUserInDialog: true, note: "User supplied" }
    });

    const calculation = await registry.run("vdt.calculate", {}, context);
    expect(calculation.ok).toBe(true);
    expect(calculation.output).toMatchObject({ rootValue: 480 });
  });

  it("rejects user_provided_value when this run has no user answer for that node", async () => {
    const store = new AgentRunStore({ now: () => "2026-06-26T00:00:00.000Z" });
    const run = store.createRun({
      mode: "generate_vdt",
      input: { rootKpi: "Haulage" },
      providerId: "mock",
      options: { autoApplyPatches: true }
    });
    const builder = new VdtBuilderSession({ now: () => "2026-06-26T00:00:00.000Z" });
    builder.createDraft({ projectTitle: "Haulage", rootKpi: "Haulage" });
    builder.addDriver({
      parentNodeId: "haulage",
      nodeId: "payload_t",
      name: "Payload t",
      type: "input"
    });
    store.updateRun(run.runId, { builder, draftProject: builder.getProject() });
    const registry = createDefaultToolRegistry();
    const context: AgentToolContext = {
      runId: run.runId,
      store,
      emit: (event) => store.appendEvent(run.runId, event),
      getRun: () => store.getSnapshot(run.runId),
      updateRun: (patch) => store.updateRun(run.runId, patch),
      builder,
      signal: run.abortController.signal
    };

    const result = await registry.run("vdt.update_node", {
      nodeId: "payload_t",
      patch: {
        value: 40,
        baselineValue: 40,
        valueStatus: "user_provided_value",
        valueSource: { note: "Assumed but stamped as user-supplied" }
      }
    }, context);

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("USER_PROVIDED_VALUE_UNGROUNDED");
    expect(builder.getProject().graph.nodes.find((node) => node.id === "payload_t")?.valueStatus).not.toBe("user_provided_value");
  });

  it("rolls back the whole driver batch when parentFormula is invalid", async () => {
    const store = new AgentRunStore({ now: () => "2026-06-26T00:00:00.000Z" });
    const run = store.createRun({
      mode: "generate_vdt",
      input: { rootKpi: "Revenue" },
      providerId: "mock",
      options: { autoApplyPatches: true }
    });
    const builder = new VdtBuilderSession({ now: () => "2026-06-26T00:00:00.000Z" });
    builder.createDraft({ projectTitle: "Revenue", rootKpi: "Revenue" });
    store.updateRun(run.runId, { builder, draftProject: builder.getProject() });
    const registry = createDefaultToolRegistry();

    const result = await registry.run("vdt.add_drivers_batch", {
      drivers: [
        { parentNodeId: "revenue", nodeId: "price", name: "Price", type: "input", baselineValue: 10 },
        { parentNodeId: "revenue", nodeId: "volume", name: "Volume", type: "input", baselineValue: 5 }
      ],
      parentFormula: "price * missing_volume"
    }, {
      runId: run.runId,
      store,
      emit: (event) => store.appendEvent(run.runId, event),
      getRun: () => store.getSnapshot(run.runId),
      updateRun: (patch) => {
        store.updateRun(run.runId, patch);
      },
      builder,
      signal: run.abortController.signal
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("MISSING_FORMULA_REFERENCES");
    expect(builder.getProject().graph.nodes.map((node) => node.id)).toEqual(["revenue"]);
    expect(store.getSnapshot(run.runId).pendingMutationProposal).toBeUndefined();
  });

  it("creates a pending mutation proposal instead of directly mutating when auto-apply is off", async () => {
    const store = new AgentRunStore({ now: () => "2026-06-26T00:00:00.000Z" });
    const run = store.createRun({
      mode: "generate_vdt",
      input: { rootKpi: "Revenue" },
      providerId: "mock"
    });
    const builder = new VdtBuilderSession({ now: () => "2026-06-26T00:00:00.000Z" });
    builder.createDraft({ projectTitle: "Revenue", rootKpi: "Revenue" });
    store.updateRun(run.runId, { builder, draftProject: builder.getProject() });
    const registry = createDefaultToolRegistry();

    const result = await registry.run("vdt.add_driver", {
      parentNodeId: "revenue",
      nodeId: "price",
      name: "Price",
      type: "input",
      relation: "positive_driver"
    }, {
      runId: run.runId,
      store,
      emit: (event) => store.appendEvent(run.runId, event),
      getRun: () => store.getSnapshot(run.runId),
      updateRun: (patch) => {
        store.updateRun(run.runId, patch);
      },
      builder,
      signal: run.abortController.signal
    });

    expect(result.ok).toBe(true);
    expect(result.projectChanged).toBe(false);
    expect(result.mutationProposal?.status).toBe("proposed");
    expect(builder.getProject().graph.nodes.map((node) => node.id)).toEqual(["revenue"]);
    const snapshot = store.getSnapshot(run.runId);
    expect(snapshot.status).toBe("waiting_approval");
    expect(snapshot.pendingMutationProposal?.changeSet.additions.map((addition) => addition.nodeId)).toEqual(["price"]);
    expect(snapshot.events.map((event) => event.type)).toEqual(expect.arrayContaining(["mutation_proposed"]));
  });

  it("returns MUTATION_VALIDATION_FAILED when delete_node would leave a dangling formula reference", async () => {
    const store = new AgentRunStore({ now: () => "2026-06-26T00:00:00.000Z" });
    const run = store.createRun({
      mode: "generate_vdt",
      input: { rootKpi: "Ore hauled" },
      providerId: "mock",
      options: { autoApplyPatches: true }
    });
    const builder = haulageBuilder();
    store.updateRun(run.runId, { builder, draftProject: builder.getProject() });
    const registry = createDefaultToolRegistry();

    const result = await registry.run("vdt.delete_node", {
      nodeId: "truck_working_time",
      cascadeEdges: true
    }, {
      runId: run.runId,
      store,
      emit: (event) => store.appendEvent(run.runId, event),
      getRun: () => store.getSnapshot(run.runId),
      updateRun: (patch) => {
        store.updateRun(run.runId, patch);
      },
      builder,
      signal: run.abortController.signal
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("MUTATION_VALIDATION_FAILED");
    expect(result.projectChanged).toBe(false);
    expect(builder.getProject().graph.nodes.map((node) => node.id)).toEqual(expect.arrayContaining([
      "truck_working_time",
      "truck_count"
    ]));
    expect(store.getSnapshot(run.runId).events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["mutation_rejected"])
    );
  });

  it("preserves a VdtStorageError code from persist instead of flattening it to TOOL_FAILED", async () => {
    const store = new AgentRunStore({ now: () => "2026-06-26T00:00:00.000Z" });
    const run = store.createRun({
      mode: "generate_vdt",
      input: { rootKpi: "Revenue" },
      providerId: "mock"
    });
    const registry = new ToolRegistry();
    registry.register({
      name: "vdt.persist_write",
      description: "Throw a persist-path storage error.",
      inputSchema: z.object({}).strict(),
      outputSchema: z.record(z.unknown()),
      run: () => {
        throw vdtStorageError(
          "PROPOSAL_BASE_NOT_PERSISTED",
          "Proposal run:mutation:28 base revision 28 is not persisted."
        );
      }
    });

    const result = await registry.run("vdt.persist_write", {}, {
      runId: run.runId,
      store,
      emit: (event) => store.appendEvent(run.runId, event),
      getRun: () => store.getSnapshot(run.runId),
      updateRun: (patch) => {
        store.updateRun(run.runId, patch);
      },
      signal: run.abortController.signal
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("PROPOSAL_BASE_NOT_PERSISTED");
  });

  it("keeps MUTATION_VALIDATION_FAILED when duck-typed AgentToolError crosses a package boundary", async () => {
    const store = new AgentRunStore({ now: () => "2026-06-26T00:00:00.000Z" });
    const run = store.createRun({
      mode: "generate_vdt",
      input: { rootKpi: "Revenue" },
      providerId: "mock"
    });
    const registry = new ToolRegistry();
    registry.register({
      name: "vdt.fake_delete",
      description: "Throw a duck-typed tool error.",
      inputSchema: z.object({}).strict(),
      outputSchema: z.record(z.unknown()),
      run: () => {
        const error = new Error("The formula for Ore hauled references missing node truck_working_time");
        error.name = "AgentToolError";
        (error as Error & { code: string }).code = "MUTATION_VALIDATION_FAILED";
        throw error;
      }
    });

    const result = await registry.run("vdt.fake_delete", {}, {
      runId: run.runId,
      store,
      emit: (event) => store.appendEvent(run.runId, event),
      getRun: () => store.getSnapshot(run.runId),
      updateRun: (patch) => {
        store.updateRun(run.runId, patch);
      },
      signal: run.abortController.signal
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("MUTATION_VALIDATION_FAILED");
  });
});

function vdtStorageError(code: string, message: string): Error {
  const error = new Error(message);
  error.name = "VdtStorageError";
  (error as Error & { code: string }).code = code;
  return error;
}

function haulageBuilder(): VdtBuilderSession {
  const builder = new VdtBuilderSession({ now: () => "2026-06-26T00:00:00.000Z" });
  builder.createDraft({ projectTitle: "Haulage", rootKpi: "Ore hauled" });
  const rootNodeId = builder.getProject().rootNodeId;
  builder.addDriver({
    parentNodeId: rootNodeId,
    nodeId: "truck_working_time",
    name: "Truck working time",
    type: "input",
    baselineValue: 10
  });
  builder.addDriver({
    parentNodeId: rootNodeId,
    nodeId: "truck_count",
    name: "Truck count",
    type: "input",
    baselineValue: 2
  });
  builder.setFormula({
    nodeId: rootNodeId,
    formula: "truck_working_time * truck_count"
  });
  return builder;
}
