import { loadAvailableSkillLibrary, parseSkillMarkdown, skillCard, type VdtSkill, type VdtSkillLibrary } from "@vdt-studio/vdt-agent";
import { LocalSkillRepository, SkillLibraryError, skillContentHash } from "@vdt-studio/storage";
import { AgentToolError, type AgentToolContext } from "../tool-registry";
import type { VdtAgentRunState } from "../types";

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

function persistRunSkillSelection(context: AgentToolContext, skillId: string, version: number, contentHash: string, reason: string) {
  const { workspace, input, skillResolution } = context.store.getState(context.runId).request;
  if (workspace?.projectId && workspace.vdtId) {
    const repository = new LocalSkillRepository(), previous = repository.getSelection(workspace.projectId, workspace.vdtId);
    // A read of Context may initialize or refresh its provisional auto choice
    // while the agent browses. Rebase only that provisional record, with CAS.
    const expectedRevision = previous?.source === "auto"
      ? previous.revision
      : skillResolution?.selectionRevision ?? previous?.revision ?? 0;
    try {
      return repository.select(workspace.projectId, workspace.vdtId, { skillId, version, contentHash, reason, source: "agent", rootKpi: input.rootKpi ?? "" },
        expectedRevision).revision;
    } catch (error) {
      if (error instanceof SkillLibraryError && error.code === "SKILL_CONFLICT") {
        throw new AgentToolError(error.code, "The selected skill changed in Context. Start a new run with the current choice.");
      }
      throw error;
    }
  }
}

export function activateRunSkill(context: AgentToolContext, skill: VdtSkill, reason: string) {
  const state = context.store.getState(context.runId), contentHash = skillContentHash(skill.raw), version = skill.frontmatter.version ?? 1;
  const selectionRevision = persistRunSkillSelection(context, skill.id, version, contentHash, reason);
  const selected = { id: skill.id, title: skill.title, path: skill.path, version, contentHash, score: 100, matchedTerms: [], reason, source: "agent" as const };
  const resolution = state.request.skillResolution;
  context.updateRun({ selectedSkills: [selected], request: {
    ...state.request,
    ...(resolution ? { skillResolution: { selectionRevision: selectionRevision ?? resolution.selectionRevision, outcome: "selected" } } : {}),
    input: { ...state.request.input, skillSelection: { ...skillCard(skill), raw: skill.raw, path: skill.path, source: "agent", reason } }
  } });
  return selected;
}

export function requireSelectedRunSkill(context: AgentToolContext, skillId: string) {
  const state = context.store.getState(context.runId);
  if (state.request.skillResolution && (state.request.skillResolution.outcome !== "selected" || state.selectedSkills[0]?.id !== skillId)) {
    throw new AgentToolError("SKILL_SELECTION_REQUIRED", "Read and select this skill before using its executable tools.");
  }
}

export function skillCatalogProgress(state: Pick<VdtAgentRunState, "events">) {
  const lookups = state.events.filter((event) => event.type === "skill_search");
  const catalogs = lookups.filter((event) => event.metadata?.toolName === "skill.list");
  const latestCatalog = catalogs.at(-1);
  const catalogComplete = catalogs.some((event) => event.metadata?.nextOffset === null);
  const scopedSearches = lookups.filter((event) => event.metadata?.toolName === "skill.search");
  const candidateIdsFrom = (event: (typeof lookups)[number] | undefined): string[] =>
    Array.isArray(event?.metadata?.candidateIds)
      ? event.metadata.candidateIds.filter((id): id is string => typeof id === "string") : [];
  const searchCandidateIds = [...new Set(scopedSearches.flatMap(candidateIdsFrom))];
  const readIds = new Set(state.events.flatMap((event) =>
    event.type === "skill_read" && typeof event.metadata?.id === "string" ? [event.metadata.id] : []));
  const unreadSearchCandidateIds = searchCandidateIds.filter((id) => !readIds.has(id));
  return {
    catalogBrowsed: Boolean(latestCatalog), catalogComplete, nextOffset: latestCatalog?.metadata?.nextOffset,
    scopedSearchReviewed: scopedSearches.length > 0 && unreadSearchCandidateIds.length === 0,
    searchCandidateIds,
    candidateIds: [...new Set([...unreadSearchCandidateIds,
      ...[...catalogs].reverse().flatMap(candidateIdsFrom).filter((id) => !readIds.has(id))])].slice(0, 24)
  };
}
