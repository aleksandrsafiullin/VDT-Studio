import type { VdtProject } from "@vdt-studio/vdt-core";
import { buildReviewModelPrompt, reviewModelSystemPrompt } from "../prompts/review-model";
import {
  buildReviewModelInput,
  reviewModelOutputSchema,
  type ReviewModelInput,
  type ReviewModelOutput,
  type ReviewModelResult
} from "../schemas/review-model";
import type { AiProvider } from "../types";
import { validateReviewModelOutput } from "../validation/validate-review-model";

export interface RunReviewModelOptions {
  maxTokens?: number | undefined;
  signal?: AbortSignal | undefined;
}

export async function runReviewModel(
  provider: AiProvider,
  project: VdtProject,
  options?: RunReviewModelOptions
): Promise<ReviewModelResult> {
  const input = buildReviewModelInput(project);

  const rawOutput = await provider.completeStructured<ReviewModelInput, ReviewModelOutput>({
    taskType: "review_model",
    input,
    schema: reviewModelOutputSchema,
    systemPrompt: reviewModelSystemPrompt,
    userPrompt: buildReviewModelPrompt(input),
    temperature: 0.2,
    ...(options?.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
    ...(options?.signal ? { signal: options.signal } : {})
  });

  return validateReviewModelOutput(project, rawOutput);
}
