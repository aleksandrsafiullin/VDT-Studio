import { assertLocalHttpTarget, LocalHttpRouteError, resolveLocalHttpFetch, type LocalHttpSelection, type ResolveOwnedLocalHttpRoute } from "@vdt-studio/model-bridge";
import type { AiCompletionParams, AiProvider, AiProviderFetch } from "../types";
import { LocalModelConversationContext, asJsonSchema, parseStructuredOutput, requestProviderNdjson, withZodResponseContract } from "./provider-utils";

export interface OllamaAgentRequest {
  model: string;
  stream: true;
  think?: boolean | string | undefined;
  format: Record<string, unknown> | "json";
  options: { num_ctx: number; num_predict: number; temperature?: number | undefined };
  messages: ReturnType<LocalModelConversationContext["messages"]>;
}

export interface OllamaAttemptUsage {
  readonly inputUnits: number | null;
  readonly outputUnits: number | null;
}

const reportedCount = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

export class OllamaContextBudgetError extends Error {
  readonly code = "LOCAL_CONTEXT_OVERFLOW";

  constructor() {
    super("The Ollama request exceeds the local context budget. Narrow the current task or use a larger-context supported profile.");
  }
}

/** Ollama's native endpoint exposes the context budget. Its OpenAI endpoint
 * otherwise silently truncates a full VDT brief/catalog at the 4K default. */
export class OllamaProvider implements AiProvider {
  id = "ollama";
  name = "Ollama";
  type = "local_http" as const;
  private readonly conversation = new LocalModelConversationContext();

  constructor(private readonly config: {
    baseUrl: string;
    model: string;
    fetch?: AiProviderFetch | undefined;
    think?: boolean | string | undefined;
    resolveThink?: (() => boolean | string) | undefined;
    observeAttempt?: ((usage: OllamaAttemptUsage) => void) | undefined;
    prepareAgentRequest?: (request: OllamaAgentRequest) => OllamaAgentRequest;
    localRoute?: { selection: LocalHttpSelection; resolve: ResolveOwnedLocalHttpRoute } | undefined;
  }) {}

  async completeStructured<TInput, TOutput>(params: AiCompletionParams<TInput>): Promise<TOutput> {
    assertLocalHttpTarget(this.config.baseUrl, this.config.model);
    const route = this.config.localRoute;
    if (route && params.model !== undefined && params.model !== this.config.model) {
      throw new LocalHttpRouteError("LOCAL_TARGET_REJECTED", "The task model differs from the host-admitted local model.");
    }
    const fetcher = route
      ? resolveLocalHttpFetch({ backendId: "ollama", baseUrl: this.config.baseUrl, model: this.config.model, task: params.taskType }, route.selection, route.resolve)
      : this.config.fetch ?? globalThis.fetch;
    const baseUrl = this.config.baseUrl.replace(/\/v1\/?$/, "").replace(/\/$/, "");
    const think = this.config.resolveThink?.() ?? this.config.think;
    const request: OllamaAgentRequest = {
      model: this.config.model,
      stream: true,
      // A bounded direct structured action can disable private thinking.
      ...(think === undefined ? {} : { think }),
      format: asJsonSchema(params.schema) ?? "json",
      options: {
        num_ctx: 16_384,
        num_predict: Math.min(params.maxTokens ?? 4_096, 32_768),
        ...(params.temperature === undefined ? {} : { temperature: params.temperature })
      },
      messages: this.conversation.messages(withZodResponseContract(params.systemPrompt, params.schema, params.outputJsonSchema), params.userPrompt)
    };
    let prepared = request;
    if (params.taskType === "agent_decision" && this.config.prepareAgentRequest) {
      const { messages, options: { num_ctx, num_predict } } = this.config.prepareAgentRequest(request);
      prepared = { ...request, messages, options: { ...request.options, num_ctx, num_predict } };
    }
    const timeoutMs = 480_000;
    const signal = prepared === request ? params.signal
      : AbortSignal.any(params.signal ? [params.signal, AbortSignal.timeout(timeoutMs)] : [AbortSignal.timeout(timeoutMs)]);
    for (;;) {
      let content = "";
      let done = false;
      let doneReason: unknown;
      let reportedPromptTokens: number | undefined;
      let reportedOutputTokens: number | undefined;
      let dispatched = false;
      await requestProviderNdjson({
        providerName: "Ollama",
        fetch: this.config.observeAttempt ? (url, init) => {
          dispatched = true;
          return fetcher(url, init);
        } : fetcher,
        url: `${baseUrl}/api/chat`,
        signal,
        timeoutMs,
        onChunk(chunk) {
          if (typeof chunk.error === "string") throw new Error(`Ollama generation failed: ${chunk.error.slice(0, 500)}`);
          if (done) throw new Error("Ollama returned content after its completed response.");
          const message = chunk.message as { content?: unknown } | undefined;
          if (typeof message?.content === "string") content += message.content;
          if (chunk.done !== true) return;
          done = true;
          doneReason = chunk.done_reason;
          reportedPromptTokens = reportedCount(chunk.prompt_eval_count);
          reportedOutputTokens = reportedCount(chunk.eval_count);
        },
        init: {
          method: "POST",
          redirect: "error",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(prepared)
        }
      }).finally(() => {
        if (dispatched) this.config.observeAttempt?.({
          inputUnits: reportedPromptTokens ?? null, outputUnits: reportedOutputTokens ?? null
        });
      });
      if (!done) throw new Error("Ollama response stream ended before completing a turn.");
      const overflow = prepared !== request && reportedPromptTokens !== undefined
        && reportedPromptTokens + prepared.options.num_predict > prepared.options.num_ctx;
      if (doneReason === "length" || overflow) {
        const retry = nextBudget(prepared, request, doneReason === "length");
        if (retry) { prepared = retry; continue; }
        if (overflow) throw new OllamaContextBudgetError();
        throw new Error("Ollama reached the structured response token limit before completing a turn. Narrow the action and retry from the saved draft.");
      }
      if (!content) throw new Error("Ollama returned no message content.");
      const result = parseStructuredOutput<TOutput>(content, params.schema);
      this.conversation.confirm(params.userPrompt, content);
      return result;
    }
  }
}


// One larger-window attempt retains the exact approved input and format.
// Moving directly to the cap keeps recovery bounded to two requests.
function nextBudget(prepared: OllamaAgentRequest, original: OllamaAgentRequest, outputLimited: boolean): OllamaAgentRequest | undefined {
  if (prepared === original || prepared.options.num_ctx >= original.options.num_ctx) return;
  const num_ctx = original.options.num_ctx;
  const num_predict = outputLimited
    ? Math.min(original.options.num_predict, 4_096, prepared.options.num_predict * 2,
      prepared.options.num_predict + num_ctx - prepared.options.num_ctx)
    : prepared.options.num_predict;
  if (outputLimited && num_predict <= prepared.options.num_predict) return;
  return { ...prepared, options: { ...prepared.options, num_ctx, num_predict } };
}
