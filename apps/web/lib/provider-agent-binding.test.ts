import { FAST_LOCAL_REASONING } from "@vdt-studio/model-bridge/reasoning";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_EXECUTION_SETTINGS } from "./execution-mode-catalog";
import { prepareProviderAgentBinding, providerConnectionRequest, requestProviderModelCapabilities } from "./provider-agent-binding";
const settings = { ...DEFAULT_EXECUTION_SETTINGS, apiKey: "test-private", model: "selected-model" };

describe("selected-provider chat admission", () => {
  it.each([[undefined, "capabilities"], ["suggested_kpi", "smart_capabilities"]] as const)("keeps metadata purpose %s separate from admission and inference", async (purpose, operation) => {
    const fetcher = vi.fn(async () => Response.json({ ok: true, modelId: "selected-model", capabilities: { parameter: "reasoning_effort", values: ["low", "high"], source: "provider" } }));
    await requestProviderModelCapabilities({ providerId: "anthropic", providerConfig: { model: "selected-model", apiKey: "synthetic-key" } }, undefined, fetcher, purpose);
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ operation, providerId: "anthropic", providerConfig: { model: "selected-model" } });
    expect(body).not.toHaveProperty("input");
    expect(body).not.toHaveProperty("prompt");
  });
  it.each(["openai_compatible", "anthropic", "gemini", "azure_openai"])("admits %s without redirecting it through OpenAI", async (providerId) => {
    const binding = { bindingId: "api_byok_session_test", executionProfile: "model_agent", backendId: providerId, modelId: "selected-model", modelReasoning: "high" };
    const fetcher = vi.fn(async () => Response.json({ ok: true, binding }));
    const config = { apiKey: "test-private", model: "selected-model", modelReasoning: "high", maxTokens: 64000 };
    await expect(prepareProviderAgentBinding(settings, providerId, config, fetcher)).resolves.toMatchObject({ bindingId: binding.bindingId });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/agent/bindings/provider");
    expect(JSON.parse(String(init.body))).toEqual({ operation: "admit", providerId, executionMode: "api_keys", providerConfig: { ...config, maxTokens: 32768 } });
  });
  it("admits an exact local switch without forwarding cloud credentials or endpoints", async () => {
    const local = { ...settings, executionMode: "local_cli" as const, runnerProviderId: "local_http_stub" as const };
    const config = { backendId: "ollama", model: "local-model", modelReasoning: false, apiKey: "must-not-leave", baseUrl: "https://wrong-endpoint" };
    const fetcher = vi.fn(async () => Response.json({ ok: true, binding: { bindingId: "local_model_ollama_test", executionProfile: "model_agent", backendId: "ollama", modelId: "local-model", modelReasoning: false } }));
    await expect(prepareProviderAgentBinding(local, "local_runner", config, fetcher)).resolves.toMatchObject({ bindingId: "local_model_ollama_test" });
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain("must-not-leave");
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain("wrong-endpoint");
  });
  it("requires explicit scoped opt-in and an exact adaptive response", async () => {
    const local = { ...settings, executionMode: "local_cli" as const, runnerProviderId: "local_http_stub" as const };
    const config = { backendId: "ollama", model: "local-model", modelReasoning: FAST_LOCAL_REASONING };
    const scope = { projectId: "project", vdtId: "tree" };
    const binding = {
      bindingId: "local_model_ollama_adaptive_once", executionProfile: "model_agent", backendId: "ollama",
      modelId: config.model, modelReasoning: false, adaptiveReasoning: { start: false, repair: "low" },
      admission: { mode: "legacy", providerId: "ollama", modelId: config.model, modelRevision: null, profileVersion: 1 }
    };
    const fetcher = vi.fn(async () => Response.json({ ok: true, binding }));
    await expect(prepareProviderAgentBinding(local, "local_runner", config, fetcher, scope)).resolves.toEqual(binding);
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      operation: "admit", providerId: "local_runner", executionMode: "legacy", providerConfig: config,
      adaptiveReasoning: true, adaptiveWorkspace: scope
    });
    await expect(prepareProviderAgentBinding(local, "local_runner", config, fetcher)).rejects.toThrow("did not match");
    await expect(prepareProviderAgentBinding(local, "local_runner", { ...config, modelReasoning: false }, fetcher, scope)).rejects.toThrow("using Fast");
    expect(fetcher).toHaveBeenCalledTimes(2);
    const ordinary = vi.fn(async () => Response.json({ ok: true, binding: {
      ...binding, bindingId: "local_model_ollama_fixed", adaptiveReasoning: undefined
    } }));
    await expect(prepareProviderAgentBinding(local, "local_runner", config, ordinary, scope)).rejects.toThrow("did not match");
  });
  it("fails closed on a reasoning or backend mismatch", async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: true, binding: { bindingId: "api_byok_session_test", executionProfile: "model_agent", backendId: "openai_compatible", modelId: "selected-model" } }));
    await expect(prepareProviderAgentBinding(settings, "openai_compatible", { apiKey: "test-private", model: "selected-model", modelReasoning: "high" }, fetcher)).rejects.toThrow("did not match");
  });
  it("leaves CLI routing alone and requires a saved key for BYOK", async () => {
    expect(providerConnectionRequest({ ...settings, executionMode: "local_cli", runnerProviderId: "cli_stub", localRunnerPresetId: "custom_cli_json" }, "local_runner", { backendId: "codex_subscription" })).toBeUndefined();
    expect(() => providerConnectionRequest(settings, "anthropic", { model: "selected-model" })).toThrow("API key");
  });
});
