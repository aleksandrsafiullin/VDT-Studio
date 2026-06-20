import { z } from "zod";
import type { AiCompletionParams, AiProvider, OpenAiCompatibleProviderConfig } from "../types";
import { requestProviderJson } from "./provider-utils";

function parseJsonResponse(raw: string) {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return JSON.parse(fenced?.[1] ?? trimmed) as unknown;
}

export class OpenAiCompatibleProvider implements AiProvider {
  id = "openai_compatible";
  name = "OpenAI-compatible Provider";
  type = "openai_compatible" as const;

  constructor(private readonly config: OpenAiCompatibleProviderConfig) {}

  async completeStructured<TInput, TOutput>(
    params: AiCompletionParams<TInput>
  ): Promise<TOutput> {
    const schema = params.schema instanceof z.ZodType ? params.schema : undefined;
    let lastError: unknown;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const payload = (await requestProviderJson({
        providerName: "OpenAI-compatible provider",
        fetch: globalThis.fetch,
        url: `${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`,
        signal: params.signal,
        timeoutMs: this.config.timeoutMs,
        init: {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {})
          },
          body: JSON.stringify({
            model: params.model ?? this.config.model,
            temperature: params.temperature ?? 0.2,
            max_tokens: params.maxTokens ?? 2200,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: params.systemPrompt },
              {
                role: "user",
                content:
                  attempt === 0
                    ? params.userPrompt
                    : `${params.userPrompt}\n\nThe previous response was invalid. Return only valid JSON matching the required schema.`
              }
            ]
          })
        }
      })) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = payload.choices?.[0]?.message?.content;

      if (!content) {
        throw new Error("OpenAI-compatible provider returned no message content.");
      }

      try {
        const json = parseJsonResponse(content);
        return (schema ? schema.parse(json) : json) as TOutput;
      } catch (error) {
        lastError = error;
      }
    }

    throw new Error(
      lastError instanceof Error
        ? `AI response could not be parsed or validated: ${lastError.message}`
        : "AI response could not be parsed or validated."
    );
  }
}
