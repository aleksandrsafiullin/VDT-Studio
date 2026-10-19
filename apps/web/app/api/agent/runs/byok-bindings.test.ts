import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentExecutionBindingRegistry } from "./execution-bindings";
import { OpenAiSessionBindingRegistrar, openAiBindingInputSchema } from "./byok-bindings";
const hash = `sha256:${"a".repeat(64)}`;

describe("OpenAI session binding lifecycle", () => {
  afterEach(() => vi.useRealTimers());
  it("pins model and endpoint, omits credentials from discovery and consumes the admission once", () => {
    const registry = new AgentExecutionBindingRegistry(); const admission = new OpenAiSessionBindingRegistrar(registry);
    const summary = admission.admit({ apiKey: "test-secret", model: "gpt-6-luna", maxTokens: 32768 }, hash);
    expect(summary.modelId).toBe("gpt-6-luna");
    expect(JSON.stringify(summary)).not.toContain("test-secret");
    const resolved = registry.resolve(summary.bindingId);
    expect(resolved).toMatchObject({ modelEngineAdapter: { maxTokens: 32768, providerConfig: { baseUrl: "https://api.openai.com/v1", model: "gpt-6-luna" } } });
    admission.consume(summary.bindingId);
    expect(() => registry.resolve(summary.bindingId)).toThrow("unavailable");
    expect(resolved).toMatchObject({ modelEngineAdapter: { providerConfig: { apiKey: "test-secret" } } });
  });
  it("expires unused admissions and frees pending capacity", () => {
    vi.useFakeTimers();
    const registry = new AgentExecutionBindingRegistry(); const admission = new OpenAiSessionBindingRegistrar(registry);
    for (let i=0;i<16;i++) admission.admit({ apiKey: "test-secret", model: "gpt-6-luna" }, hash);
    expect(() => admission.admit({ apiKey: "test-secret", model: "gpt-6-luna" }, hash)).toThrow("Too many pending");
    vi.advanceTimersByTime(60000);
    expect(registry.summaries()).toEqual([]);
    expect(() => admission.admit({ apiKey: "test-secret", model: "gpt-6-luna" }, hash)).not.toThrow();
    vi.advanceTimersByTime(60000);
  });
  it("rejects endpoints, commands, invalid model identifiers and unbounded output", () => {
    for (const extra of [{ baseUrl: "http://127.0.0.1" }, { command: "sh" }, { model: "bad\nmodel" }, { maxTokens: 1000000 }])
      expect(openAiBindingInputSchema.safeParse({ apiKey: "test-secret", model: "gpt-6-luna", ...extra }).success).toBe(false);
  });
});
