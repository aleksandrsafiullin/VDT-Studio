import { modelAgentStructuredTurnSchema } from "@vdt-studio/vdt-agent-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalModelAgentBinding } from "./local-model-bindings";
import { createLocalModelAgentProvider } from "./local-model-provider";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("local Model Agent structured transport", () => {
  it.each([false, true, "medium"])("pins %s from the immutable binding on local chat turns", async (think) => {
    const output = { turnId: "turn", sessionState: "Review", assistantMessage: null,
      action: { type: "question", messageId: "question", questionSetId: "questions", questions: [
        { id: "goal", question: "Which KPI?", expectedAnswerType: "text", required: true }
      ] } };
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ done: true, message: { content: JSON.stringify(output) } }));
    vi.stubGlobal("fetch", fetcher);
    const binding = createLocalModelAgentBinding("ollama", "local-model", `sha256:${"e".repeat(64)}`, think);
    const provider = createLocalModelAgentProvider(binding);
    await provider.completeStructured({ taskType: "agent_decision", input: {}, schema: modelAgentStructuredTurnSchema, systemPrompt: "VDT", userPrompt: "Clarify goal" });
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)).think).toBe(think);
  });
  it("honors explicit binding sampling and prediction limits instead of generic caller defaults", async () => {
    const output = { turnId: "turn", sessionState: "Review", assistantMessage: null,
      action: { type: "question", messageId: "question", questionSetId: "questions", questions: [
        { id: "goal", question: "Which KPI?", expectedAnswerType: "text", required: true }
      ] } };
    const fetcher = vi.fn(async () => Response.json({ done: true, message: { content: JSON.stringify(output) } }));
    vi.stubGlobal("fetch", fetcher);
    const binding = createLocalModelAgentBinding("ollama", "local-model", `sha256:${"e".repeat(64)}`);
    const provider = createLocalModelAgentProvider({ ...binding,
      modelEngineAdapter: { ...binding.modelEngineAdapter, temperature: 0.6, maxTokens: 3_000 }
    });
    await provider.completeStructured({ taskType: "agent_decision", input: {}, schema: modelAgentStructuredTurnSchema,
      systemPrompt: "VDT", userPrompt: "Clarify goal", temperature: 0.2, maxTokens: 8_000 });
    const request = JSON.parse(String((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(request.options).toMatchObject({ temperature: 0.6, num_predict: 3_000 });
  });

  it("normalizes native input keys into canonical public arguments without choosing numeric values", async () => {
    const output = { turnId: "turn", sessionState: "Fill", assistantMessage: { messageId: "first", text: "Build the tree." }, action: { type: "action_batch", batch: {
      calls: [{ externalCallId: "call", toolName: "vdt.fill_input_values_batch", args: { values: { count: { value: 4, provenance: "user_provided_value", note: "4 machines" } } } }]
    } } };
    const fetcher = vi.fn(async () => Response.json({ done: true, message: { content: JSON.stringify(output) } }));
    vi.stubGlobal("fetch", fetcher);
    const provider = createLocalModelAgentProvider(createLocalModelAgentBinding("ollama", "test-model", `sha256:${"d".repeat(64)}`), () => ({
      constructingTree: true, needsStructure: false,
      nativeInputBatch: { schemaVersion: "values_by_node_id.v1", batches: [["count"]] }
    }));
    const result = await provider.completeStructured({ taskType: "agent_decision", input: {}, schema: modelAgentStructuredTurnSchema,
      systemPrompt: "VDT", userPrompt: JSON.stringify({ delta: { type: "initial_context", context: { brief: { prompt: "4 machines" }, tools: [{
        name: "vdt.fill_input_values_batch", inputJsonSchema: { type: "object", properties: { values: { type: "array", items: {
          type: "object", properties: { nodeId: { type: "string" }, value: { type: "number" }, provenance: { type: "string" }, note: { type: "string" } },
          required: ["nodeId", "value", "provenance", "note"], additionalProperties: false
        } } } }
      }] } } }) });
    expect(result).toMatchObject({ action: { batch: { calls: [{ args: { values: [{ nodeId: "count", value: 4, provenance: "user_provided_value", note: "4 machines" }] } }] } } });
    const request = JSON.parse(String((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    const args = request.format.properties.action.anyOf.find((option: { properties: { batch?: unknown } }) => option.properties.batch).properties.batch.properties.calls.items.anyOf[0].properties.args;
    expect(args).toHaveProperty("properties.values.anyOf.0.properties.count");
    expect(JSON.stringify(args)).not.toContain('"nodeId"');
  });

  it("reviews the original brief and actual root dependencies before finishing a new tree", async () => {
    const output = { turnId: "turn", sessionState: "Review", assistantMessage: null, action: { type: "action_batch", batch: {
      calls: [{ externalCallId: "call", toolName: "run.request_finish", args: {} }]
    } } };
    const fetcher = vi.fn(async () => Response.json({ done: true, message: { content: JSON.stringify(output) } }));
    vi.stubGlobal("fetch", fetcher);
    const provider = createLocalModelAgentProvider(createLocalModelAgentBinding("ollama", "test-model", `sha256:${"c".repeat(64)}`), () => ({
      constructingTree: true, projectReadyForFinish: true,
      rootDependencyInputs: [{ id: "count", value: 4, valueStatus: "user_provided_value", sourceNote: "4 machines" }]
    }));
    const complete = (delta: unknown) => provider.completeStructured({ taskType: "agent_decision", input: {}, schema: modelAgentStructuredTurnSchema,
      systemPrompt: "VDT", userPrompt: JSON.stringify({ delta }) });
    await complete({ type: "initial_context", context: { tools: [], brief: { prompt: "4 machines; 10 trucks", businessContext: "Original context" } } });
    await complete({ type: "tool_results", results: [] });
    const request = JSON.parse(String((fetcher.mock.calls[1] as unknown as [string, RequestInit])[1].body));
    const current = JSON.parse(request.messages.at(-1).content);
    expect(current.finalBusinessReview).toMatchObject({
      originalBrief: { prompt: "4 machines; 10 trucks", businessContext: "Original context" },
      unrepresentedLiteralQuantities: [{ value: 10, quote: "10 trucks" }]
    });
    expect(current.hostObservation.rootDependencyInputs).toHaveLength(1);
  });

  it("transports current-revision verification progress while preserving the selected model and thinking", async () => {
    const output = { turnId: "turn", sessionState: "Check", assistantMessage: null, action: { type: "action_batch", batch: {
      calls: [{ externalCallId: "call", toolName: "vdt.validate", args: {} }]
    } } };
    const fetcher = vi.fn(async () => Response.json({ done: true, message: { content: JSON.stringify(output) } }));
    vi.stubGlobal("fetch", fetcher);
    let revision = 4;
    const provider = createLocalModelAgentProvider(createLocalModelAgentBinding("ollama", "chosen-local-model", `sha256:${"c".repeat(64)}`, true), () => ({
      revision, constructingTree: true, needsStructure: false, projectReadyForFinish: true
    }));
    const checks = ["vdt.validate", "vdt.calculate", "vdt.inspect_hierarchy"];
    const complete = (delta: unknown) => provider.completeStructured({ taskType: "agent_decision", input: {}, schema: modelAgentStructuredTurnSchema,
      systemPrompt: "VDT", userPrompt: JSON.stringify({ delta }) });
    await complete({ type: "initial_context", context: { tools: [...checks, "run.request_finish"].map((name) => ({ name, inputJsonSchema: { type: "object" } })) } });
    await complete({ type: "tool_results", results: checks.map((toolName) => ({
      toolName, status: "succeeded", resultHash: `sha256:${"d".repeat(64)}`, payload: { output: toolName === "vdt.calculate" ? { rootValue: 2000, errors: [] } : { valid: true, errors: [] } }
    })) });
    revision = 5;
    await complete({ type: "tool_results", results: [] });
    const bodies = fetcher.mock.calls.map((call) => JSON.parse(String((call as unknown as [string, RequestInit])[1].body)));
    for (const body of bodies) expect(body).toMatchObject({ model: "chosen-local-model", think: true });
    const workflows = bodies.map((body) => JSON.parse(body.messages.at(-1).content).hostObservation.verificationWorkflow);
    expect(workflows).toEqual([
      { revision: 4, completed: [], pending: checks, nextStep: "run_checks" },
      { revision: 4, completed: checks, pending: [], nextStep: "request_finish" },
      { revision: 5, completed: [], pending: checks, nextStep: "run_checks" }
    ]);
    expect(JSON.stringify(bodies[0].format)).not.toContain('"const":"run.request_finish"');
    expect(JSON.stringify(bodies[1].format)).toContain('"const":"run.request_finish"');
    expect(JSON.stringify(bodies[2].format)).not.toContain('"const":"run.request_finish"');
  });

  it("keeps discovered skill IDs and argument guides in later native requests without replaying a full conversation", async () => {
    const output = { turnId: "turn", sessionState: "Continue", assistantMessage: null, action: { type: "action_batch", batch: {
      batchId: "batch", calls: [{ externalCallId: "call", toolName: "skill.list", args: {} }]
    } } };
    const fetcher = vi.fn(async () => Response.json({ done: true, message: { content: JSON.stringify(output) } }));
    vi.stubGlobal("fetch", fetcher);
    const provider = createLocalModelAgentProvider(createLocalModelAgentBinding("ollama", "qwen3:4b-instruct", `sha256:${"b".repeat(64)}`));
    const complete = (delta: unknown) => provider.completeStructured({ taskType: "agent_decision", input: {}, schema: modelAgentStructuredTurnSchema,
      systemPrompt: "VDT", userPrompt: JSON.stringify({ delta }) });
    await complete({ type: "initial_context", context: { tools: ["tools.describe", "skill.list", "skill.read"].map((name) => ({ name, inputJsonSchema: { type: "object" } })) } });
    const readSchema = { type: "object", properties: { skillId: { type: "string" } }, required: ["skillId"] };
    await complete({ type: "tool_results", results: [
      { toolName: "tools.describe", status: "succeeded", payload: { output: { tools: [{ name: "skill.read", inputJsonSchema: readSchema }] } } },
      { toolName: "skill.list", status: "succeeded", payload: { output: { skills: [{ id: "actual_skill", title: "Actual returned skill" }] } } }
    ] });
    await complete({ type: "tool_results", results: [] });
    const request = JSON.parse(String((fetcher.mock.calls[2] as unknown as [string, RequestInit])[1].body));
    const current = JSON.parse(request.messages.at(-1).content);
    expect(current.confirmedKnowledge).toMatchObject({
      discoveredSkills: { entries: [{ id: "actual_skill" }] }, toolArgumentGuides: { entries: [{ name: "skill.read", inputJsonSchema: readSchema }] }
    });
    expect(request.messages).toHaveLength(4);
  });

  it("reviews a redundant construction confirmation once and returns the model's own repair without a user answer", async () => {
    const question = { turnId: "turn", sessionState: "Ask", assistantMessage: null, action: { type: "question", messageId: "ask", questionSetId: "questions", questions: [{
      id: "plan", question: "Should I repair my plan to match your request?", required: true
    }] } };
    const repair = { turnId: "turn", sessionState: "Repair plan", assistantMessage: null, action: { type: "action_batch", batch: { calls: [{
      externalCallId: "repair", toolName: "vdt.set_decomposition_plan", args: { plan: { version: 1, goal: "User scope", nodes: [{ nodeId: "quantity", parentNodeId: "root", kind: "input" }] } }
    }] } } };
    let nativeCalls = 0;
    const fetcher = vi.fn(async () => Response.json({ done: true, message: { content: JSON.stringify(++nativeCalls === 1 ? question : { questionDisposition: "continue_work", ...repair }) } }));
    vi.stubGlobal("fetch", fetcher);
    const provider = createLocalModelAgentProvider(createLocalModelAgentBinding("ollama", "chosen-local-model", `sha256:${"e".repeat(64)}`, true), () => ({
      revision: 4, constructingTree: true, needsStructure: false, hasDecompositionPlan: true
    }));
    const result = await provider.completeStructured({ taskType: "agent_decision", input: {}, schema: modelAgentStructuredTurnSchema,
      systemPrompt: "VDT", userPrompt: JSON.stringify({ exchangeId: "exchange-1-4", delta: { type: "tool_results", results: [] } }) });
    expect(result).toEqual(repair);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const bodies = fetcher.mock.calls.map((call) => JSON.parse(String((call as unknown as [string, RequestInit])[1].body)));
    for (const body of bodies) expect(body).toMatchObject({ model: "chosen-local-model", think: true });
    const branches = bodies[1].format.anyOf;
    expect(branches.map((branch: { properties: { questionDisposition: { const: string } } }) => branch.properties.questionDisposition.const)).toEqual(["continue_work", "ask_user"]);
    expect(branches[0].properties.turnId).toEqual(bodies[0].format.properties.turnId);
    expect(JSON.stringify(branches[0].properties.action)).not.toContain('"const":"question"');
    expect(branches[1].properties.action.anyOf.map((action: { properties: { type: { const: string } } }) => action.properties.type.const)).toEqual(["question"]);
    const review = JSON.parse(bodies[1].messages.at(-1).content);
    expect(review).toMatchObject({ exchangeId: "exchange-1-4", delta: { type: "tool_results", results: [] }, hostQuestionReview: {
      proposedQuestions: [{ question: "Should I repair my plan to match your request?" }]
    } });
    expect(review).not.toHaveProperty("answer");
    expect(review).not.toHaveProperty("human_inputs");
  });

  it("preserves a genuine missing-fact question after one review without looping or inventing its answer", async () => {
    const question = { turnId: "turn", sessionState: "Need fact", assistantMessage: null, action: { type: "question", messageId: "ask", questionSetId: "questions", questions: [{
      id: "period", question: "Which reporting period should the model use?", required: true
    }] } };
    let nativeCalls = 0;
    const fetcher = vi.fn(async () => Response.json({ done: true, message: { content: JSON.stringify(++nativeCalls === 1 ? question : { questionDisposition: "ask_user", ...question }) } }));
    vi.stubGlobal("fetch", fetcher);
    const provider = createLocalModelAgentProvider(createLocalModelAgentBinding("ollama", "chosen-local-model", `sha256:${"f".repeat(64)}`), () => ({
      revision: 0, constructingTree: true, needsStructure: false
    }));
    const result = await provider.completeStructured({ taskType: "agent_decision", input: {}, schema: modelAgentStructuredTurnSchema,
      systemPrompt: "VDT", userPrompt: JSON.stringify({ delta: { type: "tool_results", results: [] } }) });
    expect(result).toEqual(question);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([undefined, "continue_work", "unknown"])("rejects a question with an inconsistent review disposition %s instead of inventing consent", async (questionDisposition) => {
    const question = { turnId: "turn", sessionState: "Question", assistantMessage: null, action: { type: "question", messageId: "ask", questionSetId: "questions", questions: [{
      id: "period", question: "Which period?", required: true
    }] } };
    let nativeCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ done: true, message: { content: JSON.stringify(++nativeCalls === 1 ? question : { questionDisposition, ...question }) } })));
    const provider = createLocalModelAgentProvider(createLocalModelAgentBinding("ollama", "chosen-local-model", `sha256:${"f".repeat(64)}`), () => ({
      revision: 0, constructingTree: true, needsStructure: false
    }));
    await expect(provider.completeStructured({ taskType: "agent_decision", input: {}, schema: modelAgentStructuredTurnSchema,
      systemPrompt: "VDT", userPrompt: JSON.stringify({ delta: { type: "tool_results", results: [] } }) })).rejects.toThrow("inconsistent disposition");
    expect(nativeCalls).toBe(2);
  });

  it.each([
    ["ollama", "http://127.0.0.1:11434/api/chat"],
    ["lm_studio", "http://127.0.0.1:1234/v1/chat/completions"],
    ["vllm", "http://127.0.0.1:8000/v1/chat/completions"]
  ] as const)("sends %s to its fixed endpoint with an enforced turn schema and no cloud credential", async (backendId, endpoint) => {
    vi.stubEnv("OPENAI_COMPATIBLE_API_KEY", "cloud-secret-must-not-be-used");
    const output = {
      turnId: "first", sessionState: "Await user answer", assistantMessage: null,
      action: { type: "question", messageId: "message", questionSetId: "questions", questions: [{
        id: "shifts", question: "Сколько смен в сутки?", expectedAnswerType: "text", required: true
      }] }
    };
    const fetcher = vi.fn(async () => Response.json(backendId === "ollama"
      ? { done: true, message: { content: JSON.stringify(output) } }
      : { choices: [{ message: { content: JSON.stringify(output) } }] }));
    vi.stubGlobal("fetch", fetcher);
    const provider = createLocalModelAgentProvider(createLocalModelAgentBinding(backendId, "qwen3:8b", `sha256:${"a".repeat(64)}`));
    const result = await provider.completeStructured({
      taskType: "agent_decision", input: {}, schema: modelAgentStructuredTurnSchema,
      systemPrompt: "Follow the VDT tool catalog", userPrompt: "Build excavation tree", model: "qwen3:8b"
    });
    expect(result).toEqual(output);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(endpoint);
    expect(init.redirect).toBe("error");
    expect(init.headers).not.toHaveProperty("authorization");
    expect(init.body).not.toContain("cloud-secret");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("qwen3:8b");
    const schema = backendId === "ollama" ? body.format : body.response_format.json_schema.schema;
    expect(schema).toMatchObject({ type: "object", required: ["turnId", "sessionState", "assistantMessage", "action"] });
    if (backendId === "ollama") {
      expect(body).toMatchObject({ stream: true, options: { num_ctx: 16_384, num_predict: 8_192 } });
      expect(body).not.toHaveProperty("think");
      expect(body.options).not.toHaveProperty("temperature");
      expect(schema.properties.sessionState.maxLength).toBe(512);
      expect(body.messages[0].content).not.toContain("Required JSON response schema");
    } else {
      expect(body.response_format.type).toBe("json_schema");
    }
    if (backendId !== "ollama") expect(body.messages[0].content).toContain("Required JSON response schema");
    await provider.completeStructured({
      taskType: "agent_decision", input: {}, schema: modelAgentStructuredTurnSchema,
      systemPrompt: "Follow the VDT tool catalog", userPrompt: "Current checkpoint/tool results"
    });
    const continuation = JSON.parse(String((fetcher.mock.calls[1] as unknown as [string, RequestInit])[1].body));
    expect(continuation.messages[1]).toEqual({ role: "user", content: "Build excavation tree" });
    expect(continuation.messages.at(-1)).toEqual({ role: "user", content: "Current checkpoint/tool results" });
  });
});
