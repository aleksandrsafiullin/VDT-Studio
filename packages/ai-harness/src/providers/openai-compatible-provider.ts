import { z } from "zod";
import type { AiCompletionParams, AiProvider, OpenAiCompatibleProviderConfig } from "../types";
import { LocalModelConversationContext, ProviderHttpError, asJsonSchema, requestProviderJson } from "./provider-utils";

function parseJsonResponse(raw: string) {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return JSON.parse(fenced?.[1] ?? trimmed) as unknown;
}

function completionParameters(model: string, params: AiCompletionParams<unknown>) {
  // Reasoning model families reject legacy max_tokens and can reject sampling
  // overrides at their default reasoning effort. Keep the provider's effort.
  if (/^(?:o[134](?:-|$)|gpt-(?:5|6)(?:[.-]|$))/i.test(model)) {
    return { max_completion_tokens: params.maxTokens ?? 2200 };
  }
  return { temperature: params.temperature ?? 0.2, max_tokens: params.maxTokens ?? 2200 };
}

export class OpenAiCompatibleProvider implements AiProvider {
  id = "openai_compatible";
  name = "OpenAI-compatible Provider";
  type = "openai_compatible" as const;
  private readonly conversation = new LocalModelConversationContext(3);
  private strictSchemaUnavailable = false;

  constructor(private readonly config: OpenAiCompatibleProviderConfig) {}

  async completeStructured<TInput, TOutput>(
    params: AiCompletionParams<TInput>
  ): Promise<TOutput> {
    const schema = params.schema instanceof z.ZodType ? params.schema : undefined;
    const jsonSchema = params.outputJsonSchema ?? asJsonSchema(params.schema);
    const model = params.model ?? this.config.model;
    const retainContext = this.config.retainInitialContext ?? params.taskType === "agent_decision";
    let lastError: unknown;

    const maxAttempts = schema ? 2 : (jsonSchema ? 1 : 2);
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const userPrompt = attempt === 0 ? params.userPrompt
        : `${params.userPrompt}\n\nThe previous response was invalid: ${lastError instanceof Error ? lastError.message.slice(0, 2000) : "schema validation failed"}. Return only valid JSON matching the required schema.`;
      const request = (responseFormat: Record<string, unknown>) => requestProviderJson({
        providerName: "OpenAI-compatible provider",
        fetch: this.config.fetch ?? globalThis.fetch,
        url: `${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`,
        signal: params.signal,
        timeoutMs: this.config.timeoutMs ?? (params.taskType === "agent_decision" ? 180_000 : undefined),
        init: {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {})
          },
          body: JSON.stringify({
            model,
            ...completionParameters(model, params),
            response_format: responseFormat,
            messages: retainContext
              ? this.conversation.messages(`${params.systemPrompt}${responseFormat.type === "json_object" && jsonSchema ? `\n\nReturn JSON matching this exact response schema:\n${JSON.stringify(jsonSchema)}` : ""}`, userPrompt)
              : [
              { role: "system", content: `${params.systemPrompt}${responseFormat.type === "json_object" && jsonSchema ? `\n\nReturn JSON matching this exact response schema:\n${JSON.stringify(jsonSchema)}` : ""}` },
              {
                role: "user",
                content: userPrompt
              }
            ]
          })
        }
      });
      let payload: {
        choices?: { message?: { content?: string } }[];
      };
      try {
        payload = (await request(jsonSchema && !this.strictSchemaUnavailable
          ? { type: "json_schema", json_schema: { name: "vdt_agent_decision", strict: true, schema: jsonSchema } }
          : { type: "json_object" })) as typeof payload;
      } catch (error) {
        if (!jsonSchema || !isStructuredSchemaUnsupported(error)) throw error;
        this.strictSchemaUnavailable = true;
        payload = (await request({ type: "json_object" })) as typeof payload;
      }
      const content = payload.choices?.[0]?.message?.content;

      if (!content) {
        throw new Error("OpenAI-compatible provider returned no message content.");
      }

      try {
        const json = parseJsonResponse(content);
        const result = (schema ? schema.parse(json) : json) as TOutput;
        if (retainContext) this.conversation.confirm(params.userPrompt, content);
        return result;
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

function isStructuredSchemaUnsupported(error: unknown): boolean {
  if (error instanceof ProviderHttpError) {
    if (error.param && error.param !== "response_format") return false;
    if (error.code && !["unsupported_parameter", "unsupported_value", "invalid_json_schema"].includes(error.code)) return false;
  }
  return error instanceof Error && /status (400|404|422)\b/.test(error.message);
}
