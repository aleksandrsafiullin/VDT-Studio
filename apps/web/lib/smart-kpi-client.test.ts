import { afterEach, describe, expect, it, vi } from "vitest";
import { buildKpiSuggestionContext, createSmartKpiMeasuredFixture, kpiCanonicalJson, kpiSuggestionCacheKey, KPI_SUGGESTION_RECIPES } from "@vdt-studio/vdt-core";
import { IndexedDbApiKeyVault, encryptApiKey, type ApiKeyRecordStorage, type EncryptedApiKey } from "./api-key-vault";
import { apiKeyScope } from "./api-key-persistence";
import { applyGatewayPreset, applyLocalRunnerPreset, DEFAULT_EXECUTION_SETTINGS, type ExecutionSettings } from "./execution-mode-catalog";
import { createSmartKpiPreparedSelection, prepareSmartThroughHttp } from "./smart-kpi-client";
import { DesktopAiExecutionClient, resolveDesktopSmartExecution } from "./ai-execution-client";
import { cancelSmartKpiPreparation, prepareSmartKpiResponse } from "./smart-kpi-service";
import type { AiProvider } from "@vdt-studio/ai-harness";

const empty = { status: "empty", rationale: "No reviewed immediate decomposition.", limitations: [], groups: [] };
const ready = { status: "ready", rationale: "Productive time and rate are measurable operating inputs.", limitations: [], groups: [{ id: "context", title: "Operating inputs", selectionMode: "all", requiredKeys: ["hours", "rate"], formula: "hours * rate", recipeId: null, limitations: [], children: [
  { key: "hours", conceptKey: "productive_time", name: "Productive time", unit: "h/month", description: null, existingNodeId: null },
  { key: "rate", conceptKey: "production_rate", name: "Production rate", unit: "t/h", description: null, existingNodeId: null }
] }] };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const context = (personalisation?: { userInstructions: string }) => buildKpiSuggestionContext(createSmartKpiMeasuredFixture(), { workspaceId: "client_qa", vdtId: null, targetNodeId: "measured_output", period: { key: "2026-10", grain: "month" }, ...(personalisation ? { personalisation } : {}) });
const apiSettings = (): ExecutionSettings => ({ ...applyGatewayPreset({ ...DEFAULT_EXECUTION_SETTINGS, executionMode: "byok" }, "openai-default"), apiKey: "synthetic-a", model: "selected", timeoutSec: 2 });
const cliSettings = (): ExecutionSettings => ({ ...applyLocalRunnerPreset({ ...DEFAULT_EXECUTION_SETTINGS, executionMode: "local_cli", selectedCliAgentId: "codex" }, "custom_cli_json"), cliModelSelection: { source: "custom", customModel: "selected" }, timeoutSec: 2 });
const binding = { backendId: "codex_subscription" as const, requestModel: "selected", modelId: "selected", modelResolution: "exact" as const, bindingVersion: "stable-cli-v1", credentialEpoch: "stable-host-epoch" };
function records() {
  const map = new Map<string, EncryptedApiKey>();
  const signature = (v: EncryptedApiKey | undefined) => v ? [v.identityEpoch, Buffer.from(v.iv).toString("hex"), Buffer.from(v.ciphertext).toString("hex")].join(":") : "absent";
  const storage: ApiKeyRecordStorage = { read: async scope => structuredClone(map.get(scope)), compareAndSet: async (scope, expected, next) => {
    if (signature(map.get(scope)) !== signature(expected)) return false;
    if (next) map.set(scope, structuredClone(next)); else map.delete(scope); return true;
  } };
  return { map, storage, vault: new IndexedDbApiKeyVault("smart-qa", storage) };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("stable credential and selection identities", () => {
  it("uses native metadata IPC for initial admission and revalidation without relative HTTP", async () => {
    const invoke = vi.fn(async (command: string) => { expect(command).toBe("ai_smart_execution"); return { ok: true, identity: binding }; });
    vi.stubGlobal("__TAURI__", { core: { invoke } }); const fetch = vi.fn();
    const selected = await createSmartKpiPreparedSelection(cliSettings(), { appMode: "desktop", fetch });
    expect(selected.execution.modelId).toBe("selected"); expect(await selected.revalidate(cliSettings())).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(2); expect(fetch).not.toHaveBeenCalled();
  });
  it("native metadata waits terminal cleanup after cancel and rejects a late successful identity", async () => {
    const controller = new AbortController(); let close!: (value: unknown) => void, settled = false;
    const invoke = vi.fn(async (command: string) => command === "ai_cancel" ? undefined : new Promise(resolve => { close = resolve; }));
    const pending = resolveDesktopSmartExecution({ backendId: "codex_subscription", model: "selected", timeoutMs: 2000 }, { signal: controller.signal, invoke }).finally(() => { settled = true; }); void pending.catch(() => {});
    controller.abort(); await Promise.resolve(); expect(settled).toBe(false); expect(invoke).toHaveBeenCalledWith("ai_cancel", expect.anything());
    close({ ok: true, identity: binding }); await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
  });
  it("native metadata preserves unknown cleanup and bounds a noncooperative invocation", async () => {
    vi.useFakeTimers(); const pending = resolveDesktopSmartExecution({ backendId: "codex_subscription", timeoutMs: 20 }, { invoke: async () => new Promise(() => {}) }); void pending.catch(() => {});
    await vi.advanceTimersByTimeAsync(2521); await expect(pending).rejects.toMatchObject({ code: "CLEANUP_UNCONFIRMED" });
  });
  it("reuses passive reload/rehydration and rotates replacement/removal/restoration epochs", async () => {
    const { storage, vault } = records(); await vault.write("scope", "synthetic-a");
    const first = await vault.identity("scope", "synthetic-a"), reopened = new IndexedDbApiKeyVault("smart-qa", storage);
    await expect(reopened.read("scope")).resolves.toBe("synthetic-a"); await reopened.write("scope", "synthetic-a");
    await expect(reopened.identity("scope", "synthetic-a")).resolves.toBe(first);
    await reopened.write("scope", "synthetic-b"); expect(await reopened.identity("scope", "synthetic-b")).not.toBe(first);
    await reopened.remove("scope"); await expect(reopened.identity("scope", "synthetic-a")).rejects.toThrow();
    await reopened.write("scope", "synthetic-a"); expect(await reopened.identity("scope", "synthetic-a")).not.toBe(first);
  });
  it("CAS migration cannot resurrect a credential deleted while metadata admission waited", async () => {
    const { storage, map } = records(), legacy = await encryptApiKey("scope", "synthetic-a"); delete legacy.identityEpoch; map.set("scope", legacy);
    let release!: () => void, waiting = false;
    const guarded: ApiKeyRecordStorage = { read: storage.read, compareAndSet: async (scope, previous, next) => {
      if (previous && !previous.identityEpoch && next?.identityEpoch) { waiting = true; await new Promise<void>(resolve => { release = resolve; }); }
      return storage.compareAndSet(scope, previous, next);
    } };
    const vault = new IndexedDbApiKeyVault("smart-qa", guarded), pending = vault.identity("scope", "synthetic-a"); void pending.catch(() => {});
    await vi.waitFor(() => expect(waiting).toBe(true)); await vault.remove("scope"); release();
    await expect(pending).rejects.toThrow("not ready"); expect(map.has("scope")).toBe(false);
  });
  it("prepared callback uses selected destination/model and cache identity survives re-admission", async () => {
    const { vault, storage } = records(), settings = apiSettings(), scope = apiKeyScope(settings)!; await vault.write(scope, settings.apiKey!);
    const fetch = vi.fn(async (_url: unknown, _init?: RequestInit) => json({ ok: true, result: ready }));
    const selected = await createSmartKpiPreparedSelection(settings, { vault, fetch, appMode: "development_web" });
    const reopened = await createSmartKpiPreparedSelection(settings, { vault: new IndexedDbApiKeyVault("smart-qa", storage), fetch, appMode: "development_web" });
    const ctx = await context({ userInstructions: "Use Russian labels.\n\nUse fiscal periods." });
    expect(kpiSuggestionCacheKey(ctx, KPI_SUGGESTION_RECIPES.version, selected.execution)).toBe(kpiSuggestionCacheKey(ctx, KPI_SUGGESTION_RECIPES.version, reopened.execution));
    expect(kpiCanonicalJson(selected.execution)).not.toContain(settings.apiKey);
    const proposal = await selected.prepare({ context: ctx, execution: selected.execution, signal: new AbortController().signal });
    expect(proposal).toMatchObject({ origin: { kind: "model", execution: selected.execution }, groups: [{ children: [{ name: "Productive time" }, { name: "Production rate" }] }] });
    const payload = JSON.parse(String(fetch.mock.calls[0]![1]?.body)); expect(payload.providerConfig).toMatchObject({ model: "selected", apiKey: "synthetic-a", baseUrl: "https://api.openai.com/v1", timeoutMs: 2000 });
    expect(payload.input.context.personalisation).toEqual(ctx.personalisation);
    await expect(selected.prepare({ context: ctx, execution: { ...selected.execution, credentialEpoch: "changed" }, signal: new AbortController().signal })).rejects.toMatchObject({ code: "STALE_EXECUTION" });
    const changed = await createSmartKpiPreparedSelection({ ...settings, model: "different" }, { vault, fetch }); expect(changed.execution.modelId).toBe("different");
    await vault.write(scope, "synthetic-b"); const replaced = await createSmartKpiPreparedSelection({ ...settings, apiKey: "synthetic-b" }, { vault, fetch }); expect(replaced.execution.credentialEpoch).not.toBe(selected.execution.credentialEpoch);
  });
  it("never provisions credentials, changes backend, or uses an ephemeral identity fallback", async () => {
    const fetch = vi.fn();
    await expect(createSmartKpiPreparedSelection(apiSettings(), { vault: { read: async () => undefined, write: async () => {}, remove: async () => {} }, fetch })).rejects.toMatchObject({ code: "SUGGESTIONS_UNAVAILABLE" });
    await expect(createSmartKpiPreparedSelection({ ...cliSettings(), selectedCliAgentId: "claude" }, { fetch })).rejects.toMatchObject({ code: "SUGGESTIONS_UNAVAILABLE" }); expect(fetch).not.toHaveBeenCalled();
  });
  it("preserves a genuine empty rationale and limitations from the selected API model", async () => {
    const { vault } = records(), settings = { ...apiSettings(), model: "gpt-6-luna" };
    await vault.write(apiKeyScope(settings)!, settings.apiKey!);
    const result = { ...empty, rationale: "Не хватает определения показателя для обоснованных дочерних KPI.", limitations: ["Уточните, включает ли показатель ожидание обслуживания."] };
    const fetch = vi.fn(async (_url: unknown, _init?: RequestInit) => json({ ok: true, result }));
    const selected = await createSmartKpiPreparedSelection(settings, { vault, fetch, appMode: "development_web" });
    await expect(selected.prepare({ context: await context(), execution: selected.execution, signal: new AbortController().signal }))
      .resolves.toEqual({ status: "empty", reason: result.rationale, limitations: result.limitations });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body)).providerConfig.model).toBe("gpt-6-luna");
  });
  it("does not relabel provider failures or rejected groups as an empty result", async () => {
    const { vault } = records(), settings = apiSettings(); await vault.write(apiKeyScope(settings)!, settings.apiKey!);
    for (const payload of [{ ok: false, error: { code: "INVALID_PROPOSAL" } }, { ok: true, result: { ...ready, groups: [] } },
      { ok: true, result: { ...empty, limitations: ["x".repeat(301)] } }]) {
      const fetch = vi.fn(async () => json(payload));
      const selected = await createSmartKpiPreparedSelection(settings, { vault, fetch, appMode: "development_web" });
      await expect(selected.prepare({ context: await context(), execution: selected.execution, signal: new AbortController().signal })).rejects.toThrow();
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });
  it("native complete stays pending after cancel until the same owned invocation returns", async () => {
    const controller = new AbortController(); let close!: (value: unknown) => void, settled = false;
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === "ai_cancel") return undefined;
      expect(command).toBe("ai_complete"); expect(args?.request).toMatchObject({ taskType: "suggest_incoming_kpis", schemaId: "suggest-incoming-kpis-v1", model: "selected", timeoutMs: 2000 });
      return new Promise(resolve => { close = resolve; });
    });
    const fetch = vi.fn(), client = new DesktopAiExecutionClient(fetch, invoke);
    const selected = await createSmartKpiPreparedSelection(cliSettings(), { appMode: "desktop", executionClient: client, cliBinding: binding, fetch });
    const pending = selected.prepare({ context: await context(), execution: selected.execution, signal: controller.signal }).finally(() => { settled = true; }); void pending.catch(() => {});
    await vi.waitFor(() => expect(close).toBeTypeOf("function")); controller.abort(); await Promise.resolve();
    expect(invoke).toHaveBeenCalledWith("ai_cancel", expect.anything()); expect(settled).toBe(false); expect(fetch).not.toHaveBeenCalled();
    close({ ok: false, error: { code: "CANCELLED" }, run: { status: "cancelled" } }); await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
  });
  it("preserves native cleanup unknown and returns validated one-call native proposals", async () => {
    for (const unknown of [false, true]) {
      const invoke = vi.fn(async () => unknown ? { ok: false, error: { code: "CLEANUP_UNCONFIRMED" } } : { ok: true, output: ready, run: { status: "succeeded" } });
      const selected = await createSmartKpiPreparedSelection(cliSettings(), { appMode: "desktop", cliBinding: binding, executionClient: new DesktopAiExecutionClient(vi.fn(), invoke) });
      const pending = selected.prepare({ context: await context(), execution: selected.execution, signal: new AbortController().signal });
      if (unknown) await expect(pending).rejects.toMatchObject({ code: "CLEANUP_UNCONFIRMED" }); else await expect(pending).resolves.toMatchObject({ origin: { execution: { mode: "cli", modelId: "selected" } } });
      expect(invoke).toHaveBeenCalledTimes(1);
    }
  });
  it("preserves genuine empty details through the same native completion path", async () => {
    const result = { ...empty, limitations: ["The existing measurements already cover all supported immediate contributors."] };
    const invoke = vi.fn(async () => ({ ok: true, output: result, run: { status: "succeeded" } }));
    const selected = await createSmartKpiPreparedSelection(cliSettings(), { appMode: "desktop", cliBinding: binding, executionClient: new DesktopAiExecutionClient(vi.fn(), invoke) });
    await expect(selected.prepare({ context: await context(), execution: selected.execution, signal: new AbortController().signal }))
      .resolves.toEqual({ status: "empty", reason: result.rationale, limitations: result.limitations });
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it("never publishes native success arriving after deadline while terminal cleanup is awaited", async () => {
    const ctx = await context(); vi.useFakeTimers(); let close!: (value: unknown) => void;
    const invoke = vi.fn(async (command: string) => command === "ai_cancel" ? undefined : new Promise(resolve => { close = resolve; }));
    const selected = await createSmartKpiPreparedSelection({ ...cliSettings(), timeoutSec: 0.02 }, { appMode: "desktop", cliBinding: binding, executionClient: new DesktopAiExecutionClient(vi.fn(), invoke) });
    const pending = selected.prepare({ context: ctx, execution: selected.execution, signal: new AbortController().signal }); void pending.catch(() => {});
    await vi.advanceTimersByTimeAsync(25); expect(invoke).toHaveBeenCalledWith("ai_cancel", expect.anything());
    close({ ok: true, output: ready, run: { status: "succeeded" } }); await expect(pending).rejects.toMatchObject({ code: "TIMEOUT" });
  });
});

describe("browser-to-host terminal cancellation", () => {
  it("reconciles cancel-before-registration by the same requestId and awaits late owned termination", async () => {
    const controller = new AbortController(); let register!: () => void, cancelNotFound = 0, providerCalls = 0;
    const { buildKpiSuggestionTaskInput } = await import("@vdt-studio/vdt-core");
    const body = { input: buildKpiSuggestionTaskInput(await context()), providerId: "local_runner", providerConfig: { backendId: "codex_subscription" }, timeoutMs: 2000 };
    const fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body));
      if (String(url).endsWith("/cancel")) {
        try { return json({ ok: true, ...await cancelSmartKpiPreparation(payload.requestId) }); }
        catch { cancelNotFound++; return json({ ok: false, error: { code: "RUN_NOT_FOUND" } }, 404); }
      }
      return new Promise<Response>((resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("HTTP closed", "AbortError")));
        register = () => { void prepareSmartKpiResponse(payload, new AbortController().signal, "http://localhost:3000", { provider: async () => ({ completeStructured: async (params: { signal: AbortSignal }) => {
          providerCalls++; return new Promise((_resolve, fail) => params.signal.addEventListener("abort", () => fail(Object.assign(new Error("closed"), { code: "CANCELLED" }))));
        } }) as unknown as AiProvider }).then(result => resolve(json({ ok: true, result })), failure => resolve(json({ ok: false, error: { code: failure.code } }, 409))); };
      });
    });
    let settled = false; const pending = prepareSmartThroughHttp(fetch, body, controller.signal).finally(() => { settled = true; }); void pending.catch(() => {});
    await vi.waitFor(() => expect(register).toBeTypeOf("function")); controller.abort(); await vi.waitFor(() => expect(cancelNotFound).toBeGreaterThan(0)); expect(settled).toBe(false);
    register(); await expect(pending).rejects.toMatchObject({ code: "CANCELLED" }); expect(providerCalls).toBe(1);
  });
  it("never interprets repeated404 without registration as positive cleanup proof", async () => {
    vi.useFakeTimers(); const controller = new AbortController();
    const fetch = vi.fn(async (url: unknown, init?: RequestInit) => String(url).endsWith("/cancel") ? json({ ok: false, error: { code: "RUN_NOT_FOUND" } }, 404)
      : new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("HTTP closed", "AbortError")))));
    const pending = prepareSmartThroughHttp(fetch, { timeoutMs: 5000 }, controller.signal); void pending.catch(() => {}); controller.abort();
    await vi.advanceTimersByTimeAsync(2600); await expect(pending).rejects.toMatchObject({ code: "CLEANUP_UNCONFIRMED" });
  });
});
