import { assertKpiSuggestionSkillIntegrity, KPI_SUGGESTION_LIMITS, KPI_SUGGESTION_MODEL_JSON_SCHEMA, SMART_KPI_INSTRUCTION, kpiSuggestionApiResponseSchema, kpiSuggestionPromptInput,
  validateKpiSuggestionModelOutput, validateKpiSuggestionTaskInput, type KpiSuggestionModelOutput, type KpiSuggestionTaskInput } from "@vdt-studio/vdt-core";
import type { AiProvider } from "../types";

export async function runSuggestIncomingKpis(provider: AiProvider, input: KpiSuggestionTaskInput, options: { signal?: AbortSignal; maxTokens?: number } = {}): Promise<KpiSuggestionModelOutput> {
  const bounded = validateKpiSuggestionTaskInput(input);
  await assertKpiSuggestionSkillIntegrity(bounded.context);
  if (options.maxTokens !== undefined && (!Number.isSafeInteger(options.maxTokens) || options.maxTokens <= 0)) throw new Error("Smart maxTokens must be a positive integer.");
  options.signal?.throwIfAborted();
  const schema = provider.type === "openai_compatible"
    ? kpiSuggestionApiResponseSchema(bounded.responseContract)
    : KPI_SUGGESTION_MODEL_JSON_SCHEMA;
  const result = await provider.completeStructured({ taskType: "suggest_incoming_kpis", input: bounded, schema,
    outputJsonSchema: schema, systemPrompt: SMART_KPI_INSTRUCTION, userPrompt: JSON.stringify(kpiSuggestionPromptInput(bounded)),
    maxTokens: Math.min(options.maxTokens ?? KPI_SUGGESTION_LIMITS.outputTokens, KPI_SUGGESTION_LIMITS.outputTokens),
    ...(options.signal ? { signal: options.signal } : {}) });
  options.signal?.throwIfAborted();
  return validateKpiSuggestionModelOutput(result);
}
