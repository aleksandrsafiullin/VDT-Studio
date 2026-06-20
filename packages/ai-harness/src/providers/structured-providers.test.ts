import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AnthropicProvider } from "./anthropic-provider";
import { AzureOpenAiProvider } from "./azure-openai-provider";
import { GeminiProvider } from "./gemini-provider";

const outputSchema = z.object({ answer: z.string() });
const params = {
  taskType: "generate_vdt" as const,
  input: {},
  schema: outputSchema,
  systemPrompt: "System prompt",
  userPrompt: "User prompt",
  temperature: 0.1,
  maxTokens: 123
};

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("structured completion providers", () => {
  it("calls Anthropic Messages API and extracts fenced JSON text", async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ content: [{ type: "text", text: "```json\n{\"answer\":\"anthropic\"}\n```" }] })
    );
    const provider = new AnthropicProvider({
      apiKey: "anthropic-secret",
      model: "claude-test",
      fetch: fetchMock
    });

    await expect(provider.completeStructured(params)).resolves.toEqual({ answer: "anthropic" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-api-key": "anthropic-secret",
          "anthropic-version": "2023-06-01"
        }),
        signal: expect.any(AbortSignal)
      })
    );
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      model: "claude-test",
      max_tokens: 123,
      system: "System prompt"
    });
  });

  it("uses Anthropic tool output when a JSON Schema is supplied", async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({
        content: [
          { type: "tool_use", name: "return_structured_output", input: { answer: "tool" } }
        ]
      })
    );
    const provider = new AnthropicProvider({
      apiKey: "secret",
      model: "claude-test",
      fetch: fetchMock
    });

    await expect(
      provider.completeStructured({
        ...params,
        schema: {
          type: "object",
          properties: { answer: { type: "string" } },
          required: ["answer"]
        }
      })
    ).resolves.toEqual({ answer: "tool" });
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      tools: [{ name: "return_structured_output" }],
      tool_choice: { type: "tool", name: "return_structured_output" }
    });
  });

  it("calls Azure chat completions without placing its key in the URL", async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ choices: [{ message: { content: "Result: {\"answer\":\"azure\"}" } }] })
    );
    const provider = new AzureOpenAiProvider({
      endpoint: "https://unit.openai.azure.com/",
      apiKey: "azure-secret",
      deployment: "vdt deployment",
      apiVersion: "2024-10-21",
      fetch: fetchMock
    });

    await expect(provider.completeStructured(params)).resolves.toEqual({ answer: "azure" });
    const [url, request] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://unit.openai.azure.com/openai/deployments/vdt%20deployment/chat/completions?api-version=2024-10-21"
    );
    expect(String(url)).not.toContain("azure-secret");
    expect((request as RequestInit).headers).toMatchObject({ "api-key": "azure-secret" });
    expect(JSON.parse(String((request as RequestInit).body))).toMatchObject({
      response_format: { type: "json_object" },
      max_tokens: 123
    });
  });

  it("calls Gemini generateContent in JSON mode", async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ candidates: [{ content: { parts: [{ text: "{\"answer\":\"gemini\"}" }] } }] })
    );
    const provider = new GeminiProvider({
      apiKey: "gemini-secret",
      model: "models/gemini-test",
      fetch: fetchMock
    });

    await expect(provider.completeStructured(params)).resolves.toEqual({ answer: "gemini" });
    const [url, request] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent"
    );
    expect(String(url)).not.toContain("gemini-secret");
    expect((request as RequestInit).headers).toMatchObject({ "x-goog-api-key": "gemini-secret" });
    expect(JSON.parse(String((request as RequestInit).body))).toMatchObject({
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: 123
      }
    });
  });

  it("aborts a provider request after the configured timeout", async () => {
    const fetchMock = vi.fn((_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      })
    );
    const provider = new GeminiProvider({
      apiKey: "secret",
      model: "gemini-test",
      timeoutMs: 5,
      fetch: fetchMock
    });

    await expect(provider.completeStructured(params)).rejects.toThrow(
      "Google Gemini request timed out after 5ms."
    );
  });

  it("propagates a caller AbortSignal", async () => {
    const fetchMock = vi.fn((_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const rejectAbort = () => reject(new DOMException("Aborted", "AbortError"));
        if (init?.signal?.aborted) rejectAbort();
        else init?.signal?.addEventListener("abort", rejectAbort, { once: true });
      })
    );
    const provider = new AnthropicProvider({
      apiKey: "secret",
      model: "claude-test",
      fetch: fetchMock
    });
    const controller = new AbortController();
    controller.abort();

    await expect(
      provider.completeStructured({ ...params, signal: controller.signal })
    ).rejects.toThrow("Anthropic request was aborted.");
  });

  it("rejects oversized responses and never includes secret response text in errors", async () => {
    const oversized = new AzureOpenAiProvider({
      endpoint: "https://unit.openai.azure.com",
      apiKey: "secret",
      deployment: "test",
      apiVersion: "2024-10-21",
      maxResponseBytes: 20,
      fetch: vi.fn(async () => jsonResponse({ choices: [{ message: { content: "too large" } }] }))
    });
    await expect(oversized.completeStructured(params)).rejects.toThrow(
      "Azure OpenAI response exceeded the maximum allowed size."
    );

    const leakedText = "upstream-secret-response";
    const rejected = new AnthropicProvider({
      apiKey: "request-secret",
      model: "claude-test",
      fetch: vi.fn(async () => jsonResponse({ error: leakedText }, 401))
    });
    const error = await rejected.completeStructured(params).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Anthropic request failed with status 401.");
    expect((error as Error).message).not.toContain(leakedText);
    expect((error as Error).message).not.toContain("request-secret");
  });
});
