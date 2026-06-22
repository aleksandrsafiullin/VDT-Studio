import type { VdtProject } from "@vdt-studio/vdt-core";
import { buildExecutiveSummaryPrompt, executiveSummarySystemPrompt } from "../prompts/executive-summary";
import {
  buildExecutiveSummaryInput,
  executiveSummaryOutputSchema,
  type ExecutiveSummaryInput,
  type ExecutiveSummaryOutput,
  type ExecutiveSummaryResult
} from "../schemas/executive-summary";
import type { AiProvider } from "../types";
import { validateExecutiveSummaryOutput } from "../validation/validate-executive-summary";

export interface RunExecutiveSummaryOptions {
  rootValue?: number | undefined;
  topDrivers?: ExecutiveSummaryInput["topDrivers"];
  maxTokens?: number | undefined;
  signal?: AbortSignal | undefined;
}

export async function runExecutiveSummary(
  provider: AiProvider,
  project: VdtProject,
  options?: RunExecutiveSummaryOptions
): Promise<ExecutiveSummaryResult> {
  const input = buildExecutiveSummaryInput(project, {
    ...(options?.rootValue !== undefined ? { rootValue: options.rootValue } : {}),
    ...(options?.topDrivers ? { topDrivers: options.topDrivers } : {})
  });

  const rawOutput = await provider.completeStructured<ExecutiveSummaryInput, ExecutiveSummaryOutput>({
    taskType: "generate_executive_summary",
    input,
    schema: executiveSummaryOutputSchema,
    systemPrompt: executiveSummarySystemPrompt,
    userPrompt: buildExecutiveSummaryPrompt(input),
    temperature: 0.2,
    ...(options?.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
    ...(options?.signal ? { signal: options.signal } : {})
  });

  return validateExecutiveSummaryOutput(rawOutput);
}
