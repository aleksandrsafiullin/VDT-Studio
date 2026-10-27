import type { AiCompletionParams, AiProvider, AiProviderFetch } from "../types";
import { LocalModelConversationContext, asJsonSchema, parseStructuredOutput, requestProviderNdjson } from "./provider-utils";

/** Ollama's native endpoint exposes the context budget. Its OpenAI endpoint
 * otherwise silently truncates a full VDT brief/catalog at the 4K default. */
export class OllamaProvider implements AiProvider {
  id = "ollama";
  name = "Ollama";
  type = "local_http" as const;
  private readonly conversation = new LocalModelConversationContext();

  constructor(private readonly config: {
    baseUrl: string;
    model: string;
    fetch?: AiProviderFetch | undefined;
    think?: boolean | string | undefined;
  }) {}

  async completeStructured<TInput, TOutput>(params: AiCompletionParams<TInput>): Promise<TOutput> {
    const baseUrl = this.config.baseUrl.replace(/\/v1\/?$/, "").replace(/\/$/, "");
    let content = "";
    let done = false;
    let doneReason: unknown;
    await requestProviderNdjson({
      providerName: "Ollama",
      fetch: this.config.fetch ?? globalThis.fetch,
      url: `${baseUrl}/api/chat`,
      signal: params.signal,
      timeoutMs: 480_000,
      onChunk(chunk) {
        if (typeof chunk.error === "string") throw new Error(`Ollama generation failed: ${chunk.error.slice(0, 500)}`);
        if (done) throw new Error("Ollama returned content after its completed response.");
        const message = chunk.message as { content?: unknown } | undefined;
        if (typeof message?.content === "string") content += message.content;
        if (chunk.done === true) { done = true; doneReason = chunk.done_reason; }
      },
      init: {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.config.model,
          stream: true,
          // Callers may choose bounded direct structured actions; other callers
          // retain the model default. Private thinking is never an action.
          ...(this.config.think === undefined ? {} : { think: this.config.think }),
          format: asJsonSchema(params.schema) ?? "json",
          options: {
            num_ctx: 16_384,
            num_predict: Math.min(params.maxTokens ?? 4_096, 32_768),
            ...(params.temperature === undefined ? {} : { temperature: params.temperature })
          },
          messages: this.conversation.messages(params.systemPrompt, params.userPrompt)
        })
      }
    });
    if (!done) throw new Error("Ollama response stream ended before completing a turn.");
    if (doneReason === "length") throw new Error("Ollama reached the structured response token limit before completing a turn.");
    if (!content) throw new Error("Ollama returned no message content.");
    const result = parseStructuredOutput<TOutput>(content, params.schema);
    this.conversation.confirm(params.userPrompt, content);
    return result;
  }
}
