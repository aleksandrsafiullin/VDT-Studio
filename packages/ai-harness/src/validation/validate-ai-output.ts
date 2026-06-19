import { generateVdtOutputSchema, type GenerateVdtOutput } from "../schemas/generate-vdt";

export function validateGenerateVdtOutput(output: unknown): GenerateVdtOutput {
  return generateVdtOutputSchema.parse(output);
}
