import type { AiCompletionParams, AiProvider, AzureOpenAiProviderConfig } from "../types";
import {
  asJsonSchema,
  parseStructuredOutput,
  requestProviderJson,
  requireNonEmptyText,
  trimTrailingSlash
} from "./provider-utils";

interface AzureChatCompletionResponse {
  choices?: Array<{ finish_reason?: string; message?: { content?: string; tool_calls?: unknown[]; function_call?: unknown; refusal?: unknown } }>;
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
      timeoutMs: params.taskType === "suggest_incoming_kpis" ? Math.min(this.config.timeoutMs ?? 15_000, 15_000) : this.config.timeoutMs,
      maxResponseBytes: params.taskType === "suggest_incoming_kpis" ? 64 * 1024 : this.config.maxResponseBytes,
      requireAbortSettlement: params.taskType === "suggest_incoming_kpis",
      init: {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "api-key": this.config.apiKey
        },
        body: JSON.stringify({
          temperature: params.temperature ?? 0.2,
          max_tokens: params.taskType === "suggest_incoming_kpis" ? Math.min(params.maxTokens ?? 2048, 2048) : params.maxTokens ?? 2200,
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
      if (params.taskType === "suggest_incoming_kpis" || !jsonSchema || !isStructuredSchemaUnsupported(error)) throw error;
      payload = (await request({ type: "json_object" })) as AzureChatCompletionResponse;
    }

    const choice = payload.choices?.[0];
    if (params.taskType === "suggest_incoming_kpis" && (payload.choices?.length !== 1 || choice?.finish_reason !== "stop" || choice.message?.tool_calls?.length || choice.message?.function_call || choice.message?.refusal)) {
      throw new Error("Smart provider did not return one completed tool-free result.");
    }
    const content = choice?.message?.content;
    return parseStructuredOutput<TOutput>(requireNonEmptyText(content, "Azure OpenAI"), params.schema);
  }
}

function isStructuredSchemaUnsupported(error: unknown): boolean {
  return error instanceof Error && /status (400|404|422)\b/.test(error.message);
}
