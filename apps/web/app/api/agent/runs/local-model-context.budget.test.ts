import { describe, expect, it, vi } from "vitest";
import { OllamaProvider, type OllamaAgentRequest } from "@vdt-studio/ai-harness";
import { estimateOllamaAgentRequest, prepareOllamaAgentRequest } from "./local-model-budget";

const brief = {
  prompt: "Рассчитай добычу за год. Указано 4 экскаватора и 10 машин. Сохрани ограничение пропускной способности.",
  options: { continueWithAssumptions: true, researchMode: "off" },
  selectedSkill: { id: "mining.load_and_haul", version: 1, contentHash: "sha256:fixture" }
};
const input = {
  exchangeId: "turn-1",
  toolSchemasAvailable: ["skill.read"],
  delta: { type: "initial_context", contextHash: "initial-hash", context: {
    brief, toolCatalogHash: "catalog-hash", permission: "workspace-read-write",
    tools: [{ name: "skill.read", description: "Read a Skill" }, { name: "vdt.set_formula", description: "formula".repeat(100) }]
  } },
  hostObservation: { revision: 10, constructingTree: true }
};
const request: OllamaAgentRequest = {
  model: "qwen3.5:4b-q4_K_M", stream: true, think: false, format: { type: "object" },
  options: { num_ctx: 16_384, num_predict: 4_096 },
  messages: [{ role: "system", content: "You are the VDT analytical agent. " + "Legacy system rules. ".repeat(350) }, { role: "user", content: JSON.stringify(input) }]
};

describe("Ollama Model Agent transport budget", () => {
  it("uses the skill-stage prompt and drops only duplicate brief and ineligible tool card prose", () => {
    const output = prepareOllamaAgentRequest(request);
    expect(output.options).toEqual({ num_ctx: 4_096, num_predict: 768 });
    expect(output.think).toBe(false);
    expect(output.format).toBe(request.format);
    const projected = JSON.parse(output.messages[1]!.content);
    expect(projected.originalBrief).toEqual(brief);
    expect(projected.delta).toEqual({ type: "initial_context", contextHash: "initial-hash", context: {
      toolCatalogHash: "catalog-hash", permission: "workspace-read-write",
      tools: [{ name: "skill.read", description: "Read a Skill" }], otherToolNames: ["vdt.set_formula"]
    } });
    expect(estimateOllamaAgentRequest(output).bytes).toBeLessThan(estimateOllamaAgentRequest(request).bytes / 2);
    expect(JSON.parse(request.messages[1]!.content)).toEqual(input);
  });

  it("keeps specialist and outcome-policy instructions through the wire projection", () => {
    const guidance = "Select the answer outcome only for a discussion. Do not change the graph.";
    const specialized = { ...request, messages: [
      { role: "system" as const, content: guidance }, request.messages[1]!
    ] };
    expect(prepareOllamaAgentRequest(specialized).messages[0]!.content).toBe(guidance);
  });

  it("retains scoped batch, exact revisions, provenance and answers without repeating historical wire data", () => {
    const current = {
      exchangeId: "turn-2", toolSchemasAvailable: ["vdt.fill_input_values_batch"],
      sessionContinuation: { semanticState: "Continue the approved task" },
      hostObservation: { revision: 11, rootNodeId: "annual_output", nativeInputBatch: { batches: [["machines", "downtime"]] },
        nodeColumns: ["id", "baselineValue"], nodes: [["downtime", 0]],
        versions: [{ id: "confirmed-revision" }] },
      confirmedKnowledge: {
        recentUserAnswers: [{ id: "confirmed", text: "Only include scheduled downtime" }],
        confirmedSourceObservations: { entries: [{ datasetId: "dispatch", queryHash: "exact", numericValue: 0 }] }
      },
      delta: { type: "manual_reconciliation", reconciliation: { previousRevision: 10, currentRevision: 11 },
        results: [{ externalCallId: "call-1", resultHash: "receipt", status: "failed", resultCode: "STALE_REVISION" }] }
    };
    const finalRequest = { ...request, messages: [
      ...request.messages, { role: "assistant" as const, content: "historical tool reply" },
      { role: "user" as const, content: JSON.stringify(current) }
    ] };
    const output = prepareOllamaAgentRequest(finalRequest);
    const projected = JSON.parse(output.messages[1]!.content);
    expect(output.messages).toHaveLength(2);
    expect(projected).toEqual({ ...current, originalBrief: brief,
      retainedInitialContext: { toolCatalogHash: "catalog-hash", permission: "workspace-read-write" } });
    expect(estimateOllamaAgentRequest(output).estimatedTotalTokens).toBeLessThanOrEqual(output.options.num_ctx);
  });

  it("keeps exact current Skill receipt while omitting only equivalent cached fields", () => {
    const output = { id: "mining.load_and_haul", readReceiptId: "read-1", title: "Load and haul",
      excerpt: "Long current Skill evidence", executableTopology: { defaults: [{ nodeId: "hours", value: 0 }] } };
    const current = { ...input, originalBrief: brief, toolSchemasAvailable: ["vdt.fill_input_values_batch"],
      delta: { type: "tool_results", results: [{ toolName: "skill.read", status: "succeeded", resultHash: "original",
        payload: { output } }] },
      confirmedKnowledge: { readSkills: [{ id: output.id, title: output.title, executableTopology: output.executableTopology,
        excerpt: "Cache-only evidence" }], toolArgumentGuides: { entries: [{ name: "vdt.set_formula" }] } }
    };
    const projected = JSON.parse(prepareOllamaAgentRequest({ ...request, messages: [request.messages[0]!,
      { role: "user", content: JSON.stringify(current) }] }).messages.at(-1)!.content);
    expect(projected.delta).toEqual(current.delta);
    expect(projected.confirmedKnowledge).toEqual({ ...current.confirmedKnowledge,
      readSkills: [{ id: output.id, excerpt: "Cache-only evidence" }] });
  });

  it("keeps the full evidence and shrinks the output reserve when a wide batch almost fits", () => {
    const wider = { ...request, format: { description: "s".repeat(40_200) },
      messages: [{ role: "system" as const, content: "Use actual dimensions." },
        { role: "user" as const, content: JSON.stringify({ ...input, toolSchemasAvailable: ["vdt.fill_input_values_batch"] }) }] };
    const output = prepareOllamaAgentRequest(wider);
    expect(output.options.num_ctx).toBe(16_384);
    expect(output.options.num_predict).toBe(2_048);
    expect(output.format).toEqual(wider.format);
    expect(JSON.parse(output.messages.at(-1)!.content).originalBrief).toEqual(brief);
  });

  it("uses a separate bounded native grammar when the combined estimate overstates context for a workspace turn", () => {
    const wide = { ...request, format: { description: "g".repeat(22_000) },
      messages: [{ role: "system" as const, content: "Authoritative workspace context. ".repeat(780) },
        { role: "user" as const, content: JSON.stringify({ ...input, toolSchemasAvailable: ["vdt.fill_input_values_batch"] }) }] };
    const result = prepareOllamaAgentRequest(wide);
    const budget = estimateOllamaAgentRequest(result);
    expect(result.options).toMatchObject({ num_ctx: 16_384, num_predict: 3_072 });
    expect(budget.estimatedTotalTokens).toBeGreaterThan(16_384);
    expect(budget.estimatedMessageTokens + budget.outputReserveTokens).toBeLessThan(16_384);
    expect(budget.estimatedGrammarTokens).toBeLessThan(8_192);
    expect(result.format).toEqual(wide.format);
    expect(result.messages[0]).toEqual(wide.messages[0]);
  });

  it.each([[3_000, 8_192], [18_000, 16_384], [50_000, null]] as const)("accounts for a %i-byte schema and chooses the smallest viable tested window", (length, window) => {
    const withSchema = { ...request, format: { description: "s".repeat(length), type: "object" }, think: true };
    if (!window) {
      expect(() => prepareOllamaAgentRequest(withSchema)).toThrow(/context budget/);
      return;
    }
    const projected = prepareOllamaAgentRequest(withSchema);
    expect(projected.options.num_ctx).toBe(window);
    expect(projected.options.num_predict).toBe(4_096);
    expect(projected.think).toBe(true);
    expect(estimateOllamaAgentRequest(projected).schemaBytes).toBeGreaterThan(length);
  });

  it("changes only budgets and messages on the native wire and leaves non-agent tasks alone", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(
      JSON.stringify({ message: { content: "{}" }, done: true }) + "\n"
    ));
    const prepareAgentRequest = vi.fn((wire: OllamaAgentRequest) => ({
      ...wire, model: "unapproved", think: true, format: { type: "array" },
      options: { num_ctx: 4_096, num_predict: 256, temperature: 1 }
    }));
    const provider = new OllamaProvider({
      baseUrl: "http://127.0.0.1:11434/v1", model: request.model, think: false, prepareAgentRequest, fetch: fetcher
    });
    const params = { input: {}, systemPrompt: "System", userPrompt: "Task", schema: { type: "object" }, temperature: 0 };
    await provider.completeStructured({ ...params, taskType: "agent_decision" });
    await provider.completeStructured({ ...params, taskType: "generate_tree" });
    expect(prepareAgentRequest).toHaveBeenCalledOnce();
    const [first, second] = fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
    expect(first).toMatchObject({ model: request.model, think: false, format: { type: "object" },
      options: { num_ctx: 4_096, num_predict: 256, temperature: 0 } });
    expect(second.options).toMatchObject({ num_ctx: 16_384, num_predict: 4_096, temperature: 0 });
  });

  it("accepts only the full validated response from its one budget recovery attempt", async () => {
    const frame = (proposal: { calls: string[] }, doneReason: string) => new Response(JSON.stringify({
      message: { content: JSON.stringify(proposal) }, done: true, done_reason: doneReason
    }) + "\n");
    const fetcher = vi.fn<() => Promise<Response>>()
      .mockResolvedValueOnce(frame({ calls: ["partial"] }, "length"))
      .mockResolvedValueOnce(frame({ calls: ["complete-action-1", "complete-action-2"] }, "stop"));
    const provider = new OllamaProvider({
      baseUrl: "http://127.0.0.1:11434/v1", model: request.model, think: false,
      prepareAgentRequest: prepareOllamaAgentRequest, fetch: fetcher
    });
    await expect(provider.completeStructured({ taskType: "agent_decision", input: {}, userPrompt: JSON.stringify(input),
      schema: { type: "object" }, systemPrompt: "Use verified evidence." }))
      .resolves.toEqual({ calls: ["complete-action-1", "complete-action-2"] });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("keeps an unknown correction envelope, rejects overflow before network and never accepts a truncated action", async () => {
    const raw = { ...request, messages: [{ role: "system" as const, content: "Correct the whole object." },
      { role: "user" as const, content: "Use the current brief and return a complete correction." }] };
    expect(prepareOllamaAgentRequest(raw).messages).toEqual(raw.messages);
    const partial = () => new Response(
      JSON.stringify({ message: { content: '{"action":{"calls":[{"toolName":"vdt.set_formula"}]}}' }, done: true, done_reason: "length" }) + "\n"
    );
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => partial());
    const provider = new OllamaProvider({
      baseUrl: "http://127.0.0.1:11434/v1", model: "qwen3.5:4b-q4_K_M", think: false,
      prepareAgentRequest: prepareOllamaAgentRequest, fetch: fetcher
    });
    const params = { taskType: "agent_decision" as const, input: {}, systemPrompt: "Use verified evidence.",
      userPrompt: JSON.stringify(input), schema: { type: "object" } };
    await expect(provider.completeStructured({ ...params, schema: { description: "s".repeat(75_000) } })).rejects.toThrow(/context budget/);
    expect(fetcher).not.toHaveBeenCalled();
    await expect(provider.completeStructured(params)).rejects.toThrow(/token limit/);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const [first, retry] = fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
    expect(retry.messages).toEqual(first.messages);
    expect(retry.format).toEqual(first.format);
    expect(retry.options.num_ctx).toBe(16_384);
    expect(retry.options.num_predict).toBe(first.options.num_predict * 2);
    const overflow = () => new Response(JSON.stringify({ message: { content: "{}" }, done: true,
      done_reason: "stop", prompt_eval_count: 16_384 }) + "\n");
    fetcher.mockResolvedValueOnce(overflow()).mockResolvedValueOnce(overflow());
    await expect(provider.completeStructured(params)).rejects.toMatchObject({ code: "LOCAL_CONTEXT_OVERFLOW" });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
});
