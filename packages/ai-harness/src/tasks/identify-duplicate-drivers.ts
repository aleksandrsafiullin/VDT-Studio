import type { VdtProject } from "@vdt-studio/vdt-core";
import {
  buildIdentifyDuplicateDriversPrompt,
  identifyDuplicateDriversSystemPrompt
} from "../prompts/identify-duplicate-drivers";
import {
  buildIdentifyDuplicateDriversInput,
  identifyDuplicateDriversOutputSchema,
  type IdentifyDuplicateDriversInput,
  type IdentifyDuplicateDriversOutput,
  type IdentifyDuplicateDriversResult
} from "../schemas/identify-duplicate-drivers";
import type { AiProvider } from "../types";
import { validateIdentifyDuplicateDriversOutput } from "../validation/validate-identify-duplicate-drivers";

export interface RunIdentifyDuplicateDriversOptions {
  maxTokens?: number | undefined;
  signal?: AbortSignal | undefined;
}

export async function runIdentifyDuplicateDrivers(
  provider: AiProvider,
  project: VdtProject,
  options?: RunIdentifyDuplicateDriversOptions
): Promise<IdentifyDuplicateDriversResult> {
  const input = buildIdentifyDuplicateDriversInput(project);

  const rawOutput = await provider.completeStructured<
    IdentifyDuplicateDriversInput,
    IdentifyDuplicateDriversOutput
  >({
    taskType: "identify_duplicate_drivers",
    input,
    schema: identifyDuplicateDriversOutputSchema,
    systemPrompt: identifyDuplicateDriversSystemPrompt,
    userPrompt: buildIdentifyDuplicateDriversPrompt(input),
    temperature: 0.2,
    ...(options?.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
    ...(options?.signal ? { signal: options.signal } : {})
  });

  return validateIdentifyDuplicateDriversOutput(project, rawOutput);
}
