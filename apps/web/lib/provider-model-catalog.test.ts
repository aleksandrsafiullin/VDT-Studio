import { describe, expect, it, vi } from "vitest";
import { DEFAULT_EXECUTION_SETTINGS, type ExecutionSettings } from "./execution-mode-catalog";
import { loadByokModelCatalog, loadProviderModelCatalog, normalizeProviderModelIds, providerModelSource } from "./provider-model-catalog";

describe("provider-owned model catalogs", () => {
  it.each(["openai_compatible", "anthropic", "gemini"])("uses the existing scoped route for %s with the saved credential", async (providerId) => {
    const controller = new AbortController();
    const fetcher = vi.fn(async () => Response.json({ ok: true, models: ["current-model", "new-model", "current-model", "  ", null] }));
    const execution = { providerId, providerConfig: { baseUrl: "https://provider.test/v1", apiKey: "test-saved-credential" } };
    await expect(loadByokModelCatalog(execution, { fetcher, signal: controller.signal })).resolves.toEqual(["current-model", "new-model"]);
    expect(fetcher).toHaveBeenCalledWith("/api/ai/generate-vdt", expect.objectContaining({
      body: JSON.stringify({ operation: "list_models", ...execution }), signal: controller.signal
    }));
  });

  it("does not request models without a key or invent an Azure deployment list", async () => {
    const fetcher = vi.fn();
    await expect(loadByokModelCatalog({ providerId: "openai_compatible" }, { fetcher })).rejects.toThrow("API key");
    await expect(loadByokModelCatalog({ providerId: "azure_openai", providerConfig: { apiKey: "test-key" } }, { fetcher })).rejects.toThrow("deployment");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps remote diagnostic text out of catalog errors", async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: false, error: "echoed-private-credential" }, { status: 401 }));
    await expect(loadByokModelCatalog({ providerId: "anthropic", providerConfig: { apiKey: "test-key" } }, { fetcher })).rejects.toThrow("HTTP 401");
    await expect(loadByokModelCatalog({ providerId: "anthropic", providerConfig: { apiKey: "test-key" } }, { fetcher })).rejects.not.toThrow("echoed-private-credential");
  });

  it("explains a known upstream authentication status without echoing the remote diagnostic", async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: false, error: "OpenAI-compatible provider model discovery failed with status 401. private-text" }, { status: 502 }));
    await expect(loadByokModelCatalog({ providerId: "openai_compatible", providerConfig: { apiKey: "test-key" } }, { fetcher }))
      .rejects.toThrow("provider rejected model-list access (HTTP 401)");
  });

  it.each(["ollama", "lm_studio", "vllm"])("loads %s from its local runtime without an API request", async (backendId) => {
    const client = { listModels: vi.fn(async () => [{ id: "installed-local", label: "Installed" }]), detectSubscriptionClis: vi.fn() };
    const fetcher = vi.fn();
    await expect(loadProviderModelCatalog({ category: "local_models", providerId: "local_runner", backendId, providerConfig: {} }, undefined, { client, fetcher }))
      .resolves.toEqual(["installed-local"]);
    expect(client.listModels).toHaveBeenCalledWith(backendId);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(["codex", "cursor-agent", "claude", "gemini", "copilot"] as const)("uses only the authenticated %s CLI catalog", async (cliAgentId) => {
    const client = { listModels: vi.fn(), detectSubscriptionClis: vi.fn(async () => ({
      agents: [{ id: cliAgentId, installed: true, executable: null, alias: null, version: null, status: "ready" as const }],
      modelsByAgent: { [cliAgentId]: ["account-model"] }
    })) };
    const source = { category: "cli_subscriptions" as const, providerId: "local_runner", cliAgentId, providerConfig: {} };
    await expect(loadProviderModelCatalog(source, undefined, { client })).resolves.toEqual(["account-model"]);
    expect(client.detectSubscriptionClis).toHaveBeenCalledWith(cliAgentId);
    client.detectSubscriptionClis.mockResolvedValueOnce({ agents: [], modelsByAgent: { [cliAgentId]: ["unverified"] } });
    await expect(loadProviderModelCatalog(source, undefined, { client })).resolves.toEqual([]);
    expect(client.listModels).not.toHaveBeenCalled();
  });

  it("keeps the credential outside the nonsecret source identity and ignores model/effort changes", () => {
    const settings: ExecutionSettings = { ...DEFAULT_EXECUTION_SETTINGS, apiKey: "test-private", model: "old-model" };
    const first = providerModelSource(settings);
    expect(first.apiKey).toBe("test-private");
    expect(JSON.stringify(first.source)).not.toContain("test-private");
    expect(providerModelSource({ ...settings, model: "new-model", cliModelSelection: { source: "custom", reasoningEffort: "high" } }).source).toEqual(first.source);
    expect(providerModelSource({ ...settings, customizeBaseUrl: true, baseUrl: "https://other.test/v1" }).source).not.toEqual(first.source);
  });

  it("rejects oversized/control-character IDs and bounds the visible catalog", () => {
    expect(normalizeProviderModelIds([" valid ", "valid", "bad\nmodel", "x".repeat(161), false])).toEqual(["valid"]);
    expect(normalizeProviderModelIds(Array.from({ length: 1100 }, (_, index) => `model-${index}`))).toHaveLength(1000);
  });

  it("ignores a local runtime result after its request is aborted", async () => {
    const controller = new AbortController();
    const client = { listModels: vi.fn(async () => { controller.abort(); return [{ id: "stale", label: "Stale" }]; }), detectSubscriptionClis: vi.fn() };
    await expect(loadProviderModelCatalog({ category: "local_models", providerId: "local_runner", backendId: "ollama", providerConfig: {} }, undefined,
      { client, signal: controller.signal })).rejects.toThrow();
  });

  it("reports an offline local server without exposing raw runtime errors", async () => {
    const client = { listModels: vi.fn(async () => { throw new Error("private runtime details"); }), detectSubscriptionClis: vi.fn() };
    await expect(loadProviderModelCatalog({ category: "local_models", providerId: "local_runner", backendId: "ollama", providerConfig: {} }, undefined, { client }))
      .rejects.toThrow("Start the model server");
  });
});
