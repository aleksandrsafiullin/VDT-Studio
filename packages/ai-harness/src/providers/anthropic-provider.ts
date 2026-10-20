import type { AiCompletionParams, AiProvider, AnthropicProviderConfig } from "../types";
import {
  asJsonSchema,
  parseStructuredOutput,
  requestProviderJson,
  requireNonEmptyText,
  trimTrailingSlash
} from "./provider-utils";

interface AnthropicMessageResponse {
  stop_reason?: string;
  content?: Array<
    | { type?: "text"; text?: string }
    | { type?: "tool_use"; name?: string; input?: unknown }
  >;
}

const STRUCTURED_OUTPUT_TOOL = "return_structured_output";

export class AnthropicProvider implements AiProvider {
  id = "anthropic";
  name = "Anthropic";
  type = "anthropic" as const;

  constructor(private readonly config: AnthropicProviderConfig) {}

  async completeStructured<TInput, TOutput>(params: AiCompletionParams<TInput>): Promise<TOutput> {
    const jsonSchema = params.outputJsonSchema ?? asJsonSchema(params.schema);
    const baseUrl = trimTrailingSlash(this.config.baseUrl ?? "https://api.anthropic.com");
    const url = baseUrl.endsWith("/v1") ? `${baseUrl}/messages` : `${baseUrl}/v1/messages`;
    const toolConfig = jsonSchema
      ? {
          tools: [
            {
              name: STRUCTURED_OUTPUT_TOOL,
              description: "Return the requested structured result.",
              input_schema: jsonSchema
            }
          ],
          tool_choice: { type: "tool", name: STRUCTURED_OUTPUT_TOOL }
        }
      : {};

    const payload = (await requestProviderJson({
      providerName: "Anthropic",
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
          "x-api-key": this.config.apiKey,
          "anthropic-version": this.config.anthropicVersion ?? "2023-06-01"
        },
        body: JSON.stringify({
          model: params.model ?? this.config.model,
          max_tokens: params.taskType === "suggest_incoming_kpis" ? Math.min(params.maxTokens ?? 2048, 2048) : params.maxTokens ?? 2200,
          temperature: params.temperature ?? 0.2,
          system: params.systemPrompt,
          messages: [
            {
              role: "user",
              content: `${params.userPrompt}\n\nReturn only the requested structured JSON.`
            }
          ],
          ...toolConfig
        })
      }
    })) as AnthropicMessageResponse;

    if (params.taskType === "suggest_incoming_kpis" && (payload.stop_reason !== "tool_use" || !payload.content?.length || payload.content.filter(item => item.type === "tool_use").length !== 1 || payload.content.some(item => item.type !== "text" && (item.type !== "tool_use" || item.name !== STRUCTURED_OUTPUT_TOOL)))) {
      throw new Error("Smart provider did not return the single reviewed structured-output channel.");
    }
    const toolOutput = payload.content?.find(
      (item) => item.type === "tool_use" && item.name === STRUCTURED_OUTPUT_TOOL
    );
    if (toolOutput && "input" in toolOutput) {
      return parseStructuredOutput<TOutput>(JSON.stringify(toolOutput.input), params.schema);
    }

    const text = payload.content
      ?.filter((item): item is { type?: "text"; text?: string } => item.type === "text")
      .map((item) => item.text ?? "")
      .join("");
    return parseStructuredOutput<TOutput>(requireNonEmptyText(text, "Anthropic"), params.schema);
  }
}
