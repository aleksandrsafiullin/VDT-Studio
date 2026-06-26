import { generateVdtOutputSchema, type GenerateVdtOutput } from "./schemas/generate-vdt";
import { buildGenerateVdtPrompt, generateVdtSystemPrompt } from "./prompts/generate-vdt";
import { generateVdtOutputToProject } from "./validation/to-project";
import type { AiProvider, GenerateVdtInput } from "./types";
import { validateGraph, type VdtProject } from "@vdt-studio/vdt-core";
import {
  appendAgenticVdtRunEvent,
  finalizeAgenticVdtRun,
  loadDefaultSkillLibrary,
  prepareAgenticVdtRun,
  type VdtAgentRun
} from "@vdt-studio/vdt-agent";

export interface GenerateAgenticVdtProjectResult {
  project: VdtProject;
  agentRun: VdtAgentRun;
}

export async function generateVdtProject(
  provider: AiProvider,
  input: GenerateVdtInput,
  options?: { maxTokens?: number | undefined }
): Promise<VdtProject> {
  const { project } = await generateAgenticVdtProject(provider, input, options);
  return project;
}

export async function generateAgenticVdtProject(
  provider: AiProvider,
  input: GenerateVdtInput,
  options?: { maxTokens?: number | undefined }
): Promise<GenerateAgenticVdtProjectResult> {
  const library = await loadDefaultSkillLibrary();
  const prepared = prepareAgenticVdtRun(input, library);
  const runWithStart = appendAgenticVdtRunEvent(
    prepared.run,
    {
      type: "model_call_started",
      title: "Model call started",
      message: `Generating graph from ${prepared.skillExcerpts.length} selected skill${prepared.skillExcerpts.length === 1 ? "" : "s"}.`,
      metadata: {
        providerId: provider.id,
        selectedSkillIds: prepared.prompt.decompositionPlan.selectedSkillIds
      }
    },
    { phase: "generating_graph" }
  );
  const output = await provider.completeStructured<GenerateVdtInput, GenerateVdtOutput>({
    taskType: "generate_tree",
    input,
    schema: generateVdtOutputSchema,
    systemPrompt: `${generateVdtSystemPrompt}\n\n${prepared.prompt.systemPromptAddition}`,
    userPrompt: `${buildGenerateVdtPrompt(input)}\n\n${prepared.prompt.userPromptAddition}`,
    temperature: 0.2,
    ...(options?.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {})
  });

  const project = generateVdtOutputToProject(output, input, provider.id);
  const validation = validateGraph(project.graph, project.rootNodeId);
  const validationSummary = validation.valid && validation.warnings.length === 0
    ? `Graph validation passed: ${project.graph.nodes.length} nodes, ${project.graph.edges.length} decomposition edges.`
    : `Graph validation completed with ${validation.errors.length} errors and ${validation.warnings.length} warnings.`;
  const agentRun = finalizeAgenticVdtRun(runWithStart, {
    resultProjectId: project.id,
    finalReport: buildFinalReport(prepared.prompt.finalReportSeed, validationSummary),
    validationSummary,
    draftGraph: output
  });

  return { project, agentRun };
}

function buildFinalReport(seed: string, validationSummary: string): string {
  return seed.replace("Validation result: pending graph generation and validator execution.", `Validation result: ${validationSummary}`);
}
