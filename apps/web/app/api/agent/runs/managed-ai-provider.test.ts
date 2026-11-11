import { afterEach, expect, it, vi } from "vitest";
import { modelAgentStructuredTurnSchema } from "@vdt-studio/vdt-agent-runtime";
import { createManagedAwareAiProvider } from "./managed-ai-provider";
import { buildOpenAiModelTurn } from "./openai-agent-decision";
import { calculationsWithoutPlannedInputs } from "./openai-hierarchy-repair";
import { toProviderJsonSchema } from "./provider-json-schema";

afterEach(() => vi.unstubAllGlobals());

it("sends native OpenAI call items and rejects malformed argument strings before execution", async () => {
  const calls = [{ toolName: "project.get_node", argsJson: '{"nodeId":"root"}' }];
  const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) => new Response(JSON.stringify({
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
      type: "call_tools", toolName: "", argsJson: "{}", calls,
      statusMessage: "Inspecting the root.", questionsJson: "[]", summary: "", nextSuggestedActions: []
    }) } }]
  })));
  vi.stubGlobal("fetch", fetchMock);
  const provider = createManagedAwareAiProvider({
    providerId: "openai_compatible",
    providerConfig: { baseUrl: "https://api.openai.com/v1", apiKey: "test-api-key", model: "gpt-5-nano", reasoningEffort: "low" }
  }, "http://localhost", { retainInitialContext: false });
  const params = { taskType: "agent_decision" as const, input: {}, schema: {}, systemPrompt: "Choose a tool.", userPrompt: "{}" };

  await expect(provider.completeStructured(params)).resolves.toMatchObject({
    type: "call_tool", toolName: "project.get_node", args: { nodeId: "root" }
  });
  const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
  expect(body).toMatchObject({ model: "gpt-5-nano", reasoning_effort: "low", response_format: {
    type: "json_schema", json_schema: { strict: true, schema: { properties: {
      calls: { type: "array", maxItems: 6, items: { required: ["toolName", "argsJson"] } }
    } } }
  } });
  expect(body.response_format.json_schema.schema.properties).not.toHaveProperty("callsJson");
  expect(body.messages[0].content).toContain('questionsJson must encode this exact array schema: {"type":"array","minItems":1,"maxItems":5');
  calls[0]!.argsJson = "{";
  await expect(provider.completeStructured({ ...params, userPrompt: '{"revision":2}' })).rejects.toMatchObject({
    code: "SCHEMA_INVALID"
  });
  expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)).messages).toHaveLength(2);
});

it("projects Supervisor turns without sending the open args record to OpenAI", () => {
  const native = buildOpenAiModelTurn(toProviderJsonSchema(modelAgentStructuredTurnSchema), [
    { name: "vdt.create_draft", inputJsonSchema: { type: "object", required: ["rootKpi"],
      properties: { rootKpi: { type: "string" }, unit: { type: "string" } } } },
    { name: "memory.add_note", inputJsonSchema: { type: "object", required: ["note"], properties: { note: { type: "string" } } } }
  ], undefined, "exchange-1", undefined)!;
  expect(JSON.stringify(native.schema)).not.toContain("propertyNames");
  expect(JSON.stringify(native.schema)).not.toContain("finishReceiptId");
  const turn = { turnId: "exchange-1", sessionState: "Opening draft", assistantMessage: null,
    action: { type: "action_batch", batch: { calls: [
      { toolName: "vdt.create_draft", args: { rootKpi: "Revenue", unit: null } },
      { toolName: "memory.add_note", argsJson: '{"note":"Ready"}' }
    ] } } };
  expect(modelAgentStructuredTurnSchema.parse(native.decode(turn))).toMatchObject({ action: {
    batch: { calls: [{ externalCallId: "exchange-1:call:1", args: { rootKpi: "Revenue" } },
      { externalCallId: "exchange-1:call:2", args: { note: "Ready" } }] }
  } });
  const construction = buildOpenAiModelTurn(toProviderJsonSchema(modelAgentStructuredTurnSchema), [
    { name: "vdt.set_decomposition_plan", inputJsonSchema: { type: "object", properties: {} } },
    { name: "user.ask", inputJsonSchema: { type: "object", properties: {} } },
    { name: "memory.add_note", inputJsonSchema: { type: "object", properties: {} } }
  ], { nodeCount: 1, constructingTree: true, needsStructure: true }, "exchange-2", undefined)!;
  expect(JSON.stringify(construction.schema)).not.toContain("questionSetId");
  expect(JSON.stringify(construction.schema)).not.toContain("user.ask");
  expect(JSON.stringify(construction.schema)).not.toContain("memory.add_note");
});

it.each([true, false])("constrains a redundant opening question during construction (%s)", (constructingTree) => {
  const recovery = buildOpenAiModelTurn(toProviderJsonSchema(modelAgentStructuredTurnSchema), [
    { name: "vdt.create_draft", inputJsonSchema: { type: "object", properties: {} } }
  ], { nodeCount: 0, constructingTree }, "exchange-1", undefined, { continueWithoutQuestion: true, requireOpeningMessage: true })!;
  expect(JSON.stringify(recovery.schema)).not.toContain("questionSetId");
  expect(recovery.schema.properties).toMatchObject({
    assistantMessage: constructingTree ? { type: "null" } : { anyOf: [{ type: "object" }] }
  });
  expect(() => recovery.decode({ action: { type: "question" } })).toThrow("Action does not match");
});

it("uses the actual root and accepted plan IDs for construction calls", () => {
  const string = { type: "string" };
  const object = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties) });
  const driver = object({ nodeId: string, parentNodeId: string, name: string });
  const plan = object({ plan: object({ nodes: { type: "array", items: object({ nodeId: string, parentNodeId: string, kind: string }) } }) });
  const catalog = [
    { name: "vdt.set_decomposition_plan", inputJsonSchema: plan },
    { name: "vdt.add_driver", inputJsonSchema: driver },
    { name: "vdt.add_drivers_batch", inputJsonSchema: object({ drivers: { type: "array", minItems: 2, items: driver } }) },
    { name: "vdt.set_formula", inputJsonSchema: object({ nodeId: string, formula: string }) }
  ];
  const schema = toProviderJsonSchema(modelAgentStructuredTurnSchema);
  const rootOnly = { nodeCount: 1, constructingTree: true, needsStructure: true, rootNodeId: "root_kpi",
    truncated: false, nodeColumns: ["id"], nodes: [["root_kpi"]] };
  const first = buildOpenAiModelTurn(schema, catalog, rootOnly, "exchange-1", undefined)!;
  const nodes = [{ nodeId: "net_sales", parentNodeId: "ROOT", kind: "calculated" },
    { nodeId: "discount", parentNodeId: "root_kpi", kind: "input" },
    { nodeId: "price_per_item", parentNodeId: "net_sales", kind: "input" }];
  const turn = first.decode({ turnId: "exchange-1", sessionState: "{}", assistantMessage: null,
    action: { type: "action_batch", batch: { calls: [{ toolName: "vdt.set_decomposition_plan", args: { plan: { nodes } } }] } } });
  const accepted = [{ ...nodes[0], parentNodeId: "root_kpi" }, ...nodes.slice(1)];
  expect(turn).toMatchObject({ action: { batch: { calls: [{ args: { plan: { nodes: accepted } } }] } } });
  const planned = buildOpenAiModelTurn(schema, catalog, { ...rootOnly, decompositionPlan: { nodes: accepted } },
    "exchange-2", undefined, { planRecorded: true })!;
  expect(planned.toolGuidance.map((tool) => tool.name)).toEqual(["vdt.add_driver", "vdt.add_drivers_batch"]);
  const tools = planned.schema.$defs as { toolCall: { anyOf: unknown[] } };
  expect(tools.toolCall.anyOf[1]).toMatchObject({ properties: { args: { properties: {
    drivers: { maxItems: 2, items: { properties: {
      nodeId: { enum: ["net_sales", "discount"] }, parentNodeId: { const: "root_kpi" }
    } } }
  } } } });
  const partial = buildOpenAiModelTurn(schema, catalog, { ...rootOnly, nodeCount: 3, needsStructure: false,
    nodes: [["root_kpi"], ["net_sales"], ["discount"]], decompositionPlan: { nodes: accepted } }, "exchange-3", undefined)!;
  expect(partial.toolGuidance.map((tool) => tool.name)).toEqual(["vdt.set_decomposition_plan", "vdt.add_driver", "vdt.set_formula"]);
  const partialTools = partial.schema.$defs as { toolCall: { anyOf: unknown[] } };
  expect(partialTools.toolCall.anyOf[2]).toMatchObject({ properties: { args: { properties: {
    nodeId: { enum: ["root_kpi", "net_sales"] }
  } } } });
});

it("reviews an intermediate without factors and accepts direct or shared operands", () => {
  const nodes = [
    { nodeId: "duplicate_result", parentNodeId: "root_kpi", kind: "calculated" },
    { nodeId: "note", parentNodeId: "duplicate_result", kind: "context" },
    { nodeId: "subtotal", parentNodeId: "root_kpi", kind: "calculated" },
    { nodeId: "quantity", parentNodeId: "subtotal", kind: "input", sharedWith: ["total_cost"] },
    { nodeId: "total_cost", parentNodeId: "root_kpi", kind: "calculated" }
  ];
  expect(calculationsWithoutPlannedInputs({ nodes })).toEqual(["duplicate_result"]);
  expect(calculationsWithoutPlannedInputs({ nodes: nodes.slice(2) })).toEqual([]);
});

it("offers the checked repair only when every underlying tool is admitted", () => {
  const schema = toProviderJsonSchema(modelAgentStructuredTurnSchema);
  const repair = [{ toolName: "vdt.reparent_branch" as const, args: {
    nodeId: "volume", parentNodeId: "gross", fromParentNodeId: "root"
  } }];
  const catalog = ["vdt.reparent_branch", "vdt.inspect_hierarchy"].map((name) => ({
    name, inputJsonSchema: { type: "object", properties: {} }
  }));
  const request = { turnId: "exchange-1", sessionState: "{}", assistantMessage: null, action: { type: "apply_hierarchy_repair" } };
  const native = buildOpenAiModelTurn(schema, catalog, undefined, "exchange-1", undefined, { hierarchyRepair: repair })!;
  expect(native.hasHierarchyRepair).toBe(true);
  expect(native.toolGuidance.map(({ name }) => name)).toEqual(["vdt.reparent_branch"]);
  expect(modelAgentStructuredTurnSchema.parse(native.decode(request)).action).toEqual({
    type: "action_batch", batch: { calls: [{ ...repair[0], externalCallId: "exchange-1:call:1" }] }
  });
  const withoutTool = buildOpenAiModelTurn(schema, catalog.slice(1), undefined, "exchange-1", undefined, { hierarchyRepair: repair })!;
  expect(withoutTool.hasHierarchyRepair).toBe(false);
  expect(() => withoutTool.decode(request)).toThrow("Action does not match");
});

it("binds a native argument object to its tool and removes nullable placeholders", async () => {
  const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) => new Response(JSON.stringify({
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
      decision: {
        type: "call_tool", statusMessage: "Creating the draft.",
        call: { toolName: "vdt.create_draft", args: { projectTitle: "Sales", unit: null } }
      }
    }) } }]
  })));
  vi.stubGlobal("fetch", fetchMock);
  const provider = createManagedAwareAiProvider({
    providerId: "openai_compatible",
    providerConfig: { baseUrl: "https://api.openai.com/v1", apiKey: "test-api-key", model: "gpt-5-nano" }
  }, "http://localhost", { retainInitialContext: false });
  const input = {
    currentProject: { rootNodeId: "root", truncated: false, nodes: [{ id: "root", type: "root_kpi", childIds: [] }] },
    availableTools: [
      { name: "vdt.create_draft", inputJsonSchema: {
        type: "object", required: ["projectTitle"], properties: { projectTitle: { type: "string" }, unit: { type: "string" } }
      } },
      { name: "vdt.set_formula", inputJsonSchema: {
        type: "object", required: ["nodeId", "formula"], properties: { nodeId: { type: "string" }, formula: { type: "string" } }
      } },
      { name: "vdt.fill_input_values_batch", inputJsonSchema: { type: "object", properties: {} } }
    ]
  };
  await expect(provider.completeStructured({
    taskType: "agent_decision", input, schema: {}, systemPrompt: "Choose a tool.", userPrompt: JSON.stringify(input)
  })).resolves.toMatchObject({ type: "call_tool", toolName: "vdt.create_draft", args: { projectTitle: "Sales" } });
  const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
  const choices = body.response_format.json_schema.schema.$defs.toolCall.anyOf;
  expect(choices[0]).toMatchObject({
    properties: {
      toolName: { const: "vdt.create_draft" },
      args: { additionalProperties: false, required: ["projectTitle", "unit"] }
    }
  });
  expect(choices).toHaveLength(2);
  expect(choices[1]).toMatchObject({ properties: {
    toolName: { const: "vdt.set_formula" }, args: { properties: { nodeId: { enum: ["root"] } } }
  } });
  expect(JSON.parse(body.messages[1].content).availableTools).toEqual([
    { name: "vdt.create_draft" }, { name: "vdt.set_formula" }
  ]);
});
