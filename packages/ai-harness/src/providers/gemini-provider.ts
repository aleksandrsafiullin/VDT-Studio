import type { AiCompletionParams, AiProvider, GeminiProviderConfig } from "../types";
import {
  asJsonSchema,
  parseStructuredOutput,
  requestProviderJson,
  requireNonEmptyText,
  trimTrailingSlash
} from "./provider-utils";

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: Array<{ text?: string; functionCall?: unknown; [key: string]: unknown }> };
  }>;
  promptFeedback?: { blockReason?: string };
}

export class GeminiProvider implements AiProvider {
  id = "gemini";
  name = "Google Gemini";
  type = "gemini" as const;

  constructor(private readonly config: GeminiProviderConfig) {}

  async completeStructured<TInput, TOutput>(params: AiCompletionParams<TInput>): Promise<TOutput> {
    const model = (params.model ?? this.config.model).replace(/^models\//, "");
    const baseUrl = trimTrailingSlash(
      this.config.baseUrl ?? "https://generativelanguage.googleapis.com"
    );
    const jsonSchema = asJsonSchema(params.schema);
    const payload = (await requestProviderJson({
      providerName: "Google Gemini",
      fetch: this.config.fetch ?? globalThis.fetch,
      url: `${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      signal: params.signal,
      timeoutMs: params.taskType === "suggest_incoming_kpis" ? Math.min(this.config.timeoutMs ?? 15_000, 15_000) : this.config.timeoutMs,
      maxResponseBytes: params.taskType === "suggest_incoming_kpis" ? 64 * 1024 : this.config.maxResponseBytes,
      requireAbortSettlement: params.taskType === "suggest_incoming_kpis",
      init: {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": this.config.apiKey
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: params.systemPrompt }] },
          contents: [
            {
              role: "user",
              parts: [{ text: `${params.userPrompt}\n\nReturn only valid JSON.` }]
            }
          ],
          generationConfig: {
            ...(this.config.thinkingLevel !== undefined ? { thinkingConfig: { thinkingLevel: this.config.thinkingLevel.toUpperCase() } }
              : this.config.thinkingBudget !== undefined ? { thinkingConfig: { thinkingBudget: this.config.thinkingBudget } } : {}),
            temperature: params.temperature ?? 0.2,
            maxOutputTokens: params.taskType === "suggest_incoming_kpis" ? Math.min(params.maxTokens ?? 2048, 2048) : params.maxTokens ?? 2200,
            responseMimeType: "application/json",
            ...(jsonSchema ? { responseJsonSchema: jsonSchema } : {})
          }
        })
      }
    })) as GeminiGenerateContentResponse;

    const candidate = payload.candidates?.[0];
    if (params.taskType === "suggest_incoming_kpis" && (payload.promptFeedback?.blockReason || payload.candidates?.length !== 1 || candidate?.finishReason !== "STOP" || !candidate.content?.parts?.length || candidate.content.parts.some(part => Object.keys(part).some(key => key !== "text") || typeof part.text !== "string"))) {
      throw new Error("Smart provider did not return one completed text-only result.");
    }
    const text = candidate?.content?.parts
      ?.filter((part) => part.thought !== true)
      ?.map((part) => part.text ?? "")
      .join("");
    if (!text && payload.promptFeedback?.blockReason) {
      throw new Error(`Google Gemini blocked the request: ${payload.promptFeedback.blockReason}.`);
    }
    return parseStructuredOutput<TOutput>(requireNonEmptyText(text, "Google Gemini"), params.schema);
  }
}
