import type { VdtChangeSet, VdtProject } from "@vdt-studio/vdt-core";
import { buildSimplifyBranchPrompt, simplifyBranchSystemPrompt } from "../prompts/simplify-branch";
import {
  buildSimplifyBranchInput,
  simplifyBranchOutputSchema,
  type SimplifyBranchContext,
  type SimplifyBranchInput,
  type SimplifyBranchOutput
} from "../schemas/simplify-branch";
import type { AiProvider } from "../types";
import { validateAndMapSimplifyBranch } from "../validation/validate-simplify-branch";

export interface RunSimplifyBranchOptions {
  context?: SimplifyBranchContext | undefined;
  maxTokens?: number | undefined;
  signal?: AbortSignal | undefined;
}

export async function runSimplifyBranch(
  provider: AiProvider,
  project: VdtProject,
  branchRootNodeId: string,
  options?: RunSimplifyBranchOptions
): Promise<VdtChangeSet> {
  const input = buildSimplifyBranchInput(project, branchRootNodeId, options?.context);

  const rawOutput = await provider.completeStructured<SimplifyBranchInput, SimplifyBranchOutput>({
    taskType: "simplify_branch",
    input,
    schema: simplifyBranchOutputSchema,
    systemPrompt: simplifyBranchSystemPrompt,
    userPrompt: buildSimplifyBranchPrompt(input),
    temperature: 0.2,
    ...(options?.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
    ...(options?.signal ? { signal: options.signal } : {})
  });

  const { changeSet } = validateAndMapSimplifyBranch(project, rawOutput, branchRootNodeId, provider.id);
  return changeSet;
}
