import { z } from "zod";
import {
  classifyVdtRequest,
  compileSkillRecipe,
  loadDefaultSkillLibrary,
  readSkillExcerpts,
  retrieveSkills
} from "@vdt-studio/vdt-agent";
import { extractFormulaReferences, stableSnakeId, type VdtChangeSet, type VdtProject } from "@vdt-studio/vdt-core";
import { createStructuredFeedback } from "../feedback";
import { proposeAndMaybeApplyMutation } from "../mutation-pipeline";
import { AgentToolError, type AgentTool } from "../tool-registry";
import { summarizeValidation } from "../summaries";
import { cloneBuilder, combineChangeSets, requireChangeSet } from "./builder-mutation-utils";

export function createSkillTools(): AgentTool[] {
  return [skillListTool, skillSearchTool, skillReadTool, skillCompileRecipeTool, skillSeedDraftFromRecipeTool];
}

const skillListTool: AgentTool = {
  name: "skill.list",
  description: "List available VDT skills without reading full markdown.",
  inputSchema: z.object({}),
  outputSchema: z.record(z.unknown()),
  phase: "retrieving_skills",
  async run() {
    const library = await loadDefaultSkillLibrary();
    return {
      skills: library.skills.map((skill) => ({
        id: skill.id,
        title: skill.title,
        domain: skill.domain,
        patterns: skill.frontmatter.patterns,
        kpiPatterns: skill.frontmatter.kpiPatterns,
        requiredInputs: skill.frontmatter.requires,
        outputs: skill.frontmatter.outputs,
        referenceFiles: skill.frontmatter.referenceFiles,
        runtimePolicy: skill.frontmatter.runtimePolicy
      }))
    };
  }
};

const skillSearchTool: AgentTool = {
  name: "skill.search",
  description: "Search the local VDT skill library for decomposition skills.",
  inputSchema: z.object({
    rootKpi: z.string().min(1).max(200),
    industry: z.string().max(200).optional(),
    businessContext: z.string().max(2_000).optional(),
    goal: z.string().max(1_000).optional(),
    maxSkills: z.number().int().min(1).max(10).optional()
  }),
  outputSchema: z.record(z.unknown()),
  phase: "retrieving_skills",
  async run(context, input) {
    const library = await loadDefaultSkillLibrary();
    const classification = classifyVdtRequest(input);
    const candidates = retrieveSkills(input, library, {
      classification,
      ...(input.maxSkills !== undefined ? { maxSkills: input.maxSkills } : {})
    }).map((candidate) => ({
      id: candidate.skill.id,
      path: candidate.skill.path,
      title: candidate.skill.title,
      score: candidate.score,
      reason: candidate.reason,
      matchedTerms: candidate.matchedTerms,
      domain: candidate.skill.domain,
      requiredInputs: candidate.skill.frontmatter.requires,
      outputs: candidate.skill.frontmatter.outputs,
      referenceFiles: candidate.skill.frontmatter.referenceFiles,
      runtimePolicy: candidate.skill.frontmatter.runtimePolicy
    }));
    context.emit({
      type: "skill_search",
      phase: "retrieving_skills",
      title: "Skill search completed",
      message: `Found ${candidates.length} candidate skill${candidates.length === 1 ? "" : "s"}.`,
      metadata: { candidateIds: candidates.map((candidate) => candidate.id), classification }
    });
    return { classification, candidates };
  }
};

const skillReadTool: AgentTool = {
  name: "skill.read",
  description: "Read a selected local VDT skill excerpt and structured metadata.",
  inputSchema: z.object({
    skillId: z.string().min(1).max(160),
    maxChars: z.number().int().min(200).max(10_000).optional()
  }),
  outputSchema: z.record(z.unknown()),
  phase: "reading_skills",
  async run(context, input) {
    const library = await loadDefaultSkillLibrary();
    const skill = library.byId.get(input.skillId);
    if (!skill) throw new AgentToolError("SKILL_NOT_FOUND", `Skill "${input.skillId}" was not found.`);
    const [excerpt] = readSkillExcerpts([skill], input.maxChars);
    if (!excerpt) throw new AgentToolError("SKILL_READ_FAILED", `Skill "${input.skillId}" could not be read.`);
    const recipe = compileSkillRecipe(skill);
    if (!context.store.getState(context.runId).selectedSkills.some((selected) => selected.id === skill.id)) {
      context.store.updateRun(context.runId, {
        selectedSkills: [
          ...context.store.getState(context.runId).selectedSkills,
          {
            id: skill.id,
            path: skill.path,
            title: skill.title,
            score: 100,
            reason: "Read by agent decision.",
            matchedTerms: []
          }
        ]
      });
    }
    context.emit({
      type: "skill_read",
      phase: "reading_skills",
      title: "Skill read",
      message: `Read ${skill.id}: ${skill.title}.`,
      metadata: { id: skill.id, path: skill.path, outputs: skill.frontmatter.outputs }
    });
    return {
      id: excerpt.id,
      path: excerpt.path,
      title: excerpt.title,
      domain: excerpt.domain,
      excerpt: excerpt.excerpt,
      requiredInputs: skill.frontmatter.requires,
      outputs: excerpt.outputs ?? [],
      questions: excerpt.questions ?? [],
      referenceFiles: skill.frontmatter.referenceFiles ?? {},
      evalFiles: skill.frontmatter.evalFiles ?? {},
      runtimePolicy: skill.frontmatter.runtimePolicy ?? {},
      recipeQuality: recipe.recipeQuality,
      recipeSource: recipe.recipeSource,
      formulaTemplates: recipe.formulaTemplates.map((formula) => `${formula.targetNodeId} = ${formula.formula}`)
    };
  }
};

const skillCompileRecipeTool: AgentTool = {
  name: "skill.compile_recipe",
  description: "Compile a local markdown skill into a structured executable VDT recipe.",
  inputSchema: z.object({
    skillId: z.string().min(1).max(160)
  }),
  outputSchema: z.record(z.unknown()),
  phase: "planning_decomposition",
  async run(context, input) {
    const library = await loadDefaultSkillLibrary();
    const skill = library.byId.get(input.skillId);
    if (!skill) throw new AgentToolError("SKILL_NOT_FOUND", `Skill "${input.skillId}" was not found.`);
    const recipe = compileSkillRecipe(skill);
    const state = context.store.getState(context.runId);
    const feedback = recipe.recipeQuality === "complete"
      ? undefined
      : createStructuredFeedback({
          kind: "recipe_incomplete",
          severity: "warning",
          message: `Skill "${recipe.skillId}" exists, but executable recipe is ${recipe.recipeQuality}. Read markdown guidance, use research/discovery, or ask user before building.`,
          target: { toolName: "skill.compile_recipe" },
          expected: "Complete executable recipe template.",
          actual: { recipeQuality: recipe.recipeQuality, recipeSource: recipe.recipeSource },
          suggestedNextTools: ["skill.read", "research.search_web", "user.ask"],
          retryable: true
        });
    context.store.updateRun(context.runId, {
      recipes: [
        ...state.recipes.filter((existing) => existing.skillId !== recipe.skillId),
        recipe
      ],
      ...(feedback
        ? {
            feedbackHistory: [...(state.feedbackHistory ?? []), feedback].slice(-20),
            lastFeedback: feedback
          }
        : {})
    });
    return {
      ...recipe
    };
  }
};

const skillSeedDraftFromRecipeTool: AgentTool = {
  name: "skill.seed_draft_from_recipe",
  description: "Create a small deterministic draft skeleton from a compiled skill recipe.",
  inputSchema: z.object({
    skillId: z.string().min(1).max(160),
    rootKpi: z.string().min(1).max(200),
    unit: z.string().max(80).optional(),
    timePeriod: z.string().max(80).optional(),
    knownInputs: z.record(z.union([z.string(), z.number()])).optional(),
    maxInitialDrivers: z.number().int().min(1).max(12).optional()
  }),
  outputSchema: z.record(z.unknown()),
  mutatesProject: true,
  requiresDraftProject: true,
  phase: "building_graph",
  async run(context, input) {
    const builder = context.builder;
    if (!builder) throw new AgentToolError("NO_DRAFT_PROJECT", "VDT builder session is not available for this run.");
    const state = context.store.getState(context.runId);
    let recipe = state.recipes.find((candidate) => candidate.skillId === input.skillId);
    if (!recipe) {
      const library = await loadDefaultSkillLibrary();
      const skill = library.byId.get(input.skillId);
      if (!skill) throw new AgentToolError("SKILL_NOT_FOUND", `Skill "${input.skillId}" was not found.`);
      recipe = compileSkillRecipe(skill);
    }
    if (recipe.recipeQuality === "missing") {
      throw new AgentToolError(
        "RECIPE_INCOMPLETE",
        `Skill "${recipe.skillId}" has no executable recipe. Read markdown guidance, use research/discovery, or ask the user before building.`,
        { recipeQuality: recipe.recipeQuality, recipeSource: recipe.recipeSource, warnings: recipe.warnings }
      );
    }

    let project = builder.getProject();
    if (project.graph.nodes.length === 0) {
      project = builder.createDraft({
        projectTitle: `${input.rootKpi} Driver Model`,
        rootKpi: input.rootKpi,
        unit: input.unit,
        timePeriod: input.timePeriod
      }).project;
      context.store.updateRun(context.runId, { draftProject: project });
    }

    const rootNodeId = project.rootNodeId || stableSnakeId(input.rootKpi, "root_kpi");
    const previewBuilder = cloneBuilder(context);
    const changeSets: VdtChangeSet[] = [];
    const addedNodeIds: string[] = [];
    const appliedFormulaNodeIds: string[] = [];
    const knownInputs = input.knownInputs ?? {};
    for (const driver of recipe.initialDrivers.slice(0, input.maxInitialDrivers ?? 6)) {
      const current = previewBuilder.getProject();
      if (current.graph.nodes.some((node) => node.id === driver.id)) continue;
      const formula = driver.formula && referencesExist(current, driver.formula) ? driver.formula : undefined;
      const baselineValue = parseKnownNumber(knownInputs[driver.id]);
      const result = previewBuilder.addDriver({
        parentNodeId: rootNodeId,
        nodeId: driver.id,
        name: driver.name,
        type: driver.type,
        unit: driver.unit,
        relation: driver.relation,
        formula,
        baselineValue,
        description: driver.description,
        assumptions: driver.assumptions
      });
      changeSets.push(requireChangeSet(result.changeSet));
      addedNodeIds.push(result.changeSet?.additions[0]?.nodeId ?? driver.id);
    }

    for (const formula of recipe.formulaTemplates) {
      const current = previewBuilder.getProject();
      const targetNodeId = formula.targetNodeId === "root" || formula.targetNodeId === input.rootKpi
        ? current.rootNodeId
        : formula.targetNodeId;
      if (!current.graph.nodes.some((node) => node.id === targetNodeId)) continue;
      if (!referencesExist(current, formula.formula)) continue;
      const result = previewBuilder.setFormula({ nodeId: targetNodeId, formula: formula.formula });
      changeSets.push(requireChangeSet(result.changeSet));
      appliedFormulaNodeIds.push(targetNodeId);
    }

    const missingInputs = recipe.requiredInputs.filter((id) => knownInputs[id] === undefined);
    if (changeSets.length === 0) {
      const latest = builder.getProject();
      const validation = summarizeValidation(builder.validate().validation);
      context.store.updateRun(context.runId, {
        draftProject: latest,
        validationState: validation
      });
      return {
        projectId: latest.id,
        rootNodeId: latest.rootNodeId,
        addedNodeIds,
        appliedFormulaNodeIds,
        missingInputs,
        revision: builder.getRevision(),
        validation
      };
    }

    const summary = `Seeded ${addedNodeIds.length} driver node${addedNodeIds.length === 1 ? "" : "s"} from ${recipe.skillId}.`;
    const mutation = proposeAndMaybeApplyMutation(context, {
      title: "Recipe draft seeded",
      summary,
      changeSet: combineChangeSets(changeSets, context),
      targetNodeId: rootNodeId
    });
    const latest = mutation.applied ? builder.getProject() : mutation.proposal.previewProject;
    return {
      projectId: latest.id,
      rootNodeId: latest.rootNodeId,
      addedNodeIds,
      appliedFormulaNodeIds,
      missingInputs,
      revision: mutation.revision,
      validation: mutation.validation,
      mutationProposal: { id: mutation.proposal.id, status: mutation.proposal.status }
    };
  }
};

function referencesExist(project: VdtProject, formula: string): boolean {
  const nodeIds = new Set(project.graph.nodes.map((node) => node.id));
  try {
    return extractFormulaReferences(formula).every((reference) => nodeIds.has(reference));
  } catch {
    return false;
  }
}

function parseKnownNumber(value: string | number | undefined): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const match = value.replace(",", ".").match(/[-+]?\d+(?:\.\d+)?/);
  if (!match) return undefined;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
}
