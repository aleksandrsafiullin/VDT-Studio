import type { VdtChangeSet, VdtProject } from "@vdt-studio/vdt-core";
import {
  buildSuggestAlternativePrompt,
  suggestAlternativeSystemPrompt
} from "../prompts/suggest-alternative";
import {
  buildSuggestAlternativeInput,
  suggestAlternativeOutputSchema,
  type SuggestAlternativeContext,
  type SuggestAlternativeInput,
  type SuggestAlternativeOutput
} from "../schemas/suggest-alternative";
import type { AiProvider } from "../types";
import { validateAndMapSuggestAlternative } from "../validation/validate-suggest-alternative";

export interface RunSuggestAlternativeOptions {
  context?: SuggestAlternativeContext | undefined;
  maxTokens?: number | undefined;
  signal?: AbortSignal | undefined;
}

export async function runSuggestAlternative(
  provider: AiProvider,
  project: VdtProject,
  targetNodeId: string,
  options?: RunSuggestAlternativeOptions
): Promise<VdtChangeSet> {
  const input = buildSuggestAlternativeInput(project, targetNodeId, options?.context);

  const rawOutput = await provider.completeStructured<SuggestAlternativeInput, SuggestAlternativeOutput>({
    taskType: "suggest_alternative",
    input,
    schema: suggestAlternativeOutputSchema,
    systemPrompt: suggestAlternativeSystemPrompt,
    userPrompt: buildSuggestAlternativePrompt(input),
    temperature: 0.2,
    ...(options?.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
    ...(options?.signal ? { signal: options.signal } : {})
  });

  const { changeSet } = validateAndMapSuggestAlternative(project, rawOutput, targetNodeId, provider.id);
  return changeSet;
}
