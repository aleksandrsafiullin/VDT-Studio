import { describe, expect, it } from "vitest";
import { z } from "zod";
import { VdtBuilderSession } from "@vdt-studio/vdt-core";
import { AgentRunStore } from "./run-store";
import { ToolRegistry, type AgentToolContext } from "./tool-registry";
import { SCHEMA_ISSUE_SUMMARY_MAX_CHARS } from "./schema-issue-summary";
import { createDefaultToolRegistry } from "./tools";

describe("ToolRegistry", () => {
  it("publishes the same argument bounds and required fields that built-in tools enforce", () => {
    const registry = createDefaultToolRegistry();
    const read = registry.getSpec("skill.read")!.inputJsonSchema as { properties: Record<string, unknown>; required: string[] };
    expect(read.properties.skillId).toMatchObject({ type: "string", minLength: 1, maxLength: 160 });
    expect(read.properties.maxChars).toMatchObject({ type: "integer", minimum: 200, maximum: 10000 });
    expect(read.required).toContain("skillId"); expect(read.required).not.toContain("maxChars");
    expect(registry.list().every(tool => registry.getSpec(tool.name)!.inputJsonSchema)).toBe(true);
    expect(registry.getSpec("skill.seed_topology")!.inputJsonSchema).toMatchObject({ properties: { defaults: { maxProperties: 24 } } });
  });
  it("publishes nested enums, array limits, nullable values and strict object boundaries", () => {
    const registry = new ToolRegistry();
    registry.register({ name: "qa.nested", description: "QA", inputSchema: z.object({ rows: z.array(z.object({ mode: z.enum(["total", "rate"]), value: z.number().positive().nullable() }).strict()).min(1).max(2) }).strict(), outputSchema: z.unknown(), run: () => null });
    expect(registry.getSpec("qa.nested")!.inputJsonSchema).toMatchObject({ additionalProperties: false, required: ["rows"], properties: { rows: { minItems: 1, maxItems: 2,
      items: { required: ["mode", "value"], additionalProperties: false, properties: { mode: { enum: ["total", "rate"] }, value: { anyOf: [{ type: "number", exclusiveMinimum: 0 }, { type: "null" }] } } } } } });
  });
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
      input: { rootKpi: "Excavation", unit: "units*shifts/day", timePeriod: "year" },
      providerId: "mock",
      options: { autoApplyPatches: true }
    });
    const builder = new VdtBuilderSession({ now: () => "2026-06-26T00:00:00.000Z" });
    builder.createDraft({
      projectTitle: "Excavation Driver Model",
      rootKpi: "Excavation",
      unit: "units*shifts/day",
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

  it("keeps distinct non-Latin driver names usable without explicit IDs", async () => {
    const { registry, context, builder } = inputBatchContext();
    const before = builder.getProject().graph.nodes.length;
    const result = await registry.run("vdt.add_drivers_batch", { drivers: [
      { parentNodeId: builder.getProject().rootNodeId, name: "Добыча" },
      { parentNodeId: builder.getProject().rootNodeId, name: "Транспорт" }
    ] }, context);
    expect(result.ok).toBe(true);
    const added = builder.getProject().graph.nodes.slice(before);
    expect(added.map((node) => node.name)).toEqual(["Добыча", "Транспорт"]);
    expect(new Set(added.map((node) => node.id)).size).toBe(2);
  });

  it.each([false, true])("rejects normalized driver ID collisions before automatic suffixing, atomically (%s)", async (batch) => {
    const store = new AgentRunStore();
    const run = store.createRun({ mode: "continue_project", input: { rootKpi: "Ore hauled" }, providerId: "mock", options: { autoApplyPatches: true } });
    const builder = haulageBuilder();
    store.updateRun(run.runId, { builder, draftProject: builder.getProject() });
    const context: AgentToolContext = {
      runId: run.runId, store, builder, signal: run.abortController.signal,
      emit: (event) => store.appendEvent(run.runId, event), getRun: () => store.getSnapshot(run.runId),
      updateRun: (patch) => { store.updateRun(run.runId, patch); }
    };
    const registry = createDefaultToolRegistry();
    const before = JSON.stringify(builder.getProject());
    const duplicate = { parentNodeId: builder.getProject().rootNodeId, name: "truck_count", baselineValue: 10 };
    const result = await registry.run(batch ? "vdt.add_drivers_batch" : "vdt.add_driver", batch ? {
      drivers: [{ parentNodeId: duplicate.parentNodeId, nodeId: "new_input", name: "New input" }, duplicate]
    } : duplicate, context);
    expect(result).toMatchObject({ ok: false, error: { code: "NODE_ID_EXISTS" } });
    expect(result.error?.message).toContain('"truck_count"');
    expect(result.error?.message).toContain("vdt.update_node");
    expect(JSON.stringify(builder.getProject())).toBe(before);
    const distinct = await registry.run("vdt.add_driver", { ...duplicate, nodeId: "other_truck_count" }, context);
    expect(distinct.ok).toBe(true);
    expect(builder.getProject().graph.nodes.some((node) => node.id === "other_truck_count")).toBe(true);
  });

  it("fills existing inputs in one atomic revision with quoted facts and explicit assumptions", async () => {
    const { registry, context, builder } = inputBatchContext();
    const before = builder.getRevision();
    const result = await registry.run("vdt.fill_input_values_batch", { values: [
      { nodeId: "truck_count", value: 2, provenance: "user_provided_value", note: "2 trucks" },
      { nodeId: "truck_working_time", value: 12, provenance: "default_assumption", note: "Editable draft assumption: twelve productive hours." }
    ] }, context);
    expect(result.ok).toBe(true);
    expect(builder.getRevision()).toBe(before + 1);
    expect(builder.getProject().graph.nodes.find((node) => node.id === "truck_count")).toMatchObject({
      baselineValue: 2, value: 2, valueStatus: "user_provided_value", valueSource: { note: "2 trucks" }
    });
    expect(builder.getProject().graph.nodes.find((node) => node.id === "truck_working_time")).toMatchObject({
      baselineValue: 12, valueStatus: "default_assumption", status: "assumption", assumptions: ["Editable draft assumption: twelve productive hours."]
    });
    expect(builder.calculate().calculation?.rootValue).toBe(24);
  });

  it.each([
    { caseName: "grounded rate", prompt: "The list price was 50 USD per item.", note: "Recorded verbatim: «50 USD per item».", expectedUnit: "USD/item", manualEdit: false },
    { caseName: "unquoted attribution", prompt: "The list price was 50.", note: "50 USD per item inferred from «The list price was 50».", expectedUnit: "USD", manualEdit: false },
    { caseName: "manually edited unit", prompt: "The list price was 50 USD per item.", note: "50 USD per item", expectedUnit: "USD", manualEdit: true }
  ])("uses the grounded unit only on a new agent-owned input ($caseName)", async ({ prompt, note, expectedUnit, manualEdit }) => {
    const builder = new VdtBuilderSession();
    builder.createDraft({ projectTitle: "Revenue", rootKpi: "Revenue", unit: "USD" });
    const { registry, context } = sourceUnitContext(builder, prompt);
    expect(await registry.run("vdt.add_driver", {
      parentNodeId: builder.getProject().rootNodeId, nodeId: "price", name: "List price", unit: "USD"
    }, context)).toMatchObject({ ok: true });
    const before = builder.getRevision();
    if (manualEdit) {
      context.store.observeManualChange(context.runId, {
        projectRevision: before,
        change: { kind: "node_updated", nodeId: "price", patch: { unit: "USD" }, summary: "User set the price unit." }
      });
    }
    const result = await registry.run("vdt.update_node", {
      nodeId: "price", patch: { baselineValue: 50, valueStatus: "user_provided_value", valueSource: { note } }
    }, context);
    expect(result).toMatchObject({ ok: true });
    if (expectedUnit === "USD/item") {
      expect(result.output).toMatchObject({
        sourceUnitCorrections: [{ nodeId: "price", previousUnit: "USD", unit: "USD/item" }]
      });
    } else {
      expect(result.output).not.toHaveProperty("sourceUnitCorrections");
    }
    expect(builder.getRevision()).toBe(before + 1);
    expect(builder.getProject().graph.nodes.find((node) => node.id === "price")).toMatchObject({
      baselineValue: 50, unit: expectedUnit, valueSource: { note }
    });
  });

  it.each(["agent", "retained", "manually edited"] as const)("keeps unit validation strict for a %s input", async (ownership) => {
    const builder = new VdtBuilderSession();
    builder.createDraft({ projectTitle: "Revenue", rootKpi: "Revenue", unit: "USD" });
    const parentNodeId = builder.getProject().rootNodeId;
    const drivers = [
      { parentNodeId, nodeId: "quantity", name: "Quantity", unit: "items", baselineValue: 120 },
      { parentNodeId, nodeId: "price", name: "List price", unit: "USD", baselineValue: 50 },
      { parentNodeId, nodeId: "refunds", name: "Refunds", unit: "USD", baselineValue: 500 }
    ];
    const note = "50 USD per item";
    const prompt = `The list price was ${note}.`;
    const sourcePatch = { value: 50, valueStatus: "user_provided_value" as const, status: "accepted" as const, valueSource: { note } };
    const active = ownership === "retained" ? undefined : sourceUnitContext(builder, prompt);
    if (active) {
      expect(await active.registry.run("vdt.add_drivers_batch", { drivers }, active.context)).toMatchObject({ ok: true });
      expect(await active.registry.run("vdt.update_node", { nodeId: "price", patch: sourcePatch }, active.context))
        .toMatchObject({ ok: true });
    } else {
      for (const driver of drivers) builder.addDriver(driver);
      builder.updateNode({ nodeId: "price", patch: sourcePatch });
    }
    const { registry, context } = active ?? sourceUnitContext(builder, prompt);
    if (ownership === "manually edited") {
      context.store.observeManualChange(context.runId, {
        projectRevision: builder.getRevision(),
        change: { kind: "node_updated", nodeId: "price", patch: { unit: "USD" }, summary: "User set the price unit." }
      });
    }
    const formula = { nodeId: parentNodeId, formula: "quantity * price - refunds" };
    const before = builder.getProject();
    expect(before.graph.nodes.find((node) => node.id === "price")).toMatchObject({
      aiGenerated: true, status: "accepted", unit: "USD", valueSource: { note }
    });
    const rejected = await registry.run("vdt.set_formula", formula, context);
    expect(rejected).toMatchObject({ ok: false, error: { code: "MUTATION_VALIDATION_FAILED" } });
    expect(builder.getProject()).toEqual(before);
    if (ownership !== "agent") {
      expect(rejected.error?.details).not.toHaveProperty("sourceUnitRepairs");
      return;
    }
    const args = { nodeId: "price", patch: { unit: "USD/item" } };
    expect(rejected.error?.details).toMatchObject({
      sourceUnitRepairs: [{ nodeId: "price", previousUnit: "USD", unit: "USD/item", toolName: "vdt.update_node", args }]
    });
    expect(await registry.run("vdt.update_node", args, context)).toMatchObject({ ok: true });
    expect(await registry.run("vdt.set_formula", formula, context)).toMatchObject({ ok: true });
    expect(builder.calculate().calculation?.rootValue).toBe(5500);
  });

  it("admits construction formulas only on ready calculated targets through the dedicated tool", async () => {
    const builder = new VdtBuilderSession();
    builder.createDraft({ projectTitle: "Revenue", rootKpi: "Revenue", unit: "USD" });
    const root = builder.getProject().rootNodeId;
    builder.addDriver({ parentNodeId: root, nodeId: "subtotal", name: "Subtotal", type: "calculated", unit: "USD" });
    builder.addDriver({ parentNodeId: root, nodeId: "rebate", name: "Rebate", type: "input", unit: "USD", baselineValue: 10 });
    builder.updateNode({ nodeId: root, patch: { decompositionPlan: { version: 1, goal: "Revenue", nodes: [
      { nodeId: "subtotal", parentNodeId: root, kind: "calculated" },
      { nodeId: "rebate", parentNodeId: root, kind: "input" },
      { nodeId: "sales", parentNodeId: "subtotal", kind: "input" },
      { nodeId: "fee", parentNodeId: "subtotal", kind: "input" }
    ] } } });
    const { registry, context } = sourceUnitContext(builder, "Calculate revenue from sales and rebates.");
    context.requirePlanOperands = true;
    context.requireDecompositionPlan = true;
    const before = builder.getProject();
    const revision = builder.getRevision();
    for (const nodeId of ["subtotal", "rebate"]) {
      expect(await registry.run("vdt.set_formula", { nodeId, formula: nodeId === "subtotal" ? "rebate" : "1" }, context))
        .toMatchObject({ ok: false, error: { code: "FORMULA_TARGET_NOT_READY", details: { nodeId, readyTargets: [root] } } });
    }
    const sales = { nodeId: "sales", parentNodeId: "subtotal", name: "Sales", type: "input", unit: "USD", baselineValue: 90 };
    const fee = { ...sales, nodeId: "fee", name: "Fee", baselineValue: 5 };
    expect(await registry.run("vdt.add_driver", { ...sales, formula: "rebate" }, context)).toMatchObject({
      ok: false, error: { code: "FORMULA_TOOL_REQUIRED" }
    });
    for (const args of [{ drivers: [sales, fee], parentFormula: "sales + fee" }, { drivers: [sales, { ...fee, formula: "sales" }] }]) {
      expect(await registry.run("vdt.add_drivers_batch", args, context)).toMatchObject({
        ok: false, error: { code: "FORMULA_TOOL_REQUIRED" }
      });
    }
    expect(builder.getRevision()).toBe(revision);
    expect(builder.getProject()).toEqual(before);
    expect(await registry.run("vdt.add_driver", sales, context)).toMatchObject({ ok: true });
    expect(await registry.run("vdt.add_driver", fee, context)).toMatchObject({ ok: true });
    expect(await registry.run("vdt.set_formula", { nodeId: "subtotal", formula: "sales + fee" }, context)).toMatchObject({ ok: true });
    expect(await registry.run("vdt.set_formula", { nodeId: root, formula: "subtotal - rebate" }, context)).toMatchObject({ ok: true });
    for (const formula of ["", "  ", "rebate"]) {
      expect(await registry.run("vdt.update_node", { nodeId: "subtotal", patch: { formula } }, context)).toMatchObject({
        ok: false, error: { code: "FORMULA_TOOL_REQUIRED" }
      });
    }
    expect(builder.calculate().calculation?.rootValue).toBe(85);
  });

  it("creates only a declared orphan link during new construction, including shared factors", async () => {
    const builder = new VdtBuilderSession();
    builder.createDraft({ projectTitle: "Revenue", rootKpi: "Revenue", unit: "USD" });
    const root = builder.getProject().rootNodeId;
    builder.addDriver({ parentNodeId: root, nodeId: "gross", name: "Gross", type: "calculated", unit: "USD" });
    builder.addDriver({ parentNodeId: "gross", nodeId: "sales", name: "Sales", unit: "USD", baselineValue: 120 });
    builder.updateNode({ nodeId: root, patch: { decompositionPlan: { version: 1, goal: "Revenue", nodes: [
      { nodeId: "gross", parentNodeId: root, kind: "calculated" },
      { nodeId: "sales", parentNodeId: "gross", kind: "input", sharedWith: [root] }
    ] } } });
    const initial = builder.getProject();
    const { registry, context } = sourceUnitContext(builder, "Model revenue.");
    context.requirePlanOperands = true;
    const link = { sourceNodeId: "gross", targetNodeId: "sales", relation: "formula_dependency" };
    for (const input of [link, { ...link, sourceNodeId: root }]) {
      expect(await registry.run("vdt.add_edge", input, context)).toMatchObject({ ok: false,
        error: { code: "CONSTRUCTION_EDGE_NOT_ADMITTED", details: { orphanLinks: [] } } });
    }
    expect(builder.getProject()).toEqual(initial);

    const orphan = structuredClone(initial);
    orphan.graph.edges = orphan.graph.edges.filter(({ targetNodeId }) => targetNodeId !== "sales");
    const orphanBuilder = new VdtBuilderSession({ project: orphan });
    const repairing = sourceUnitContext(orphanBuilder, "Model revenue.");
    repairing.context.requirePlanOperands = true;
    for (const input of [{ ...link, sourceNodeId: root }, { ...link, relation: "contextual_influence" }]) {
      expect(await repairing.registry.run("vdt.add_edge", input, repairing.context)).toMatchObject({ ok: false,
        error: { code: "CONSTRUCTION_EDGE_NOT_ADMITTED", details: { orphanLinks: [{ nodeId: "sales", parentNodeId: "gross", kind: "input" }] } } });
    }
    expect(orphanBuilder.getRevision()).toBe(0);
    expect(await repairing.registry.run("vdt.add_edge", link, repairing.context)).toMatchObject({ ok: true });
    expect(orphanBuilder.getProject().graph.edges.filter(({ targetNodeId }) => targetNodeId === "sales"))
      .toEqual([expect.objectContaining(link)]);
    expect(await repairing.registry.run("vdt.set_formula", { nodeId: "gross", formula: "2 * sales" }, repairing.context)).toMatchObject({ ok: true });
    expect(await repairing.registry.run("vdt.set_formula", { nodeId: root, formula: "gross - sales" }, repairing.context)).toMatchObject({ ok: true });
    expect(orphanBuilder.calculate().calculation?.rootValue).toBe(120);
  });

  it("keeps quoted measurements unique and unit-consistent across construction writes", async () => {
    const builder = new VdtBuilderSession();
    builder.createDraft({ projectTitle: "Revenue", rootKpi: "Revenue", unit: "USD" });
    const parentNodeId = builder.getProject().rootNodeId;
    const { registry, context } = sourceUnitContext(builder, "Sold 120 items. Returned 120 items. Discount was 10%.");
    context.requirePlanOperands = true;
    context.requireDecompositionPlan = true;
    const drivers = [
      { nodeId: "sold", parentNodeId, name: "Sold", unit: "items" },
      { nodeId: "returned", parentNodeId, name: "Returned", unit: "count" },
      { nodeId: "discount", parentNodeId, name: "Discount", unit: "" }
    ];
    expect(await registry.run("vdt.set_decomposition_plan", { plan: { version: 1, goal: "Use the quoted measurements", nodes: [
      ...drivers.map(({ nodeId }) => ({ nodeId, parentNodeId, kind: "input" })),
      { nodeId: "scope_note", parentNodeId: "sold", kind: "context", rationale: "Explain the measurement scope" }
    ] } }, context)).toMatchObject({ ok: true });
    expect(await registry.run("vdt.add_drivers_batch", { drivers }, context)).toMatchObject({ ok: true });
    const source = (nodeId: string, value: number, note: string) => ({ nodeId, value, note, provenance: "user_provided_value" });
    const sold = source("sold", 120, "Sold 120 items");
    const returned = source("returned", 120, "Returned 120 items");
    const fill = (...values: ReturnType<typeof source>[]) => registry.run("vdt.fill_input_values_batch", { values }, context);
    const before = builder.getProject();
    expect(await fill(sold, { ...returned, note: sold.note })).toMatchObject({ ok: false, error: {
      code: "DUPLICATE_SOURCE_FACT", details: { nodeId: "returned", usedBy: "sold" }
    } });
    expect(builder.getProject()).toEqual(before);
    expect(await fill(sold)).toMatchObject({ ok: true });
    expect(await registry.run("vdt.add_driver", { parentNodeId: "sold", nodeId: "scope_note", name: "Scope note",
      relation: "contextual_influence" }, context)).toMatchObject({ ok: true });
    expect(await fill({ ...returned, note: "Sold 120 items." })).toMatchObject({ ok: false, error: { code: "DUPLICATE_SOURCE_FACT" } });
    expect(await fill({ ...returned, note: "120 items" })).toMatchObject({ ok: false, error: { code: "AMBIGUOUS_SOURCE_QUOTE" } });
    expect(await registry.run("vdt.update_node", { nodeId: "discount", patch: {
      baselineValue: 120, valueStatus: "user_provided_value", valueSource: { note: sold.note }
    } }, context)).toMatchObject({ ok: false, error: { code: "DUPLICATE_SOURCE_FACT" } });
    expect(await fill(returned)).toMatchObject({ ok: true });
    const discount = source("discount", 10, "Discount was 10%");
    expect(await registry.run("vdt.update_node", { nodeId: "discount", patch: { unit: "USD" } }, context)).toMatchObject({ ok: true });
    expect(await fill(discount)).toMatchObject({ ok: false, error: { code: "SOURCE_UNIT_MISMATCH",
      details: { nodeId: "discount", sourceUnit: "%", nodeUnit: "USD" } } });
    expect(await registry.run("vdt.update_node", { nodeId: "discount", patch: { unit: "fraction" } }, context)).toMatchObject({ ok: true });
    expect(await fill(discount)).toMatchObject({ ok: true, output: {
      sourceUnitCorrections: [{ nodeId: "discount", previousUnit: "fraction", unit: "%" }]
    } });
    expect(await registry.run("vdt.update_node", { nodeId: "discount", patch: { unit: "items" } }, context))
      .toMatchObject({ ok: false, error: { code: "SOURCE_UNIT_MISMATCH" } });
    expect(builder.getProject().graph.nodes.find(({ id }) => id === "discount")).toMatchObject({ baselineValue: 10, unit: "%" });
  });

  it.each(["pieces", "products", "товаров"])("grounds a currency-prefix rate and normalizes %s on a sourced count", async (unit) => {
    const builder = new VdtBuilderSession();
    builder.createDraft({ projectTitle: "Revenue", rootKpi: "Revenue", unit: "USD" });
    const parentNodeId = builder.getProject().rootNodeId;
    const priceQuote = "List price was USD 50 per item";
    const countQuote = "Sold 120 pieces";
    const { registry, context } = sourceUnitContext(builder, `${priceQuote}. ${countQuote}.`);
    context.requirePlanOperands = true;
    expect(await registry.run("vdt.add_drivers_batch", { drivers: [
      { nodeId: "price", parentNodeId, name: "Price", unit: "USD/item" },
      { nodeId: "quantity", parentNodeId, name: "Quantity", unit }
    ] }, context)).toMatchObject({ ok: true });
    expect(await registry.run("vdt.fill_input_values_batch", { values: [
      { nodeId: "price", value: 50, note: priceQuote, provenance: "user_provided_value" },
      { nodeId: "quantity", value: 120, note: countQuote, provenance: "user_provided_value" }
    ] }, context)).toMatchObject({ ok: true, output: {
      sourceUnitCorrections: [{ nodeId: "quantity", previousUnit: unit, unit: "items" }]
    } });
    expect(builder.getProject().graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "price", baselineValue: 50, unit: "USD/item" }),
      expect.objectContaining({ id: "quantity", baselineValue: 120, unit: "items" })
    ]));
  });

  it("reserves the hundred divisor for actual percent scaling during formula admission", async () => {
    const builder = new VdtBuilderSession();
    builder.createDraft({ projectTitle: "Revenue", rootKpi: "Revenue", unit: "USD" });
    const root = builder.getProject().rootNodeId;
    builder.addDriver({ parentNodeId: root, nodeId: "gross", name: "Gross", unit: "USD", baselineValue: 900 });
    builder.addDriver({ parentNodeId: root, nodeId: "discount", name: "Discount", unit: "%", baselineValue: 10 });
    builder.updateNode({ nodeId: root, patch: { decompositionPlan: { version: 1, goal: "Revenue", nodes: [
      { nodeId: "gross", parentNodeId: root, kind: "input" }, { nodeId: "discount", parentNodeId: root, kind: "input" }
    ] } } });
    const { registry, context } = sourceUnitContext(builder, "Refunds were 100 USD. Discount was 10%.");
    context.requirePlanOperands = true;
    const before = builder.getProject();
    for (const [formula, value] of [["gross / 100", 100], ["gross * (90 / 100)", 10]] as const) {
      expect(await registry.run("vdt.set_formula", { nodeId: root, formula }, context)).toMatchObject({ ok: false, error: {
        code: "SOURCE_PROVENANCE_INCOMPLETE", details: { unboundSourceFacts: [{ value }] }
      } });
    }
    expect(builder.getProject()).toEqual(before);
    expect(await registry.run("vdt.set_formula", { nodeId: root, formula: "gross * (1 - discount / 100)" }, context))
      .toMatchObject({ ok: true });
    expect(await registry.run("vdt.set_formula", { nodeId: root, formula: "gross * (1 + (-discount) / 100)" }, context))
      .toMatchObject({ ok: true });
  });

  it.each([
    [{ nodeId: "missing", value: 5, provenance: "default_assumption", note: "Draft estimate" }, "NODE_NOT_FOUND"],
    [{ nodeId: "ore_hauled", value: 5, provenance: "default_assumption", note: "Draft estimate" }, "INPUT_LEAF_REQUIRED"],
    [{ nodeId: "truck_count", value: 5, provenance: "user_provided_value", note: "5 trucks" }, "USER_PROVIDED_VALUE_UNGROUNDED"],
    [{ nodeId: "truck_working_time", value: 5, provenance: "default_assumption", note: "Draft estimate" }, "DUPLICATE_INPUT_WRITE"],
    [{ nodeId: "truck_count", value: 2, provenance: "default_assumption", note: "Draft estimate", formula: "1" }, "INVALID_TOOL_ARGS"]
  ] as const)("rejects the whole input batch for %s", async (invalid, code) => {
    const { registry, context, builder } = inputBatchContext();
    const before = JSON.stringify(builder.getProject());
    const result = await registry.run("vdt.fill_input_values_batch", { values: [
      { nodeId: "truck_working_time", value: 12, provenance: "default_assumption", note: "Editable draft estimate" }, invalid
    ] }, context);
    expect(result).toMatchObject({ ok: false, error: { code } });
    expect(JSON.stringify(builder.getProject())).toBe(before);
  });

  it("cannot repeatedly refill a known input or bypass a selected-node scope", async () => {
    const { registry, context, builder, store } = inputBatchContext();
    builder.updateNode({ nodeId: "truck_count", patch: { baselineValue: 2 } });
    const before = JSON.stringify(builder.getProject());
    const input = { values: [{ nodeId: "truck_count", value: 3, provenance: "default_assumption", note: "Editable draft estimate" }] };
    expect(await registry.run("vdt.fill_input_values_batch", input, context)).toMatchObject({ ok: false, error: { code: "INPUT_ALREADY_POPULATED" } });
    store.getState(context.runId).request.mode = "deepen_node";
    store.getState(context.runId).request.input.selectedNodeId = "truck_count";
    expect(await registry.run("vdt.fill_input_values_batch", { values: [{ ...input.values[0], nodeId: "truck_working_time" }] }, context)).toMatchObject({ ok: false, error: { code: "MUTATION_SCOPE_VIOLATION" } });
    expect(JSON.stringify(builder.getProject())).toBe(before);
  });

  it("reports all ungrounded batch values together and allows a valid selected-node-only fill", async () => {
    const { registry, context, builder, store } = inputBatchContext();
    const before = JSON.stringify(builder.getProject());
    const rejected = await registry.run("vdt.fill_input_values_batch", { values: [
      { nodeId: "truck_count", value: 5, provenance: "user_provided_value", note: "5 trucks" },
      { nodeId: "truck_working_time", value: 12, provenance: "user_provided_value", note: "12 hours" }
    ] }, context);
    expect(rejected).toMatchObject({ ok: false, error: { code: "USER_PROVIDED_VALUE_UNGROUNDED", details: { issues: [
      { nodeId: "truck_count" }, { nodeId: "truck_working_time" }
    ] } } });
    expect(JSON.stringify(builder.getProject())).toBe(before);
    store.getState(context.runId).request.mode = "deepen_node";
    store.getState(context.runId).request.input.selectedNodeId = "truck_count";
    expect(await registry.run("vdt.fill_input_values_batch", { values: [
      { nodeId: "truck_count", value: 2, provenance: "user_provided_value", note: "2 trucks" }
    ] }, context)).toMatchObject({ ok: true, projectChanged: true });
    expect(builder.getProject().graph.nodes.find((node) => node.id === "truck_count")?.baselineValue).toBe(2);
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
      outputSchema: z.record(z.string(), z.unknown()),
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
      outputSchema: z.record(z.string(), z.unknown()),
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

function sourceUnitContext(builder: VdtBuilderSession, prompt: string) {
  const project = builder.getProject();
  const store = new AgentRunStore();
  const run = store.createRun({
    mode: "continue_project", input: { project, rootKpi: "Revenue", unit: "USD", prompt },
    providerId: "mock", options: { autoApplyPatches: true }
  });
  store.updateRun(run.runId, { builder, draftProject: project });
  const context: AgentToolContext = {
    runId: run.runId, store, builder, signal: run.abortController.signal,
    emit: (event) => store.appendEvent(run.runId, event), getRun: () => store.getSnapshot(run.runId),
    updateRun: (patch) => { store.updateRun(run.runId, patch); }
  };
  return { registry: createDefaultToolRegistry(), context };
}

function inputBatchContext() {
  const store = new AgentRunStore();
  const run = store.createRun({ mode: "continue_project", input: { rootKpi: "Ore hauled", prompt: "The fleet has 2 trucks." }, providerId: "mock", options: { autoApplyPatches: true } });
  const project = haulageBuilder().getProject();
  for (const node of project.graph.nodes) {
    if (node.id === project.rootNodeId) continue;
    delete node.baselineValue;
    delete node.value;
  }
  const builder = new VdtBuilderSession({ project });
  store.updateRun(run.runId, { builder, draftProject: builder.getProject() });
  const context: AgentToolContext = {
    runId: run.runId, store, builder, signal: run.abortController.signal,
    emit: (event) => store.appendEvent(run.runId, event), getRun: () => store.getSnapshot(run.runId),
    updateRun: (patch) => { store.updateRun(run.runId, patch); }
  };
  return { context, builder, store, registry: createDefaultToolRegistry() };
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
