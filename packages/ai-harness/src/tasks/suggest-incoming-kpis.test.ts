import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi, afterEach } from "vitest";
import { buildKpiSuggestionContext, buildKpiSuggestionTaskInput, KPI_SUGGESTION_MODEL_JSON_SCHEMA, KPI_SUGGESTION_RECIPES, kpiSuggestionPromptInput, materializeKpiSuggestion, validateKpiSuggestionModelOutput,
  type KpiSuggestionModelOutput, type VdtNode } from "@vdt-studio/vdt-core";
import { createSmartKpiMeasuredFixture } from "@vdt-studio/vdt-core";
import { runSuggestIncomingKpis } from "./suggest-incoming-kpis";
import { OpenAiCompatibleProvider } from "../providers/openai-compatible-provider";
import { AzureOpenAiProvider } from "../providers/azure-openai-provider";
import { AnthropicProvider } from "../providers/anthropic-provider";
import { GeminiProvider } from "../providers/gemini-provider";
import { LocalRunnerProvider } from "../providers/local-runner-provider";
import { readBoundedText } from "../providers/provider-utils";
import type { AiProvider } from "../types";

const empty = { status: "empty", rationale: "No supported immediate decomposition.", limitations: [], groups: [] };
const params = { taskType: "suggest_incoming_kpis" as const, input: {}, schema: KPI_SUGGESTION_MODEL_JSON_SCHEMA,
  outputJsonSchema: KPI_SUGGESTION_MODEL_JSON_SCHEMA, systemPrompt: "Read-only bounded task.", userPrompt: "{}", maxTokens: 9000 };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const chat = (extra: Record<string, unknown> = {}) => ({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(empty) }, ...extra }] });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("Smart response reader ownership", () => {
  it("awaits cancellation of an open tail after malformed UTF-8", async () => {
    let finish!: () => void, started!: () => void, settled = false;
    const cancelling = new Promise<void>(resolve => { started = resolve; });
    const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([0xc3, 0x28])); },
      cancel() { started(); return new Promise<void>(resolve => { finish = resolve; }); } }));
    const pending = readBoundedText(response, 1024, "Smart", undefined, true).finally(() => { settled = true; }); void pending.catch(() => {});
    await cancelling; expect(settled).toBe(false); expect(response.body?.locked).toBe(true);
    finish(); await expect(pending).rejects.toBeInstanceOf(TypeError); expect(response.body?.locked).toBe(false);
  });
  it("prioritizes unconfirmed reader cancellation over malformed UTF-8", async () => {
    vi.useFakeTimers(); let started!: () => void;
    const cancelling = new Promise<void>(resolve => { started = resolve; });
    const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([0xc3, 0x28])); },
      cancel() { started(); return new Promise<void>(() => {}); } }));
    const pending = readBoundedText(response, 1024, "Smart", undefined, true); void pending.catch(() => {});
    await cancelling; await vi.advanceTimersByTimeAsync(1251);
    await expect(pending).rejects.toMatchObject({ code: "CLEANUP_UNCONFIRMED" });
  });
});

describe("one-completion Smart task", () => {
  it("validates its small canonical input, calls once, and never repairs", async () => {
    const context = await buildKpiSuggestionContext(createSmartKpiMeasuredFixture(), { workspaceId: "qa", vdtId: null, targetNodeId: "measured_output", period: { key: "2026-10", grain: "month" } });
    const input = buildKpiSuggestionTaskInput(context);
    const completeStructured = vi.fn(async (_params: unknown): Promise<unknown> => empty), provider = { completeStructured } as unknown as AiProvider;
    await expect(runSuggestIncomingKpis(provider, input, { maxTokens: 9000 })).resolves.toEqual(empty);
    expect(completeStructured).toHaveBeenCalledTimes(1); expect(completeStructured.mock.calls[0]![0]).toMatchObject({ taskType: "suggest_incoming_kpis", maxTokens: 2048 });
    const sent = completeStructured.mock.calls[0]![0] as { userPrompt: string; outputJsonSchema: unknown };
    expect(JSON.parse(sent.userPrompt).responseContract).toEqual(input.responseContract);
    expect(sent.outputJsonSchema).toEqual(KPI_SUGGESTION_MODEL_JSON_SCHEMA);
    completeStructured.mockResolvedValueOnce({ ...empty, groups: [{ values: [100] }] });
    await expect(runSuggestIncomingKpis(provider, input)).rejects.toThrow(); expect(completeStructured).toHaveBeenCalledTimes(2);
    await expect(runSuggestIncomingKpis(provider, { ...input, recipes: [] })).rejects.toThrow(); expect(completeStructured).toHaveBeenCalledTimes(2);
  });
  it("sends the selected adjustment scope and preserves full host context for a saved refund input", async () => {
    const project = createSmartKpiMeasuredFixture();
    delete project.businessContext;
    const createNode = (id: string, name: string, unit: string, fields: Partial<VdtNode>): VdtNode => ({
      id, name, unit, type: "input", status: "accepted", aiGenerated: true, createdAt: project.createdAt, updatedAt: project.updatedAt, ...fields
    });
    project.rootNodeId = "root_kpi";
    project.graph = {
      nodes: [
        createNode("root_kpi", "Чистая выручка", "USD", { type: "root_kpi", formula: "net_revenue", decompositionPlan: {
          version: 1, goal: "Calculate net revenue.", nodes: [{ nodeId: "returns_amount", parentNodeId: "net_revenue", kind: "input",
            rationale: "Total returns value after discounts." }]
        } }),
        createNode("net_revenue", "Net revenue", "USD", {
          type: "calculated", formula: "qty_sold * price_per_item * (1 - discount_rate/100) - returns_amount"
        }),
        createNode("qty_sold", "Qty sold", "items", { baselineValue: 120 }),
        createNode("price_per_item", "Price per item", "USD/item", { baselineValue: 50 }),
        createNode("discount_rate", "Discount rate", "%", { baselineValue: 10 }),
        createNode("returns_amount", "Returns amount", "USD", { baselineValue: 500, description: "Returns/allowances after discounts" })
      ],
      edges: ["net_revenue", "qty_sold", "price_per_item", "discount_rate", "returns_amount"].map(targetNodeId => ({
        id: `edge_${targetNodeId}`, sourceNodeId: targetNodeId === "net_revenue" ? "root_kpi" : "net_revenue", targetNodeId,
        relation: "formula_dependency", aiGenerated: true
      }))
    };
    const content = readFileSync(new URL("../../../vdt-agent/skills/generic/logical-kpi-decomposition.md", import.meta.url), "utf8");
    const selectedSkill = { ...KPI_SUGGESTION_RECIPES.bundledUniversalSkill!, title: "Generic logical KPI decomposition", content };
    const personalisation = { userInstructions: "Use precise factor units." };
    const context = await buildKpiSuggestionContext(project, {
      workspaceId: "qa", vdtId: "saved_vdt", targetNodeId: "returns_amount", period: { key: "explicit:monthly", grain: "month" },
      selectedSkill, personalisation
    });
    const task = buildKpiSuggestionTaskInput(context);
    const ready: KpiSuggestionModelOutput = { status: "ready", rationale: "Use amounts from the same return and allowance records.", limitations: [], groups: [{
      id: "return_adjustments", title: "Return adjustments", selectionMode: "all", recipeId: null,
      formula: "p_1 * p_2", requiredKeys: ["p_1", "p_2"], limitations: [],
      children: [
        { key: "p_1", conceptKey: "adjustment_count", name: "Return and allowance adjustment count", unit: "adjustment", description: null, existingNodeId: null },
        { key: "p_2", conceptKey: "mean_adjustment", name: "Mean adjustment after discount", unit: "USD/adjustment", description: null, existingNodeId: null }
      ]
    }] };
    const fetch = vi.fn(async (_url: unknown, _init?: RequestInit) => json(chat({ message: { content: JSON.stringify(ready) } })));
    const provider = new OpenAiCompatibleProvider({ baseUrl: "https://selected.example/v1", apiKey: "synthetic", model: "gpt-5-nano", reasoningEffort: "low", fetch });
    const result = await runSuggestIncomingKpis(provider, task);
    expect(fetch).toHaveBeenCalledTimes(1);
    const request = JSON.parse(String(fetch.mock.calls[0]![1]?.body));
    expect(request).toMatchObject({ model: "gpt-5-nano", reasoning_effort: "low", max_completion_tokens: 2048, response_format: { type: "json_schema" } });
    expect(request.messages[0].content).toContain("even if every new factor's value is unknown");
    expect(request.messages[0].content).toContain("Use responseContract.excludedAncestorRecipes only to avoid");
    const prompt = JSON.parse(request.messages[1].content);
    expect(prompt).not.toHaveProperty("recipes");
    expect(Object.keys(prompt)).toEqual(["schemaVersion", "responseContract", "context"]);
    expect(prompt.context).toEqual({ targetNodeId: context.targetNodeId, target: context.target, period: context.period, selectedSkill, personalisation });
    expect(prompt.context.target).not.toHaveProperty("baselineValue");
    expect(request.messages[1].content).not.toMatch(/qty_sold|price_per_item|discount_rate|Net revenue/);
    expect(task.context.ancestors[0]?.formula).toContain("qty_sold * price_per_item");
    expect(task.context.decompositionPlan?.nodes[0]?.rationale).toBe("Total returns value after discounts.");
    expect(task.context.siblings.map(node => node.name)).toContain("Qty sold");
    expect(prompt.responseContract).toMatchObject({
      recipes: [],
      excludedAncestorRecipes: [{ recipeId: "revenue.quantity_price_net", targetNodeId: "returns_amount", repeatedTargetLabel: "Refunds", unit: "USD" }],
      references: {
        excludedTarget: { id: "returns_amount", name: "Returns amount", unit: "USD" },
        openAiCustomFactorKeys: ["p_1", "p_2"]
      },
      definition: {
        ready: expect.stringContaining("measurements unknown"), custom: expect.stringContaining("recipeId:null"),
        adjustmentTotal: { formulaExample: "p_1 * p_2", units: { count: "adjustment", mean: "USD/adjustment" } }
      },
      limits: { alternatives: 1, minFactors: 2, maxFactors: 2 }
    });
    expect(JSON.stringify(request.response_format)).not.toContain("revenue.quantity_price_net");
    const schema = request.response_format.json_schema.schema;
    const groups = schema.properties.groups;
    const countAndMean = groups.items.properties;
    expect(groups).toMatchObject({ minItems: 0, maxItems: 1 });
    expect(groups.items).not.toHaveProperty("anyOf");
    expect(countAndMean.formula.const).toBe("p_1 * p_2");
    expect(countAndMean.requiredKeys.items.enum).toEqual(["p_1", "p_2"]);
    expect(countAndMean.children).toMatchObject({ minItems: 2, maxItems: 2 });
    expect(countAndMean.children.items.anyOf.map((child: { properties: { key: { const: string }; unit: { const: string } } }) =>
      [child.properties.key.const, child.properties.unit.const])).toEqual([["p_1", "adjustment"], ["p_2", "USD/adjustment"]]);
    expect(task.recipes.map(recipe => recipe.id)).toContain("revenue.quantity_price_net");
    const host = { proposalId: "host", requestId: "request", now: "2026-11-11T00:00:00.000Z",
      execution: { mode: "api" as const, backendId: "openai_compatible", modelId: "gpt-5-nano", bindingVersion: "qa", credentialEpoch: "opaque" } };
    const proposal = materializeKpiSuggestion(result, context, host);
    expect(proposal?.groups[0]?.formula).toBe("p_1 * p_2");
    const copiedInputs: KpiSuggestionModelOutput = { status: "ready", rationale: "Existing sales factors.", limitations: [], groups: [{
      id: "sales_inputs", title: "Sales inputs", selectionMode: "all", recipeId: null,
      formula: "p_1*p_2*(1-p_3)", requiredKeys: ["p_1", "p_2", "p_3"], limitations: [],
      children: [
        { key: "p_1", conceptKey: "qty_sold", name: "Qty sold", unit: "items", description: null, existingNodeId: null },
        { key: "p_2", conceptKey: "price_per_item", name: "Price per item", unit: "USD/item", description: null, existingNodeId: null },
        { key: "p_3", conceptKey: "discount_fraction", name: "Discount fraction", unit: "fraction", description: null, existingNodeId: null }
      ]
    }] };
    expect(() => materializeKpiSuggestion(copiedInputs, task.context, host)).toThrow(/copy of the target, a sibling or an ancestor/);
    const group = ready.groups[0]!;
    const wrongUnits = { ...ready, groups: [{ ...group, children: [
      { ...group.children[0]!, unit: "count" }, { ...group.children[1]!, unit: "USD" }
    ] }] };
    expect(() => materializeKpiSuggestion(wrongUnits, task.context, host)).toThrow(/unit/i);

    const editedContent = `${content}\nUse the independently recorded adjustment terms from this specific project.`;
    const edited = { ...selectedSkill, content: editedContent, contentHash: `sha256:${createHash("sha256").update(editedContent).digest("hex")}` };
    const editedContext = { ...context, selectedSkill: edited };
    const editedTask = buildKpiSuggestionTaskInput(editedContext);
    expect(kpiSuggestionPromptInput(editedTask).context).toEqual(editedContext);
    expect(editedTask.responseContract.references).not.toHaveProperty("openAiCustomFactorKeys");
  });
  it("never accepts model-owned values, provenance, execution or nested children", () => {
    for (const forbidden of ["values", "origin", "execution", "children", "proposalId"]) expect(() => validateKpiSuggestionModelOutput({ ...empty, [forbidden]: 1 })).toThrow();
    expect(() => validateKpiSuggestionModelOutput({ ...empty, rationale: "x".repeat(17_000) })).toThrow();
  });
  it("materializes only host identity and does not turn empty into generic children", async () => {
    const context = await buildKpiSuggestionContext(createSmartKpiMeasuredFixture(), { workspaceId: "qa", vdtId: null, targetNodeId: "measured_output", period: { key: "2026-10", grain: "month" } });
    expect(materializeKpiSuggestion(empty, context, { proposalId: "host", requestId: "request", now: "2026-10-19T00:00:00.000Z", execution: { mode: "api", backendId: "selected", modelId: "model", bindingVersion: "v1", credentialEpoch: "opaque" } })).toBeUndefined();
  });
});

describe("Smart API protocols fail closed without retries", () => {
  const factories = {
    openai: (fetch: typeof globalThis.fetch) => new OpenAiCompatibleProvider({ baseUrl: "https://selected.example/v1", model: "gpt-6", apiKey: "synthetic", fetch }),
    azure: (fetch: typeof globalThis.fetch) => new AzureOpenAiProvider({ endpoint: "https://selected.example", deployment: "selected", apiVersion: "2024-10-21", apiKey: "synthetic", fetch }),
    anthropic: (fetch: typeof globalThis.fetch) => new AnthropicProvider({ baseUrl: "https://selected.example", model: "selected", apiKey: "synthetic", fetch }),
    gemini: (fetch: typeof globalThis.fetch) => new GeminiProvider({ baseUrl: "https://selected.example", model: "selected", apiKey: "synthetic", fetch })
  };
  for (const [name, factory] of Object.entries(factories)) {
    it(`${name} applies a real generation cap and one HTTP attempt`, async () => {
      const payload = name === "anthropic" ? { stop_reason: "tool_use", content: [{ type: "tool_use", name: "return_structured_output", input: empty }] }
        : name === "gemini" ? { candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(empty) }] } }] } : chat();
      const fetch = vi.fn(async (_url: unknown, _init?: RequestInit) => json(payload));
      await expect(factory(fetch).completeStructured(params)).resolves.toEqual(empty);
      const request = JSON.parse(String(fetch.mock.calls[0]![1]?.body));
      expect(request.max_completion_tokens ?? request.max_tokens ?? request.generationConfig.maxOutputTokens).toBe(2048);
      expect(fetch).toHaveBeenCalledTimes(1);
      const failFetch = vi.fn(async () => json({ error: { code: "invalid_json_schema" } }, 400));
      await expect(factory(failFetch).completeStructured(params)).rejects.toThrow(); expect(failFetch).toHaveBeenCalledTimes(1);
    });
    it(`${name} rejects oversized and cancelled body streams`, async () => {
      const fetch = vi.fn(async () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(65_537)); c.close(); } })));
      await expect(factory(fetch).completeStructured(params)).rejects.toThrow("maximum allowed size");
      let cancelled = false;
      const controller = new AbortController();
      const streaming = factory(async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }))).completeStructured({ ...params, signal: controller.signal });
      await Promise.resolve(); await Promise.resolve(); controller.abort();
      await expect(streaming).rejects.toThrow("aborted"); expect(cancelled).toBe(true);
    });
  }
  for (const name of ["openai", "azure"] as const) {
    for (const extra of [{ finish_reason: "length" }, { finish_reason: "content_filter" }, { message: { content: JSON.stringify(empty), tool_calls: [{}] } }, { message: { content: JSON.stringify(empty), function_call: {} } }]) {
      it(`${name} rejects truncation/tool activity ${JSON.stringify(extra).slice(0, 45)}`, async () => {
        const fetch = vi.fn(async () => json(chat(extra)));
        const failed = factories[name](fetch).completeStructured(params);
        if (name === "openai" && "finish_reason" in extra && extra.finish_reason === "length") await expect(failed).rejects.toMatchObject({ code: "INCOMPLETE_OUTPUT" });
        else if (name === "openai" && "finish_reason" in extra && extra.finish_reason === "content_filter") await expect(failed).rejects.toMatchObject({ code: "PROVIDER_REFUSAL" });
        else await expect(failed).rejects.toThrow("completed tool-free");
        expect(fetch).toHaveBeenCalledTimes(1);
      });
    }
  }
  it("Anthropic admits only the reviewed output tool and terminal stop reason", async () => {
    for (const payload of [{ stop_reason: "max_tokens", content: [{ type: "tool_use", name: "return_structured_output", input: empty }] },
      { stop_reason: "tool_use", content: [{ type: "tool_use", name: "return_structured_output", input: empty }, { type: "tool_use", name: "shell", input: {} }] },
      { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(empty) }] }]) {
      await expect(factories.anthropic(async () => json(payload)).completeStructured(params)).rejects.toThrow("structured-output channel");
    }
  });
  it("Gemini rejects function calls even alongside valid text and non-STOP output", async () => {
    for (const candidate of [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(empty) }, { functionCall: {} }] } },
      { finishReason: "MAX_TOKENS", content: { parts: [{ text: JSON.stringify(empty) }] } }]) {
      await expect(factories.gemini(async () => json({ candidates: [candidate] })).completeStructured(params)).rejects.toThrow("text-only");
    }
  });
});

describe("paired runner Smart terminal cancellation", () => {
  const provider = () => new LocalRunnerProvider({ runnerUrl: "http://127.0.0.1:8765", origin: "http://localhost:3000", pairingToken: "synthetic", backendId: "codex_subscription", model: "selected" });
  it("does not settle or abort its completion fetch before cancel acknowledges delayed child close", async () => {
    const controller = new AbortController(); let id = "", acknowledge!: (response: Response) => void, completionSignal: AbortSignal | undefined;
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith("/cancel")) return new Promise<Response>(resolve => { acknowledge = resolve; });
      id = JSON.parse(String(init?.body)).requestId; completionSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => completionSignal!.addEventListener("abort", () => reject(new DOMException("abort", "AbortError"))));
    }); vi.stubGlobal("fetch", fetch);
    let settled = false; const result = provider().completeStructured({ ...params, signal: controller.signal }).finally(() => { settled = true; });
    void result.catch(() => {}); await Promise.resolve(); controller.abort(); await Promise.resolve(); await Promise.resolve();
    expect(acknowledge).toBeTypeOf("function"); expect(completionSignal?.aborted).toBe(false); expect(settled).toBe(false);
    acknowledge(json({ ok: true, requestId: id, status: "cancelled", cleanupConfirmed: true }));
    await expect(result).rejects.toMatchObject({ code: "CANCELLED" }); expect(completionSignal?.aborted).toBe(true);
  });
  it("bounds the paired response envelope and confirms cleanup before reporting failure", async () => {
    let id = "";
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith("/cancel")) return json({ ok: true, requestId: id, status: "failed", cleanupConfirmed: true });
      id = JSON.parse(String(init?.body)).requestId;
      return new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(65_537)); c.close(); } }));
    }));
    await expect(provider().completeStructured(params)).rejects.toThrow("maximum allowed size"); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("preserves CLEANUP_UNCONFIRMED instead of masking it as caller cancellation", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith("/cancel")) return json({ ok: false, error: { code: "CLEANUP_UNCONFIRMED" }, cleanupConfirmed: false }, 409);
      return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("abort", "AbortError"))));
    }));
    const pending = provider().completeStructured({ ...params, signal: controller.signal }); void pending.catch(() => {}); controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "CLEANUP_UNCONFIRMED" });
  });
});
