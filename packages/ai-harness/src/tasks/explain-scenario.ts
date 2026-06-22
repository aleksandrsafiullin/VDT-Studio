import type { VdtProject } from "@vdt-studio/vdt-core";
import { buildExplainScenarioPrompt, explainScenarioSystemPrompt } from "../prompts/explain-scenario";
import {
  buildExplainScenarioInput,
  explainScenarioOutputSchema,
  type ExplainScenarioInput,
  type ExplainScenarioOutput,
  type ExplainScenarioResult
} from "../schemas/explain-scenario";
import type { AiProvider } from "../types";
import { validateExplainScenarioOutput } from "../validation/validate-explain-scenario";

export interface RunExplainScenarioOptions {
  calculationSummary: ExplainScenarioInput["calculationSummary"];
  maxTokens?: number | undefined;
  signal?: AbortSignal | undefined;
}

export async function runExplainScenario(
  provider: AiProvider,
  project: VdtProject,
  scenarioId: string,
  options: RunExplainScenarioOptions
): Promise<ExplainScenarioResult> {
  const input = buildExplainScenarioInput(project, scenarioId, options.calculationSummary);

  const rawOutput = await provider.completeStructured<ExplainScenarioInput, ExplainScenarioOutput>({
    taskType: "explain_scenario",
    input,
    schema: explainScenarioOutputSchema,
    systemPrompt: explainScenarioSystemPrompt,
    userPrompt: buildExplainScenarioPrompt(input),
    temperature: 0.2,
    ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
    ...(options?.signal ? { signal: options.signal } : {})
  });

  return validateExplainScenarioOutput(project, rawOutput, scenarioId);
}
