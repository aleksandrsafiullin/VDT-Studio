import { z } from "zod";
import type { AiCompletionParams, AiProvider, OpenAiCompatibleProviderConfig } from "../types";
import { LocalModelConversationContext, ProviderHttpError, asJsonSchema, requestProviderJson, withZodResponseContract } from "./provider-utils";

function parseJsonResponse(raw: string) {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return JSON.parse(fenced?.[1] ?? trimmed) as unknown;
}

function completionParameters(model: string, params: AiCompletionParams<unknown>, reasoningEffort?: string) {
  // Reasoning model families reject legacy max_tokens and can reject sampling
  // overrides at their default reasoning effort. Keep the provider's effort.
  if (reasoningEffort !== undefined || /^(?:o[134](?:-|$)|gpt-(?:5|6)(?:[.-]|$))/i.test(model)) {
    // Agent decisions can contain a full bounded driver layer. Reasoning and
    // its JSON share this limit; an explicit caller limit always takes priority.
    return { max_completion_tokens: params.maxTokens ?? (params.taskType === "agent_decision" ? 4096 : 2200) };
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
    const systemPrompt = withZodResponseContract(params.systemPrompt, params.schema, params.outputJsonSchema);
    const model = params.model ?? this.config.model;
    const smart = params.taskType === "suggest_incoming_kpis";
    const retainContext = !smart && (this.config.retainInitialContext ?? params.taskType === "agent_decision");
    let lastError: unknown;

    const maxAttempts = smart ? 1 : (schema ? 2 : (jsonSchema ? 1 : 2));
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const userPrompt = attempt === 0 ? params.userPrompt
        : `${params.userPrompt}\n\nThe previous response was invalid: ${lastError instanceof Error ? lastError.message.slice(0, 2000) : "schema validation failed"}. Return only valid JSON matching the required schema.`;
      const request = (responseFormat: Record<string, unknown>) => requestProviderJson({
        providerName: "OpenAI-compatible provider",
        fetch: this.config.fetch ?? globalThis.fetch,
        url: `${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`,
        signal: params.signal,
        timeoutMs: smart ? Math.min(this.config.timeoutMs ?? 15_000, 15_000) : this.config.timeoutMs ?? (params.taskType === "agent_decision" ? 180_000 : undefined),
        ...(smart ? { maxResponseBytes: 64 * 1024 } : {}),
        requireAbortSettlement: smart,
        init: {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {})
          },
          body: JSON.stringify({
            model,
            ...(this.config.reasoningEffort === undefined ? {} : { reasoning_effort: this.config.reasoningEffort }),
            ...completionParameters(model, smart ? { ...params, maxTokens: Math.min(params.maxTokens ?? 2048, 2048) } : params, this.config.reasoningEffort),
            response_format: responseFormat,
            messages: retainContext
              ? this.conversation.messages(`${systemPrompt}${responseFormat.type === "json_object" && jsonSchema ? `\n\nReturn JSON matching this exact response schema:\n${JSON.stringify(jsonSchema)}` : ""}`, userPrompt)
              : [
              { role: "system", content: `${systemPrompt}${responseFormat.type === "json_object" && jsonSchema ? `\n\nReturn JSON matching this exact response schema:\n${JSON.stringify(jsonSchema)}` : ""}` },
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
        if (smart || !jsonSchema || !isStructuredSchemaUnsupported(error)) throw error;
        this.strictSchemaUnavailable = true;
        payload = (await request({ type: "json_object" })) as typeof payload;
      }
      const choice = payload.choices?.[0] as { finish_reason?: string; message?: { content?: string; tool_calls?: unknown[]; function_call?: unknown; refusal?: unknown } } | undefined;
      const message = choice?.message;
      if (smart && choice?.finish_reason === "length") throw Object.assign(new Error("Smart response exhausted its generation budget before completion."), { code: "INCOMPLETE_OUTPUT" });
      if (params.taskType === "agent_decision" && choice?.finish_reason === "length") {
        throw Object.assign(new Error("The agent exhausted its generation budget before returning a complete decision."), { code: "INCOMPLETE_OUTPUT" });
      }
      if (smart && (choice?.finish_reason === "content_filter" || message?.refusal)) throw Object.assign(new Error("The provider declined this Smart request."), { code: "PROVIDER_REFUSAL" });
      if (smart && (payload.choices?.length !== 1 || choice?.finish_reason !== "stop" || message?.tool_calls?.length || message?.function_call || message?.refusal)) {
        throw Object.assign(new Error("Smart provider did not return one completed tool-free result."), { code: "INVALID_PROVIDER_OUTPUT" });
      }
      const content = message?.content;

      if (smart && !content) throw Object.assign(new Error("Smart provider returned no completed message content."), { code: "INVALID_PROVIDER_OUTPUT" });
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

    if (smart) throw Object.assign(new Error("Smart response did not match the supplied JSON schema."), { code: "INVALID_PROVIDER_OUTPUT" });
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
