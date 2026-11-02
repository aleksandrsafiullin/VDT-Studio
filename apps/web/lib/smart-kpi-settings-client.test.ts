import { describe, expect, it, vi } from "vitest";
import { applyLocalRunnerPreset, DEFAULT_EXECUTION_SETTINGS } from "./execution-mode-catalog";
import { loadSmartKpiModelCatalog, loadSmartKpiReasoningValues } from "./smart-kpi-settings-client";
import { smartKpiSourceKey, updateSmartKpiPreferences } from "./smart-kpi-settings";

describe("Suggested KPI metadata discovery", () => {
  it("reloads the selected paired runner's CLI catalog after a runner URL change", async () => {
    const first = { ...applyLocalRunnerPreset(DEFAULT_EXECUTION_SETTINGS, "custom_cli_json"), selectedCliAgentId: "codex" as const, runnerUrl: "http://127.0.0.1:8765" };
    const second = { ...first, runnerUrl: "http://127.0.0.1:8766" };
    expect(smartKpiSourceKey(first)).not.toBe(smartKpiSourceKey(second));
    const fetcher = vi.fn(async (url: unknown, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: "Bearer paired-token" });
      expect(init?.redirect).toBe("error");
      return Response.json({ ok: true, backendId: "codex_subscription", models: [String(url).includes(":8765/") ? "first-host-model" : "second-host-model"] });
    });
    await expect(loadSmartKpiModelCatalog(first, new AbortController().signal, { pairingToken: "paired-token", fetcher })).resolves.toEqual(["first-host-model"]);
    await expect(loadSmartKpiModelCatalog(second, new AbortController().signal, { pairingToken: "paired-token", fetcher })).resolves.toEqual(["second-host-model"]);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["http://127.0.0.1:8765/v1/backends/codex_subscription/models", "http://127.0.0.1:8766/v1/backends/codex_subscription/models"]);
  });

  it("loads local-model reasoning from the selected paired runner rather than the web host", async () => {
    const settings = { ...applyLocalRunnerPreset(DEFAULT_EXECUTION_SETTINGS, "ollama_openai"), runnerUrl: "http://127.0.0.1:9876", localModel: "paired-local-model" };
    const fetcher = vi.fn(async (url: unknown, init?: RequestInit) => {
      expect(url).toBe("http://127.0.0.1:9876/v1/smart-execution");
      expect(init?.headers).toMatchObject({ authorization: "Bearer paired-token", "content-type": "application/json" });
      expect(JSON.parse(String(init?.body))).toEqual({ backendId: "ollama", model: "paired-local-model", timeoutMs: 5000 });
      return Response.json({ ok: true, identity: { backendId: "ollama", modelId: "paired-local-model", requestModel: "paired-local-model", reasoningValues: [false, true] } });
    });
    await expect(loadSmartKpiReasoningValues(settings, new AbortController().signal, { pairingToken: "paired-token", fetcher })).resolves.toEqual([false, true]);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("never falls back to a different host if the paired catalog fails or identifies another backend", async () => {
    const settings = { ...applyLocalRunnerPreset(DEFAULT_EXECUTION_SETTINGS, "custom_cli_json"), selectedCliAgentId: "codex" as const, runnerUrl: "http://127.0.0.1:8765" };
    const fetcher = vi.fn(async () => Response.json({ ok: true, backendId: "kiro_subscription", models: ["wrong-model"] }));
    await expect(loadSmartKpiModelCatalog(settings, new AbortController().signal, { pairingToken: "paired-token", fetcher })).rejects.toThrow("selected paired runner");
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each(["https://outside.example/", "http://127.0.0.1:8765/private", "http://user:pass@127.0.0.1:8765/", "http://127.0.0.1:8765/?key=synthetic", "http://127.0.0.1:8765/#fragment"])("does not send pairing credentials to an unsafe runner URL: %s", async runnerUrl => {
    const settings = { ...applyLocalRunnerPreset(DEFAULT_EXECUTION_SETTINGS, "ollama_openai"), runnerUrl }, fetcher = vi.fn();
    for (const load of [loadSmartKpiModelCatalog, loadSmartKpiReasoningValues]) {
      await expect(load(settings, new AbortController().signal, { pairingToken: "paired-token", fetcher })).rejects.toThrow("loopback");
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("queries the separate Smart API model without requesting off or sending inference", async () => {
    const chat = { ...DEFAULT_EXECUTION_SETTINGS, apiKey: "private-key", model: "chat-model" };
    const settings = { ...chat, smartKpiBySource: updateSmartKpiPreferences(chat, { model: "smart-model" }) };
    const fetcher = vi.fn(async () => Response.json({ ok: true, modelId: "smart-model", capabilities: { values: ["none", "low", "high"] } }));
    await expect(loadSmartKpiReasoningValues(settings, new AbortController().signal, { fetcher })).resolves.toEqual(["none", "low", "high"]);
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("/api/agent/bindings/provider");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ operation: "smart_capabilities", providerConfig: { model: "smart-model" } });
    expect(body.providerConfig).not.toHaveProperty("modelReasoning");
    expect(body).not.toHaveProperty("input");
  });

  it("uses a no-reasoning CLI admission to discover supported alternatives to Off", async () => {
    const settings = { ...applyLocalRunnerPreset(DEFAULT_EXECUTION_SETTINGS, "custom_cli_json"), selectedCliAgentId: "codex" as const, cliModelSelection: { source: "custom" as const, customModel: "smart-cli" } };
    const fetcher = vi.fn(async () => Response.json({ ok: true, identity: { backendId: "codex_subscription", requestModel: "smart-cli", reasoningValues: ["low", "high", "--bad option"] } }));
    await expect(loadSmartKpiReasoningValues(settings, new AbortController().signal, { appMode: "development_web", fetcher })).resolves.toEqual(["low", "high"]);
    const [url, init] = fetcher.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("/api/ai/suggestions/execution");
    expect(JSON.parse(String(init.body))).toEqual({ backendId: "codex_subscription", model: "smart-cli", timeoutMs: 5000 });
  });

  it("rejects a catalog returned for a different CLI model", async () => {
    const settings = { ...applyLocalRunnerPreset(DEFAULT_EXECUTION_SETTINGS, "custom_cli_json"), selectedCliAgentId: "codex" as const, cliModelSelection: { source: "custom" as const, customModel: "selected" } };
    const fetcher = vi.fn(async () => Response.json({ ok: true, identity: { backendId: "codex_subscription", requestModel: "obsolete", reasoningValues: ["high"] } }));
    await expect(loadSmartKpiReasoningValues(settings, new AbortController().signal, { appMode: "development_web", fetcher })).rejects.toThrow("Could not check reasoning");
  });
});
