import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { OpenAiCompatibleProvider } from "./openai-compatible-provider";
import { AnthropicProvider } from "./anthropic-provider";
import { GeminiProvider } from "./gemini-provider";
import { AzureOpenAiProvider } from "./azure-openai-provider";
import { OllamaProvider } from "./ollama-provider";

const params = { taskType: "agent_decision" as const, input: {}, schema: z.object({ answer: z.string() }),
  outputJsonSchema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false },
  systemPrompt: "System", userPrompt: "Question", maxTokens: 8000 };
describe("reasoning reaches provider requests", () => {
  it("preserves explicit API effort across a strict-format fallback and subsequent turns", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return bodies.length === 1 ? Response.json({ error: { code: "unsupported_parameter", param: "response_format", message: "private diagnostic" } }, { status: 400 })
        : Response.json({ choices: [{ message: { content: '{"answer":"ok"}' } }] });
    });
    const provider = new OpenAiCompatibleProvider({ baseUrl: "https://provider.test/v1", model: "provider-owned-alias", reasoningEffort: "high", fetch: fetcher });
    await expect(provider.completeStructured(params)).resolves.toEqual({ answer: "ok" });
    await provider.completeStructured({ ...params, userPrompt: "Next turn" });
    expect(bodies).toHaveLength(3);
    for (const body of bodies) { expect(body.reasoning_effort).toBe("high"); expect(body.max_completion_tokens).toBe(8000); expect(body).not.toHaveProperty("temperature"); }
  });
  it("does not silently drop effort when the API rejects that parameter", async () => {
    const fetcher = vi.fn(async () => Response.json({ error: { code: "unsupported_parameter", param: "reasoning_effort" } }, { status: 400 }));
    const provider = new OpenAiCompatibleProvider({ baseUrl: "https://provider.test/v1", model: "model", reasoningEffort: "high", fetch: fetcher });
    await expect(provider.completeStructured(params)).rejects.toThrow(); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("uses Anthropic effort with compatible thinking/tool-choice settings", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ content: [
      { type: "thinking", thinking: "private trace" }, { type: "tool_use", name: "return_structured_output", input: { answer: "ok" } }
    ] }));
    const provider = new AnthropicProvider({ model: "provider-model", apiKey: "test", reasoningEffort: "high", adaptiveThinking: true, fetch: fetcher });
    await expect(provider.completeStructured(params)).resolves.toEqual({ answer: "ok" });
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({ output_config: { effort: "high" }, thinking: { type: "adaptive" }, tool_choice: { type: "auto" } });
    expect(body).not.toHaveProperty("temperature");
  });
  it("uses Gemini thinking levels and ignores thought text when parsing the result", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ candidates: [{ content: { parts: [{ text: "private reasoning", thought: true }, { text: '{"answer":"ok"}' }] } }] }));
    const provider = new GeminiProvider({ model: "provider-model", apiKey: "test", thinkingLevel: "low", fetch: fetcher });
    await expect(provider.completeStructured(params)).resolves.toEqual({ answer: "ok" });
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)).generationConfig.thinkingConfig).toEqual({ thinkingLevel: "LOW" });
  });
  it("uses Azure reasoning completion parameters without a sampling override", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ message: { content: '{"answer":"ok"}' } }] }));
    const provider = new AzureOpenAiProvider({ endpoint: "https://resource.openai.azure.com", deployment: "my-deployment", apiKey: "test", apiVersion: "2025-04-01-preview", reasoningEffort: "high", fetch: fetcher });
    await expect(provider.completeStructured(params)).resolves.toEqual({ answer: "ok" });
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({ reasoning_effort: "high", max_completion_tokens: 8000 });
    expect(body).not.toHaveProperty("temperature"); expect(body).not.toHaveProperty("max_tokens");
  });
  it.each([0, 4096])("preserves Gemini's explicit %s thinking budget without a conflicting level", async (thinkingBudget) => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ candidates: [{ content: { parts: [{ text: '{"answer":"ok"}' }] } }] }));
    const provider = new GeminiProvider({ model: "provider-model", apiKey: "test", thinkingBudget, fetch: fetcher });
    await expect(provider.completeStructured(params)).resolves.toEqual({ answer: "ok" });
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)).generationConfig.thinkingConfig).toEqual({ thinkingBudget });
  });
  it.each([false, true, "medium"])("passes Ollama's exact %s value to every native turn", async (think) => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ message: { content: '{"answer":"ok"}' }, done: true }));
    const provider = new OllamaProvider({ baseUrl: "http://127.0.0.1:11434", model: "installed-model", think, fetch: fetcher });
    await provider.completeStructured(params); await provider.completeStructured({ ...params, userPrompt: "Next turn" });
    for (const [, init] of fetcher.mock.calls) expect(JSON.parse(String(init?.body)).think).toBe(think);
  });
});
