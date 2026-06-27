import { z } from "zod";
import type { AgentTool } from "../tool-registry";
import { agentQuestionSchema } from "../schemas/agent-event";

export function createUserTools(): AgentTool[] {
  return [askUserTool, showStatusTool, requestApprovalTool];
}

const askUserTool: AgentTool = {
  name: "user.ask",
  description: "Pause the run and ask required user questions.",
  inputSchema: z.object({
    questions: z.array(agentQuestionSchema).min(1).max(5)
  }),
  outputSchema: z.object({ status: z.literal("needs_user_input") }),
  phase: "asking_clarifying_questions",
  run(context, input) {
    context.store.updateRun(context.runId, {
      status: "needs_user_input",
      phase: "asking_clarifying_questions",
      pendingQuestions: input.questions
    });
    context.emit({
      type: "clarifying_questions",
      phase: "asking_clarifying_questions",
      title: "Clarifying questions",
      message: `Agent needs ${input.questions.length} answer${input.questions.length === 1 ? "" : "s"} before continuing.`,
      questions: input.questions
    });
    return { status: "needs_user_input" };
  }
};

const showStatusTool: AgentTool = {
  name: "user.show_status",
  description: "Show a visible non-mutating status update to the user.",
  inputSchema: z.object({
    title: z.string().min(1).max(200),
    message: z.string().min(1).max(1_000),
    level: z.enum(["info", "warning", "success"]).optional()
  }),
  outputSchema: z.object({ ok: z.literal(true) }),
  phase: "planning_decomposition",
  run(context, input) {
    context.emit({
      type: "tool_call_completed",
      phase: context.store.getState(context.runId).phase,
      title: input.title,
      message: input.message,
      metadata: { level: input.level ?? "info", toolName: "user.show_status" }
    });
    return { ok: true };
  }
};

const requestApprovalTool: AgentTool = {
  name: "user.request_approval",
  description: "Pause the run for user approval.",
  inputSchema: z.object({
    title: z.string().min(1).max(200),
    message: z.string().min(1).max(1_000),
    changeSetId: z.string().max(160).optional(),
    selectedChangeIds: z.array(z.string().max(160)).max(50).optional(),
    changeSet: z.unknown().optional(),
    plan: z.unknown().optional()
  }),
  outputSchema: z.object({ status: z.literal("waiting_approval") }),
  phase: "planning_decomposition",
  run(context, input) {
    context.store.updateRun(context.runId, {
      status: "waiting_approval",
      phase: "planning_decomposition",
      pendingChangeSet: input.changeSet as never,
      pendingPlan: input.plan as never
    });
    context.emit({
      type: "plan_proposed",
      phase: "planning_decomposition",
      title: input.title,
      message: input.message,
      metadata: {
        changeSetId: input.changeSetId,
        selectedChangeIds: input.selectedChangeIds ?? []
      }
    });
    return { status: "waiting_approval" };
  }
};
