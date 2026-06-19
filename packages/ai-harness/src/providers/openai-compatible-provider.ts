import { z } from "zod";
import type { AiProvider, OpenAiCompatibleProviderConfig } from "../types";

function parseJsonResponse(raw: string) {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return JSON.parse(fenced?.[1] ?? trimmed) as unknown;
}

const MAX_PROVIDER_RESPONSE_BYTES = 1_000_000;
const DEFAULT_TIMEOUT_MS = 30_000;

export class OpenAiCompatibleProvider implements AiProvider {
  id = "openai_compatible";
  name = "OpenAI-compatible Provider";
  type = "openai_compatible" as const;

  constructor(private readonly config: OpenAiCompatibleProviderConfig) {}

  async completeStructured<TInput, TOutput>(params: {
    taskType: string;
    input: TInput;
    schema: unknown;
    systemPrompt: string;
    userPrompt: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<TOutput> {
    const schema = params.schema instanceof z.ZodType ? params.schema : undefined;
    let lastError: unknown;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      const response = await fetch(`${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
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
      }).finally(() => clearTimeout(timeout));

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`OpenAI-compatible provider failed with ${response.status}: ${body}`);
      }

      const rawPayload = await response.text();
      if (rawPayload.length > MAX_PROVIDER_RESPONSE_BYTES) {
        throw new Error("OpenAI-compatible provider response exceeded the maximum allowed size.");
      }

      const payload = JSON.parse(rawPayload) as {
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
