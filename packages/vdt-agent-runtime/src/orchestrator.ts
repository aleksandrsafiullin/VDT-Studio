import {
  calculateGraph,
  VdtBuilderSession,
  type VdtNodePatch
} from "@vdt-studio/vdt-core";
import {
  answerRecordFromPayloads,
  answerPayloadsFromRecord,
  describeAnswerPayloads,
  normalizeUserQuestions,
  publicStatusForPhase
} from "./chat-messages";
import { AGENT_DECISION_SYSTEM_PROMPT } from "./prompts/agent-decision";
import { AGENT_FIRST_RESPONSE_SYSTEM_PROMPT } from "./prompts/agent-first-response";
import { AgentRunStore } from "./run-store";
import { agentDecisionSchema, parseAndGuardAgentDecision, type AgentDecision } from "./schemas/agent-decision";
import { firstResponseSchema, type FirstResponseInput, type FirstResponseOutput } from "./schemas/agent-first-response";
import { ToolRegistry, type AgentToolContext } from "./tool-registry";
import { createDefaultToolRegistry } from "./tools";
import {
  summarizeCalculation,
  summarizeEvents,
  summarizeManualChanges,
  summarizeNode,
  summarizeProject,
  summarizeValidation
} from "./summaries";
import type {
  AgentDecisionContext,
  AgentToolResultEnvelope,
  AgentUserMessage,
  ManualProjectChange,
  ValidationStateSummary,
  VdtAgentRunPhase,
  VdtAgentRunSnapshot,
  VdtAgentRunState,
  VdtAgentStartRequest
} from "./types";

export interface AgentDecisionProvider {
  id: string;
  completeStructured<TInput, TOutput>(params: {
    taskType: "orchestrator_first_response" | "agent_decision";
    input: TInput;
    schema: unknown;
    systemPrompt: string;
    userPrompt: string;
    model?: string | undefined;
    temperature?: number | undefined;
    maxTokens?: number | undefined;
    signal?: AbortSignal | undefined;
  }): Promise<TOutput>;
}

export type AgentPlanningProvider = AgentDecisionProvider;

export interface VdtAgentRuntimeOptions {
  store?: AgentRunStore | undefined;
  tools?: ToolRegistry | undefined;
}

export interface VdtAgentExecutionOptions {
  provider?: AgentDecisionProvider | undefined;
  maxTokens?: number | undefined;
}

export class VdtAgentRuntime {
  readonly store: AgentRunStore;
  readonly tools: ToolRegistry;

  constructor(options: VdtAgentRuntimeOptions = {}) {
    this.store = options.store ?? new AgentRunStore();
    this.tools = options.tools ?? createDefaultToolRegistry();
  }

  async startRun(
    request: VdtAgentStartRequest,
    execution: VdtAgentExecutionOptions = {}
  ): Promise<VdtAgentRunSnapshot> {
    const state = this.initializeRun(request);
    await this.executeRun(state.runId, execution);
    return this.store.getSnapshot(state.runId);
  }

  startRunInBackground(
    request: VdtAgentStartRequest,
    execution: VdtAgentExecutionOptions = {}
  ): VdtAgentRunSnapshot {
    const state = this.initializeRun(request);
    void this.executeRun(state.runId, execution);
    return this.store.getSnapshot(state.runId);
  }

  handleMessageInBackground(
    runId: string,
    message: AgentUserMessage,
    execution: VdtAgentExecutionOptions = {}
  ): VdtAgentRunSnapshot {
    const task = this.handleMessage(runId, message, execution);
    void task.catch((error) => {
      this.failRun(
        runId,
        error,
        "MESSAGE_FAILED",
        "Message processing failed",
        "Agent run failed while processing the user message."
      );
    });
    return this.store.getSnapshot(runId);
  }

  async handleMessage(
    runId: string,
    message: AgentUserMessage,
    execution: VdtAgentExecutionOptions = {}
  ): Promise<VdtAgentRunSnapshot> {
    const state = this.store.getState(runId);
    if (state.status === "cancelled" || state.status === "failed" || state.status === "succeeded") {
      if (message.type !== "manual_project_change") {
        return this.store.getSnapshot(runId);
      }
    }

    if (message.type === "user_answer") {
      const answerPayloads = message.structuredAnswers && message.structuredAnswers.length > 0
        ? message.structuredAnswers
        : answerPayloadsFromRecord(message.answers ?? {});
      const answerRecord = {
        ...(message.answers ?? {}),
        ...answerRecordFromPayloads(answerPayloads)
      };
      const answeredContext = answersToContext(answerRecord);
      this.store.updateRun(runId, {
        status: "running",
        phase: "planning_decomposition",
        pendingQuestions: undefined,
        retryableError: undefined,
        answers: { ...state.answers, ...answerRecord },
        request: {
          ...state.request,
          input: {
            ...state.request.input,
            businessContext: [state.request.input.businessContext, answeredContext].filter(Boolean).join("\n")
          }
        }
      });
      this.store.appendChatMessage(runId, {
        role: "user",
        kind: "answer",
        text: describeAnswerPayloads(answerPayloads),
        answers: answerPayloads
      });
      this.store.updatePublicStatus(runId, publicStatusForPhase("planning_decomposition", "Reading your answer..."));
      this.emit(runId, {
        type: "user_answer_received",
        phase: "planning_decomposition",
        title: "User answers received",
        message: "Saved answers and resumed the AI agent.",
        metadata: { answerIds: answerPayloads.map((answer) => answer.questionId) }
      });
      await this.executeRun(runId, execution);
      return this.store.getSnapshot(runId);
    }

    if (message.type === "user_instruction") {
      const text = message.text.trim();
      this.emit(runId, {
        type: "user_instruction",
        phase: state.phase,
        title: "User instruction received",
        message: text,
        metadata: {
          ...(message.selectedNodeId ? { selectedNodeId: message.selectedNodeId } : {})
        }
      });
      if (!text) return this.store.getSnapshot(runId);
      this.store.appendChatMessage(runId, {
        role: "user",
        kind: "instruction",
        text
      });
      this.store.updateRun(runId, {
        status: "running",
        phase: "planning_decomposition",
        retryableError: undefined,
        request: {
          ...state.request,
          input: {
            ...state.request.input,
            selectedNodeId: message.selectedNodeId ?? state.request.input.selectedNodeId,
            businessContext: [state.request.input.businessContext, `User instruction: ${text}`]
              .filter(Boolean)
              .join("\n")
          }
        }
      });
      await this.executeRun(runId, execution);
      return this.store.getSnapshot(runId);
    }

    if (message.type === "manual_project_change") {
      this.store.observeManualChange(runId, {
        projectRevision: message.projectRevision,
        change: message.change
      });
      this.applyManualChangeToBuilder(this.store.getState(runId), message.change);
      return this.store.getSnapshot(runId);
    }

    if (message.type === "approval") {
      this.emit(runId, {
        type: "tool_call_completed",
        title: message.approved ? "Approval received" : "Approval rejected",
        message: message.approved ? "User approved pending agent action." : "User rejected pending agent action.",
        metadata: { selectedChangeIds: message.selectedChangeIds ?? [] }
      });
      if (message.approved) {
        this.store.updateRun(runId, { status: "running", phase: "planning_decomposition" });
        await this.executeRun(runId, execution);
      }
      return this.store.getSnapshot(runId);
    }

    return this.store.getSnapshot(runId);
  }

  cancelRun(runId: string): VdtAgentRunSnapshot {
    this.store.cancelRun(runId);
    return this.store.getSnapshot(runId);
  }

  private initializeRun(request: VdtAgentStartRequest): VdtAgentRunState {
    const state = this.store.createRun(request);
    this.store.updateRun(state.runId, { status: "running", phase: "classifying_request" });
    this.store.updatePublicStatus(state.runId, publicStatusForPhase("classifying_request", "Agent is reading your request..."));
    this.emit(state.runId, {
      type: "run_started",
      phase: "classifying_request",
      title: "Agent run started",
      message: "Started VDT agent run."
    });

    const initialPrompt = request.input.prompt?.trim();
    if (initialPrompt) {
      this.store.appendChatMessage(state.runId, {
        role: "user",
        kind: "instruction",
        text: initialPrompt
      });
      this.emit(state.runId, {
        type: "user_instruction",
        phase: "classifying_request",
        title: "User message sent",
        message: initialPrompt,
        metadata: { initial: true }
      });
    }

    return this.store.getState(state.runId);
  }

  private async executeRun(runId: string, execution: VdtAgentExecutionOptions): Promise<void> {
    try {
      this.ensureBuilder(runId);
      await this.ensureFirstResponse(runId, execution);
      const firstResponseState = this.store.getState(runId);
      if (firstResponseState.status === "needs_user_input" || firstResponseState.status === "waiting_approval") {
        return;
      }
      await this.runDecisionLoop(runId, execution);
    } catch (error) {
      const state = this.store.getState(runId);
      if (state.abortController.signal.aborted || isAbortError(error)) {
        return;
      }
      if (isRetryableProviderError(error)) {
        this.pauseForRetryableError(runId, error);
      } else {
        this.failRun(
          runId,
          error,
          "AGENT_DECISION_LOOP_FAILED",
          "Agent decision loop failed",
          "Agent run failed while running the decision loop."
        );
      }
    }
  }

  private async ensureFirstResponse(runId: string, execution: VdtAgentExecutionOptions): Promise<void> {
    const state = this.store.getState(runId);
    if (state.firstResponseCompleted) return;
    if (!execution.provider) {
      throw new Error("Agent mode requires a configured AI provider.");
    }

    const input = this.buildFirstResponseInput(runId);
    this.emit(runId, {
      type: "tool_call_started",
      phase: "classifying_request",
      title: "First response requested",
      message: "Asked the orchestrator to write the first visible response.",
      metadata: { taskType: "orchestrator_first_response", providerId: execution.provider.id }
    });

    const raw = await execution.provider.completeStructured<FirstResponseInput, FirstResponseOutput>({
      taskType: "orchestrator_first_response",
      input,
      schema: firstResponseSchema,
      systemPrompt: AGENT_FIRST_RESPONSE_SYSTEM_PROMPT,
      userPrompt: JSON.stringify(input, null, 2),
      temperature: 0.2,
      maxTokens: Math.min(execution.maxTokens ?? 2_000, 2_000),
      signal: state.abortController.signal
    });
    const firstResponse = firstResponseSchema.parse(raw);
    const questions = normalizeUserQuestions(firstResponse.questions ?? []);

    this.store.appendChatMessage(runId, {
      role: "assistant",
      kind: "assistant_message",
      text: firstResponse.assistantMessage
    });
    this.store.updatePublicStatus(runId, firstResponse.publicStatus);
    this.emit(runId, {
      type: "assistant_message",
      phase: "classifying_request",
      title: "Assistant message",
      message: firstResponse.assistantMessage,
      metadata: { taskType: "orchestrator_first_response", nextAction: firstResponse.nextAction }
    });

    if (firstResponse.nextAction === "ask_user" && questions.length > 0) {
      this.store.updateRun(runId, {
        status: "needs_user_input",
        phase: "asking_clarifying_questions",
        pendingQuestions: questions,
        firstResponseCompleted: true
      });
      this.store.appendChatMessage(runId, {
        role: "assistant",
        kind: "question",
        questions
      });
      this.store.updatePublicStatus(runId, publicStatusForPhase("asking_clarifying_questions", "Waiting for your answer."));
      this.emit(runId, {
        type: "clarifying_questions",
        phase: "asking_clarifying_questions",
        title: "Clarifying questions",
        message: `Agent needs ${questions.length} answer${questions.length === 1 ? "" : "s"} before continuing.`,
        questions
      });
      return;
    }

    this.store.updateRun(runId, {
      firstResponseCompleted: true
    });
  }

  private async runDecisionLoop(runId: string, execution: VdtAgentExecutionOptions): Promise<void> {
    const maxSteps = this.store.getState(runId).request.options?.maxSteps ?? 40;

    for (let step = 1; step <= maxSteps; step += 1) {
      const current = this.store.getState(runId);

      if (current.status === "cancelled" || current.status === "failed" || current.status === "succeeded") {
        return;
      }

      if (current.status === "needs_user_input" || current.status === "waiting_approval") {
        return;
      }

      this.store.updateRun(runId, {
        status: "running",
        phase: inferPhaseForNextDecision(current)
      });
      this.store.updatePublicStatus(runId, publicStatusForPhase(this.store.getState(runId).phase));

      const decision = await this.requestDecision(runId, execution);
      this.publishDecisionStatus(runId, decision);
      const outcome = await this.executeDecision(runId, decision, execution);

      if (outcome === "paused" || outcome === "finished") return;
    }

    this.failRun(
      runId,
      new Error("Agent exceeded maxSteps."),
      "MAX_STEPS_EXCEEDED",
      "Agent stopped",
      "Agent exceeded the maximum number of allowed steps."
    );
  }

  private async requestDecision(runId: string, execution: VdtAgentExecutionOptions): Promise<AgentDecision> {
    if (!execution.provider) {
      throw new Error("Agent mode requires a configured AI provider.");
    }

    const state = this.store.getState(runId);
    const context = this.buildAgentContext(runId);

    this.emit(runId, {
      type: "tool_call_started",
      phase: state.phase,
      title: "AI decision requested",
      message: "Asked the AI agent to choose the next tool or user interaction.",
      metadata: { taskType: "agent_decision", providerId: execution.provider.id }
    });

    const raw = await execution.provider.completeStructured<AgentDecisionContext, AgentDecision>({
      taskType: "agent_decision",
      input: context,
      schema: agentDecisionSchema,
      systemPrompt: AGENT_DECISION_SYSTEM_PROMPT,
      userPrompt: JSON.stringify(context, null, 2),
      temperature: 0.1,
      maxTokens: execution.maxTokens,
      signal: state.abortController.signal
    });

    const decision = parseAndGuardAgentDecision(raw);

    this.emit(runId, {
      type: "tool_call_completed",
      phase: state.phase,
      title: "AI decision received",
      message: decision.type === "call_tool"
        ? `AI chose tool ${decision.toolName}.`
        : decision.type === "ask_user"
          ? "AI chose to ask the user for clarification."
          : "AI chose to finish the run.",
      metadata: {
        taskType: "agent_decision",
        decisionType: decision.type,
        toolName: decision.type === "call_tool" ? decision.toolName : undefined
      }
    });

    return decision;
  }

  private async executeDecision(
    runId: string,
    decision: AgentDecision,
    _execution: VdtAgentExecutionOptions
  ): Promise<"continue" | "paused" | "finished"> {
    if (decision.type === "ask_user") {
      await this.tools.run("user.ask", { questions: decision.questions }, this.toolContext(runId));
      return "paused";
    }

    if (decision.type === "finish") {
      const finished = await this.tryFinishRun(runId, decision);
      return finished ? "finished" : "continue";
    }

    const toolResult = await this.tools.run(decision.toolName, decision.args, this.toolContext(runId));
    if (toolResult.ok && isGraphMutationTool(decision.toolName)) {
      await this.validateAfterMutation(runId);
    }

    return "continue";
  }

  private publishDecisionStatus(runId: string, decision: AgentDecision): void {
    if (decision.type === "finish") return;
    const message = decision.statusMessage.trim();
    if (!message) return;
    const state = this.store.getState(runId);
    const updated = this.store.updatePublicStatus(runId, publicStatusForPhase(state.phase, message));
    this.store.appendChatMessage(runId, {
      role: "assistant",
      kind: "status",
      text: message,
      status: updated.publicStatus
    });
    this.emit(runId, {
      type: "assistant_message",
      phase: state.phase,
      title: "Agent status",
      message,
      metadata: { decisionType: decision.type }
    });
  }

  private buildAgentContext(runId: string): AgentDecisionContext {
    const state = this.store.getState(runId);
    const project = state.builder?.getProject() ?? state.draftProject ?? state.project;
    const selectedNodeId = state.request.input.selectedNodeId;
    return {
      runId,
      mode: state.request.mode,
      step: state.events.filter((event) => event.metadata?.taskType === "agent_decision").length + 1,
      userRequest: state.request.input,
      currentProject: project ? summarizeProject(project) : undefined,
      selectedNode: project && selectedNodeId ? summarizeNode(project, selectedNodeId) : undefined,
      selectedSkills: state.selectedSkills,
      availableTools: this.tools.listSpecs(),
      recentEvents: summarizeEvents(state.events),
      visibleContext: state.visibleContext,
      userAnswers: state.answers,
      manualChanges: summarizeManualChanges(state),
      subagentReports: (state.subagentReports ?? []).slice(-8).map((report) => ({
        taskId: report.taskId,
        status: report.status,
        summaryForOrchestrator: report.summaryForOrchestrator,
        ...(report.confidence !== undefined ? { confidence: report.confidence } : {})
      })),
      lastToolResult: state.lastToolResult,
      validationState: state.validationState,
      calculationState: state.calculationState,
      constraints: {
        maxOneToolCallPerDecision: true,
        mustUseToolsForGraphChanges: true,
        cannotReturnFullGraph: true,
        cannotExposeHiddenReasoning: true
      }
    };
  }

  private buildFirstResponseInput(runId: string): FirstResponseInput {
    const state = this.store.getState(runId);
    const project = state.project ?? state.draftProject ?? state.request.input.project;
    const rootNode = project?.graph.nodes.find((node) => node.id === project.rootNodeId);
    const lastUserMessage = [...state.chatMessages].reverse().find((message) => message.role === "user");
    return {
      brief: state.visibleContext.brief,
      currentUserMessage: lastUserMessage?.text ?? state.request.input.prompt ?? state.request.input.businessContext ?? state.visibleContext.brief.rootKpi,
      ...(project && rootNode
        ? {
            currentProjectSummary: {
              title: project.name,
              rootNodeName: rootNode.name,
              ...(rootNode.unit ? { unit: rootNode.unit } : {})
            }
          }
        : {}),
      visibleChatSummary: state.chatMessages
        .slice(-8)
        .map((message) => `${message.role}: ${message.text ?? message.kind}`)
        .join("\n")
    };
  }

  private async validateAfterMutation(runId: string): Promise<void> {
    const state = this.store.getState(runId);
    const builder = state.builder;
    if (!builder) return;
    const validation = summarizeValidation(builder.validate().validation);
    const project = builder.getProject();
    this.store.updateRun(runId, {
      draftProject: project,
      validationState: validation,
      phase: validation.valid ? "building_graph" : "repairing_graph"
    });
    this.emit(runId, {
      type: "graph_validation",
      phase: validation.valid ? "validating_graph" : "repairing_graph",
      title: validation.valid ? "Graph validation passed" : "Graph validation found issues",
      message: validation.valid
        ? `Graph validation passed with ${validation.warnings.length} warning${validation.warnings.length === 1 ? "" : "s"}.`
        : `Graph validation found ${validation.errors.length} error${validation.errors.length === 1 ? "" : "s"}.`,
      metadata: { errors: validation.errors.length, warnings: validation.warnings.length }
    });
  }

  private async tryFinishRun(runId: string, decision: Extract<AgentDecision, { type: "finish" }>): Promise<boolean> {
    try {
      await this.finishRun(runId, decision);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cannot finish run.";
      const envelope: AgentToolResultEnvelope = {
        toolName: "finish",
        ok: false,
        error: { code: "FINISH_REJECTED", message },
        projectChanged: false,
        validation: this.store.getState(runId).validationState,
        emittedEventIds: []
      };
      this.store.updateRun(runId, {
        phase: "repairing_graph",
        lastToolResult: envelope
      });
      this.emit(runId, {
        type: "tool_call_completed",
        phase: "repairing_graph",
        title: "Finish rejected",
        message,
        metadata: { ok: false, code: "FINISH_REJECTED" }
      });
      return false;
    }
  }

  private async finishRun(runId: string, decision: Extract<AgentDecision, { type: "finish" }>): Promise<void> {
    const state = this.store.getState(runId);
    const project = state.builder?.getProject() ?? state.draftProject;
    if (!project) throw new Error("Cannot finish: no draft project exists.");

    const validation = summarizeValidation(state.builder?.validate().validation ?? { valid: false, errors: [], warnings: [] });
    if (!validation.valid) {
      this.store.updateRun(runId, { phase: "repairing_graph", validationState: validation });
      throw new Error("Cannot finish: graph is invalid.");
    }

    const rootNode = project.graph.nodes.find((node) => node.id === project.rootNodeId);
    if (!rootNode) throw new Error("Cannot finish: root node is missing.");
    if (!rootNode.formula?.trim() && rootNode.baselineValue === undefined && rootNode.value === undefined) {
      throw new Error("Cannot finish: root node has no formula or value.");
    }

    const calculation = calculateGraph(project);
    const calculationSummary = summarizeCalculation(calculation);
    this.store.updateRun(runId, { calculationState: calculationSummary });
    if (calculation.errors.length > 0) {
      throw new Error(`Cannot finish: calculation has errors: ${calculation.errors.map((error) => error.message).join("; ")}`);
    }
    if (calculation.rootValue === undefined || !Number.isFinite(calculation.rootValue)) {
      throw new Error("Cannot finish: root value is not finite.");
    }

    this.store.updateRun(runId, {
      status: "succeeded",
      phase: "reporting",
      project,
      draftProject: project,
      finalReport: decision.summary,
      completedAt: new Date().toISOString(),
      validationState: validation,
      calculationState: calculationSummary
    });
    this.store.appendChatMessage(runId, {
      role: "assistant",
      kind: "final_report",
      text: decision.summary
    });
    this.store.updatePublicStatus(runId, publicStatusForPhase("reporting", "Draft ready."));

    this.emit(runId, {
      type: "final_report",
      phase: "reporting",
      title: "Final report prepared",
      message: decision.summary,
      metadata: { nextSuggestedActions: decision.nextSuggestedActions }
    });

    this.emit(runId, {
      type: "run_completed",
      phase: "reporting",
      title: "Run completed",
      message: "Agent run completed with a valid VDT."
    });
  }

  private ensureBuilder(runId: string): void {
    const state = this.store.getState(runId);
    if (state.builder) return;
    const builder = new VdtBuilderSession({
      project: state.draftProject ?? state.request.input.project,
      providerId: state.request.providerId
    });
    const project = builder.getProject();
    this.store.updateRun(runId, {
      builder,
      ...(project.graph.nodes.length > 0 ? { draftProject: project } : {})
    });
  }

  private toolContext(runId: string): AgentToolContext {
    const state = this.store.getState(runId);
    return {
      runId,
      store: this.store,
      emit: (event) => this.emit(runId, event),
      getRun: () => this.store.getSnapshot(runId),
      updateRun: (patch) => {
        this.store.updateRun(runId, patch);
      },
      builder: state.builder,
      signal: state.abortController.signal
    };
  }

  private failRun(
    runId: string,
    error: unknown,
    code: string,
    title: string,
    completionMessage: string
  ): void {
    const state = this.store.getState(runId);
    if (state.status === "cancelled") return;
    const message = error instanceof Error ? error.message : "Agent run failed.";
    const completedAt = new Date().toISOString();
    const project = state.builder?.getProject();
    this.store.updateRun(runId, {
      status: "failed",
      phase: "reporting",
      error: { code, message },
      ...(project && project.graph.nodes.length > 0 ? { draftProject: project, project } : {}),
      completedAt
    });
    this.emit(runId, {
      type: "error",
      phase: "reporting",
      title,
      message,
      metadata: { code }
    });
    this.emit(runId, {
      type: "run_completed",
      phase: "reporting",
      title: "Run failed",
      message: completionMessage
    });
  }

  private pauseForRetryableError(runId: string, error: unknown): void {
    const state = this.store.getState(runId);
    if (state.status === "cancelled") return;
    const message = error instanceof Error ? error.message : "Backend execution timed out.";
    const retryCount = (state.retryableError?.retryCount ?? 0) + 1;
    const code = retryableCode(error);
    const userMessage = retryableUserMessage(code);
    const retryableError = {
      code,
      message,
      retryCount,
      createdAt: new Date().toISOString()
    };
    const project = state.builder?.getProject();
    this.store.updateRun(runId, {
      status: "needs_user_input",
      phase: "reporting",
      retryableError,
      error: undefined,
      ...(project && project.graph.nodes.length > 0 ? { draftProject: project } : {})
    });
    this.store.appendChatMessage(runId, {
      role: "assistant",
      kind: "retryable_error",
      text: userMessage.chat
    });
    this.store.updatePublicStatus(runId, {
      phase: "retryable_error",
      message: userMessage.status
    });
    this.emit(runId, {
      type: "error",
      phase: "reporting",
      title: userMessage.title,
      message,
      metadata: { code: retryableError.code, retryable: true, retryCount }
    });
  }

  private emit(runId: string, event: Parameters<AgentRunStore["appendEvent"]>[1]): void {
    this.store.appendEvent(runId, event);
  }

  private applyManualChangeToBuilder(state: VdtAgentRunState, change: ManualProjectChange): void {
    if (!state.builder || change.kind !== "node_updated" || !change.nodeId || !change.patch) return;
    try {
      const result = state.builder.updateNode({
        nodeId: change.nodeId,
        patch: change.patch as VdtNodePatch
      });
      const validation = summarizeValidation(state.builder.validate().validation);
      this.store.updateRun(state.runId, {
        draftProject: result.project,
        validationState: validation
      });
    } catch {
      // Manual edits are context signals; failed projection into builder memory is non-blocking.
    }
  }
}

export function createVdtAgentRuntime(options?: VdtAgentRuntimeOptions): VdtAgentRuntime {
  return new VdtAgentRuntime(options);
}

function inferPhaseForNextDecision(state: VdtAgentRunState): VdtAgentRunPhase {
  if (state.validationState && !state.validationState.valid) return "repairing_graph";
  if (!state.draftProject || state.draftProject.graph.nodes.length === 0) {
    return state.selectedSkills.length > 0 ? "planning_decomposition" : "retrieving_skills";
  }
  if (state.calculationState?.errors.length) return "repairing_graph";
  return "building_graph";
}

function isGraphMutationTool(toolName: string): boolean {
  return new Set([
    "vdt.create_draft",
    "vdt.add_driver",
    "vdt.add_drivers_batch",
    "vdt.add_edge",
    "vdt.update_node",
    "vdt.delete_node",
    "vdt.set_formula",
    "skill.seed_draft_from_recipe",
    "vdt.repair_missing_formula_reference",
    "vdt.repair_orphan_node",
    "vdt.repair_duplicate_node_id"
  ]).has(toolName);
}

function answersToContext(answers: Record<string, string | number | string[]>): string {
  return Object.entries(answers)
    .map(([key, value]) => `User answer ${key}: ${Array.isArray(value) ? value.join(", ") : value}`)
    .join("\n");
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || (error as { code?: unknown }).code === "CANCELLED");
}

function isRetryableProviderError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  if (
    code === "TIMEOUT" ||
    code === "PROVIDER_UNAVAILABLE" ||
    code === "SCHEMA_REPAIR_FAILED" ||
    code === "BACKEND_PARSE_FAILED" ||
    code === "SCHEMA_INVALID"
  ) {
    return true;
  }
  return /timed out|timeout|provider unavailable|rate limited|temporarily unavailable|structured response|schema validation|schema repair|could not be parsed/i.test(error.message);
}

function retryableCode(error: unknown): "TIMEOUT" | "PROVIDER_UNAVAILABLE" | "SCHEMA_REPAIR_FAILED" | "STRUCTURED_OUTPUT_FAILED" {
  const code = error instanceof Error ? (error as { code?: unknown }).code : undefined;
  if (code === "PROVIDER_UNAVAILABLE") return "PROVIDER_UNAVAILABLE";
  if (code === "SCHEMA_REPAIR_FAILED") return "SCHEMA_REPAIR_FAILED";
  if (code === "BACKEND_PARSE_FAILED" || code === "SCHEMA_INVALID") return "STRUCTURED_OUTPUT_FAILED";
  if (error instanceof Error && /structured response|schema validation|schema repair|could not be parsed/i.test(error.message)) {
    return "STRUCTURED_OUTPUT_FAILED";
  }
  return "TIMEOUT";
}

function retryableUserMessage(
  code: "TIMEOUT" | "PROVIDER_UNAVAILABLE" | "SCHEMA_REPAIR_FAILED" | "STRUCTURED_OUTPUT_FAILED"
): { title: string; status: string; chat: string } {
  if (code === "STRUCTURED_OUTPUT_FAILED" || code === "SCHEMA_REPAIR_FAILED") {
    return {
      title: "Provider returned unstructured output",
      status: "The provider returned an unstructured answer. Your message is saved, and you can retry.",
      chat: "I saved your message, but the provider returned output that VDT Studio could not use as a structured agent response. Retry the step, or send a smaller instruction so I can continue from the saved context."
    };
  }
  if (code === "PROVIDER_UNAVAILABLE") {
    return {
      title: "Provider temporarily unavailable",
      status: "The provider is temporarily unavailable. Your message is saved.",
      chat: "I saved your message, but the provider is temporarily unavailable. Retry the step, or send a smaller instruction so I can continue from the saved context."
    };
  }
  return {
    title: "Provider step timed out",
    status: "The provider step timed out. Your message is saved.",
    chat: "I saved your message, but the provider step timed out. Retry the step, or send a smaller instruction so I can continue from the saved context."
  };
}
