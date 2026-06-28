import { z } from "zod";
import type { AgentTool } from "../tool-registry";

const subagentTaskTypeSchema = z.enum([
  "brief_alignment",
  "domain_decomposition",
  "formula_generation",
  "unit_validation",
  "model_critique",
  "memory_curation"
]);

export function createSubagentTools(): AgentTool[] {
  return [createTaskTool, recordReportTool];
}

const createTaskTool: AgentTool = {
  name: "subagent.create_task",
  description: "Create an internal subagent task. Subagents are internal and never speak directly to the user.",
  inputSchema: z.object({
    type: subagentTaskTypeSchema,
    inputArtifactId: z.string().min(1).max(160),
    publicStatus: z.string().max(300).optional(),
    timeoutMs: z.number().int().min(1_000).max(120_000).optional()
  }),
  outputSchema: z.record(z.unknown()),
  phase: "planning_decomposition",
  run(context, input) {
    const state = context.store.getState(context.runId);
    const now = new Date().toISOString();
    const task = {
      id: `${context.runId}:subagent:${(state.subagentTasks?.length ?? 0) + 1}`,
      runId: context.runId,
      type: input.type,
      status: "queued" as const,
      inputArtifactId: input.inputArtifactId,
      ...(input.publicStatus ? { publicStatus: input.publicStatus } : {}),
      timeoutMs: input.timeoutMs ?? 60_000,
      retryCount: 0
    };
    context.store.updateRun(context.runId, {
      subagentTasks: [...(state.subagentTasks ?? []), task]
    });
    context.emit({
      type: "tool_call_completed",
      phase: "planning_decomposition",
      title: "Internal subagent task queued",
      message: input.publicStatus ?? `Queued ${input.type.replaceAll("_", " ")} task.`,
      metadata: { taskId: task.id, subagentType: input.type, internal: true, createdAt: now }
    });
    return task;
  }
};

const recordReportTool: AgentTool = {
  name: "subagent.record_report",
  description: "Record a compact internal subagent report for the orchestrator context.",
  inputSchema: z.object({
    taskId: z.string().min(1).max(200),
    status: z.enum(["succeeded", "needs_user_input", "failed_retryable", "failed"]),
    summaryForOrchestrator: z.string().min(1).max(2_000),
    userFacingSummary: z.string().max(800).optional(),
    proposedQuestions: z.array(z.unknown()).max(5).optional(),
    proposedPatchArtifactId: z.string().max(160).optional(),
    proposedProjectArtifactId: z.string().max(160).optional(),
    assumptions: z.array(z.string().max(300)).max(20).optional(),
    risks: z.array(z.string().max(300)).max(20).optional(),
    confidence: z.number().min(0).max(1).optional()
  }),
  outputSchema: z.record(z.unknown()),
  phase: "planning_decomposition",
  run(context, input) {
    const state = context.store.getState(context.runId);
    const completedAt = new Date().toISOString();
    const report = {
      taskId: input.taskId,
      status: input.status,
      summaryForOrchestrator: input.summaryForOrchestrator,
      ...(input.userFacingSummary ? { userFacingSummary: input.userFacingSummary } : {}),
      ...(input.proposedPatchArtifactId ? { proposedPatchArtifactId: input.proposedPatchArtifactId } : {}),
      ...(input.proposedProjectArtifactId ? { proposedProjectArtifactId: input.proposedProjectArtifactId } : {}),
      ...(input.assumptions ? { assumptions: input.assumptions } : {}),
      ...(input.risks ? { risks: input.risks } : {}),
      ...(input.confidence !== undefined ? { confidence: input.confidence } : {})
    };
    context.store.updateRun(context.runId, {
      subagentReports: [...(state.subagentReports ?? []), report],
      subagentTasks: (state.subagentTasks ?? []).map((task) =>
        task.id === input.taskId
          ? {
              ...task,
              status: input.status === "failed_retryable" ? "failed_retryable" : input.status === "failed" ? "failed" : "succeeded",
              completedAt
            }
          : task
      )
    });
    context.emit({
      type: "tool_call_completed",
      phase: "planning_decomposition",
      title: "Internal subagent report recorded",
      message: "Recorded a compact internal report for the orchestrator.",
      metadata: { taskId: input.taskId, status: input.status, internal: true }
    });
    return report;
  }
};

