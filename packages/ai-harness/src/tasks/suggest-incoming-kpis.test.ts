import { describe, expect, it, vi, afterEach } from "vitest";
import { buildKpiSuggestionContext, buildKpiSuggestionTaskInput, KPI_SUGGESTION_MODEL_JSON_SCHEMA, materializeKpiSuggestion, validateKpiSuggestionModelOutput } from "@vdt-studio/vdt-core";
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
    completeStructured.mockResolvedValueOnce({ ...empty, groups: [{ values: [100] }] });
    await expect(runSuggestIncomingKpis(provider, input)).rejects.toThrow(); expect(completeStructured).toHaveBeenCalledTimes(2);
    await expect(runSuggestIncomingKpis(provider, { ...input, recipes: [] })).rejects.toThrow(); expect(completeStructured).toHaveBeenCalledTimes(2);
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
        await expect(factories[name](fetch).completeStructured(params)).rejects.toThrow("completed tool-free"); expect(fetch).toHaveBeenCalledTimes(1);
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
