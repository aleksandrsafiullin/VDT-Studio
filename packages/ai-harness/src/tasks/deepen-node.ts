import type { VdtChangeSet, VdtProject } from "@vdt-studio/vdt-core";
import { buildDeepenNodePrompt, deepenNodeSystemPrompt } from "../prompts/deepen-node";
import {
  buildDeepenNodeInput,
  deepenNodeOutputSchema,
  type DeepenNodeContext,
  type DeepenNodeInput,
  type DeepenNodeOutput
} from "../schemas/deepen-node";
import type { AiProvider } from "../types";
import { validateAndMapDeepenNode } from "../validation/validate-deepen-node";

export interface RunDeepenNodeOptions {
  context?: DeepenNodeContext | undefined;
  maxTokens?: number | undefined;
  signal?: AbortSignal | undefined;
}

export async function runDeepenNode(
  provider: AiProvider,
  project: VdtProject,
  nodeId: string,
  options?: RunDeepenNodeOptions
): Promise<VdtChangeSet> {
  const input = buildDeepenNodeInput(project, nodeId, options?.context);

  const rawOutput = await provider.completeStructured<DeepenNodeInput, DeepenNodeOutput>({
    taskType: "deepen_node",
    input,
    schema: deepenNodeOutputSchema,
    systemPrompt: deepenNodeSystemPrompt,
    userPrompt: buildDeepenNodePrompt(input),
    temperature: 0.2,
    ...(options?.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
    ...(options?.signal ? { signal: options.signal } : {})
  });

  const { changeSet } = validateAndMapDeepenNode(project, rawOutput, nodeId, provider.id);
  return changeSet;
}
