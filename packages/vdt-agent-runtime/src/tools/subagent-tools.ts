import { z } from "zod";
import { calculateGraph, validateGraph, type VdtProject } from "@vdt-studio/vdt-core";
import { AgentToolError, type AgentTool, type AgentToolContext } from "../tool-registry";
import { summarizeCalculation, summarizeValidation } from "../summaries";
import type { SubagentReport, SubagentTask, VdtAgentRunState } from "../types";

const subagentTaskTypeSchema = z.enum([
  "brief_alignment",
  "level_decomposition",
  "formula_builder",
  "critic",
  "memory_curator"
]);

export function createSubagentTools(): AgentTool[] {
  return [createTaskTool];
}

const createTaskTool: AgentTool = {
  name: "subagent.create_task",
  description: "Create and execute a bounded internal subagent task. Subagents return compact reports and never mutate the VDT.",
  inputSchema: z.object({
    type: subagentTaskTypeSchema,
    inputArtifactId: z.string().min(1).max(160).optional(),
    objective: z.string().max(600).optional(),
    targetNodeId: z.string().max(160).optional(),
    publicStatus: z.string().max(300).optional(),
    timeoutMs: z.number().int().min(1_000).max(120_000).optional()
  }),
  outputSchema: z.record(z.unknown()),
  phase: "planning_decomposition",
  run(context, input) {
    if (context.signal.aborted) {
      throw new AgentToolError("SUBAGENT_CANCELLED", "Subagent task was cancelled before it started.");
    }

    const state = context.store.getState(context.runId);
    const now = new Date().toISOString();
    const taskNumber = (state.subagentTasks?.length ?? 0) + 1;
    const task: SubagentTask = {
      id: `${context.runId}:subagent:${taskNumber}`,
      runId: context.runId,
      type: input.type,
      status: "queued",
      inputArtifactId: input.inputArtifactId ?? `subagent_input_${taskNumber}`,
      ...(input.publicStatus ? { publicStatus: input.publicStatus } : {}),
      timeoutMs: input.timeoutMs ?? 60_000,
      retryCount: 0
    };

    context.store.updateRun(context.runId, {
      subagentTasks: [...(state.subagentTasks ?? []), task]
    });
    context.emit({
      type: "tool_call_started",
      phase: "planning_decomposition",
      title: "Internal subagent task started",
      message: input.publicStatus ?? `Running ${input.type.replaceAll("_", " ")} task.`,
      metadata: { taskId: task.id, subagentType: input.type, internal: true, createdAt: now }
    });

    const startedAt = new Date().toISOString();
    updateTask(context, task.id, {
      status: "running",
      startedAt,
      heartbeatAt: startedAt
    });

    const runningState = context.store.getState(context.runId);
    const report = runBoundedSubagent(runningState, {
      task: { ...task, status: "running", startedAt, heartbeatAt: startedAt },
      objective: input.objective,
      targetNodeId: input.targetNodeId
    });
    const completedAt = new Date().toISOString();
    const terminalTaskStatus = report.status === "failed_retryable"
      ? "failed_retryable"
      : report.status === "failed"
        ? "failed"
        : "succeeded";

    const latest = context.store.getState(context.runId);
    context.store.updateRun(context.runId, {
      subagentReports: [...(latest.subagentReports ?? []), report],
      subagentTasks: (latest.subagentTasks ?? []).map((candidate) =>
        candidate.id === task.id
          ? {
              ...candidate,
              status: terminalTaskStatus,
              completedAt,
              heartbeatAt: completedAt
            }
          : candidate
      )
    });
    context.emit({
      type: "tool_call_completed",
      phase: "planning_decomposition",
      title: "Internal subagent report ready",
      message: report.summaryForOrchestrator,
      metadata: {
        taskId: task.id,
        subagentType: input.type,
        status: report.status,
        confidence: report.confidence,
        internal: true
      }
    });

    return { taskId: task.id, report };
  }
};

function updateTask(
  context: AgentToolContext,
  taskId: string,
  patch: Partial<Omit<SubagentTask, "id" | "runId" | "type" | "inputArtifactId" | "timeoutMs" | "retryCount">>
): void {
  const state = context.store.getState(context.runId);
  context.store.updateRun(context.runId, {
    subagentTasks: (state.subagentTasks ?? []).map((task) =>
      task.id === taskId ? { ...task, ...patch } : task
    )
  });
}

function runBoundedSubagent(
  state: VdtAgentRunState,
  input: {
    task: SubagentTask;
    objective?: string | undefined;
    targetNodeId?: string | undefined;
  }
): SubagentReport {
  const project = state.builder?.getProject() ?? state.draftProject ?? state.project ?? state.request.input.project;
  switch (input.task.type) {
    case "brief_alignment":
      return briefAlignmentReport(state, input.task, project, input.objective);
    case "level_decomposition":
      return levelDecompositionReport(state, input.task, project, input.targetNodeId, input.objective);
    case "formula_builder":
      return formulaBuilderReport(input.task, project, input.targetNodeId);
    case "critic":
      return criticReport(input.task, project);
    case "memory_curator":
      return memoryCuratorReport(state, input.task, project);
  }
}

function briefAlignmentReport(
  state: VdtAgentRunState,
  task: SubagentTask,
  project: VdtProject | undefined,
  objective: string | undefined
): SubagentReport {
  const briefRoot = state.visibleContext.brief.rootKpi;
  const rootNode = project?.graph.nodes.find((node) => node.id === project.rootNodeId);
  const risks: string[] = [];
  if (rootNode && rootNode.name.toLowerCase() !== briefRoot.toLowerCase()) {
    risks.push(`Draft root "${rootNode.name}" differs from visible brief "${briefRoot}".`);
  }
  if (!state.request.input.prompt && !state.request.input.businessContext) {
    risks.push("User brief has limited business context.");
  }
  return {
    taskId: task.id,
    status: risks.some((risk) => risk.includes("differs")) ? "needs_user_input" : "succeeded",
    summaryForOrchestrator: [
      `Brief root KPI is "${briefRoot}".`,
      rootNode ? `Draft root is "${rootNode.name}".` : "No draft root exists yet.",
      objective ? `Objective: ${objective}` : ""
    ].filter(Boolean).join(" "),
    assumptions: [
      ...state.selectedSkills.slice(0, 3).map((skill) => `Selected skill: ${skill.id}`),
      ...(state.visibleContext.brief.unit ? [`Unit: ${state.visibleContext.brief.unit}`] : [])
    ],
    ...(risks.length > 0 ? { risks } : {}),
    confidence: risks.length > 0 ? 0.62 : 0.86
  };
}

function levelDecompositionReport(
  state: VdtAgentRunState,
  task: SubagentTask,
  project: VdtProject | undefined,
  targetNodeId: string | undefined,
  objective: string | undefined
): SubagentReport {
  if (!project) {
    return noProjectReport(task, "Level decomposition cannot run before a draft VDT exists.");
  }
  const childrenByParent = childrenByParentMap(project);
  const target = targetNodeId
    ? project.graph.nodes.find((node) => node.id === targetNodeId)
    : project.graph.nodes.find((node) => node.id === project.rootNodeId);
  if (!target) {
    return {
      taskId: task.id,
      status: "failed_retryable",
      summaryForOrchestrator: `Target node "${targetNodeId ?? project.rootNodeId}" was not found for level decomposition.`,
      risks: ["The orchestrator should select an existing node before requesting decomposition critique."],
      confidence: 0.35
    };
  }
  const childIds = childrenByParent.get(target.id) ?? [];
  const leafCandidates = project.graph.nodes
    .filter((node) => (childrenByParent.get(node.id)?.length ?? 0) === 0)
    .slice(0, 8)
    .map((node) => node.id);
  return {
    taskId: task.id,
    status: "succeeded",
    summaryForOrchestrator: [
      `Target "${target.name}" has ${childIds.length} direct child driver${childIds.length === 1 ? "" : "s"}.`,
      childIds.length === 0 ? "It is a candidate for the next visible layer." : `Existing child ids: ${childIds.slice(0, 8).join(", ")}.`,
      leafCandidates.length > 0 ? `Current frontier candidates: ${leafCandidates.join(", ")}.` : "",
      objective ? `Objective: ${objective}` : "",
      state.progressiveBuild ? `Progressive depth is ${state.progressiveBuild.currentDepth}.` : ""
    ].filter(Boolean).join(" "),
    assumptions: ["Subagent reviewed structure only; it did not create a patch."],
    confidence: childIds.length === 0 ? 0.78 : 0.72
  };
}

function formulaBuilderReport(
  task: SubagentTask,
  project: VdtProject | undefined,
  targetNodeId: string | undefined
): SubagentReport {
  if (!project) return noProjectReport(task, "Formula builder cannot run before a draft VDT exists.");
  const nodes = targetNodeId
    ? project.graph.nodes.filter((node) => node.id === targetNodeId)
    : project.graph.nodes;
  if (targetNodeId && nodes.length === 0) {
    return {
      taskId: task.id,
      status: "failed_retryable",
      summaryForOrchestrator: `Target node "${targetNodeId}" was not found for formula review.`,
      confidence: 0.35
    };
  }
  const missingFormula = nodes
    .filter((node) => node.type === "calculated" && !node.formula?.trim())
    .map((node) => node.id)
    .slice(0, 10);
  const missingValues = nodes
    .filter((node) => node.type === "input" && node.baselineValue === undefined && node.value === undefined)
    .map((node) => node.id)
    .slice(0, 10);
  return {
    taskId: task.id,
    status: missingValues.length > 0 ? "needs_user_input" : "succeeded",
    summaryForOrchestrator: [
      missingFormula.length > 0
        ? `Calculated nodes missing formulas: ${missingFormula.join(", ")}.`
        : "No missing calculated-node formulas found in the bounded review.",
      missingValues.length > 0
        ? `Input nodes missing values: ${missingValues.join(", ")}.`
        : "No missing input values found in the bounded review."
    ].join(" "),
    assumptions: ["Formula subagent proposed no graph mutation; orchestrator must use VDT tools for any changes."],
    confidence: missingFormula.length > 0 || missingValues.length > 0 ? 0.7 : 0.84
  };
}

function criticReport(task: SubagentTask, project: VdtProject | undefined): SubagentReport {
  if (!project) return noProjectReport(task, "Critic cannot run before a draft VDT exists.");
  const validation = summarizeValidation(validateGraph(project));
  const calculation = validation.valid ? summarizeCalculation(calculateGraph(project)) : undefined;
  const risks = [
    ...validation.errors.map((issue) => issue.message),
    ...validation.warnings.slice(0, 5).map((issue) => issue.message),
    ...(calculation?.errors.slice(0, 5).map((issue) => issue.message) ?? [])
  ];
  return {
    taskId: task.id,
    status: validation.valid && (calculation?.errors.length ?? 0) === 0 ? "succeeded" : "needs_user_input",
    summaryForOrchestrator: [
      validation.valid
        ? `Validation passed with ${validation.warnings.length} warning${validation.warnings.length === 1 ? "" : "s"}.`
        : `Validation has ${validation.errors.length} error${validation.errors.length === 1 ? "" : "s"}.`,
      calculation
        ? `Calculation has ${calculation.valueCount} computed value${calculation.valueCount === 1 ? "" : "s"}.`
        : "Calculation was skipped because validation is not clean."
    ].join(" "),
    ...(risks.length > 0 ? { risks } : {}),
    confidence: validation.valid ? 0.88 : 0.68
  };
}

function memoryCuratorReport(
  state: VdtAgentRunState,
  task: SubagentTask,
  project: VdtProject | undefined
): SubagentReport {
  const answerKeys = Object.keys(state.answers);
  const nodeCount = project?.graph.nodes.length ?? 0;
  return {
    taskId: task.id,
    status: "succeeded",
    summaryForOrchestrator: [
      `Keep root KPI "${state.visibleContext.brief.rootKpi}" as the durable brief anchor.`,
      project ? `Current draft has ${nodeCount} node${nodeCount === 1 ? "" : "s"}.` : "No draft project exists yet.",
      answerKeys.length > 0 ? `User provided answers for: ${answerKeys.slice(0, 10).join(", ")}.` : "No structured user answers have been recorded."
    ].join(" "),
    assumptions: state.memoryNotes.slice(-5).map((note) => note.note),
    confidence: 0.8
  };
}

function noProjectReport(task: SubagentTask, message: string): SubagentReport {
  return {
    taskId: task.id,
    status: "failed_retryable",
    summaryForOrchestrator: message,
    risks: ["Run this subagent again after creating a draft project."],
    confidence: 0.4
  };
}

function childrenByParentMap(project: VdtProject): Map<string, string[]> {
  const childrenByParent = new Map<string, string[]>();
  for (const edge of project.graph.edges) {
    childrenByParent.set(edge.sourceNodeId, [...(childrenByParent.get(edge.sourceNodeId) ?? []), edge.targetNodeId]);
  }
  return childrenByParent;
}
