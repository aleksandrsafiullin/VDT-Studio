import type { AiCompletionParams, AiProvider, AzureOpenAiProviderConfig } from "../types";
import {
  asJsonSchema,
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
    const jsonSchema = asJsonSchema(params.schema);
    const request = (responseFormat: Record<string, unknown>) => requestProviderJson({
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
          response_format: responseFormat,
          messages: [
            { role: "system", content: params.systemPrompt },
            {
              role: "user",
              content: `${params.userPrompt}\n\nReturn only valid JSON matching the required schema.`
            }
          ]
        })
      }
    });
    let payload: AzureChatCompletionResponse;
    try {
      payload = (await request(jsonSchema
        ? { type: "json_schema", json_schema: { name: "vdt_agent_decision", strict: true, schema: jsonSchema } }
        : { type: "json_object" })) as AzureChatCompletionResponse;
    } catch (error) {
      if (!jsonSchema || !isStructuredSchemaUnsupported(error)) throw error;
      payload = (await request({ type: "json_object" })) as AzureChatCompletionResponse;
    }

    const content = payload.choices?.[0]?.message?.content;
    return parseStructuredOutput<TOutput>(requireNonEmptyText(content, "Azure OpenAI"), params.schema);
  }
}

function isStructuredSchemaUnsupported(error: unknown): boolean {
  return error instanceof Error && /status (400|404|422)\b/.test(error.message);
}
