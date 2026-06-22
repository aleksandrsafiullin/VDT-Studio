import type { VdtChangeSet, VdtProject } from "@vdt-studio/vdt-core";
import { buildSuggestFormulaPrompt, suggestFormulaSystemPrompt } from "../prompts/suggest-formula";
import {
  buildSuggestFormulaInput,
  suggestFormulaOutputSchema,
  type SuggestFormulaContext,
  type SuggestFormulaInput,
  type SuggestFormulaOutput
} from "../schemas/suggest-formula";
import type { AiProvider } from "../types";
import { validateAndMapSuggestFormula } from "../validation/validate-suggest-formula";

export interface RunSuggestFormulaOptions {
  context?: SuggestFormulaContext | undefined;
  maxTokens?: number | undefined;
  signal?: AbortSignal | undefined;
}

export async function runSuggestFormula(
  provider: AiProvider,
  project: VdtProject,
  nodeId: string,
  options?: RunSuggestFormulaOptions
): Promise<VdtChangeSet> {
  const input = buildSuggestFormulaInput(project, nodeId, options?.context);

  const rawOutput = await provider.completeStructured<SuggestFormulaInput, SuggestFormulaOutput>({
    taskType: "suggest_formula",
    input,
    schema: suggestFormulaOutputSchema,
    systemPrompt: suggestFormulaSystemPrompt,
    userPrompt: buildSuggestFormulaPrompt(input),
    temperature: 0.2,
    ...(options?.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
    ...(options?.signal ? { signal: options.signal } : {})
  });

  const { changeSet } = validateAndMapSuggestFormula(project, rawOutput, nodeId, provider.id);
  return changeSet;
}
