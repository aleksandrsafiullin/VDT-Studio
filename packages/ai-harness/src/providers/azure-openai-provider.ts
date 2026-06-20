import type { AiCompletionParams, AiProvider, AzureOpenAiProviderConfig } from "../types";
import {
  parseStructuredOutput,
  requestProviderJson,
  requireNonEmptyText,
  trimTrailingSlash
} from "./provider-utils";

interface AzureChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export class AzureOpenAiProvider implements AiProvider {
  id = "azure_openai";
  name = "Azure OpenAI";
  type = "azure_openai" as const;

  constructor(private readonly config: AzureOpenAiProviderConfig) {}

  async completeStructured<TInput, TOutput>(params: AiCompletionParams<TInput>): Promise<TOutput> {
    const endpoint = trimTrailingSlash(this.config.endpoint);
    const url = `${endpoint}/openai/deployments/${encodeURIComponent(this.config.deployment)}/chat/completions?api-version=${encodeURIComponent(this.config.apiVersion)}`;
    const payload = (await requestProviderJson({
      providerName: "Azure OpenAI",
      fetch: this.config.fetch ?? globalThis.fetch,
      url,
      signal: params.signal,
      timeoutMs: this.config.timeoutMs,
      maxResponseBytes: this.config.maxResponseBytes,
      init: {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "api-key": this.config.apiKey
        },
        body: JSON.stringify({
          temperature: params.temperature ?? 0.2,
          max_tokens: params.maxTokens ?? 2200,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: params.systemPrompt },
            {
              role: "user",
              content: `${params.userPrompt}\n\nReturn only valid JSON matching the required schema.`
            }
          ]
        })
      }
    })) as AzureChatCompletionResponse;

    const content = payload.choices?.[0]?.message?.content;
    return parseStructuredOutput<TOutput>(requireNonEmptyText(content, "Azure OpenAI"), params.schema);
  }
}
