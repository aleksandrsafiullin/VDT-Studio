import type { VdtProject } from "@vdt-studio/vdt-core";
import { buildExplainNodePrompt, explainNodeSystemPrompt } from "../prompts/explain-node";
import {
  buildExplainNodeInput,
  explainNodeOutputSchema,
  type ExplainNodeInput,
  type ExplainNodeOutput,
  type ExplainNodeResult
} from "../schemas/explain-node";
import type { AiProvider } from "../types";
import { validateExplainNodeOutput } from "../validation/validate-explain-node";

export interface RunExplainNodeOptions {
  maxTokens?: number | undefined;
  signal?: AbortSignal | undefined;
}

export async function runExplainNode(
  provider: AiProvider,
  project: VdtProject,
  nodeId: string,
  options?: RunExplainNodeOptions
): Promise<ExplainNodeResult> {
  const input = buildExplainNodeInput(project, nodeId);

  const rawOutput = await provider.completeStructured<ExplainNodeInput, ExplainNodeOutput>({
    taskType: "explain_node",
    input,
    schema: explainNodeOutputSchema,
    systemPrompt: explainNodeSystemPrompt,
    userPrompt: buildExplainNodePrompt(input),
    temperature: 0.2,
    ...(options?.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
    ...(options?.signal ? { signal: options.signal } : {})
  });

  return validateExplainNodeOutput(project, rawOutput, nodeId);
}
