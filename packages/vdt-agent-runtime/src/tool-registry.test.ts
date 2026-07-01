import { describe, expect, it } from "vitest";
import { z } from "zod";
import { VdtBuilderSession } from "@vdt-studio/vdt-core";
import { AgentRunStore } from "./run-store";
import { ToolRegistry } from "./tool-registry";
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
    expect(store.getSnapshot(run.runId).events.at(-1)?.message).toContain("Expected string");
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

  it("adds multiple VDT drivers in one batch tool call", async () => {
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
          type: "input",
          unit: "units",
          relation: "multiplicative_driver",
          baselineValue: 5
        },
        {
          parentNodeId: "excavation",
          nodeId: "shift_count",
          name: "Shift count",
          type: "input",
          unit: "shifts/day",
          relation: "multiplicative_driver",
          baselineValue: 2
        }
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

    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({ nodeIds: ["excavator_count", "shift_count"] });
    const project = builder.getProject();
    expect(project.graph.nodes.map((node) => node.id)).toEqual(expect.arrayContaining([
      "excavator_count",
      "shift_count"
    ]));
    expect(store.getSnapshot(run.runId).events.some((event) => event.message.includes("Added 2 drivers"))).toBe(true);
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
});
