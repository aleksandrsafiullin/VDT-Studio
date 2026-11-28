import { z } from "zod";
import { AgentToolError, type AgentTool } from "../tool-registry";
import { normalizeUserQuestions, publicStatusForPhase } from "../chat-messages";
import { agentQuestionSchema } from "../schemas/agent-event";
import { confirmConversationDecisionProposal, isReservedConfirmationQuestionId } from "../conversation-decision-proposal";

export function createUserTools(): AgentTool[] {
  return [askUserTool, showStatusTool, requestApprovalTool];
}

const askInput = z.object({ questions: z.array(agentQuestionSchema).min(1).max(5) });

const askUserTool: AgentTool<z.infer<typeof askInput>> = {
  name: "user.ask",
  description: "Pause the run and ask required user questions. Use a bounded decisionProposal on one question to request confirmation of a definition in the latest submitted user message.",
  inputSchema: askInput,
  outputSchema: z.object({ status: z.literal("needs_user_input"), questions: z.array(agentQuestionSchema).optional() }),
  phase: "asking_clarifying_questions",
  run(context, input) {
    const received = input.questions;
    const proposal = received.find(question => question.decisionProposal)?.decisionProposal;
    if ((proposal && received.length !== 1) || received.some(question => isReservedConfirmationQuestionId(question.id))) {
      throw new AgentToolError("DECISION_CONFIRMATION_INVALID", "Use a single decision proposal. Confirmation question IDs are created by the workspace.");
    }
    const state = context.store.getState(context.runId);
    let questions;
    if (proposal) {
      const workspace = state.request.workspace;
      const conversationId = state.request.conversationId;
      const source = state.chatMessages.slice().reverse().find(message => message.runId === context.runId && message.role === "user");
      const confirmation = workspace?.vdtId && conversationId && source
        ? confirmConversationDecisionProposal(source, proposal, proposal.language, {
          projectId: workspace.projectId, vdtId: workspace.vdtId, conversationId
        })
        : undefined;
      if (!confirmation) throw new AgentToolError("DECISION_EVIDENCE_UNCONFIRMED", "Quote the latest submitted user text from this saved conversation verbatim.");
      questions = [confirmation];
      if (state.request.executionBindingId
        && (state.request.providerId === "model_agent" || state.request.providerId === "external_cli_agent")) {
        // The Supervisor publishes the form with the question-set ID needed
        // to accept the answer. The phase reports the pause to the Gateway.
        context.store.updateRun(context.runId, { status: "needs_user_input", phase: "asking_clarifying_questions" });
        return { status: "needs_user_input", questions };
      }
    } else {
      questions = normalizeUserQuestions(received.map(({ decisionProposal: _proposal, ...question }) => question));
    }
    context.store.updateRun(context.runId, {
      status: "needs_user_input",
      phase: "asking_clarifying_questions",
      pendingQuestions: questions
    });
    context.store.appendChatMessage(context.runId, {
      role: "assistant",
      kind: "question",
      questions
    });
    context.store.updatePublicStatus(context.runId, publicStatusForPhase("asking_clarifying_questions", "Waiting for your answer."));
    context.emit({
      type: "clarifying_questions",
      phase: "asking_clarifying_questions",
      title: "Clarifying questions",
      message: `Agent needs ${questions.length} answer${questions.length === 1 ? "" : "s"} before continuing.`,
      questions
    });
    return { status: "needs_user_input", ...(proposal ? { questions } : {}) };
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
    const state = context.store.getState(context.runId);
    const updated = context.store.updatePublicStatus(context.runId, publicStatusForPhase(state.phase, input.message));
    context.store.appendChatMessage(context.runId, {
      role: "assistant",
      kind: "status",
      text: input.message,
      status: updated.publicStatus
    });
    context.emit({
      type: "tool_call_completed",
      phase: state.phase,
      title: input.title,
      message: input.message,
      metadata: { level: input.level ?? "info", toolName: "user.show_status" }
    });
    context.emit({
      type: "assistant_message",
      phase: state.phase,
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
    const state = context.store.getState(context.runId);
    const approvalText = [input.title, input.message].filter(Boolean).join("\n\n");
    context.store.updateRun(context.runId, {
      status: "waiting_approval",
      phase: "planning_decomposition",
      pendingChangeSet: input.changeSet as never,
      pendingPlan: input.plan as never
    });
    context.store.appendChatMessage(context.runId, {
      role: "assistant",
      kind: "assistant_message",
      text: approvalText
    });
    context.store.updatePublicStatus(
      context.runId,
      publicStatusForPhase("planning_decomposition", input.message)
    );
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
    context.emit({
      type: "assistant_message",
      phase: state.phase,
      title: input.title,
      message: input.message,
      metadata: { toolName: "user.request_approval" }
    });
    return { status: "waiting_approval" };
  }
};
