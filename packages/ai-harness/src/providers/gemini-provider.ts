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
    content?: { parts?: Array<{ text?: string }> };
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
      timeoutMs: this.config.timeoutMs,
      maxResponseBytes: this.config.maxResponseBytes,
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
            temperature: params.temperature ?? 0.2,
            maxOutputTokens: params.maxTokens ?? 2200,
            responseMimeType: "application/json",
            ...(jsonSchema ? { responseJsonSchema: jsonSchema } : {})
          }
        })
      }
    })) as GeminiGenerateContentResponse;

    const text = payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("");
    if (!text && payload.promptFeedback?.blockReason) {
      throw new Error(`Google Gemini blocked the request: ${payload.promptFeedback.blockReason}.`);
    }
    return parseStructuredOutput<TOutput>(requireNonEmptyText(text, "Google Gemini"), params.schema);
  }
}
