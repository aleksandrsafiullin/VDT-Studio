import {
  loadDefaultSkillLibrary,
  readSkillExcerpts,
  type GenerateVdtInputLike,
  type VdtAgentQuestion,
  type VdtSkill
} from "@vdt-studio/vdt-agent";
import { stableSnakeId, VdtBuilderSession, type VdtNodePatch } from "@vdt-studio/vdt-core";
import { AgentRunStore } from "./run-store";
import { agentPlanSchema, type AgentPlan } from "./schemas/agent-plan";
import { ToolRegistry, type AgentToolContext } from "./tool-registry";
import { createDefaultToolRegistry } from "./tools";
import type {
  AgentUserMessage,
  ManualProjectChange,
  VdtAgentRunSnapshot,
  VdtAgentStartRequest,
  VdtBuildPlan,
  VdtAgentRunState
} from "./types";

export interface AgentPlanningProvider {
  id: string;
  completeStructured<TInput, TOutput>(params: {
    taskType: "agent_plan";
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

export interface VdtAgentRuntimeOptions {
  store?: AgentRunStore | undefined;
  tools?: ToolRegistry | undefined;
}

export interface VdtAgentExecutionOptions {
  provider?: AgentPlanningProvider | undefined;
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
    const state = this.store.getState(runId);
    if (state.status === "cancelled" || state.status === "failed" || state.status === "succeeded") {
      if (message.type !== "manual_project_change") {
        return this.store.getSnapshot(runId);
      }
    }

    if (message.type === "user_answer") {
      const answeredContext = answersToContext(message.answers);
      this.store.updateRun(runId, {
        status: "running",
        phase: "planning_decomposition",
        pendingQuestions: undefined,
        answers: { ...state.answers, ...message.answers } as never,
        request: {
          ...state.request,
          input: {
            ...state.request.input,
            businessContext: [state.request.input.businessContext, answeredContext].filter(Boolean).join("\n")
          }
        } as never
      });
      this.emit(runId, {
        type: "user_answer_received",
        phase: "planning_decomposition",
        title: "User answers received",
        message: "Saved answers and resumed the AI planner.",
        metadata: { answerIds: Object.keys(message.answers) }
      });
      void this.executeRun(runId, execution);
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
      this.store.updateRun(runId, {
        status: "running",
        phase: "planning_decomposition",
        request: {
          ...state.request,
          input: {
            ...state.request.input,
            businessContext: [state.request.input.businessContext, `User instruction: ${text}`]
              .filter(Boolean)
              .join("\n")
          }
        } as never
      });
      void this.executeRun(runId, execution);
      return this.store.getSnapshot(runId);
    }

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

  private initializeRun(request: VdtAgentStartRequest): VdtAgentRunState {
    const state = this.store.createRun(request);
    this.store.updateRun(state.runId, { status: "running", phase: "classifying_request" });
    this.emit(state.runId, {
      type: "run_started",
      phase: "classifying_request",
      title: "Agent run started",
      message: "Started VDT agent run."
    });

    const initialPrompt = request.input.prompt?.trim();
    if (initialPrompt) {
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
      await this.planWithModel(runId, execution);
      const planned = this.store.getState(runId);
      if (planned.status !== "running") {
        return;
      }

      await this.buildDraft(runId);
    } catch (error) {
      const state = this.store.getState(runId);
      if (state.abortController.signal.aborted || isAbortError(error)) {
        return;
      }
      this.failRun(
        runId,
        error,
        "PLANNING_FAILED",
        "Planning failed",
        "Agent run failed while planning the VDT."
      );
    }
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
      ...(project ? { draftProject: project, project } : {}),
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
      const answeredContext = answersToContext(message.answers);
      this.store.updateRun(runId, {
        status: "running",
        phase: "planning_decomposition",
        pendingQuestions: undefined,
        answers: { ...state.answers, ...message.answers } as never,
        request: {
          ...state.request,
          input: {
            ...state.request.input,
            businessContext: [state.request.input.businessContext, answeredContext].filter(Boolean).join("\n")
          }
        } as never
      });
      this.emit(runId, {
        type: "user_answer_received",
        phase: "planning_decomposition",
        title: "User answers received",
        message: "Saved answers and resumed the AI planner.",
        metadata: { answerIds: Object.keys(message.answers) }
      });
      await this.planWithModel(runId, execution);
      const planned = this.store.getState(runId);
      if (planned.status === "running") {
        await this.buildDraft(runId);
      }
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
      this.store.updateRun(runId, {
        status: "running",
        phase: "planning_decomposition",
        request: {
          ...state.request,
          input: {
            ...state.request.input,
            businessContext: [state.request.input.businessContext, `User instruction: ${text}`]
              .filter(Boolean)
              .join("\n")
          }
        } as never
      });
      await this.planWithModel(runId, execution);
      const planned = this.store.getState(runId);
      if (planned.status === "running") {
        await this.buildDraft(runId);
      }
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
      return this.store.getSnapshot(runId);
    }

    return this.store.getSnapshot(runId);
  }

  cancelRun(runId: string): VdtAgentRunSnapshot {
    this.store.cancelRun(runId);
    return this.store.getSnapshot(runId);
  }

  private async planWithModel(runId: string, execution: VdtAgentExecutionOptions): Promise<void> {
    if (!execution.provider) {
      throw new Error("Agent mode requires a configured AI provider for model-backed planning.");
    }

    const state = this.store.getState(runId);
    const agentRequest = normalizeAgentRequest(state.request);
    const library = await loadDefaultSkillLibrary();
    const skills = library.skills;

    this.store.updateRun(runId, { phase: "classifying_request" });
    this.emit(runId, {
      type: "classification",
      phase: "classifying_request",
      title: "AI planner started",
      message: "Sending the full user brief and skill registry to the configured AI model.",
      metadata: { providerId: execution.provider.id }
    });

    this.store.updateRun(runId, { phase: "retrieving_skills" });
    this.emit(runId, {
      type: "skill_search",
      phase: "retrieving_skills",
      title: "Skill registry provided",
      message: `Provided ${skills.length} available skills to the AI planner.`,
      metadata: { skillIds: skills.map((skill) => skill.id) }
    });

    this.emit(runId, {
      type: "tool_call_started",
      phase: "planning_decomposition",
      title: "AI planner call started",
      message: "The configured AI model is selecting skills, extracting inputs, and deciding whether to ask questions.",
      metadata: { taskType: "agent_plan", providerId: execution.provider.id }
    });

    let rawPlan: AgentPlan;
    try {
      rawPlan = await execution.provider.completeStructured<AgentPlannerInput, AgentPlan>({
        taskType: "agent_plan",
        input: buildPlannerInput(agentRequest, skills, state.answers),
        schema: agentPlanSchema,
        systemPrompt: AGENT_PLANNER_SYSTEM_PROMPT,
        userPrompt: buildPlannerPrompt(agentRequest, skills, state.answers),
        temperature: 0.1,
        maxTokens: execution.maxTokens,
        signal: state.abortController.signal
      });
    } catch (error) {
      if (state.abortController.signal.aborted || isAbortError(error)) {
        return;
      }
      throw error;
    }
    if (this.store.getState(runId).status === "cancelled" || state.abortController.signal.aborted) {
      return;
    }
    const plan = agentPlanSchema.parse(rawPlan);
    validateSelectedSkills(plan, skills);

    this.emit(runId, {
      type: "tool_call_completed",
      phase: "planning_decomposition",
      title: "AI planner call completed",
      message: "AI planner returned a structured skill decision and VDT build plan.",
      metadata: {
        selectedSkillIds: plan.selectedSkillIds,
        extractedInputIds: plan.extractedInputs.map((input) => input.id),
        missingInputIds: plan.missingInputs.map((input) => input.id),
        confidence: plan.confidence
      }
    });

    const selectedSkillSet = new Set(plan.selectedSkillIds);
    const selectedSkills = skills
      .filter((skill) => selectedSkillSet.has(skill.id))
      .map((skill) => ({
        id: skill.id,
        path: skill.path,
        title: skill.title,
        score: Math.round(plan.confidence * 100),
        reason: plan.skillRationale,
        matchedTerms: plan.extractedInputs.map((input) => input.label)
      }));
    this.store.updateRun(runId, { selectedSkills });
    for (const skill of selectedSkills) {
      this.emit(runId, {
        type: "skill_selected",
        phase: "retrieving_skills",
        title: "Skill selected by AI",
        message: `AI selected ${skill.id}: ${plan.skillRationale}`,
        metadata: { id: skill.id, path: skill.path, providerId: execution.provider.id }
      });
    }

    this.store.updateRun(runId, { phase: "reading_skills" });
    const excerpts = readSkillExcerpts(skills.filter((skill) => selectedSkillSet.has(skill.id)));
    for (const excerpt of excerpts) {
      this.emit(runId, {
        type: "skill_read",
        phase: "reading_skills",
        title: "Skill read",
        message: `Read ${excerpt.id}: ${excerpt.title}.`,
        metadata: { id: excerpt.id, path: excerpt.path, outputs: excerpt.outputs ?? [] }
      });
    }

    const rootKpi = plan.buildIntent.rootKpi || agentRequest.rootKpi;
    const buildPlan: VdtBuildPlan = {
      title: `Build ${rootKpi} VDT`,
      steps: [
        "Create root draft from AI build intent",
        `Apply ${plan.driverPlan.length} model-planned driver node${plan.driverPlan.length === 1 ? "" : "s"}`,
        "Apply layout",
        "Validate graph",
        "Prepare final report"
      ],
      selectedSkillIds: selectedSkills.map((skill) => skill.id),
      firstLevelDriverIds: plan.driverPlan
        .filter((driver) => driver.parentNodeId === "root")
        .map((driver) => driver.id)
    };
    this.store.updateRun(runId, {
      pendingPlan: buildPlan,
      request: {
        ...state.request,
        input: {
          ...state.request.input,
          rootKpi,
          industry: plan.buildIntent.industry || agentRequest.industry,
          businessContext: plan.buildIntent.businessContext || agentRequest.businessContext,
          unit: plan.buildIntent.unit || agentRequest.unit,
          timePeriod: plan.buildIntent.timePeriod || agentRequest.timePeriod,
          goal: plan.buildIntent.goal || agentRequest.goal,
          levelOfDetail: agentRequest.levelOfDetail
        }
      } as never,
      recipes: [{
        skillId: "__model_agent_plan__",
        requiredInputs: plan.missingInputs.map((input) => input.id),
        questions: plan.missingInputs.map(missingInputToQuestion),
        initialDrivers: plan.driverPlan.map((driver) => ({
          id: driver.id,
          name: driver.name,
          type: driver.type,
          unit: driver.unit || undefined,
          relation: driver.relation,
          formula: driver.formula || undefined,
          description: driver.description || undefined,
          assumptions: driver.assumptions
        })),
        formulaTemplates: plan.rootFormula ? [{ targetNodeId: "root", formula: plan.rootFormula }] : [],
        deepenRules: [],
        warnings: plan.warnings.map((warning) => warning.message),
        modelPlan: plan
      } as never],
      phase: "planning_decomposition"
    });
    this.emit(runId, {
      type: "plan_proposed",
      phase: "planning_decomposition",
      title: "AI build plan prepared",
      message: `AI planner selected ${selectedSkills.length} skill${selectedSkills.length === 1 ? "" : "s"} and ${plan.driverPlan.length} driver node${plan.driverPlan.length === 1 ? "" : "s"}.`,
      metadata: {
        selectedSkillIds: buildPlan.selectedSkillIds,
        firstLevelDriverIds: buildPlan.firstLevelDriverIds,
        extractedInputs: plan.extractedInputs
      }
    });

    const requiredQuestions = plan.missingInputs.filter((input) => input.required).map(missingInputToQuestion);
    if (requiredQuestions.length > 0 && state.request.options?.continueWithAssumptions !== true) {
      this.store.updateRun(runId, {
        status: "needs_user_input",
        phase: "asking_clarifying_questions",
        pendingQuestions: requiredQuestions
      });
      this.emit(runId, {
        type: "clarifying_questions",
        phase: "asking_clarifying_questions",
        title: "Clarifying questions",
        message: `AI planner needs ${requiredQuestions.length} answer${requiredQuestions.length === 1 ? "" : "s"} before building.`,
        questions: requiredQuestions,
        metadata: { providerWasCalled: true, selectedSkillIds: buildPlan.selectedSkillIds }
      });
      return;
    }

    this.store.updateRun(runId, { status: "running", phase: "building_graph", pendingQuestions: undefined });
  }

  private async buildDraft(runId: string): Promise<void> {
    try {
      await this.buildDraftUnchecked(runId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Agent build failed.";
      const completedAt = new Date().toISOString();
      const state = this.store.getState(runId);
      const project = state.builder?.getProject();
      this.store.updateRun(runId, {
        status: "failed",
        phase: "reporting",
        error: { code: "BUILD_FAILED", message },
        ...(project ? { draftProject: project, project } : {}),
        completedAt
      });
      this.emit(runId, {
        type: "error",
        phase: "reporting",
        title: "Build failed",
        message,
        metadata: { code: "BUILD_FAILED" }
      });
      this.emit(runId, {
        type: "run_completed",
        phase: "reporting",
        title: "Run failed",
        message: "Agent run failed while building the VDT."
      });
    }
  }

  private async buildDraftUnchecked(runId: string): Promise<void> {
    const state = this.store.getState(runId);
    const agentRequest = normalizeAgentRequest(state.request);
    const modelPlan = getModelPlan(state);
    const builder = new VdtBuilderSession({
      project: state.request.input.project,
      providerId: state.request.providerId
    });
    this.store.updateRun(runId, { builder, status: "running", phase: "building_graph" });
    const context = this.toolContext(runId);

    const rootKpi = agentRequest.rootKpi;
    await this.tools.run("vdt.create_draft", {
      projectTitle: `${rootKpi} Driver Model`,
      rootKpi,
      unit: agentRequest.unit,
      timePeriod: agentRequest.timePeriod,
      industry: agentRequest.industry,
      businessContext: agentRequest.businessContext,
      goal: agentRequest.goal
    }, context);

    const rootNodeId = this.store.getState(runId).builder?.getProject().rootNodeId ?? stableSnakeId(rootKpi, "root_kpi");
    const pendingDrivers = [...modelPlan.driverPlan];
    const addedNodeIds = new Set([rootNodeId]);
    while (pendingDrivers.length > 0) {
      const index = pendingDrivers.findIndex((driver) => driver.parentNodeId === "root" || addedNodeIds.has(driver.parentNodeId));
      if (index === -1) {
        throw new Error(`AI planner returned driver nodes with unresolved parents: ${pendingDrivers.map((driver) => driver.id).join(", ")}`);
      }
      const [driver] = pendingDrivers.splice(index, 1);
      if (!driver) continue;
      const parentNodeId = driver.parentNodeId === "root" ? rootNodeId : driver.parentNodeId;
      const baselineValue = parseBaselineValue(driver.value);
      await this.tools.run("vdt.add_driver", {
        parentNodeId,
        nodeId: driver.id,
        name: driver.name,
        type: driver.type,
        unit: driver.unit || undefined,
        relation: driver.relation,
        formula: normalizeModelFormula(driver.formula),
        baselineValue,
        description: driver.description || undefined,
        assumptions: driver.assumptions
      }, context);
      addedNodeIds.add(driver.id);
    }

    const afterDrivers = this.store.getState(runId).builder?.getProject();
    const nodeIds = new Set(afterDrivers?.graph.nodes.map((node) => node.id) ?? []);
    const rootFormula = normalizeModelFormula(modelPlan.rootFormula);
    if (rootFormula) {
      const missingReferences = formulaReferences(rootFormula).filter((reference) => !nodeIds.has(reference));
      if (missingReferences.length > 0) {
        throw new Error(`AI planner root formula references missing node IDs: ${missingReferences.join(", ")}`);
      }
      await this.tools.run("vdt.set_formula", {
        nodeId: rootNodeId,
        formula: rootFormula
      }, context);
    }

    await this.tools.run("vdt.layout", {}, context);
    const validation = await this.tools.run("vdt.validate", {}, context) as { valid: boolean; errors: number; warnings: number };
    if (!validation.valid) {
      throw new Error(`AI planner produced an invalid VDT graph (${validation.errors} error${validation.errors === 1 ? "" : "s"}, ${validation.warnings} warning${validation.warnings === 1 ? "" : "s"}).`);
    }

    const latest = this.store.getState(runId);
    const project = latest.builder?.getProject();
    const firstLevelDrivers = project?.graph.edges
      .filter((edge) => edge.sourceNodeId === project.rootNodeId)
      .map((edge) => project.graph.nodes.find((node) => node.id === edge.targetNodeId)?.name)
      .filter((name): name is string => Boolean(name)) ?? [];
    const finalReport = [
      `Built ${rootKpi} as an AI-planned VDT draft.`,
      `Selected skills: ${latest.selectedSkills.map((skill) => skill.id).join(", ") || "none"}.`,
      `Extracted inputs: ${modelPlan.extractedInputs.map((input) => `${input.label}=${input.value}${input.unit ? ` ${input.unit}` : ""}`).join(", ") || "none"}.`,
      `First-level drivers: ${firstLevelDrivers.join(", ") || "none"}.`,
      `Validation result: ${validation.valid ? "passed" : "found issues"} (${validation.errors} errors, ${validation.warnings} warnings).`,
      modelPlan.questionsForUser.length > 0
        ? `Open questions: ${modelPlan.questionsForUser.join(" ")}`
        : "Next suggested action: review the first AI-planned draft on the canvas."
    ].join("\n");

    const completedAt = new Date().toISOString();
    this.store.updateRun(runId, {
      status: "succeeded",
      phase: "reporting",
      project,
      draftProject: project,
      finalReport,
      completedAt
    });
    this.emit(runId, {
      type: "final_report",
      phase: "reporting",
      title: "Final report prepared",
      message: "Prepared final VDT report.",
      metadata: { firstLevelDrivers, selectedSkillIds: latest.selectedSkills.map((skill) => skill.id) }
    });
    this.emit(runId, {
      type: "run_completed",
      phase: "reporting",
      title: "Run completed",
      message: "Agent run completed successfully."
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
      this.store.updateRun(state.runId, { draftProject: result.project });
    } catch {
      // Manual edits are context signals; failed projection into builder memory is non-blocking.
    }
  }
}

export function createVdtAgentRuntime(options?: VdtAgentRuntimeOptions): VdtAgentRuntime {
  return new VdtAgentRuntime(options);
}

interface AgentPlannerInput {
  request: GenerateVdtInputLike & { prompt?: string | undefined };
  answers: Record<string, string | number | string[]>;
  availableSkills: Array<{
    id: string;
    title: string;
    domain: string;
    path: string;
    patterns: string[];
    kpiPatterns: string[];
    requiredInputs: string[];
    outputs: string[];
    questions: string[];
  }>;
}

const AGENT_PLANNER_SYSTEM_PROMPT = [
  "You are the VDT Studio AI agent planner.",
  "Read the user's full brief, choose the most relevant skill IDs from the provided registry, extract all numeric and textual inputs, identify missing data, and return only structured JSON matching the provided schema.",
  "Do not choose a generic skill when a domain skill directly matches the prompt.",
  "Use selected skills as instructions for the driver plan. Build a practical first draft, but ask required questions when a missing input prevents a meaningful VDT.",
  "Every formula identifier must exactly match a root or driverPlan id that exists in the same response. Never invent formula variables.",
  "If a formula needs a unit conversion, create explicit driverPlan nodes for the source value and converted value, and reference only those exact ids.",
  "Never expose hidden reasoning. Put concise rationale in skillRationale and assumptions only."
].join("\n");

type AgentRequestForPlanning = GenerateVdtInputLike & { prompt?: string | undefined };

function normalizeAgentRequest(request: VdtAgentStartRequest): AgentRequestForPlanning {
  const selectedNode = request.input.project?.graph.nodes.find((node) => node.id === request.input.selectedNodeId);
  const rootKpi =
    request.input.rootKpi?.trim() ||
    selectedNode?.name ||
    inferRootKpiFromPrompt(request.input.prompt) ||
    "Value driver tree";
  const result: AgentRequestForPlanning = {
    rootKpi,
    levelOfDetail: request.input.levelOfDetail ?? "medium"
  };
  if (request.input.prompt?.trim()) result.prompt = request.input.prompt.trim();
  if (request.input.businessContext?.trim()) result.businessContext = request.input.businessContext.trim();
  for (const field of ["industry", "unit", "timePeriod", "goal"] as const) {
    const value = request.input[field];
    if (typeof value === "string" && value.trim()) {
      result[field] = value.trim();
    }
  }
  return result;
}

function inferRootKpiFromPrompt(prompt: string | undefined): string | undefined {
  if (!prompt?.trim()) return undefined;
  const lower = prompt.toLowerCase();
  if (lower.includes("truck") || lower.includes("haul") || lower.includes("km/h")) return "Ore haulage";
  return prompt.trim().split(/\r?\n/)[0]?.slice(0, 140).trim() || undefined;
}

function buildPlannerInput(
  request: GenerateVdtInputLike,
  skills: VdtSkill[],
  answers: Record<string, string | number | string[]>
): AgentPlannerInput {
  return {
    request,
    answers,
    availableSkills: skills.map((skill) => ({
      id: skill.id,
      title: skill.title,
      domain: skill.domain,
      path: skill.path,
      patterns: skill.frontmatter.patterns,
      kpiPatterns: skill.frontmatter.kpiPatterns,
      requiredInputs: skill.frontmatter.requires,
      outputs: skill.frontmatter.outputs,
      questions: skill.frontmatter.questions
    }))
  };
}

function buildPlannerPrompt(
  request: GenerateVdtInputLike,
  skills: VdtSkill[],
  answers: Record<string, string | number | string[]>
): string {
  const skillRegistry = skills.map((skill) => ({
    id: skill.id,
    title: skill.title,
    domain: skill.domain,
    patterns: skill.frontmatter.patterns,
    kpiPatterns: skill.frontmatter.kpiPatterns,
    requiredInputs: skill.frontmatter.requires,
    outputs: skill.frontmatter.outputs,
    questions: skill.frontmatter.questions
  }));
  return JSON.stringify({
    userRequest: request,
    userAnswers: answers,
    availableSkills: skillRegistry,
    instructions: [
      "Select one or more skill IDs from availableSkills.",
      "Extract every provided numeric input into extractedInputs.",
      "Put required unresolved inputs into missingInputs.",
      "Create driverPlan nodes with parentNodeId='root' for first-level root drivers; use other driver IDs for deeper branches.",
      "Use formula-compatible snake_case IDs.",
      "Every identifier inside driverPlan.formula and rootFormula must exactly match one of the driverPlan ids.",
      "Do not reference converted variables such as *_min, *_h, *_per_hour, or *_per_year unless those exact ids are present as driverPlan nodes.",
      "When converting minutes to hours, create both the minute input node and the converted hour node, or put the conversion directly in a formula that references the existing minute node."
    ]
  }, null, 2);
}

function validateSelectedSkills(plan: AgentPlan, skills: VdtSkill[]): void {
  const available = new Set(skills.map((skill) => skill.id));
  const unknown = plan.selectedSkillIds.filter((skillId) => !available.has(skillId));
  if (unknown.length > 0) {
    throw new Error(`AI planner selected unknown skill IDs: ${unknown.join(", ")}`);
  }
  if (plan.selectedSkillIds.length === 0) {
    throw new Error("AI planner must select at least one VDT skill.");
  }
}

function missingInputToQuestion(input: AgentPlan["missingInputs"][number]): VdtAgentQuestion {
  return {
    id: input.id,
    question: input.question,
    reason: input.reason,
    required: input.required,
    expectedAnswerType: "text"
  };
}

function answersToContext(answers: Record<string, string | number | string[]>): string {
  return Object.entries(answers)
    .map(([key, value]) => `User answer ${key}: ${Array.isArray(value) ? value.join(", ") : value}`)
    .join("\n");
}

function parseBaselineValue(value: string | number): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return undefined;
  const match = normalized.match(/[-+]?\d+(?:\.\d+)?/);
  if (!match) return undefined;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeModelFormula(formula: string): string | undefined {
  const trimmed = formula.trim();
  if (!trimmed) return undefined;
  const equalsIndex = trimmed.indexOf("=");
  if (equalsIndex === -1) return trimmed;
  const rhs = trimmed.slice(equalsIndex + 1).trim();
  if (!rhs) {
    throw new Error(`AI planner returned an empty formula after "=": ${trimmed}`);
  }
  return rhs;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || (error as { code?: unknown }).code === "CANCELLED");
}

function getModelPlan(state: VdtAgentRunState): AgentPlan {
  const marker = state.recipes.find((recipe) => recipe.skillId === "__model_agent_plan__");
  const raw = marker ? (marker as unknown as { modelPlan?: unknown }).modelPlan : undefined;
  const parsed = agentPlanSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("AI planner state is missing or invalid.");
  }
  return parsed.data;
}

function formulaReferences(formula: string): string[] {
  const references = new Set<string>();
  for (const match of formula.matchAll(/\b[A-Za-z_][A-Za-z0-9_]*\b/g)) {
    const value = match[0];
    if (value !== "null" && value !== "true" && value !== "false") {
      references.add(value);
    }
  }
  return [...references];
}
