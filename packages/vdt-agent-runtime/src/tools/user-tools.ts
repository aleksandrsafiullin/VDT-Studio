import { z } from "zod";
import type { AgentTool } from "../tool-registry";
import { agentQuestionSchema } from "../schemas/agent-event";

export function createUserTools(): AgentTool[] {
  return [askUserTool, requestApprovalTool];
}

const askUserTool: AgentTool = {
  name: "user.ask",
  description: "Pause the run and ask required user questions.",
  inputSchema: z.object({
    questions: z.array(agentQuestionSchema).min(1).max(5)
  }),
  outputSchema: z.object({ status: z.literal("needs_user_input") }),
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

const requestApprovalTool: AgentTool = {
  name: "user.request_approval",
  description: "Pause the run for user approval.",
  inputSchema: z.object({
    title: z.string().min(1).max(200),
    message: z.string().min(1).max(1_000),
    changeSet: z.unknown().optional(),
    plan: z.unknown().optional()
  }),
  outputSchema: z.object({ status: z.literal("waiting_approval") }),
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
      message: input.message
    });
    return { status: "waiting_approval" };
  }
};
