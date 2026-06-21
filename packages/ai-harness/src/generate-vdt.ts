import { generateVdtOutputSchema, type GenerateVdtOutput } from "./schemas/generate-vdt";
import { buildGenerateVdtPrompt, generateVdtSystemPrompt } from "./prompts/generate-vdt";
import { generateVdtOutputToProject } from "./validation/to-project";
import type { AiProvider, GenerateVdtInput } from "./types";
import type { VdtProject } from "@vdt-studio/vdt-core";

export async function generateVdtProject(
  provider: AiProvider,
  input: GenerateVdtInput,
  options?: { maxTokens?: number | undefined }
): Promise<VdtProject> {
  const output = await provider.completeStructured<GenerateVdtInput, GenerateVdtOutput>({
    taskType: "generate_vdt",
    input,
    schema: generateVdtOutputSchema,
    systemPrompt: generateVdtSystemPrompt,
    userPrompt: buildGenerateVdtPrompt(input),
    temperature: 0.2,
    ...(options?.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {})
  });

  return generateVdtOutputToProject(output, input, provider.id);
}
