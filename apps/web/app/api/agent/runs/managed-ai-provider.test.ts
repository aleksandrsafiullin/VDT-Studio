import { afterEach, expect, it, vi } from "vitest";
import { calculationsWithoutPlannedInputs, VdtBuilderSession, type VdtDecompositionPlan } from "@vdt-studio/vdt-core";
import { createDefaultToolRegistry, modelAgentStructuredTurnSchema } from "@vdt-studio/vdt-agent-runtime";
import { createManagedAwareAiProvider } from "./managed-ai-provider";
import { buildOpenAiModelTurn, checkedInitialPlanRepair, openAiConstructionPlan } from "./openai-agent-decision";
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
    { name: "vdt.update_node", inputJsonSchema: object({ nodeId: string, patch: object({ formula: string, name: string }) }) },
    { name: "vdt.set_formula", inputJsonSchema: object({ nodeId: string, formula: string }) }
  ];
  const builder = new VdtBuilderSession();
  builder.createDraft({ projectTitle: "Revenue", rootKpi: "Чистая выручка" });
  const rootNodeId = builder.getProject().rootNodeId;
  const schema = toProviderJsonSchema(modelAgentStructuredTurnSchema);
  const rootOnly = { nodeCount: 1, constructingTree: true, needsStructure: true, rootNodeId,
    truncated: false, nodeColumns: ["id"], nodes: [[rootNodeId]] };
  const first = buildOpenAiModelTurn(schema, catalog, rootOnly, "exchange-1", undefined)!;
  const nodes: VdtDecompositionPlan["nodes"] = [{ nodeId: "net_sales", parentNodeId: "ROOT", kind: "calculated" },
    { nodeId: "discount", parentNodeId: rootNodeId, kind: "input" },
    { nodeId: "price_per_item", parentNodeId: "net_sales", kind: "input", sharedWith: [rootNodeId] }];
  const turn = first.decode({ turnId: "exchange-1", sessionState: "{}", assistantMessage: null,
    action: { type: "action_batch", batch: { calls: [{ toolName: "vdt.set_decomposition_plan", args: { plan: { nodes } } }] } } });
  const accepted = [{ ...nodes[0]!, parentNodeId: rootNodeId }, ...nodes.slice(1)];
  expect(turn).toMatchObject({ action: { batch: { calls: [{ args: { plan: { nodes: accepted } } }] } } });
  builder.updateNode({ nodeId: rootNodeId, patch: { decompositionPlan: { version: 1, goal: "Revenue", nodes: accepted } } });
  const planned = buildOpenAiModelTurn(schema, catalog, rootOnly,
    "exchange-2", undefined, { planRecorded: true, constructionPlan: openAiConstructionPlan(builder.getProject())! })!;
  expect(planned.toolGuidance.map((tool) => tool.name)).toEqual(["vdt.add_driver", "vdt.add_drivers_batch"]);
  const tools = planned.schema.$defs as { toolCall: { anyOf: unknown[] } };
  expect(tools.toolCall.anyOf[1]).toMatchObject({ properties: { args: { properties: {
    drivers: { maxItems: 2, items: { anyOf: [
      { properties: { nodeId: { enum: ["net_sales"] }, parentNodeId: { const: rootNodeId }, type: { const: "calculated" } } },
      { properties: { nodeId: { enum: ["discount"] }, parentNodeId: { const: rootNodeId }, type: { enum: expect.arrayContaining(["input"]) } } }
    ] } }
  } } } });
  builder.addDriver({ parentNodeId: rootNodeId, nodeId: "net_sales", name: "Net sales", type: "calculated" });
  const observation = () => ({ ...rootOnly, needsStructure: false, nodeCount: builder.getProject().graph.nodes.length,
    nodes: builder.getProject().graph.nodes.map(({ id }) => [id]) });
  const projectTurn = () => buildOpenAiModelTurn(schema, catalog, observation(), "exchange-3", undefined, {
    constructionPlan: openAiConstructionPlan(builder.getProject())!
  })!;
  const partial = projectTurn();
  expect(partial.toolGuidance.map((tool) => tool.name)).toEqual(["vdt.add_driver", "vdt.update_node"]);
  const steered = buildOpenAiModelTurn(schema, catalog, observation(), "exchange-steered", undefined, {
    constructionPlan: openAiConstructionPlan(builder.getProject())!, allowPlanRevision: true
  })!;
  expect(steered.toolGuidance.map((tool) => tool.name)).toContain("vdt.set_decomposition_plan");
  const partialTools = partial.schema.$defs as { toolCall: { anyOf: unknown[] } };
  expect(partialTools.toolCall.anyOf[0]).toMatchObject({ properties: { args: { properties: {
    nodeId: { enum: ["discount"] }, parentNodeId: { const: rootNodeId }
  } } } });
  expect(JSON.stringify(partialTools.toolCall.anyOf[1])).not.toContain('"formula"');
  builder.addDriver({ parentNodeId: rootNodeId, nodeId: "discount", name: "Discount" });
  expect(openAiConstructionPlan(builder.getProject())).toMatchObject({
    additions: [{ parentNodeId: "net_sales", nodeIds: ["price_per_item"] }], calculatedIds: [], pendingFactors: true,
    plannedKinds: { price_per_item: "input" }
  });
  builder.addDriver({ parentNodeId: "net_sales", nodeId: "price_per_item", name: "Price" });
  expect(openAiConstructionPlan(builder.getProject())).toMatchObject({
    additions: [], calculatedIds: [rootNodeId, "net_sales"], pendingFactors: false
  });
  expect(projectTurn().toolGuidance.map((tool) => tool.name)).toContain("vdt.set_formula");
  const formulaTurn = (formula: string) => projectTurn().decode({
    turnId: "exchange-3", sessionState: "{}", assistantMessage: null,
    action: { type: "action_batch", batch: { calls: [
      { toolName: "vdt.set_formula", args: { nodeId: rootNodeId, formula } }
    ] } }
  });
  expect(formulaTurn(`${rootNodeId} = net_sales - discount`)).toMatchObject({
    action: { batch: { calls: [{ args: { formula: "net_sales - discount" } }] } }
  });
  expect(formulaTurn("other_kpi = net_sales - discount")).toMatchObject({
    action: { batch: { calls: [{ args: { formula: "other_kpi = net_sales - discount" } }] } }
  });
  const existing = buildOpenAiModelTurn(schema, catalog, { ...observation(), constructingTree: false }, "exchange-existing", undefined)!;
  const existingTools = existing.schema.$defs as { toolCall: { anyOf: unknown[] } };
  expect(existingTools.toolCall.anyOf[3]).toHaveProperty("properties.args.properties.patch.properties.formula", string);
});

it("projects direct update types without restricting ordinary property patches", () => {
  const builder = new VdtBuilderSession();
  builder.createDraft({ projectTitle: "Revenue", rootKpi: "Revenue", unit: "USD" });
  const root = builder.getProject().rootNodeId;
  builder.addDriver({ parentNodeId: root, nodeId: "subtotal", name: "Subtotal", type: "calculated" });
  builder.addDriver({ parentNodeId: root, nodeId: "measured", name: "Measured input", unit: "%", baselineValue: 10 });
  builder.updateNode({ nodeId: "measured", patch: { valueStatus: "user_provided_value", valueSource: { note: "Discount was 10%" } } });
  builder.addDriver({ parentNodeId: root, nodeId: "empty", name: "Empty", type: "input" });
  builder.addDriver({ parentNodeId: root, nodeId: "basis", name: "Basis", type: "input" });
  const nodes: VdtDecompositionPlan["nodes"] = [
    ...["subtotal", "measured", "empty"].map((nodeId) => ({ nodeId, parentNodeId: root, kind: "calculated" as const })),
    { nodeId: "basis", parentNodeId: root, kind: "input", sharedWith: ["subtotal", "measured", "empty"] }
  ];
  builder.updateNode({ nodeId: root, patch: { decompositionPlan: { version: 1, goal: "Calculate revenue", nodes } } });
  const catalog = [createDefaultToolRegistry().getSpec("vdt.update_node")!];
  const schema = toProviderJsonSchema(modelAgentStructuredTurnSchema);
  const project = builder.getProject();
  const native = buildOpenAiModelTurn(schema, catalog, { constructingTree: true, nodeCount: 5 }, "type-updates", undefined,
    { constructionPlan: openAiConstructionPlan(project)! })!;
  const projected = native.schema.$defs as { toolCall: { anyOf: Array<{ properties: { args: { anyOf: Array<{
    properties: { nodeId: { enum: string[] }; patch: { properties: Record<string, unknown> } }
  }> } } }> } };
  const patchFor = (nodeId: string) => projected.toolCall.anyOf[0]!.properties.args.anyOf
    .find(({ properties }) => properties.nodeId.enum.includes(nodeId))!.properties.patch.properties;
  for (const [id, expected] of [[root, "root_kpi"], ["subtotal", "calculated"], ["empty", "calculated"], ["measured", "input"]]) {
    expect(patchFor(id!).type).toEqual({ anyOf: [{ type: "string", const: expected }, { type: "null" }] });
    expect(patchFor(id!)).toHaveProperty("description");
    expect(patchFor(id!)).not.toHaveProperty("formula");
  }
  expect(patchFor("basis").type).toMatchObject({ anyOf: [{ enum: ["input", "assumption", "external_factor", "data_mapped"] }, { type: "null" }] });
  const legacy = buildOpenAiModelTurn(schema, catalog, { constructingTree: false, nodeCount: 5 }, "legacy-updates", undefined)!;
  expect(legacy.schema.$defs).toMatchObject({ toolCall: { anyOf: [{ properties: { args: { properties: {
    patch: { properties: { formula: expect.anything() } }
  } } } }] } });
});

it("projects the independent addition and the real node type when a prior plan drifted", () => {
  const builder = new VdtBuilderSession();
  builder.createDraft({ projectTitle: "Revenue", rootKpi: "Revenue", unit: "USD" });
  const root = builder.getProject().rootNodeId;
  for (const nodeId of ["gross", "net"]) builder.addDriver({ parentNodeId: root, nodeId, name: nodeId, type: "calculated", unit: "USD" });
  builder.addDriver({ parentNodeId: "gross", nodeId: "sales", name: "Sales", unit: "USD" });
  builder.addDriver({ parentNodeId: "gross", nodeId: "discount", name: "Discount", unit: "%" });
  builder.setFormula({ nodeId: "gross", formula: "sales" });
  const nodes: VdtDecompositionPlan["nodes"] = [
    { nodeId: "gross", parentNodeId: root, kind: "calculated" }, { nodeId: "net", parentNodeId: root, kind: "calculated" },
    { nodeId: "sales", parentNodeId: "gross", kind: "input" }, { nodeId: "discount", parentNodeId: "gross", kind: "calculated" },
    { nodeId: "rate", parentNodeId: "discount", kind: "input" }, { nodeId: "refunds", parentNodeId: "net", kind: "input" }
  ];
  const recordPlan = (entries: VdtDecompositionPlan["nodes"]) => builder.updateNode({ nodeId: root,
    patch: { decompositionPlan: { version: 1, goal: "Revenue", nodes: entries } } });
  recordPlan(nodes);
  expect(openAiConstructionPlan(builder.getProject())).toMatchObject({ calculatedIds: [root],
    additions: [{ parentNodeId: "net", nodeIds: ["refunds"] }], plannedKinds: { refunds: "input" },
    kindConflicts: [{ nodeId: "discount", plannedKind: "calculated", actualType: "input" }] });
  recordPlan(nodes.filter(({ nodeId }) => nodeId !== "rate").map((entry) => entry.nodeId === "discount" ? { ...entry, kind: "input" } : entry));
  expect(openAiConstructionPlan(builder.getProject())?.settledFormulaIds).toBeUndefined();
  builder.setFormula({ nodeId: "gross", formula: "sales * (1 - discount / 100)" });
  expect(openAiConstructionPlan(builder.getProject())).toMatchObject({ calculatedIds: [root, "gross"], settledFormulaIds: ["gross"] });
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

it("checks a pruned plan without discarding source inputs, context or distinct subtotals", () => {
  const root = "root_kpi";
  const nodes: VdtDecompositionPlan["nodes"] = [
    { nodeId: "subtotal", parentNodeId: root, kind: "calculated" },
    { nodeId: "quantity", parentNodeId: "subtotal", kind: "input", rationale: "Measured quantity" },
    { nodeId: "price", parentNodeId: "subtotal", kind: "input", sharedWith: [root] },
    { nodeId: "refunds", parentNodeId: root, kind: "input" },
    { nodeId: "source_note", parentNodeId: "quantity", kind: "context", rationale: "Reference scope" }
  ];
  const empty = { nodeId: "empty_result", parentNodeId: root, kind: "calculated" } as const;
  const plan = { version: 1, goal: "Calculate the total", nodes: [...nodes, empty] };
  const facts = [{ value: 2, quote: "2 items", unit: "items" }, { value: 20, quote: "20 USD per item", unit: "USD/item" },
    { value: 5, quote: "5 USD of refunds", unit: "USD" }, { value: 100, quote: "Benchmark of 100" }];
  expect(checkedInitialPlanRepair(plan, root, facts)).toEqual({ ...plan, nodes });
  expect(checkedInitialPlanRepair({ ...plan, nodes: [nodes[3], empty] }, root, facts)).toBeUndefined();
  for (const retained of [
    [...nodes, { ...empty, sharedWith: ["subtotal"] }],
    [...nodes, empty, { nodeId: "note", parentNodeId: empty.nodeId, kind: "context", rationale: "Preserve this context" }],
    [...nodes, empty, { nodeId: "new_factor", parentNodeId: empty.nodeId, kind: "input" }]
  ]) {
    expect(checkedInitialPlanRepair({ ...plan, nodes: retained }, root)).toBeUndefined();
  }
});

it("projects only declared orphan links for native construction", () => {
  const builder = new VdtBuilderSession();
  builder.createDraft({ projectTitle: "Revenue", rootKpi: "Revenue" });
  const parent = builder.getProject().rootNodeId;
  builder.addDriver({ parentNodeId: parent, nodeId: "sales", name: "Sales" });
  builder.updateNode({ nodeId: parent, patch: { decompositionPlan: { version: 1, goal: "Revenue", nodes: [
    { nodeId: "sales", parentNodeId: parent, kind: "input" }
  ] } } });
  const project = builder.getProject();
  const catalog = [createDefaultToolRegistry().getSpec("vdt.add_edge")!];
  const turn = (constructingTree = true) => buildOpenAiModelTurn(toProviderJsonSchema(modelAgentStructuredTurnSchema), catalog,
    { constructingTree, hasDecompositionPlan: true, nodeCount: 2 }, "exchange-edge", undefined,
    { constructionPlan: openAiConstructionPlan(project)! })!;
  expect(turn().toolGuidance).toEqual([]);
  expect(turn(false).toolGuidance).toEqual([expect.objectContaining({ name: "vdt.add_edge" })]);
  project.graph.edges = [];
  const orphan = turn();
  expect(orphan.toolGuidance).toEqual([expect.objectContaining({ name: "vdt.add_edge" })]);
  expect(orphan.schema.$defs).toMatchObject({ toolCall: { anyOf: [{ properties: { args: { anyOf: [{ properties: {
    sourceNodeId: { const: parent }, targetNodeId: { const: "sales" },
    relation: { enum: expect.arrayContaining(["positive_driver", "formula_dependency"]) }
  } }] } } }] } });
  expect(JSON.stringify(orphan.schema.$defs)).not.toContain("contextual_influence");
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
