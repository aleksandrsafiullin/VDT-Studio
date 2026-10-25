import { loadAvailableSkillLibrary, parseSkillMarkdown, skillCard, type VdtSkill, type VdtSkillLibrary } from "@vdt-studio/vdt-agent";
import { LocalSkillRepository, skillContentHash } from "@vdt-studio/storage";
import type { AgentToolContext } from "../tool-registry";

const libraries = new WeakMap<AbortSignal, Promise<VdtSkillLibrary>>();
/** Snapshot the catalog on first access; edits in Settings cannot rewrite a run. */
export function loadRunSkillLibrary(context: AgentToolContext): Promise<VdtSkillLibrary> {
  let library = libraries.get(context.signal);
  if (!library) {
    library = loadAvailableSkillLibrary().then(available => {
      const pin = context.store.getState(context.runId).request.input.skillSelection;
      if (!pin) return available;
      if (skillContentHash(pin.raw) !== pin.contentHash) throw new Error("Pinned skill integrity check failed.");
      const skill = parseSkillMarkdown(pin.path, pin.raw);
      return { ...available, skills: [...available.skills.filter(candidate => candidate.id !== skill.id), skill], byId: new Map([...available.byId, [skill.id, skill]]) };
    });
    libraries.set(context.signal, library);
  }
  return library;
}

export function persistRunSkillSelection(context: AgentToolContext, skillId: string, version: number, contentHash: string, reason: string) {
  const { workspace, input } = context.store.getState(context.runId).request;
  if (workspace?.projectId && workspace.vdtId) {
    const repository = new LocalSkillRepository(), previous = repository.getSelection(workspace.projectId, workspace.vdtId);
    repository.select(workspace.projectId, workspace.vdtId, { skillId, version, contentHash, reason, source: "agent", rootKpi: input.rootKpi ?? "" }, previous?.revision ?? 0);
  }
}

export function activateRunSkill(context: AgentToolContext, skill: VdtSkill, reason: string) {
  const state = context.store.getState(context.runId), contentHash = skillContentHash(skill.raw), version = skill.frontmatter.version ?? 1;
  persistRunSkillSelection(context, skill.id, version, contentHash, reason);
  const selected = { id: skill.id, title: skill.title, path: skill.path, version, contentHash, score: 100, matchedTerms: [], reason, source: "agent" as const };
  context.updateRun({ selectedSkills: [selected], request: { ...state.request, input: { ...state.request.input, skillSelection: {
    ...skillCard(skill), raw: skill.raw, path: skill.path, source: "agent", reason
  } } } });
  return selected;
}
