import { modelAgentStructuredTurnSchema } from "@vdt-studio/vdt-agent-runtime";
import { describe, expect, it } from "vitest";
import { zodToJsonSchema } from "zod-to-json-schema";
import { LocalModelOutputSchema } from "./local-model-output-schema";

const envelope = zodToJsonSchema(modelAgentStructuredTurnSchema, { $refStrategy: "none" });
const addSchema = { type: "object", properties: { parentNodeId: { type: "string" }, name: { type: "string" } }, required: ["parentNodeId", "name"], additionalProperties: false };
const initial = JSON.stringify({ delta: { type: "initial_context", context: { tools: [{ name: "vdt.add_driver", inputJsonSchema: addSchema }] } } });
function calls(schema: unknown) {
  const value = schema as { properties: { action: { anyOf: Array<{ properties: { batch?: { properties: { calls: { maxItems: number; items: { anyOf: Array<{ properties: { toolName: { const: string }; args: typeof addSchema } }> } } } } } }> } } };
  return value.properties.action.anyOf.find((option) => option.properties.batch)!.properties.batch!.properties.calls;
}

function allCalls(schema: unknown): Array<ReturnType<typeof calls>> {
  const value = schema as { properties: { action: { anyOf: Array<{ properties: { batch?: { properties: { calls: ReturnType<typeof calls> } } } }> } } };
  return value.properties.action.anyOf.flatMap((option) => option.properties.batch ? [option.properties.batch.properties.calls] : []);
}

function names(schema: unknown) {
  return allCalls(schema).flatMap((batch) => batch.items.anyOf.map((tool) => tool.properties.toolName.const)).sort();
}

describe("native local tool argument constraints", () => {
  it("offers complete topology seeding only after a confirmed read and lets the model select offered defaults", () => {
    const context = new LocalModelOutputSchema();
    const prompt = JSON.stringify({ delta: { type: "initial_context", context: { tools: [{ name: "skill.seed_topology", inputJsonSchema: {
      type: "object", properties: { skillId: { type: "string" }, defaults: { type: "object" } }, required: ["skillId", "defaults"], additionalProperties: false
    } }] } } });
    const observation = { constructingTree: true, needsStructure: true, hasReadSkill: true, discoveredSkillIds: ["actual.recipe"] };
    expect(names(context.forPrompt(envelope, prompt, observation))).toEqual([]);
    const observed = { ...observation, readTopologyDefinitions: [{ skillId: "actual.recipe", defaultInputIds: ["calendar_days", "payload"] }] };
    const projected = calls(context.forPrompt(envelope, JSON.stringify({ delta: { type: "tool_results", results: [] } }), observed));
    expect(projected.items.anyOf[0]!.properties.args).toMatchObject({ anyOf: [{ properties: {
      skillId: { const: "actual.recipe" }, defaults: { additionalProperties: false, properties: {
        calendar_days: { const: true }, payload: { const: true }
      } }
    } }] });
    expect(names(context.forPrompt(envelope, JSON.stringify({ delta: { type: "tool_results", results: [] } }), { ...observed, needsStructure: false }))).toEqual([]);
  });

  it("permits reading a broader discovered skill before construction without repeating a confirmed read", () => {
    const context = new LocalModelOutputSchema();
    const prompt = JSON.stringify({ delta: { type: "initial_context", context: { tools: [{ name: "skill.read", inputJsonSchema: {
      type: "object", properties: { skillId: { type: "string" } }
    } }] } } });
    const observed = { constructingTree: true, needsStructure: true, hasReadSkill: true,
      discoveredSkillIds: ["narrow", "broader"], readSkillIds: ["narrow"] };
    expect(calls(context.forPrompt(envelope, prompt, observed)).items.anyOf[0]!.properties.args).toMatchObject({ properties: { skillId: { enum: ["broader"] } } });
    expect(names(context.forPrompt(envelope, JSON.stringify({ delta: { type: "tool_results", results: [] } }), { ...observed, readSkillIds: ["narrow", "broader"] }))).toEqual([]);
  });

  it("enables only the verified final after a finish receipt and invalidates it on new work", () => {
    const context = new LocalModelOutputSchema();
    const prompt = JSON.stringify({ delta: { type: "initial_context", context: { tools: ["run.request_finish", "vdt.update_node"].map((name) => ({ name, inputJsonSchema: { type: "object" } })) } } });
    const actions = (value: unknown) => (value as { properties: { action: { anyOf: Array<{ properties: { type: { const: string }; finishReceiptId?: { const: string } } }> } } }).properties.action.anyOf;
    expect(actions(context.forPrompt(envelope, prompt)).some((option) => option.properties.type.const === "final")).toBe(false);
    const receipt = { toolName: "run.request_finish", status: "failed", payload: { receiptId: "verified-receipt", receiptHash: `sha256:${"a".repeat(64)}` } };
    const delta = (results: unknown[]) => JSON.stringify({ delta: { type: "tool_results", results } });
    expect(actions(context.forPrompt(envelope, delta([receipt]))).some((option) => option.properties.type.const === "final")).toBe(false);
    const verified = actions(context.forPrompt(envelope, delta([{ ...receipt, status: "succeeded" }])));
    expect(verified).toHaveLength(1);
    expect(verified[0]!.properties).toMatchObject({ type: { const: "final" }, finishReceiptId: { const: "verified-receipt" } });
    expect(actions(context.forPrompt(envelope, delta([{ toolName: "vdt.update_node", status: "succeeded", payload: { projectChanged: true } }]))).some((option) => option.properties.type.const === "final")).toBe(false);
    context.forPrompt(envelope, delta([{ ...receipt, status: "replayed" }]));
    const human = JSON.stringify({ delta: { type: "checkpoint_inputs", inputs: [{ type: "user_instruction", text: "New work" }], checkpointDelta: { type: "tool_results", results: [] } } });
    expect(actions(context.forPrompt(envelope, human)).some((option) => option.properties.type.const === "final")).toBe(false);
  });

  it("keeps new-tree structure behind an actual skill read without changing existing-tree access", () => {
    const context = new LocalModelOutputSchema();
    const prompt = JSON.stringify({ delta: { type: "initial_context", context: { tools: [
      { name: "tools.describe", inputJsonSchema: { type: "object" } }, { name: "vdt.add_driver", inputJsonSchema: addSchema },
      ...["skill.list", "skill.search", "skill.read"].map((name) => ({ name, inputJsonSchema: { type: "object" } }))
    ] } } });
    expect(names(context.forPrompt(envelope, prompt, { constructingTree: true, needsStructure: true, hasReadSkill: false, discoveredSkillIds: [] }))).toEqual(["skill.list", "skill.search"]);
    expect(names(context.forPrompt(envelope, JSON.stringify({ delta: { type: "tool_results", results: [] } }), { constructingTree: true, needsStructure: true, hasReadSkill: false, discoveredSkillIds: ["real_skill"] }))).toEqual(["skill.read"]);
    expect(names(context.forPrompt(envelope, JSON.stringify({ delta: { type: "tool_results", results: [] } }), { constructingTree: true, needsStructure: true, hasReadSkill: true }))).toEqual(["tools.describe", "vdt.add_driver"]);
    expect(names(context.forPrompt(envelope, JSON.stringify({ delta: { type: "tool_results", results: [] } }), { constructingTree: false, needsStructure: true, hasReadSkill: false }))).toEqual(["skill.list", "skill.read", "skill.search", "tools.describe", "vdt.add_driver"]);
  });

  it("uses returned skill IDs for read/compile arguments without inventing a library selection", () => {
    const context = new LocalModelOutputSchema();
    const prompt = JSON.stringify({ delta: { type: "initial_context", context: { tools: [{ name: "skill.read", inputJsonSchema: {
      type: "object", properties: { skillId: { type: "string" } }, required: ["skillId"]
    } }] } } });
    const native = calls(context.forPrompt(envelope, prompt, { discoveredSkillIds: ["actual.first", "actual.second"] }));
    expect(native.items.anyOf[0]!.properties.args).toMatchObject({ properties: { skillId: { enum: ["actual.first", "actual.second"] } } });
  });

  it("allows initial goal clarification but reads discovered guidance before asking for construction choices", () => {
    const context = new LocalModelOutputSchema();
    const input = { delta: { type: "initial_context", context: { tools: ["skill.search", "skill.read"].map((name) => ({ name, inputJsonSchema: { type: "object" } })) } } };
    const observation = { constructingTree: true, needsStructure: true, hasReadSkill: false, discoveredSkillIds: ["actual.skill"] };
    const kinds = (value: unknown) => (value as { properties: { action: { anyOf: Array<{ properties: { type: { const: string } } }> } } }).properties.action.anyOf.map((option) => option.properties.type.const);
    expect(kinds(context.forPrompt(envelope, JSON.stringify(input), observation))).toContain("question");
    expect(kinds(context.forPrompt(envelope, JSON.stringify(input), { ...observation, canClarifyBeforeDiscovery: false }))).not.toContain("question");
    const later = JSON.stringify({ delta: { type: "tool_results", results: [] } });
    expect(kinds(context.forPrompt(envelope, later, observation))).not.toContain("question");
    expect(kinds(context.forPrompt(envelope, later, { ...observation, hasReadSkill: true }))).toContain("question");
    expect(kinds(context.forPrompt(envelope, later, { ...observation, constructingTree: false }))).toContain("question");
  });

  it("lets the model choose a current parent but constrains every batch item to that same parent", () => {
    const context = new LocalModelOutputSchema();
    const schema = { type: "object", properties: { drivers: { type: "array", minItems: 2, maxItems: 8, items: addSchema } } };
    const prompt = JSON.stringify({ delta: { type: "initial_context", context: { tools: [{ name: "vdt.add_drivers_batch", inputJsonSchema: schema }] } } });
    const native = calls(context.forPrompt(envelope, prompt, { constructingTree: true, truncated: false, nodeColumns: ["id"], nodes: [["root"], ["branch"]] }));
    const args = native.items.anyOf[0]!.properties.args as unknown as { anyOf: Array<{ properties: { drivers: { items: { properties: { parentNodeId: unknown } } } } }> };
    expect(args.anyOf.map((option) => option.properties.drivers.items.properties.parentNodeId)).toEqual([
      { type: "string", enum: ["root"], const: "root" }, { type: "string", enum: ["branch"], const: "branch" }
    ]);
    const partial = calls(context.forPrompt(envelope, JSON.stringify({ delta: { type: "tool_results", results: [] } }), { constructingTree: true, truncated: true, nodeColumns: ["id"], nodes: [["root"]] }));
    expect(partial.items.anyOf[0]!.properties.args).not.toHaveProperty("anyOf");
  });

  it("bounds a new-tree structural batch and requires model-authored formula identifiers", () => {
    const context = new LocalModelOutputSchema();
    const driver = { ...addSchema, properties: { ...addSchema.properties, nodeId: { type: "string" }, description: { type: "string", maxLength: 1000 }, formula: { type: "string" }, baselineValue: { type: "number" } } };
    const schema = { type: "object", properties: { drivers: { type: "array", minItems: 2, maxItems: 20, items: driver }, parentFormula: { type: "string" } } };
    const prompt = JSON.stringify({ delta: { type: "initial_context", context: { tools: [{ name: "vdt.add_drivers_batch", inputJsonSchema: schema }] } } });
    const native = calls(context.forPrompt(envelope, prompt, { constructingTree: true }));
    expect(native.maxItems).toBe(1);
    expect(native.items.anyOf[0]!.properties.args).toMatchObject({ properties: { drivers: { minItems: 2, maxItems: 4, items: {
      required: ["parentNodeId", "name", "nodeId"], properties: { nodeId: { pattern: "^[a-z][a-z0-9_]*$" }, description: { maxLength: 160 } }
    } } } });
    expect(native.items.anyOf[0]!.properties.args).not.toHaveProperty("properties.drivers.items.properties.formula");
    expect(native.items.anyOf[0]!.properties.args).not.toHaveProperty("properties.drivers.items.properties.baselineValue");
    expect(native.items.anyOf[0]!.properties.args).not.toHaveProperty("properties.parentFormula");
    expect(schema.properties.drivers.maxItems).toBe(20);
    const existing = context.forPrompt(envelope, JSON.stringify({ delta: { type: "tool_results", results: [] } }), { constructingTree: false });
    expect(calls(existing).items.anyOf[0]!.properties.args).toEqual(schema);
  });

  it("binds user provenance to exact literal number/quote pairs while leaving target choice and estimates to the model", () => {
    const context = new LocalModelOutputSchema();
    const schema = { type: "object", properties: { values: { type: "array", items: { type: "object", properties: {
      nodeId: { type: "string" }, value: { type: "number" }, provenance: { type: "string" }, note: { type: "string", minLength: 4, maxLength: 160 }
    }, required: ["nodeId", "value", "provenance", "note"], additionalProperties: false } } } };
    const prompt = JSON.stringify({ delta: { type: "initial_context", context: { tools: [{ name: "vdt.fill_input_values_batch", inputJsonSchema: schema }] } } });
    const observation = { constructingTree: true, needsStructure: false, literalUserQuantities: [{ value: 4, quote: "4 excavators" }],
      truncated: false, nodeColumns: ["id"], nodes: [["root"], ["count"], ["days"]], inputLeafIds: ["count", "days"], unfilledInputLeafIds: ["count", "days"] };
    const constrained = context.forPrompt(envelope, prompt, observation);
    const args = calls(constrained).items.anyOf[0]!.properties.args as unknown as { properties: { values: { items: { anyOf: Array<{ properties: Record<string, unknown> }> } } } };
    expect(args.properties.values.items.anyOf).toEqual([
      expect.objectContaining({ properties: expect.objectContaining({ provenance: { type: "string", const: "default_assumption" }, value: { type: "number" } }) }),
      expect.objectContaining({ properties: expect.objectContaining({ provenance: { type: "string", const: "user_provided_value" }, value: { type: "number", const: 4 },
        note: { type: "string", minLength: 4, maxLength: 160, enum: ["4 excavators"] }, nodeId: { type: "string", enum: ["count", "days"] } }) })
    ]);
    const relaxed = context.forPrompt(envelope, JSON.stringify({ delta: { type: "tool_results", results: [] } }), { ...observation, literalUserQuantities: undefined });
    expect(calls(relaxed).items.anyOf[0]!.properties.args).not.toHaveProperty("properties.values.items.anyOf");
    const mapped = context.forPrompt(envelope, JSON.stringify({ delta: { type: "tool_results", results: [] } }), { ...observation,
      nativeInputBatch: { schemaVersion: "values_by_node_id.v1", batches: [["count", "days"]] } });
    expect(calls(mapped).items.anyOf[0]!.properties.args).toMatchObject({ properties: { values: { anyOf: [{
      properties: { count: { anyOf: [expect.any(Object), { properties: { value: { const: 4 }, note: { enum: ["4 excavators"] } } }] } }
    }] } } });
  });

  it("moves a read skill toward structure while preserving discovery access for an existing tree", () => {
    const context = new LocalModelOutputSchema();
    const prompt = JSON.stringify({ delta: { type: "initial_context", context: { tools: [
      { name: "skill.read", inputJsonSchema: { type: "object" } }, { name: "skill.search", inputJsonSchema: { type: "object" } },
      { name: "vdt.add_driver", inputJsonSchema: addSchema }
    ] } } });
    expect(names(context.forPrompt(envelope, prompt, { constructingTree: true, needsStructure: true, hasReadSkill: true }))).toEqual(["vdt.add_driver"]);
    expect(names(context.forPrompt(envelope, JSON.stringify({ delta: { type: "tool_results", results: [] } }), { constructingTree: true, needsStructure: false, hasReadSkill: true }))).toEqual(["skill.read", "skill.search", "vdt.add_driver"]);
    expect(names(context.forPrompt(envelope, JSON.stringify({ delta: { type: "tool_results", results: [] } }), { constructingTree: false, hasReadSkill: true }))).toEqual(["skill.read", "skill.search", "vdt.add_driver"]);
  });

  it("namespaces opaque IDs by exchange and tuple position without changing model-authored tool arguments", () => {
    const context = new LocalModelOutputSchema();
    const input = JSON.parse(initial);
    const first = context.forPrompt(envelope, JSON.stringify({ ...input, exchangeId: "exchange-1-1" })) as { properties: { turnId: { const: string } } };
    expect(first.properties.turnId.const).toBe("exchange-1-1");
    const items = calls(first).items as unknown as Array<{ anyOf: Array<{ properties: { externalCallId: { const: string }; args: unknown } }> }>;
    expect(items).toHaveLength(3);
    expect(items.map((item) => item.anyOf[0]!.properties.externalCallId.const)).toEqual(["exchange-1-1:call:1", "exchange-1-1:call:2", "exchange-1-1:call:3"]);
    expect(items[0]!.anyOf[0]!.properties.args).toEqual(addSchema);
    const next = context.forPrompt(envelope, JSON.stringify({ exchangeId: "exchange-1-2", delta: { type: "tool_results", results: [] } }));
    const nextItems = calls(next).items as unknown as typeof items;
    expect(nextItems[0]!.anyOf[0]!.properties.externalCallId.const).toBe("exchange-1-2:call:1");
  });

  it("defers new-tree checks until calculation is ready without imposing construction gates on review", () => {
    const context = new LocalModelOutputSchema();
    const prompt = JSON.stringify({ delta: { type: "initial_context", context: { tools:
      ["tools.describe", "vdt.validate", "vdt.calculate", "run.request_finish", "excavation.seed_topology"].map((name) => ({ name, inputJsonSchema: { type: "object" } }))
    } } });
    context.forPrompt(envelope, prompt);
    const described = JSON.stringify({ delta: { type: "tool_results", results: [{ toolName: "tools.describe", status: "succeeded", payload: { output: { tools:
      ["vdt.validate", "vdt.calculate", "excavation.seed_topology"].map((name) => ({ name, inputJsonSchema: { type: "object" } }))
    } } }] } });
    expect(names(context.forPrompt(envelope, described, { constructingTree: true, needsStructure: true, projectReadyForFinish: false }))).toEqual(["excavation.seed_topology", "tools.describe"]);
    expect(names(context.forPrompt(envelope, described, { constructingTree: true, needsStructure: false, projectReadyForFinish: false }))).toEqual(["tools.describe"]);
    expect(names(context.forPrompt(envelope, described, { constructingTree: true, needsStructure: false, projectReadyForFinish: true }))).toEqual(["run.request_finish", "tools.describe", "vdt.calculate", "vdt.validate"]);
    expect(names(context.forPrompt(envelope, described, { constructingTree: false, projectReadyForFinish: false }))).toEqual(["excavation.seed_topology", "tools.describe", "vdt.calculate", "vdt.validate"]);
  });

  it("grounds existing target IDs and makes value writes unavailable before a placeholder has drivers", () => {
    const context = new LocalModelOutputSchema();
    const update = { type: "object", properties: { nodeId: { type: "string" }, patch: { type: "object" } } };
    const batch = { type: "object", properties: { values: { type: "array", items: { type: "object", properties: { nodeId: { type: "string" } } } } } };
    const prompt = JSON.stringify({ delta: { type: "initial_context", context: { tools: [
      { name: "tools.describe", inputJsonSchema: { type: "object" } },
      { name: "vdt.update_node", inputJsonSchema: update },
      { name: "vdt.fill_input_values_batch", inputJsonSchema: batch }
    ] } } });
    const empty = context.forPrompt(envelope, prompt, { needsStructure: true, writableInputCount: 0, truncated: false, nodeColumns: ["id"], nodes: [["root"]], inputLeafIds: [] });
    expect(names(empty)).toEqual(["tools.describe"]);
    const graph = { needsStructure: false, writableInputCount: 1, truncated: false, nodeColumns: ["id"], nodes: [["root"], ["input_1"]], inputLeafIds: ["input_1"] };
    const next = context.forPrompt(envelope, JSON.stringify({ delta: { type: "tool_results", results: [] } }), graph);
    const tools = allCalls(next).flatMap((option) => option.items.anyOf);
    expect(tools.find((tool) => tool.properties.toolName.const === "vdt.update_node")!.properties.args).toMatchObject({ properties: { nodeId: { enum: ["root", "input_1"] } } });
    expect(tools.find((tool) => tool.properties.toolName.const === "vdt.fill_input_values_batch")!.properties.args).toMatchObject({ properties: { values: { items: { properties: { nodeId: { enum: ["input_1"] } } } } } });
    const truncated = context.forPrompt(envelope, JSON.stringify({ delta: { type: "tool_results", results: [] } }), { ...graph, truncated: true });
    expect(allCalls(truncated).flatMap((option) => option.items.anyOf).find((tool) => tool.properties.toolName.const === "vdt.update_node")!.properties.args).toEqual(update);
  });

  it("keeps core value/formula updates callable upfront and suppresses redundant continuation prose", () => {
    const context = new LocalModelOutputSchema();
    const first = context.forPrompt(envelope, JSON.stringify({ delta: { type: "initial_context", context: { tools: [
      { name: "tools.describe", inputJsonSchema: { type: "object" } },
      { name: "vdt.update_node", inputJsonSchema: addSchema },
      { name: "vdt.fill_input_values_batch", inputJsonSchema: { type: "object" } },
      { name: "vdt.add_driver", inputJsonSchema: addSchema }
    ] } } }));
    expect(names(first)).toEqual(["tools.describe", "vdt.add_driver", "vdt.fill_input_values_batch", "vdt.update_node"]);
    expect((first as { properties: { assistantMessage: { anyOf: Array<{ type: string }> } } }).properties.assistantMessage.anyOf.some((option) => option.type === "null")).toBe(false);
    const next = context.forPrompt(envelope, JSON.stringify({ delta: { type: "tool_results", results: [] } })) as { properties: { assistantMessage: unknown; sessionState: { maxLength: number } } };
    expect(next.properties.assistantMessage).toEqual({ type: "null" });
    expect(next.properties.sessionState.maxLength).toBe(512);
  });

  it("requires schema discovery and cannot re-admit draft replacement in a continuation run", () => {
    const context = new LocalModelOutputSchema();
    const first = context.forPrompt(envelope, JSON.stringify({ delta: { type: "initial_context", context: {
      brief: { mode: "continue_project" }, tools: [
        { name: "tools.describe", inputJsonSchema: { type: "object" } },
        { name: "run.request_finish", inputJsonSchema: { type: "object" } },
        { name: "vdt.add_driver", inputJsonSchema: addSchema },
        { name: "vdt.create_draft", inputJsonSchema: { type: "object" } }
      ]
    } } }));
    expect(names(first)).toEqual(["run.request_finish", "tools.describe", "vdt.add_driver"]);
    const next = context.forPrompt(envelope, JSON.stringify({ delta: { type: "tool_results", results: [{
      toolName: "tools.describe", status: "succeeded", payload: { output: { tools: [
        { name: "vdt.add_driver", inputJsonSchema: addSchema },
        { name: "vdt.create_draft", inputJsonSchema: { type: "object" } },
        { name: "hidden.exec", inputJsonSchema: { type: "object" } }
      ] } }
    }] } }));
    expect(names(next)).toEqual(["run.request_finish", "tools.describe", "vdt.add_driver"]);
  });

  it("requires seed/control calls to stand alone before planning against their returned node IDs", () => {
    const context = new LocalModelOutputSchema();
    const format = context.forPrompt(envelope, JSON.stringify({ delta: { type: "initial_context", context: { tools: [
      { name: "vdt.add_driver", inputJsonSchema: addSchema },
      { name: "excavation.seed_topology", inputJsonSchema: { type: "object" } },
      { name: "run.request_finish", inputJsonSchema: { type: "object" } }
    ] } } }));
    const options = allCalls(format);
    const seed = options.find((batch) => batch.items.anyOf.some((tool) => tool.properties.toolName.const === "excavation.seed_topology"))!;
    expect(seed.maxItems).toBe(1);
    expect(seed.items.anyOf.map((tool) => tool.properties.toolName.const)).not.toContain("vdt.add_driver");
    expect(calls(format).maxItems).toBe(3);
    expect(calls(format).items.anyOf.map((tool) => tool.properties.toolName.const)).toEqual(["vdt.add_driver"]);
  });

  it("requires the real parentNodeId and retains tool schemas after an invalid call checkpoint", () => {
    const context = new LocalModelOutputSchema();
    const original = JSON.stringify(envelope);
    const format = context.forPrompt(envelope, initial);
    expect(calls(format).maxItems).toBe(3);
    expect(calls(format).items.anyOf).toHaveLength(1);
    expect(calls(format).items.anyOf[0]!.properties).toMatchObject({ toolName: { const: "vdt.add_driver" }, args: addSchema });
    const next = context.forPrompt(envelope, JSON.stringify({ delta: { type: "tool_results", results: [{ toolName: "vdt.add_driver", payload: { error: { code: "INVALID_TOOL_ARGS" } } }] } }));
    expect(calls(next).items).toEqual(calls(format).items);
    expect(JSON.stringify(envelope)).toBe(original);
  });

  it("refines known schemas from Gateway introspection without admitting hidden tools or replacing the initial catalog", () => {
    const context = new LocalModelOutputSchema();
    context.forPrompt(envelope, initial);
    const refined = { ...addSchema, properties: { ...addSchema.properties, name: { type: "string", minLength: 1 } } };
    const next = context.forPrompt(envelope, JSON.stringify({ delta: { type: "checkpoint_inputs", inputs: [], checkpointDelta: { type: "tool_results", results: [{ toolName: "tools.describe", status: "succeeded", payload: { output: { tools: [
      { name: "vdt.add_driver", inputJsonSchema: refined }, { name: "hidden.exec", inputJsonSchema: {} }
    ] } } }] } } }));
    expect(calls(next).items.anyOf.map((tool) => tool.properties.toolName.const)).toEqual(["vdt.add_driver"]);
    expect(calls(next).items.anyOf[0]!.properties.args).toEqual(refined);
    const failed = context.forPrompt(envelope, JSON.stringify({ delta: { type: "tool_results", results: [{ toolName: "tools.describe", status: "failed", payload: { output: { tools: [
      { name: "vdt.add_driver", inputJsonSchema: { type: "object", properties: { parentId: { type: "string" } } } }
    ] } } }] } }));
    expect(calls(failed).items).toEqual(calls(next).items);
    const rebound = context.forPrompt(envelope, JSON.stringify({ delta: { type: "initial_context", context: { tools: [{ name: "hidden.exec", inputJsonSchema: {} }] } } }));
    expect(calls(rebound).items).toEqual(calls(next).items);
    expect(calls(new LocalModelOutputSchema().forPrompt(envelope, "plain text")).items).not.toHaveProperty("anyOf");
  });
});
