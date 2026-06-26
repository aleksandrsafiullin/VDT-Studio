import { z } from "zod";
import {
  classifyVdtRequest,
  compileSkillRecipe,
  loadDefaultSkillLibrary,
  readSkillExcerpts,
  retrieveSkills
} from "@vdt-studio/vdt-agent";
import type { AgentTool } from "../tool-registry";

export function createSkillTools(): AgentTool[] {
  return [skillSearchTool, skillReadTool, skillCompileRecipeTool];
}

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
  outputSchema: z.object({
    classification: z.record(z.unknown()),
    candidates: z.array(z.object({
      id: z.string(),
      path: z.string(),
      title: z.string(),
      score: z.number(),
      reason: z.string(),
      matchedTerms: z.array(z.string())
    }))
  }),
  async run(_context, input) {
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
      matchedTerms: candidate.matchedTerms
    }));
    return { classification, candidates };
  }
};

const skillReadTool: AgentTool = {
  name: "skill.read",
  description: "Read a selected local VDT skill excerpt.",
  inputSchema: z.object({
    skillId: z.string().min(1).max(160),
    maxChars: z.number().int().min(200).max(10_000).optional()
  }),
  outputSchema: z.object({
    id: z.string(),
    path: z.string(),
    title: z.string(),
    domain: z.string(),
    excerpt: z.string(),
    outputs: z.array(z.string()),
    questions: z.array(z.string())
  }),
  async run(_context, input) {
    const library = await loadDefaultSkillLibrary();
    const skill = library.byId.get(input.skillId);
    if (!skill) throw new Error(`Skill "${input.skillId}" was not found.`);
    const [excerpt] = readSkillExcerpts([skill], input.maxChars);
    if (!excerpt) throw new Error(`Skill "${input.skillId}" could not be read.`);
    return {
      id: excerpt.id,
      path: excerpt.path,
      title: excerpt.title,
      domain: excerpt.domain,
      excerpt: excerpt.excerpt,
      outputs: excerpt.outputs ?? [],
      questions: excerpt.questions ?? []
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
  async run(_context, input) {
    const library = await loadDefaultSkillLibrary();
    const skill = library.byId.get(input.skillId);
    if (!skill) throw new Error(`Skill "${input.skillId}" was not found.`);
    return compileSkillRecipe(skill) as unknown as Record<string, unknown>;
  }
};
