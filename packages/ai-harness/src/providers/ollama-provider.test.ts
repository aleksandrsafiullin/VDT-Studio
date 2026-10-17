import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { OllamaProvider } from "./ollama-provider";

const params = {
  taskType: "agent_decision" as const, input: {}, schema: z.object({ answer: z.string() }),
  systemPrompt: "System", userPrompt: "Brief", maxTokens: 8_000
};

describe("native Ollama structured provider", () => {
  it("assembles split UTF-8 stream frames and requires an explicit completion", async () => {
    const bytes = new TextEncoder().encode([
      JSON.stringify({ message: { content: '{"answer":"готов' }, done: false }),
      JSON.stringify({ message: { content: 'о"}' }, done: false }),
      JSON.stringify({ done: true, done_reason: "stop" })
    ].join("\n"));
    const provider = new OllamaProvider({ baseUrl: "http://127.0.0.1:11434", model: "qwen3:8b", fetch: async () => new Response(new ReadableStream({
      start(controller) { for (let index = 0; index < bytes.length; index += 7) controller.enqueue(bytes.slice(index, index + 7)); controller.close(); }
    })) });
    await expect(provider.completeStructured(params)).resolves.toEqual({ answer: "готово" });
    const incomplete = new OllamaProvider({ baseUrl: "http://127.0.0.1:11434", model: "qwen3:8b", fetch: async () => Response.json({ message: { content: '{"answer":"partial"}' } }) });
    await expect(incomplete.completeStructured(params)).rejects.toThrow("before completing");
  });

  it("preserves the model's default thinking mode, pins the model, disables redirects and bounds total generation", async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json({ done: true, message: { content: '{"answer":"ok"}' } }));
    const provider = new OllamaProvider({ baseUrl: "http://127.0.0.1:11434/v1", model: "qwen3:8b", fetch: fetcher });
    await expect(provider.completeStructured({ ...params, model: "different-model" })).resolves.toEqual({ answer: "ok" });
    expect(fetcher.mock.calls[0]?.[0]).toBe("http://127.0.0.1:11434/api/chat");
    const init = fetcher.mock.calls[0]?.[1];
    expect(init?.redirect).toBe("error");
    expect(init?.headers).not.toHaveProperty("authorization");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "qwen3:8b", stream: true, format: "json",
      options: { num_ctx: 16_384, num_predict: 4_096 }
    });
    expect(JSON.parse(String(init?.body))).not.toHaveProperty("think");
    expect(JSON.parse(String(init?.body)).options).not.toHaveProperty("temperature");
  });

  it("accepts streamed private reasoning without interpreting it as structured actions", async () => {
    const provider = new OllamaProvider({
      baseUrl: "http://127.0.0.1:11434", model: "thinking-model",
      fetch: async () => new Response([
        JSON.stringify({ message: { thinking: 'Reasoning is not JSON: {"answer":"wrong"}' }, done: false }),
        JSON.stringify({ message: { content: '{"answer":"actual action"}' }, done: false }),
        JSON.stringify({ done: true, done_reason: "stop" })
      ].join("\n"))
    });
    await expect(provider.completeStructured(params)).resolves.toEqual({ answer: "actual action" });
  });

  it("rejects an incomplete response instead of treating truncated JSON as a completed turn", async () => {
    const provider = new OllamaProvider({
      baseUrl: "http://127.0.0.1:11434", model: "qwen3:8b",
      fetch: async () => Response.json({ done: true, done_reason: "length", message: { content: '{"answer":"partial"}' } })
    });
    await expect(provider.completeStructured(params)).rejects.toThrow("token limit");
  });

  it("retains the original brief/catalog across checkpoint turns without growing the history or sharing it across runs", async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json({ done: true, message: { content: '{"answer":"confirmed"}' } }));
    const provider = new OllamaProvider({ baseUrl: "http://127.0.0.1:11434", model: "qwen3:8b", fetch: fetcher });
    await provider.completeStructured(params);
    await provider.completeStructured({ ...params, userPrompt: "tool-results-1" });
    await provider.completeStructured({ ...params, userPrompt: "tool-results-2" });
    const messages = JSON.parse(String(fetcher.mock.calls[2]?.[1]?.body)).messages;
    expect(messages.map((entry: { role: string }) => entry.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(messages[1].content).toBe("Brief");
    expect(messages[3].content).toBe("tool-results-2");
    expect(JSON.stringify(messages)).not.toContain("tool-results-1");
    const other = new OllamaProvider({ baseUrl: "http://127.0.0.1:11434", model: "qwen3:8b", fetch: fetcher });
    await other.completeStructured({ ...params, userPrompt: "different-run" });
    expect(JSON.parse(String(fetcher.mock.calls[3]?.[1]?.body)).messages).toHaveLength(2);
  });

  it("keeps schema validation and aborts at the provider boundary", async () => {
    const provider = new OllamaProvider({
      baseUrl: "http://127.0.0.1:11434", model: "qwen3:8b",
      fetch: async () => Response.json({ done: true, message: { content: '{"answer":42}' } })
    });
    await expect(provider.completeStructured(params)).rejects.toThrow("schema validation");
    const controller = new AbortController();
    controller.abort();
    const aborted = new OllamaProvider({
      baseUrl: "http://127.0.0.1:11434", model: "qwen3:8b",
      fetch: async (_url, init) => { expect(init?.signal?.aborted).toBe(true); throw new Error("aborted"); }
    });
    await expect(aborted.completeStructured({ ...params, signal: controller.signal })).rejects.toThrow("aborted");
  });
});
