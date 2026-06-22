import type { VdtProject } from "@vdt-studio/vdt-core";
import {
  buildIdentifyMissingDriversPrompt,
  identifyMissingDriversSystemPrompt
} from "../prompts/identify-missing-drivers";
import {
  buildIdentifyMissingDriversInput,
  identifyMissingDriversOutputSchema,
  type IdentifyMissingDriversInput,
  type IdentifyMissingDriversOutput,
  type IdentifyMissingDriversResult
} from "../schemas/identify-missing-drivers";
import type { AiProvider } from "../types";
import { validateIdentifyMissingDriversOutput } from "../validation/validate-identify-missing-drivers";

export interface RunIdentifyMissingDriversOptions {
  maxTokens?: number | undefined;
  signal?: AbortSignal | undefined;
}

export async function runIdentifyMissingDrivers(
  provider: AiProvider,
  project: VdtProject,
  options?: RunIdentifyMissingDriversOptions
): Promise<IdentifyMissingDriversResult> {
  const input = buildIdentifyMissingDriversInput(project);

  const rawOutput = await provider.completeStructured<
    IdentifyMissingDriversInput,
    IdentifyMissingDriversOutput
  >({
    taskType: "identify_missing_drivers",
    input,
    schema: identifyMissingDriversOutputSchema,
    systemPrompt: identifyMissingDriversSystemPrompt,
    userPrompt: buildIdentifyMissingDriversPrompt(input),
    temperature: 0.2,
    ...(options?.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
    ...(options?.signal ? { signal: options.signal } : {})
  });

  return validateIdentifyMissingDriversOutput(project, rawOutput);
}
