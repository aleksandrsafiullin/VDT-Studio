import { afterEach, describe, expect, it, vi } from "vitest";
import { buildKpiSuggestionContext, buildKpiSuggestionTaskInput } from "@vdt-studio/vdt-core";
import { createSmartKpiMeasuredFixture } from "@vdt-studio/vdt-core";
import { prepareSmartKpiResponse } from "./smart-kpi-service";
import type { AiProvider } from "@vdt-studio/ai-harness";
import { POST as suggestions } from "../app/api/ai/suggestions/route";
import { POST as generic } from "../app/api/ai/run-task/route";
import { POST as development } from "../app/api/ai/dev-runtime/route";
import { POST as cancellation } from "../app/api/ai/suggestions/cancel/route";
import { POST as execution } from "../app/api/ai/suggestions/execution/route";
import { readAiRouteBody } from "./ai-route-body";

const empty = { status: "empty", rationale: "No suitable immediate children.", limitations: [], groups: [] };
async function input() { return buildKpiSuggestionTaskInput(await buildKpiSuggestionContext(createSmartKpiMeasuredFixture(), { workspaceId: `qa_${crypto.randomUUID()}`, vdtId: null, targetNodeId: "measured_output", period: { key: "2026-10", grain: "month" } })); }
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("Smart preparation service authority and deadlines", () => {
  it("never obtains missing selected credentials or model from ambient defaults", async () => {
    vi.stubEnv("OPENAI_API_KEY", "ambient-never-used");
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    for (const providerConfig of [{ model: "selected", baseUrl: "https://selected.example" }, { apiKey: "explicit", baseUrl: "https://selected.example" }]) {
      await expect(prepareSmartKpiResponse({ providerId: "openai_compatible", input: await input(), providerConfig }, new AbortController().signal, "http://localhost:3000/api/ai/suggestions")).rejects.toThrow();
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it("uses the lower raw user deadline and one call rather than the agent timeout floor", async () => {
    const data = await input(), completeStructured = vi.fn(async (params: { signal: AbortSignal }) => new Promise((_resolve, reject) => params.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))));
    const started = Date.now();
    await expect(prepareSmartKpiResponse({ input: data, providerId: "local_runner", providerConfig: { backendId: "codex_subscription", timeoutMs: 15 }, timeoutMs: 15 }, new AbortController().signal,
      "http://localhost:3000", { provider: async () => ({ completeStructured }) as unknown as AiProvider })).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(Date.now() - started).toBeLessThan(500); expect(completeStructured).toHaveBeenCalledTimes(1);
  });
  it("waits owned cancellation and preserves unconfirmed cleanup classification", async () => {
    const controller = new AbortController(); let acknowledge!: (error: Error) => void;
    const provider = { completeStructured: async () => new Promise((_resolve, reject) => { acknowledge = reject; }) } as unknown as AiProvider;
    let settled = false;
    const pending = prepareSmartKpiResponse({ input: await input(), providerId: "local_runner", providerConfig: { backendId: "codex_subscription" } }, controller.signal, "http://localhost:3000", { provider: async () => provider }).finally(() => { settled = true; }); void pending.catch(() => {});
    await vi.waitFor(() => expect(acknowledge).toBeTypeOf("function")); controller.abort(); await Promise.resolve(); expect(settled).toBe(false);
    acknowledge(Object.assign(new Error("closure unknown"), { code: "CLEANUP_UNCONFIRMED" })); await expect(pending).rejects.toMatchObject({ code: "CLEANUP_UNCONFIRMED" });
  });
  it("prepares the registered DTO with a deterministic provider without a project/agent loop", async () => {
    const completeStructured = vi.fn(async (_params: unknown): Promise<unknown> => empty);
    await expect(prepareSmartKpiResponse({ input: await input(), providerId: "openai_compatible" }, new AbortController().signal, "http://localhost:3000", { provider: async () => ({ completeStructured }) as unknown as AiProvider })).resolves.toEqual(empty);
    expect(completeStructured).toHaveBeenCalledTimes(1);
  });
  it("rejects otherwise-valid late success after waiting for terminal completion", async () => {
    const data = await input(); vi.useFakeTimers(); let finish!: (value: unknown) => void, announce = () => {};
    const started = new Promise<void>(resolve => { announce = resolve; });
    const pending = prepareSmartKpiResponse({ input: data, providerId: "local_runner", providerConfig: { backendId: "codex_subscription" }, timeoutMs: 20 }, new AbortController().signal,
      "http://localhost:3000", { provider: async () => ({ completeStructured: async () => new Promise(resolve => { finish = resolve; announce(); }) }) as unknown as AiProvider }); void pending.catch(() => {});
    await started;
    await vi.advanceTimersByTimeAsync(25); finish(empty); await expect(pending).rejects.toMatchObject({ code: "TIMEOUT" });
  });
  it("owns one host workspace lane across callers and retains unknown cleanup across reload-equivalent requests", async () => {
    const data = await input(), providerConfig = { backendId: "codex_subscription", model: "selected" }; let finish!: (result: unknown) => void;
    const first = prepareSmartKpiResponse({ input: data, providerId: "local_runner", providerConfig }, new AbortController().signal, "http://localhost:3000", { provider: async () => ({ completeStructured: async () => new Promise(resolve => { finish = resolve; }) }) as unknown as AiProvider });
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    await expect(prepareSmartKpiResponse({ input: data, providerId: "local_runner", providerConfig }, new AbortController().signal, "http://localhost:3000")).rejects.toMatchObject({ code: "PREPARATION_IN_PROGRESS" });
    finish(empty); await first;
    await expect(prepareSmartKpiResponse({ input: data, providerId: "local_runner", providerConfig }, new AbortController().signal, "http://localhost:3000", { provider: async () => ({ completeStructured: async () => { throw Object.assign(new Error("unknown owned closure"), { code: "CLEANUP_UNCONFIRMED" }); } }) as unknown as AiProvider })).rejects.toMatchObject({ code: "CLEANUP_UNCONFIRMED" });
    const never = vi.fn();
    await expect(prepareSmartKpiResponse({ input: data, providerId: "local_runner", providerConfig }, new AbortController().signal, "http://localhost:3000", { provider: never })).rejects.toMatchObject({ code: "CLEANUP_UNCONFIRMED" }); expect(never).not.toHaveBeenCalled();
  });
});

describe("all Smart HTTP entries admit requests before trusted execution", () => {
  for (const [name, route] of [["suggestions", suggestions], ["run-task", generic], ["dev-runtime", development], ["suggestions/cancel", cancellation], ["suggestions/execution", execution]] as const) {
    it(`${name} rejects hostile Origin and text/plain before parsing`, async () => {
      vi.stubEnv("VDT_APP_MODE", "development_web");
      for (const headers of [{ "content-type": "application/json", origin: "https://hostile.example" }, { "content-type": "text/plain", origin: "http://localhost:3000" }]) {
        const response = await route(new Request(`http://localhost:3000/api/ai/${name}`, { method: "POST", headers, body: "{}" }));
        expect(response.status).toBe(headers.origin === "https://hostile.example" ? 403 : 415);
      }
    });
    it(`${name} rejects oversized chunked bodies without materializing them all`, async () => {
      vi.stubEnv("VDT_APP_MODE", "development_web"); let cancelled = false;
      const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(513 * 1024)); }, cancel() { cancelled = true; } });
      const request = new Request(`http://localhost:3000/api/ai/${name}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" }, body: stream, duplex: "half" } as RequestInit);
      expect((await route(request)).status).toBe(413); expect(cancelled).toBe(true);
    });
  }
  it("unknown cancellation IDs never acknowledge cleanup or reveal other preparation metadata", async () => {
    const response = await cancellation(new Request("http://localhost:3000/api/ai/suggestions/cancel", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: crypto.randomUUID() }) }));
    expect(response.status).toBe(404); const payload = await response.json(); expect(payload.cleanupConfirmed).not.toBe(true); expect(payload).toMatchObject({ error: { code: "RUN_NOT_FOUND" } });
    expect(Object.keys(payload)).toEqual(["ok", "error"]);
  });
  it("generic/development entries additionally enforce the compact Smart body limit", async () => {
    vi.stubEnv("VDT_APP_MODE", "development_web");
    for (const [route, body] of [[generic, { taskType: "suggest_incoming_kpis", input: { padding: "x".repeat(33 * 1024) } }], [development, { operation: "complete", request: { taskType: "suggest_incoming_kpis", input: { padding: "x".repeat(33 * 1024) } } }]] as const) {
      expect((await route(new Request("http://localhost:3000/api/ai/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }))).status).toBe(413);
    }
  });
  it("bounds a stalled request body independently of execution and cancels the reader", async () => {
    vi.useFakeTimers(); let cancelled = false;
    const request = new Request("http://localhost:3000/api/ai/suggestions", { method: "POST", headers: { "content-type": "application/json" }, body: new ReadableStream({ cancel() { cancelled = true; } }), duplex: "half" } as RequestInit);
    const pending = readAiRouteBody(request); void pending.catch(() => {}); await vi.advanceTimersByTimeAsync(2001);
    await expect(pending).rejects.toMatchObject({ code: "TIMEOUT" }); expect(cancelled).toBe(true);
  });
});
