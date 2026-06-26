import type { VdtChangeSet, VdtProject } from "@vdt-studio/vdt-core";
import {
  appendAgenticVdtRunEvent,
  loadDefaultSkillLibrary,
  prepareAgenticVdtRun,
  type GenerateVdtInputLike,
  type VdtAgentRun
} from "@vdt-studio/vdt-agent";
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

export interface RunAgenticDeepenNodeResult {
  changeSet: VdtChangeSet;
  agentRun: VdtAgentRun;
}

export async function runDeepenNode(
  provider: AiProvider,
  project: VdtProject,
  nodeId: string,
  options?: RunDeepenNodeOptions
): Promise<VdtChangeSet> {
  const { changeSet } = await runAgenticDeepenNode(provider, project, nodeId, options);
  return changeSet;
}

export async function runAgenticDeepenNode(
  provider: AiProvider,
  project: VdtProject,
  nodeId: string,
  options?: RunDeepenNodeOptions
): Promise<RunAgenticDeepenNodeResult> {
  const input = buildDeepenNodeInput(project, nodeId, options?.context);
  const library = await loadDefaultSkillLibrary();
  const prepared = prepareAgenticVdtRun(deepenAgentRequest(project, input), library);
  const runWithStart = appendAgenticVdtRunEvent(
    prepared.run,
    {
      type: "model_call_started",
      title: "Deepen model call started",
      message: `Generating patch from ${prepared.skillExcerpts.length} selected skill${prepared.skillExcerpts.length === 1 ? "" : "s"}.`,
      metadata: {
        providerId: provider.id,
        targetNodeId: nodeId,
        selectedSkillIds: prepared.prompt.decompositionPlan.selectedSkillIds
      }
    },
    { phase: "generating_graph" }
  );

  const rawOutput = await provider.completeStructured<DeepenNodeInput, DeepenNodeOutput>({
    taskType: "deepen_node",
    input,
    schema: deepenNodeOutputSchema,
    systemPrompt: `${deepenNodeSystemPrompt}\n\n${prepared.prompt.systemPromptAddition}`,
    userPrompt: `${buildDeepenNodePrompt(input)}\n\n${prepared.prompt.userPromptAddition}`,
    temperature: 0.2,
    ...(options?.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
    ...(options?.signal ? { signal: options.signal } : {})
  });

  const { changeSet, output } = validateAndMapDeepenNode(project, rawOutput, nodeId, provider.id);
  const validationSummary = `Graph patch validation passed: ${output.nodes.length} node${output.nodes.length === 1 ? "" : "s"}, ${output.edges.length} edge${output.edges.length === 1 ? "" : "s"}.`;
  const agentRun = finalizeDeepenAgentRun(runWithStart, {
    targetNodeId: nodeId,
    changeSetId: changeSet.id,
    validationSummary,
    finalReport: buildDeepenFinalReport(prepared.prompt.finalReportSeed, validationSummary, changeSet),
    draftGraph: output
  });

  return { changeSet, agentRun };
}

function deepenAgentRequest(project: VdtProject, input: DeepenNodeInput): GenerateVdtInputLike {
  const targetNode = project.graph.nodes.find((node) => node.id === input.targetNodeId);
  const rootNode = project.graph.nodes.find((node) => node.id === project.rootNodeId);
  return {
    rootKpi: targetNode?.name ?? input.targetNodeId,
    ...(input.industry ? { industry: input.industry } : {}),
    businessContext: [
      input.businessContext,
      rootNode?.name ? `Root KPI: ${rootNode.name}` : undefined,
      targetNode?.description ? `Target description: ${targetNode.description}` : undefined
    ].filter(Boolean).join("\n"),
    ...(targetNode?.unit ? { unit: targetNode.unit } : {}),
    ...(input.context?.goal ? { goal: input.context.goal } : {})
  };
}

function finalizeDeepenAgentRun(
  run: VdtAgentRun,
  input: {
    targetNodeId: string;
    changeSetId: string;
    validationSummary: string;
    finalReport: string;
    draftGraph: DeepenNodeOutput;
  }
): VdtAgentRun {
  const withPatch = appendAgenticVdtRunEvent(
    run,
    {
      type: "graph_patch",
      title: "Graph patch prepared",
      message: "Deepen operation returned a candidate change set payload.",
      metadata: { targetNodeId: input.targetNodeId, changeSetId: input.changeSetId }
    },
    { phase: "validating_graph" }
  );
  const withValidation = appendAgenticVdtRunEvent(
    withPatch,
    {
      type: "graph_validation",
      title: "Graph patch validation completed",
      message: input.validationSummary,
      metadata: { targetNodeId: input.targetNodeId, changeSetId: input.changeSetId }
    },
    { phase: "applying_graph" }
  );
  const withReport = appendAgenticVdtRunEvent(
    withValidation,
    {
      type: "final_report",
      title: "Deepen report prepared",
      message: "Prepared deepen run report after graph patch validation.",
      metadata: { targetNodeId: input.targetNodeId, changeSetId: input.changeSetId }
    },
    { phase: "reporting", status: "succeeded" }
  );
  return {
    ...withReport,
    resultProjectId: input.changeSetId,
    finalReport: input.finalReport,
    draftGraph: input.draftGraph
  };
}

function buildDeepenFinalReport(seed: string, validationSummary: string, changeSet: VdtChangeSet): string {
  return [
    seed.replace("Validation result: pending graph generation and validator execution.", `Validation result: ${validationSummary}`),
    `Patch result: ${changeSet.additions.length} additions and ${changeSet.warnings.length} warnings.`,
    "Recommended next deepen action: review the proposed child nodes before applying the change set."
  ].join("\n");
}
