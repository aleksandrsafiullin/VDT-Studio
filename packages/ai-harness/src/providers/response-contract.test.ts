import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { OpenAiCompatibleProvider } from "./openai-compatible-provider";
import { AzureOpenAiProvider } from "./azure-openai-provider";
import { AnthropicProvider } from "./anthropic-provider";
import { GeminiProvider } from "./gemini-provider";
import { OllamaProvider } from "./ollama-provider";

const schema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("call_tool"), toolName: z.enum(["qa.read", "qa.list"]), args: z.object({ limit: z.number().int().min(1).max(3) }).strict() }).strict(),
  z.object({ type: z.literal("finish"), summary: z.string().min(1).max(80) }).strict()
]);
const output = { type: "call_tool", toolName: "qa.read", args: { limit: 2 } };

describe("runtime response schema reaches every model transport", () => {
  const factories = {
    openai: (fetch: typeof globalThis.fetch) => new OpenAiCompatibleProvider({ baseUrl: "https://provider.example/v1", model: "selected", apiKey: "synthetic", fetch }),
    azure: (fetch: typeof globalThis.fetch) => new AzureOpenAiProvider({ endpoint: "https://provider.example", deployment: "selected", apiVersion: "2024-10-21", apiKey: "synthetic", fetch }),
    anthropic: (fetch: typeof globalThis.fetch) => new AnthropicProvider({ baseUrl: "https://provider.example", model: "selected", apiKey: "synthetic", fetch }),
    gemini: (fetch: typeof globalThis.fetch) => new GeminiProvider({ baseUrl: "https://provider.example", model: "selected", apiKey: "synthetic", fetch }),
    ollama: (fetch: typeof globalThis.fetch) => new OllamaProvider({ baseUrl: "http://127.0.0.1:11434", model: "selected", fetch })
  };
  for (const [name, create] of Object.entries(factories)) it(`${name} receives discriminators, required fields, enum and nested bounds before inference`, async () => {
    let system = "";
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      system = name === "anthropic" ? body.system : name === "gemini" ? body.systemInstruction.parts[0].text : body.messages[0].content;
      const text = JSON.stringify(output);
      const result = name === "anthropic" ? { content: [{ type: "text", text }] }
        : name === "gemini" ? { candidates: [{ content: { parts: [{ text }] } }] }
        : name === "ollama" ? { message: { content: text }, done: true }
        : { choices: [{ message: { content: text } }] };
      return new Response(JSON.stringify(result) + (name === "ollama" ? "\n" : ""), { headers: { "content-type": name === "ollama" ? "application/x-ndjson" : "application/json" } });
    });
    await expect(create(fetch).completeStructured({ taskType: "agent_decision", input: {}, schema, systemPrompt: "Choose one decision.", userPrompt: "Read QA data." })).resolves.toEqual(output);
    expect(system).toContain('"call_tool"'); expect(system).toContain('"qa.read"');
    expect(system).toContain('"required"'); expect(system).toContain('"minimum":1'); expect(system).toContain('"maximum":3');
    expect(system).toContain('"additionalProperties":false'); expect(fetch).toHaveBeenCalledTimes(1);
  });
});
