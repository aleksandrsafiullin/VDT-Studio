import { describe, expect, it, vi } from "vitest";
import { DEFAULT_EXECUTION_SETTINGS } from "./execution-mode-catalog";
import { prepareOpenAiAgentBinding } from "./openai-agent-binding";

const settings = { ...DEFAULT_EXECUTION_SETTINGS, executionMode: "byok" as const, gatewayPresetId: "openai-default" as const, byokProtocol: "openai" as const, useMockProvider: false, model: "gpt-6-luna", apiKey: "test-key" };
const binding = { bindingId: "openai_byok_session_test", executionProfile: "model_agent", backendId: "openai_compatible", modelId: "gpt-6-luna" };

describe("OpenAI agent admission", () => {
  it("admits the selected model separately and returns only an opaque binding ID", async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: true, binding }));
    await expect(prepareOpenAiAgentBinding(settings, "openai_compatible", { apiKey: "test-key", model: "gpt-6-luna", maxTokens: 32768 }, fetcher)).resolves.toBe(binding.bindingId);
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/agent/bindings/openai");
    expect(JSON.parse(String(init.body))).toEqual({ apiKey: "test-key", model: "gpt-6-luna", maxTokens: 32768 });
  });
  it("does not redirect local models, other providers or custom gateways through OpenAI", async () => {
    const fetcher = vi.fn();
    await expect(prepareOpenAiAgentBinding({ ...settings, executionMode: "local_cli" }, "openai_compatible", {}, fetcher)).resolves.toBeUndefined();
    await expect(prepareOpenAiAgentBinding(settings, "anthropic", {}, fetcher)).resolves.toBeUndefined();
    await expect(prepareOpenAiAgentBinding(settings, "openai_compatible", { baseUrl: "https://example.test/v1" }, fetcher)).resolves.toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("fails closed if admission returns a different model", async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: true, binding: { ...binding, modelId: "another-model" } }));
    await expect(prepareOpenAiAgentBinding(settings, "openai_compatible", {}, fetcher)).rejects.toThrow("did not match");
  });
});
