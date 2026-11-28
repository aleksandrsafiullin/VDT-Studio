import { createHash } from "node:crypto";
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
  if (state.request.outcome === "answer") {
    throw new AgentToolError("SKILL_SELECTION_READ_ONLY", "An answer run can read Skill guidance without changing the Context selection.");
  }
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

/** Explicit Context edits supersede a run's previously observed selection.
 * The editor's preliminary suggestion remains provisional during discovery. */
export function assertRunSkillSelectionCurrent(context: AgentToolContext) {
  const { request, selectedSkills } = context.store.getState(context.runId);
  const { workspace, skillResolution: resolution } = request;
  if (!resolution || !workspace?.vdtId) return;
  const current = new LocalSkillRepository().getSelection(workspace.projectId, workspace.vdtId);
  const pinned = request.input.skillSelection;
  const selected = resolution.outcome === "selected" ? selectedSkills[0] : pinned?.source === "user" ? pinned : undefined;
  if (selected ? current?.revision !== resolution.selectionRevision || current?.skillId !== selected.id
      || current?.version !== selected.version || current?.contentHash !== selected.contentHash
    : current?.source !== "auto" && (current?.revision ?? 0) !== resolution.selectionRevision) {
    throw new AgentToolError("SKILL_CONFLICT", "The selected skill changed in Context. Start a new run with the current choice.");
  }
}

function submittedSkillScope(state: Pick<VdtAgentRunState, "chatMessages">) {
  const messages = state.chatMessages;
  const isScope = ({ id }: { id: string }) => id === "process_relationship" || id === "skill_scope";
  const latest = [...messages].reverse().find(message => message.kind === "question" && message.questions?.some(isScope));
  const questionId = latest?.questions?.find(isScope)?.id;
  const source = latest && questionId ? messages.slice(messages.indexOf(latest) + 1).find(message =>
    message.role === "user" && message.kind === "answer" && message.answers?.some(answer =>
      answer.questionId === questionId && Boolean(answer.freeText?.trim() || answer.selectedOptionIds?.length
        || Object.keys(answer.fields ?? {}).length))) : undefined;
  return { questionId, source };
}

export function assertSkillScopeAnswered(state: VdtAgentRunState) {
  const scope = submittedSkillScope(state);
  if (scope.questionId && !scope.source) {
    throw new AgentToolError("SKILL_SCOPE_UNRESOLVED", "Wait for the user's actual process scope answer before choosing a method.");
  }
}

export function announceRunSkill(
  context: AgentToolContext,
  selected: VdtAgentRunState["selectedSkills"][number],
  readReceiptId: string | undefined,
  toolName: "skill.read" | "skill.select",
  methodConfirmationSourceMessageId?: string
) {
  const state = context.store.getState(context.runId);
  const resolution = state.request.skillResolution;
  const selectionId = createHash("sha256").update(JSON.stringify([
    state.runId, selected.id, selected.version, selected.contentHash, resolution?.selectionRevision
  ])).digest("hex");
  if (state.events.some(event => event.type === "skill_selected" && event.metadata?.selectionId === selectionId)) return;
  const { source: scopeSource } = submittedSkillScope(state);
  const message = `${selected.title}. ${selected.reason}`;
  context.emit({
    type: "skill_selected", title: selected.title, message,
    metadata: {
      ...selected, toolName, methodTitle: selected.title, readReceiptId, selectionId,
      selectionRevision: resolution?.selectionRevision,
      readReceiptIds: readReceiptId ? [readReceiptId] : [],
      ...(scopeSource ? { scopeSourceMessageId: scopeSource.id } : {}),
      ...(methodConfirmationSourceMessageId ? { methodConfirmationSourceMessageId } : {}),
      ...(resolution ? { resolutionMode: "agent_semantic", usedLegacyMarkers: false, usedLanguageAliases: false } : {})
    }
  });
  if (resolution) context.store.appendChatMessage(state.runId, { role: "assistant", kind: "status", text: message });
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
