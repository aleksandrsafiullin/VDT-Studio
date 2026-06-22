import type { VdtProject } from "@vdt-studio/vdt-core";
import { buildCheckUnitsPrompt, checkUnitsSystemPrompt } from "../prompts/check-units";
import {
  buildCheckUnitsInput,
  checkUnitsOutputSchema,
  type CheckUnitsInput,
  type CheckUnitsOutput,
  type CheckUnitsResult
} from "../schemas/check-units";
import type { AiProvider } from "../types";
import { validateCheckUnitsOutput } from "../validation/validate-check-units";

export interface RunCheckUnitsOptions {
  maxTokens?: number | undefined;
  signal?: AbortSignal | undefined;
}

export async function runCheckUnits(
  provider: AiProvider,
  project: VdtProject,
  options?: RunCheckUnitsOptions
): Promise<CheckUnitsResult> {
  const input = buildCheckUnitsInput(project);

  const rawOutput = await provider.completeStructured<CheckUnitsInput, CheckUnitsOutput>({
    taskType: "check_units",
    input,
    schema: checkUnitsOutputSchema,
    systemPrompt: checkUnitsSystemPrompt,
    userPrompt: buildCheckUnitsPrompt(input),
    temperature: 0.2,
    ...(options?.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
    ...(options?.signal ? { signal: options.signal } : {})
  });

  return validateCheckUnitsOutput(project, rawOutput);
}
