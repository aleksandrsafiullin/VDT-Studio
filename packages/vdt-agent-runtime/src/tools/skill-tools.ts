import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  classifyVdtRequest,
  compileSkillRecipe,
  rankSkillCandidates,
  readSkillExcerpts,
  readExecutableSkillTopology,
  skillCard,
  UNIVERSAL_SKILL_ID,
  type VdtSkill
} from "@vdt-studio/vdt-agent";
import { skillContentHash } from "@vdt-studio/storage";
import { extractFormulaReferences, stableSnakeId, type VdtChangeSet, type VdtProject } from "@vdt-studio/vdt-core";
import { createStructuredFeedback } from "../feedback";
import { excludedExcavationSkillIds } from "../construction-source-facts";
import { proposeAndMaybeApplyMutation } from "../mutation-pipeline";
import { AgentToolError, type AgentTool } from "../tool-registry";
import { summarizeValidation } from "../summaries";
import { cloneBuilder, combineChangeSets, requireChangeSet } from "./builder-mutation-utils";
import { skillSeedTopologyTool } from "./skill-topology-tool";
import { activateRunSkill, loadRunSkillLibrary, requireSelectedRunSkill, skillCatalogProgress } from "./run-skill-library";

export function createSkillTools(): AgentTool[] {
  return [skillListTool, skillSearchTool, skillReadTool, skillSelectTool, skillReportGapTool, skillCompileRecipeTool, skillSeedDraftFromRecipeTool, skillSeedTopologyTool];
}

const SKILL_CATALOG_PAGE_SIZE = 16;

function semanticSkillCard(skill: VdtSkill) {
  const { id, title, description, domain, version, contentHash } = skillCard(skill);
  const scopeGuidance = skill.body.split(/^##\s+/m).slice(1).flatMap((section) => {
    const [heading, ...lines] = section.split(/\r?\n/);
    return /^(?:when to use|scope boundary)$/i.test(heading?.trim() ?? "")
      ? [lines.join(" ").replace(/\s+/g, " ").trim().slice(0, 320)] : [];
  }).slice(0, 2);
  return {
    id, version, contentHash, title: title.slice(0, 160), description: description.slice(0, 300), domain: domain.slice(0, 80),
    scope: skill.frontmatter.kpiPatterns.slice(0, 4).map((value) => value.slice(0, 80)),
    ...(scopeGuidance.length ? { scopeGuidance } : {}),
    requiredInputs: skill.frontmatter.requires.slice(0, 4).map((value) => value.slice(0, 80)),
    outputs: skill.frontmatter.outputs.slice(0, 4).map((value) => value.slice(0, 80))
  };
}

const skillListTool: AgentTool = {
  name: "skill.list",
  description: "Browse VDT skill cards to decide which guidance fits the full request.",
  inputSchema: z.object({ offset: z.number().int().min(0).max(2_000).optional() }).strict(),
  outputSchema: z.record(z.string(), z.unknown()),
  phase: "retrieving_skills",
  async run(context, input) {
    const library = await loadRunSkillLibrary(context);
    const state = context.store.getState(context.runId);
    const current = state.selectedSkills[0];
    const catalog = [...library.skills].sort((a, b) => Number(b.id === current?.id) - Number(a.id === current?.id));
    if (state.request.skillResolution) {
      const offset = input.offset ?? 0;
      if (offset && !state.events.some((event) => event.type === "skill_search" && event.metadata?.toolName === "skill.list"
        && event.metadata.nextOffset === offset)) {
        throw new AgentToolError("SKILL_CATALOG_OFFSET_UNKNOWN", "Use the nextOffset from a previous skill.list result.");
      }
      const applicable = catalog.filter((skill) => skill.id !== UNIVERSAL_SKILL_ID || skill.id === current?.id);
      const skills = applicable.slice(offset, offset + SKILL_CATALOG_PAGE_SIZE).map(semanticSkillCard);
      const nextOffset = offset + skills.length < applicable.length ? offset + skills.length : null;
      context.emit({
        type: "skill_search", title: "Skill catalog browsed",
        message: `Available skill cards reviewed: ${skills.length}.`,
        metadata: { toolName: "skill.list", candidateIds: skills.map((skill) => skill.id), nextOffset }
      });
      return { selectedSkill: current, skills, nextOffset };
    }
    return {
      selectedSkill: current,
      skills: catalog.map((skill) => ({
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
  outputSchema: z.record(z.string(), z.unknown()),
  phase: "retrieving_skills",
  async run(context, input) {
    const library = await loadRunSkillLibrary(context);
    const state = context.store.getState(context.runId);
    const semantic = Boolean(state.request.skillResolution);
    if (semantic && !skillCatalogProgress(state).catalogBrowsed) {
      throw new AgentToolError("SKILL_DISCOVERY_REQUIRED", "Browse the skill catalog before a scoped search.");
    }
    const classification = semantic ? undefined : classifyVdtRequest(input);
    const candidates = rankSkillCandidates([input.rootKpi, input.industry, input.businessContext, input.goal].filter(Boolean).join(" "), library)
      .filter(({ skill }) => !semantic || skill.id !== UNIVERSAL_SKILL_ID)
      .slice(0, input.maxSkills ?? 3).map((candidate) => semantic ? semanticSkillCard(candidate.skill) : {
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
    });
    context.emit({
      type: "skill_search",
      phase: "retrieving_skills",
      title: "Skill search completed",
      message: `Found ${candidates.length} candidate skill${candidates.length === 1 ? "" : "s"}.`,
      metadata: { toolName: "skill.search", candidateIds: candidates.map((candidate) => candidate.id), ...(semantic ? {} : { classification }) }
    });
    return semantic ? { candidates } : { classification, candidates };
  }
};

const skillReadTool: AgentTool = {
  name: "skill.read",
  description: "Read a local VDT skill excerpt and structured metadata without selecting or activating it.",
  inputSchema: z.object({
    skillId: z.string().min(1).max(160),
    maxChars: z.number().int().min(200).max(10_000).optional()
  }),
  outputSchema: z.record(z.string(), z.unknown()),
  phase: "reading_skills",
  async run(context, input) {
    const library = await loadRunSkillLibrary(context);
    const skill = library.byId.get(input.skillId);
    if (!skill) throw new AgentToolError("SKILL_NOT_FOUND", `Skill "${input.skillId}" was not found.`);
    const state = context.store.getState(context.runId);
    const pinned = state.request.input.skillSelection;
    if (state.request.skillResolution && pinned?.id !== skill.id && !state.events.some((event) => event.type === "skill_search"
      && Array.isArray(event.metadata?.candidateIds) && event.metadata.candidateIds.includes(skill.id))) {
      throw new AgentToolError("SKILL_DISCOVERY_REQUIRED", "Browse the skill catalog before reading an unpinned candidate.");
    }
    const [excerpt] = readSkillExcerpts([skill], input.maxChars);
    if (!excerpt) throw new AgentToolError("SKILL_READ_FAILED", `Skill "${input.skillId}" could not be read.`);
    const recipe = compileSkillRecipe(skill);
    const topology = readExecutableSkillTopology(skill);
    const contentHash = skillContentHash(skill.raw);
    const version = skill.frontmatter.version ?? 1;
    const readReceiptId = randomUUID();
    const selectedSkillIds = state.selectedSkills.map(({ id }) => id);
    context.emit({
      type: "skill_read",
      phase: "reading_skills",
      title: "Skill read",
      message: `Read ${skill.id}: ${skill.title}.`,
      metadata: {
        toolName: "skill.read", id: skill.id, path: skill.path, outputs: skill.frontmatter.outputs, contentHash, version, readReceiptId,
        selectedSkillIdsBefore: selectedSkillIds, selectedSkillIdsAfter: selectedSkillIds, selectionChanged: false
      }
    });
    if (state.request.skillResolution && !state.request.skillResolution.outcome && pinned?.source === "user"
      && pinned.id === skill.id && pinned.version === version && pinned.contentHash === contentHash) {
      context.updateRun({ request: { ...state.request, skillResolution: { ...state.request.skillResolution, outcome: "selected" } } });
    }
    return {
      id: excerpt.id,
      path: excerpt.path,
      title: excerpt.title,
      domain: excerpt.domain,
      version,
      contentHash,
      readReceiptId,
      excerpt: excerpt.excerpt,
      requiredInputs: skill.frontmatter.requires,
      outputs: excerpt.outputs ?? [],
      questions: excerpt.questions ?? [],
      referenceFiles: skill.frontmatter.referenceFiles ?? {},
      evalFiles: skill.frontmatter.evalFiles ?? {},
      runtimePolicy: skill.frontmatter.runtimePolicy ?? {},
      recipeQuality: recipe.recipeQuality,
      recipeSource: recipe.recipeSource,
      ...(topology ? { recommendedTools: ["skill.seed_topology"], executableTopology: {
        schemaVersion: topology.schemaVersion, nodeCount: topology.nodes.length, rootUnit: topology.rootUnit, timePeriod: topology.timePeriod,
        defaultInputs: topology.nodes.flatMap((node) => node.illustrativeDefault ? [{ nodeId: node.id, unit: node.unit, ...node.illustrativeDefault }] : [])
      } } : {}),
      formulaTemplates: recipe.formulaTemplates.map((formula) => `${formula.targetNodeId} = ${formula.formula}`)
    };
  }
};

const skillSelectTool: AgentTool = {
  name: "skill.select",
  description: "Choose the primary VDT skill using its exact readReceiptId and a brief reason.",
  inputSchema: z.object({
    skillId: z.string().min(1).max(160),
    reason: z.string().trim().min(1).max(500),
    readReceiptId: z.string().min(1).max(100).optional()
  }).strict(),
  outputSchema: z.record(z.string(), z.unknown()), phase: "reading_skills",
  async run(context, input) {
    const library = await loadRunSkillLibrary(context), skill = library.byId.get(input.skillId);
    if (!skill) throw new AgentToolError("SKILL_NOT_FOUND", "Skill was not found in this run's catalog.");
    const state = context.store.getState(context.runId), contentHash = skillContentHash(skill.raw);
    const resolution = state.request.skillResolution;
    const read = state.events.find((event) => event.type === "skill_read" && event.metadata?.id === skill.id && event.metadata.contentHash === contentHash
      && event.metadata.version === (skill.frontmatter.version ?? 1)
      && (!resolution && input.readReceiptId === undefined || event.metadata.readReceiptId === input.readReceiptId && typeof input.readReceiptId === "string"));
    if (!read) throw new AgentToolError("SKILL_READ_REQUIRED", "Read this exact skill version and pass its readReceiptId before selecting it.");
    const pinned = state.request.input.skillSelection;
    if (resolution && pinned?.source === "user") {
      if (pinned.id !== skill.id) throw new AgentToolError("SKILL_USER_PINNED", "Keep the skill selected by the user in Context.");
      return { selectedSkill: state.selectedSkills[0] };
    }
    if (resolution && context.requirePlanOperands
      && excludedExcavationSkillIds(state.request, skillCatalogProgress(state).candidateIds).includes(input.skillId)) {
      throw new AgentToolError("SKILL_SCOPE_MISMATCH", "The brief limits this output to the working face and excludes downstream transport. Select an applicable face-output skill using its exact read receipt.");
    }
    const selected = activateRunSkill(context, skill, input.reason);
    context.emit({
      type: "skill_selected", title: "Skill selected", message: `${skill.title}: ${input.reason}`,
      metadata: {
        ...selected, toolName: "skill.select", readReceiptIds: [read.metadata?.readReceiptId],
        ...(resolution ? { resolutionMode: "agent_semantic", usedLegacyMarkers: false, usedLanguageAliases: false } : {})
      }
    });
    return { selectedSkill: selected };
  }
};

const skillReportGapTool: AgentTool = {
  name: "skill.report_gap",
  description: "Record that no catalog skill applies and continue with the supplied facts.",
  inputSchema: z.object({ reason: z.string().trim().min(1).max(500) }).strict(),
  outputSchema: z.record(z.string(), z.unknown()),
  phase: "planning_decomposition",
  run(context, input) {
    const state = context.store.getState(context.runId);
    const resolution = state.request.skillResolution;
    if (!resolution || state.selectedSkills.length) throw new AgentToolError("SKILL_GAP_NOT_ALLOWED", "A skill gap is available only for a new tree without a selected skill.");
    const { catalogBrowsed, catalogComplete, scopedSearchReviewed, searchCandidateIds, candidateIds } = skillCatalogProgress(state);
    if (!catalogBrowsed) {
      throw new AgentToolError("SKILL_DISCOVERY_REQUIRED", "Browse the skill catalog before reporting a gap.");
    }
    if (!catalogComplete && !scopedSearchReviewed) {
      throw new AgentToolError("SKILL_CATALOG_REVIEW_REQUIRED", "Review additional catalog pages, or search for the requested process and read the returned candidates before reporting a gap.");
    }
    if (context.requirePlanOperands && excludedExcavationSkillIds(state.request, candidateIds).length) {
      throw new AgentToolError("SKILL_SCOPE_MATCH_AVAILABLE", "The catalog contains a skill for the explicitly requested face output. Read its exact version before selecting it.");
    }
    const outcome = "no_applicable_skill";
    if (resolution.outcome !== outcome) {
      context.updateRun({ request: { ...state.request, skillResolution: { ...resolution, outcome } } });
      context.emit({
        type: "skill_search", title: "No applicable skill", message: input.reason,
        metadata: { toolName: "skill.report_gap", outcome, catalogComplete, scopedSearchReviewed, searchCandidateIds }
      });
    }
    return { outcome };
  }
};

const skillCompileRecipeTool: AgentTool = {
  name: "skill.compile_recipe",
  description: "Compile a local markdown skill into a structured executable VDT recipe.",
  inputSchema: z.object({
    skillId: z.string().min(1).max(160)
  }),
  outputSchema: z.record(z.string(), z.unknown()),
  phase: "planning_decomposition",
  async run(context, input) {
    requireSelectedRunSkill(context, input.skillId);
    const library = await loadRunSkillLibrary(context);
    const skill = library.byId.get(input.skillId);
    if (!skill) throw new AgentToolError("SKILL_NOT_FOUND", `Skill "${input.skillId}" was not found.`);
    const recipe = compileSkillRecipe(skill);
    let state = context.store.getState(context.runId);
    if (!state.selectedSkills.some(selected => selected.id === skill.id)) {
      if (state.selectedSkills[0]?.source === "user") throw new AgentToolError("SKILL_SELECTION_REQUIRED", "Read and explicitly select a different skill before compiling it instead of the user's choice.");
      activateRunSkill(context, skill, "Compiled explicitly by agent decision.");
      state = context.store.getState(context.runId);
    }
    const selectedSkills = state.selectedSkills;
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
      selectedSkills,
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
    knownInputs: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
    maxInitialDrivers: z.number().int().min(1).max(12).optional()
  }),
  outputSchema: z.record(z.string(), z.unknown()),
  mutatesProject: true,
  phase: "building_graph",
  async run(context, input) {
    requireSelectedRunSkill(context, input.skillId);
    const builder = context.builder;
    if (!builder) throw new AgentToolError("NO_DRAFT_PROJECT", "VDT builder session is not available for this run.");
    const state = context.store.getState(context.runId);
    let recipe = state.recipes.find((candidate) => candidate.skillId === input.skillId);
    if (!recipe) {
      const library = await loadRunSkillLibrary(context);
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
