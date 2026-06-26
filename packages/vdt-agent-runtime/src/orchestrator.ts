import {
  applyQuestionAnswers,
  buildCriticalQuestions,
  classifyVdtRequest,
  compileSkillRecipes,
  initialDriversFromRecipes,
  loadDefaultSkillLibrary,
  readSkillExcerpts,
  retrieveSkills,
  type GenerateVdtInputLike
} from "@vdt-studio/vdt-agent";
import { stableSnakeId, VdtBuilderSession, type VdtNodePatch } from "@vdt-studio/vdt-core";
import { AgentRunStore } from "./run-store";
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

export interface VdtAgentRuntimeOptions {
  store?: AgentRunStore | undefined;
  tools?: ToolRegistry | undefined;
}

export class VdtAgentRuntime {
  readonly store: AgentRunStore;
  readonly tools: ToolRegistry;

  constructor(options: VdtAgentRuntimeOptions = {}) {
    this.store = options.store ?? new AgentRunStore();
    this.tools = options.tools ?? createDefaultToolRegistry();
  }

  async startRun(request: VdtAgentStartRequest): Promise<VdtAgentRunSnapshot> {
    const state = this.store.createRun(request);
    this.store.updateRun(state.runId, { status: "running", phase: "classifying_request" });
    this.emit(state.runId, {
      type: "run_started",
      phase: "classifying_request",
      title: "Agent run started",
      message: "Started VDT agent run."
    });

    const agentRequest = normalizeAgentRequest(request);
    const library = await loadDefaultSkillLibrary();
    const classification = classifyVdtRequest(agentRequest);
    this.emit(state.runId, {
      type: "classification",
      phase: "classifying_request",
      title: "Request classified",
      message: `Classified request as ${classification.domain} / ${classification.pattern}.`,
      metadata: { ...classification }
    });

    this.store.updateRun(state.runId, { phase: "retrieving_skills" });
    const retrievedSkills = retrieveSkills(agentRequest, library, { classification, maxSkills: 3 });
    this.emit(state.runId, {
      type: "skill_search",
      phase: "retrieving_skills",
      title: "Skill search completed",
      message: `Found ${retrievedSkills.length} candidate skill${retrievedSkills.length === 1 ? "" : "s"}.`,
      metadata: {
        candidates: retrievedSkills.map((candidate) => ({
          id: candidate.skill.id,
          score: candidate.score,
          matchedTerms: candidate.matchedTerms
        }))
      }
    });

    const selectedSkills = retrievedSkills.map((candidate) => ({
      id: candidate.skill.id,
      path: candidate.skill.path,
      title: candidate.skill.title,
      score: candidate.score,
      reason: candidate.reason,
      matchedTerms: candidate.matchedTerms
    }));
    this.store.updateRun(state.runId, { selectedSkills });
    for (const skill of selectedSkills) {
      this.emit(state.runId, {
        type: "skill_selected",
        phase: "retrieving_skills",
        title: "Skill selected",
        message: `Selected ${skill.id}: ${skill.reason}`,
        metadata: { id: skill.id, path: skill.path, score: skill.score }
      });
    }

    this.store.updateRun(state.runId, { phase: "reading_skills" });
    const excerpts = readSkillExcerpts(retrievedSkills);
    for (const excerpt of excerpts) {
      this.emit(state.runId, {
        type: "skill_read",
        phase: "reading_skills",
        title: "Skill read",
        message: `Read ${excerpt.id}: ${excerpt.title}.`,
        metadata: { id: excerpt.id, path: excerpt.path, outputs: excerpt.outputs ?? [] }
      });
    }

    const recipes = compileSkillRecipes(excerpts);
    const questions = buildCriticalQuestions(agentRequest, excerpts);
    const drivers = initialDriversFromRecipes(recipes, 8);
    const plan: VdtBuildPlan = {
      title: `Build ${agentRequest.rootKpi} VDT`,
      steps: [
        "Create root draft",
        `Add ${drivers.length} first-level driver${drivers.length === 1 ? "" : "s"} from selected skill recipes`,
        "Apply layout",
        "Validate graph",
        "Run bounded advisory tools",
        "Prepare final report"
      ],
      selectedSkillIds: selectedSkills.map((skill) => skill.id),
      firstLevelDriverIds: drivers.map((driver) => driver.id)
    };
    this.store.updateRun(state.runId, {
      pendingPlan: plan,
      recipes,
      request: {
        ...request,
        input: {
          ...request.input,
          rootKpi: agentRequest.rootKpi,
          industry: agentRequest.industry,
          businessContext: agentRequest.businessContext,
          unit: agentRequest.unit,
          timePeriod: agentRequest.timePeriod,
          goal: agentRequest.goal,
          levelOfDetail: agentRequest.levelOfDetail
        }
      } as never,
      phase: "planning_decomposition"
    });
    this.emit(state.runId, {
      type: "plan_proposed",
      phase: "planning_decomposition",
      title: "Build plan prepared",
      message: `Prepared plan from ${selectedSkills.length} selected skill${selectedSkills.length === 1 ? "" : "s"}.`,
      metadata: { ...plan }
    });

    if (questions.length > 0 && request.options?.continueWithAssumptions !== true) {
      this.store.updateRun(state.runId, {
        status: "needs_user_input",
        phase: "asking_clarifying_questions",
        pendingQuestions: questions
      });
      this.emit(state.runId, {
        type: "clarifying_questions",
        phase: "asking_clarifying_questions",
        title: "Clarifying questions",
        message: `Agent needs ${questions.length} required answer${questions.length === 1 ? "" : "s"} before building.`,
        questions,
        metadata: { providerWasCalled: false }
      });
      return this.store.getSnapshot(state.runId);
    }

    await this.buildDraft(state.runId);
    return this.store.getSnapshot(state.runId);
  }

  async handleMessage(runId: string, message: AgentUserMessage): Promise<VdtAgentRunSnapshot> {
    const state = this.store.getState(runId);
    if (state.status === "cancelled" || state.status === "failed" || state.status === "succeeded") {
      if (message.type !== "manual_project_change") {
        return this.store.getSnapshot(runId);
      }
    }

    if (message.type === "user_answer") {
      const request = normalizeAgentRequest(state.request);
      const answered = applyQuestionAnswers(request, message.answers);
      this.store.updateRun(runId, {
        status: "running",
        phase: "building_graph",
        pendingQuestions: undefined,
        answers: { ...state.answers, ...message.answers } as never,
        request: {
          ...state.request,
          input: {
            ...state.request.input,
            ...answered
          }
        } as never
      });
      this.emit(runId, {
        type: "user_answer_received",
        phase: "building_graph",
        title: "User answers received",
        message: "Saved answers and resumed the agent run.",
        metadata: { answerIds: Object.keys(message.answers) }
      });
      await this.buildDraft(runId);
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

  private async buildDraft(runId: string): Promise<void> {
    const state = this.store.getState(runId);
    const agentRequest = normalizeAgentRequest(state.request);
    const builder = state.builder ?? new VdtBuilderSession({
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

    const current = this.store.getState(runId);
    const rootNodeId = current.builder?.getProject().rootNodeId ?? stableSnakeId(rootKpi, "root_kpi");
    const recipes = current.recipes;
    const primaryDrivers = initialDriversFromRecipes(recipes.slice(0, 1), 6);
    for (const driver of primaryDrivers) {
      await this.tools.run("vdt.add_driver", {
        parentNodeId: rootNodeId,
        nodeId: driver.id,
        name: driver.name,
        type: driver.type,
        unit: driver.unit,
        relation: driver.relation,
        formula: driver.formula,
        description: driver.description,
        assumptions: driver.assumptions
      }, context);
    }

    const afterDrivers = this.store.getState(runId).builder?.getProject();
    const nodeIds = new Set(afterDrivers?.graph.nodes.map((node) => node.id) ?? []);
    const rootFormula = recipes.flatMap((recipe) => recipe.formulaTemplates).find((template) => {
      const target = template.targetNodeId === "root" ? rootNodeId : template.targetNodeId;
      if (target !== rootNodeId) return false;
      return formulaReferences(template.formula).every((reference) => nodeIds.has(reference));
    });
    if (rootFormula) {
      await this.tools.run("vdt.set_formula", {
        nodeId: rootNodeId,
        formula: rootFormula.formula
      }, context);
    }

    await this.tools.run("vdt.layout", {}, context);
    const validation = await this.tools.run("vdt.validate", {}, context) as { valid: boolean; errors: number; warnings: number };
    await this.tools.run("ai.check_units", {}, context).catch(() => undefined);
    await this.tools.run("ai.identify_missing_drivers", {}, context).catch(() => undefined);
    await this.tools.run("ai.identify_duplicate_drivers", {}, context).catch(() => undefined);
    await this.tools.run("ai.review_model", {}, context).catch(() => undefined);

    const latest = this.store.getState(runId);
    const project = latest.builder?.getProject();
    const firstLevelDrivers = project?.graph.edges
      .filter((edge) => edge.sourceNodeId === project.rootNodeId)
      .map((edge) => project.graph.nodes.find((node) => node.id === edge.targetNodeId)?.name)
      .filter((name): name is string => Boolean(name)) ?? [];
    const finalReport = [
      `Built ${rootKpi} as an incremental VDT draft.`,
      `Selected skills: ${latest.selectedSkills.map((skill) => skill.id).join(", ") || "none"}.`,
      `First-level drivers: ${firstLevelDrivers.join(", ") || "none"}.`,
      `Validation result: ${validation.valid ? "passed" : "found issues"} (${validation.errors} errors, ${validation.warnings} warnings).`,
      "Next suggested action: deepen the most uncertain first-level driver."
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
      metadata: { firstLevelDrivers }
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

function normalizeAgentRequest(request: VdtAgentStartRequest): GenerateVdtInputLike {
  const selectedNode = request.input.project?.graph.nodes.find((node) => node.id === request.input.selectedNodeId);
  const rootKpi =
    request.input.rootKpi?.trim() ||
    selectedNode?.name ||
    request.input.prompt?.trim().slice(0, 140) ||
    "Value driver tree";
  const result: GenerateVdtInputLike = {
    rootKpi,
    levelOfDetail: request.input.levelOfDetail ?? "medium"
  };
  for (const field of ["industry", "businessContext", "unit", "timePeriod", "goal"] as const) {
    const value = request.input[field];
    if (typeof value === "string" && value.trim()) {
      result[field] = value.trim();
    }
  }
  return result;
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
