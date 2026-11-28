import { agentHumanInputSchema, collectLiteralUserQuantities, type AgentHumanInput, type LiteralUserQuantity } from "@vdt-studio/vdt-agent-runtime";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => !!value && typeof value === "object" && !Array.isArray(value);

type SkillVersion = { id: string; version: number; contentHash: string };
type SkillReadReceipt = SkillVersion & { readReceiptId: string; scopeExcerpt: string };
type UserAnswer = Extract<AgentHumanInput, { type: "user_answer" }>;

const MAX_RETAINED_ANSWER_SETS = 4;
const MAX_RETAINED_ANSWER_CHARS = 4_000;

export type LocalSkillResolution = {
  catalogBrowsed: boolean;
  nextCatalogOffset: number | undefined;
  gapAvailable: boolean;
  pinnedSkillId: string | undefined;
  pinAwaitingConfirmation?: boolean;
  selectedSkillId: string | undefined;
  gapReported: boolean;
  readReceipts: Array<{ skillId: string; readReceiptId: string }>;
  searchCandidateIds?: string[];
  unreadScopedCandidateIds?: string[];
};

function skillVersion(value: unknown): SkillVersion | undefined {
  if (!record(value) || typeof value.id !== "string" || typeof value.version !== "number"
    || !Number.isSafeInteger(value.version) || value.version < 1
    || typeof value.contentHash !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value.contentHash)) return;
  return { id: value.id, version: value.version, contentHash: value.contentHash };
}

function matchesVersion(version: SkillVersion, receipt?: SkillReadReceipt): boolean {
  return receipt?.id === version.id && receipt.version === version.version && receipt.contentHash === version.contentHash;
}

function isMethodDecision(input: AgentHumanInput, questionId: string | undefined): boolean {
  if (!questionId || input.type !== "user_answer") return false;
  const choices = (value: unknown) => {
    const items = Array.isArray(value) ? value : [value];
    return items.length === 1 && (items[0] === "accept_method" || items[0] === "decline_method");
  };
  const { structuredAnswers, ...plain } = input.answers;
  const entries = Object.entries(plain);
  if (!structuredAnswers) return entries.length === 1 && entries[0]?.[0] === questionId && choices(entries[0][1]);
  if (entries.length || !Array.isArray(structuredAnswers) || structuredAnswers.length !== 1) return false;
  const [answer] = structuredAnswers;
  return record(answer) && answer.questionId === questionId && answer.freeText === undefined && answer.fields === undefined
    && choices(answer.selectedOptionIds);
}

/** Bounded, run-local read evidence. A semantic checkpoint is not a substitute
 * for exact tool fields or discovered skill IDs. These are confirmed Gateway
 * results only; retaining them cannot select a skill or mutate a project. */
export class LocalModelKnowledge {
  private readonly admitted = new Set<string>();
  private readonly schemas = new Map<string, unknown>();
  private readonly skills = new Map<string, RecordValue>();
  private readonly excerpts = new Map<string, RecordValue>();
  private initialized = false;
  private readonly quantities: LiteralUserQuantity[] = [];
  private quantitiesTruncated = false;
  private brief: RecordValue | undefined;
  private conversationContext: RecordValue | undefined;
  private receivedHumanInput = false;
  private readonly recentUserAnswers = new Map<string, UserAnswer>();
  private userAnswersTruncated = false;
  private readonly topologies = new Map<string, { skillId: string; defaultInputIds: string[] }>();
  private readonly readIds = new Set<string>();
  private nextCatalogOffset: number | null | undefined;
  private searchCandidateIds: string[] | undefined;
  private scopedSearchCandidates: Map<string, SkillVersion> | undefined;
  private structuralOutcome = false;
  private methodQuestionId: string | undefined;
  private readonly humanInputExchanges = new Set<string>();
  private readonly seenGapRejections = new Set<string>();
  private structuralScopeInstruction: string | undefined;
  private readonly seenScopedSearchCalls = new Set<string>();
  private readonly pendingCatalogSearchReads = new Set<string>();
  private readonly skillReadReceipts = new Map<string, SkillReadReceipt>();
  private selectedSkillId: string | undefined;
  private pinAwaitingConfirmation = false;
  private gapReported = false;
  private readonly dataEvidence = new Map<string, RecordValue>();
  private readonly researchEvidence = new Map<string, RecordValue>();

  hasReadSkill(): boolean { return this.excerpts.size > 0; }
  discoveredSkillIds(): string[] { return [...new Set([...this.skills.keys(), ...this.pendingCatalogSearchReads])]; }
  readTopologyDefinitions(): Array<{ skillId: string; defaultInputIds: string[] }> { return [...this.topologies.values()]; }
  readSkillIds(): string[] { return [...this.readIds]; }
  skillResolution(): LocalSkillResolution | undefined {
    if (this.brief?.skillResolution !== "agent_semantic") return;
    const pin = skillVersion(this.brief.selectedSkill);
    const scoped = this.structuralOutcome && !pin;
    const searchCandidateIds = scoped
      ? this.scopedSearchCandidates && [...this.scopedSearchCandidates.keys()] : this.searchCandidateIds;
    return {
      catalogBrowsed: this.nextCatalogOffset !== undefined,
      nextCatalogOffset: this.nextCatalogOffset ?? undefined,
      gapAvailable: !pin && this.canReportSkillGap(),
      pinnedSkillId: pin?.id,
      selectedSkillId: pin && !this.pinAwaitingConfirmation
        ? (matchesVersion(pin, this.skillReadReceipts.get(pin.id)) ? pin.id : undefined) : this.selectedSkillId,
      pinAwaitingConfirmation: this.pinAwaitingConfirmation,
      gapReported: !pin && this.gapReported,
      readReceipts: [...this.skillReadReceipts.values()].map(({ id, readReceiptId }) => ({ skillId: id, readReceiptId })),
      ...(searchCandidateIds ? { searchCandidateIds: [...searchCandidateIds] } : {}),
      ...(scoped && this.scopedSearchCandidates ? { unreadScopedCandidateIds: this.unreadScopedCandidateIds() } : {})
    };
  }
  private canReportSkillGap(): boolean {
    return this.nextCatalogOffset === null && (!this.structuralOutcome || Boolean(this.scopedSearchCandidates)
      && this.unreadScopedCandidateIds().length === 0);
  }

  private unreadScopedCandidateIds(): string[] {
    return [...this.scopedSearchCandidates ?? []].flatMap(([id, version]) => {
      return matchesVersion(version, this.skillReadReceipts.get(id)) ? [] : [id];
    });
  }

  originalBrief(): RecordValue | undefined { return this.brief; }
  latestScopeInstruction(): string | undefined { return this.structuralScopeInstruction; }
  literalUserQuantities(): LiteralUserQuantity[] | undefined { return this.receivedHumanInput || this.quantitiesTruncated ? undefined : this.quantities; }

  observePrompt(prompt: string): void {
    try {
      const input: unknown = JSON.parse(prompt);
      if (record(input) && record(input.delta)) {
        const carriesHumanInput = ["human_input", "human_inputs", "checkpoint_inputs"].includes(String(input.delta.type));
        const exchangeId = carriesHumanInput && typeof input.exchangeId === "string" && input.exchangeId.trim() ? input.exchangeId : undefined;
        const alreadyPresented = exchangeId !== undefined && this.humanInputExchanges.has(exchangeId);
        if (exchangeId) this.humanInputExchanges.add(exchangeId);
        this.observe(input.delta, !alreadyPresented);
      }
    } catch { /* Non-agent provider input has no Gateway evidence. */ }
  }

  structuralSkillReadMetadata(ids?: readonly string[]) {
    const candidates = this.scopedSearchCandidates;
    return [...this.skillReadReceipts.values()].filter(receipt => {
      if (!ids) return true;
      if (!ids.includes(receipt.id)) return false;
      const version = candidates?.get(receipt.id);
      return !version || matchesVersion(version, receipt);
    }).slice(-10).map(({ id, scopeExcerpt }) => ({ id, scopeExcerpt }));
  }

  structuralSkillCards(candidateIds: readonly string[]) {
    const ids = candidateIds.slice(-10);
    return { entries: ids.flatMap(id => this.skills.get(id) ?? []), truncated: candidateIds.length > ids.length };
  }

  context(): RecordValue {
    const entries: RecordValue[] = [];
    const omittedToolNames: string[] = [];
    let chars = 0;
    for (const [name, schema] of [...this.schemas].reverse()) {
      const entry = { name, inputJsonSchema: schema };
      const length = JSON.stringify(entry).length;
      if (chars + length > 6_000) { omittedToolNames.push(name); continue; }
      entries.push(entry); chars += length;
    }
    const result: RecordValue = {};
    if (entries.length || omittedToolNames.length) result.toolArgumentGuides = { entries, omittedToolNames };
    if (this.skills.size) result.discoveredSkills = { entries: [...this.skills.values()].slice(-30), truncated: this.skills.size > 30 };
    if (this.excerpts.size) {
      const selected = this.selectedSkillId && this.excerpts.get(this.selectedSkillId);
      result.readSkills = selected ? [selected] : [...this.excerpts.values()].slice(-1);
    }
    if (this.quantities.length) result.literalUserQuantities = this.quantities;
    if (this.quantitiesTruncated) result.literalUserQuantitiesTruncated = true;
    if (JSON.stringify(result).length > 10_000) { delete result.readSkills; result.readSkillsOmitted = true; }
    const skills = result.discoveredSkills as { entries: RecordValue[]; truncated: boolean } | undefined;
    while (JSON.stringify(result).length > 10_000 && skills && skills.entries.length > 2) { skills.entries.shift(); skills.truncated = true; }
    while (JSON.stringify(result).length > 10_000 && entries.length) omittedToolNames.push(String(entries.pop()!.name));
    // Exact retained-source IDs, query definitions/results and cited URLs must
    // survive an intervening schema lookup or graph read. They are untrusted
    // observations, not executable instructions or new mutation authority.
    const evidence = [...this.dataEvidence.values(), ...this.researchEvidence.values()];
    const retained: RecordValue[] = [];
    let evidenceChars = 0;
    for (const item of evidence.reverse()) {
      const chars=JSON.stringify(item).length;
      if(evidenceChars+chars>8_000)continue;
      retained.unshift(item);evidenceChars+=chars;
    }
    if(retained.length)result.confirmedSourceObservations={untrustedData:true,entries:retained,truncated:retained.length<evidence.length};
    if (this.conversationContext) result.conversation = this.conversationContext;
    if (this.recentUserAnswers.size) result.recentUserAnswers = [...this.recentUserAnswers.values()];
    if (this.userAnswersTruncated) result.recentUserAnswersTruncated = true;
    return result;
  }

  private rememberHumanInput(input: unknown): void {
    const parsed = agentHumanInputSchema.safeParse(input);
    if (!parsed.success) return;
    this.receivedHumanInput = true;
    if (this.structuralOutcome && parsed.data.type === "user_instruction") this.structuralScopeInstruction = parsed.data.text;
    if (this.structuralOutcome && !this.selectedSkillId && !this.gapReported
      && !isMethodDecision(parsed.data, this.methodQuestionId)) {
      this.scopedSearchCandidates = undefined;
      this.methodQuestionId = undefined;
    }
    if (parsed.data.type !== "user_answer") return;

    const answer = parsed.data;
    this.recentUserAnswers.delete(answer.questionSetId);
    if (JSON.stringify([answer]).length > MAX_RETAINED_ANSWER_CHARS) {
      this.userAnswersTruncated = true;
      return;
    }
    this.recentUserAnswers.set(answer.questionSetId, answer);
    while (this.recentUserAnswers.size > MAX_RETAINED_ANSWER_SETS
      || JSON.stringify([...this.recentUserAnswers.values()]).length > MAX_RETAINED_ANSWER_CHARS) {
      this.recentUserAnswers.delete(this.recentUserAnswers.keys().next().value!);
      this.userAnswersTruncated = true;
    }
  }

  private observe(delta: RecordValue, acceptHumanInput: boolean): void {
    if (delta.type === "initial_context" && record(delta.context) && Array.isArray(delta.context.tools)) {
      if (this.initialized) return;
      this.initialized = true;
      if (record(delta.context.conversationContext)) this.conversationContext = structuredClone(delta.context.conversationContext);
      for (const tool of delta.context.tools) if (record(tool) && typeof tool.name === "string") this.admitted.add(tool.name);
      if (record(delta.context.brief)) {
        this.brief = structuredClone(delta.context.brief);
        this.structuralOutcome = this.brief.outcome === "structural_model";
        const { quantities, truncated } = collectLiteralUserQuantities([this.brief.prompt, this.brief.businessContext],
          typeof this.brief.unit === "string" ? this.brief.unit : undefined);
        this.quantities.push(...quantities);
        this.quantitiesTruncated = truncated;
      }
    } else if (delta.type === "human_input") {
      if (acceptHumanInput) this.rememberHumanInput(delta.input);
    } else if (delta.type === "checkpoint_inputs" && record(delta.checkpointDelta)) {
      this.observe(delta.checkpointDelta, acceptHumanInput);
      if (acceptHumanInput && Array.isArray(delta.inputs)) for (const input of delta.inputs) this.rememberHumanInput(input);
    } else if (delta.type === "human_inputs" && acceptHumanInput && Array.isArray(delta.inputs)) {
      for (const input of delta.inputs) this.rememberHumanInput(input);
    } else if ((delta.type === "tool_results" || delta.type === "manual_reconciliation") && Array.isArray(delta.results)) {
      for (const result of delta.results) {
        if (!record(result) || !this.admitted.has(String(result.toolName))) continue;
        const callId = typeof result.externalCallId === "string" && result.externalCallId.trim() ? result.externalCallId : undefined;
        const confirmed = callId !== undefined && result.resultCode === "OK";
        const strictSkillDiscovery = this.structuralOutcome && this.brief?.skillResolution === "agent_semantic"
          && !skillVersion(this.brief.selectedSkill);
        if (strictSkillDiscovery && callId && result.toolName === "skill.report_gap" && result.status === "failed"
          && result.resultCode === "SKILL_CATALOG_REVIEW_REQUIRED" && !this.seenGapRejections.has(callId)) {
          this.seenGapRejections.add(callId);
          this.scopedSearchCandidates = undefined;
        }
        if (!record(result.payload) || !record(result.payload.output)) continue;
        const output = result.payload.output;
        if (strictSkillDiscovery && !confirmed && ["skill.list", "skill.search", "skill.read", "skill.select", "skill.report_gap"].includes(String(result.toolName))) continue;
        if (this.structuralOutcome && result.toolName === "skill.select" && result.status === "waiting_user"
          && record(output.proposedSkill) && Array.isArray(output.questions) && output.questions.length === 1) {
          const proposed = skillVersion(output.proposedSkill);
          const receipt = proposed && this.skillReadReceipts.get(proposed.id);
          const [question] = output.questions;
          if (proposed && matchesVersion(proposed, receipt) && output.proposedSkill.readReceiptId === receipt?.readReceiptId
            && record(question) && typeof question.id === "string") this.methodQuestionId = question.id;
        }
        if (!["succeeded", "replayed"].includes(String(result.status))) continue;
        if (result.toolName === "run.propose_outcome" && this.brief?.outcomeSelection === "automatic") {
          this.structuralOutcome = output.outcome === "structural_model";
        }
        if (String(result.toolName).startsWith("data.")) {
          const key=String(result.toolName)+":"+String(output.datasetId??"sources")+":"+String(output.queryHash??output.tableId??"")+":"+String(output.offset??"");
          const retainedOutput=result.toolName==="data.inspect"&&Array.isArray(output.tables)
            ? {...output,tables:output.tables.filter(record).map((table)=>({tableId:table.tableId,name:table.name,columns:table.columns,rowCount:table.rowCount,truncated:table.truncated,layoutIssue:table.layoutIssue}))}:output;
          const item={toolName:result.toolName,output:structuredClone(retainedOutput)};
          if(JSON.stringify(item).length<=8_000){this.dataEvidence.delete(key);this.dataEvidence.set(key,item);}
          while(this.dataEvidence.size>12)this.dataEvidence.delete(this.dataEvidence.keys().next().value!);
        }
        if (result.toolName === "research.search_web" && Array.isArray(output.results)) {
          for(const source of output.results){
            if(!record(source)||typeof source.url!=="string"||typeof source.snippet!=="string")continue;
            this.researchEvidence.set(source.url,{toolName:result.toolName,source:{url:source.url,title:source.title,snippet:source.snippet.slice(0,1200),retrievedAt:source.retrievedAt}});
          }
          while(this.researchEvidence.size>6)this.researchEvidence.delete(this.researchEvidence.keys().next().value!);
        }
        if (result.toolName === "tools.describe" && Array.isArray(output.tools)) {
          for (const tool of output.tools) {
            if (!record(tool) || typeof tool.name !== "string" || !this.admitted.has(tool.name) || !record(tool.inputJsonSchema)) continue;
            this.schemas.delete(tool.name);
            this.schemas.set(tool.name, structuredClone(tool.inputJsonSchema));
          }
        }
        if (result.toolName === "skill.list" || result.toolName === "skill.search") {
          const candidates = output.skills ?? output.candidates;
          if (Array.isArray(candidates)) {
            if (result.toolName === "skill.list") {
              const nextOffset = output.nextOffset;
              if (nextOffset === null || (this.nextCatalogOffset !== null && typeof nextOffset === "number"
                && Number.isSafeInteger(nextOffset) && nextOffset > (this.nextCatalogOffset ?? 0))) {
                this.nextCatalogOffset = nextOffset;
                if (nextOffset === null) this.pendingCatalogSearchReads.clear();
              }
            }
            const scopedSearch = result.toolName === "skill.search" && typeof this.nextCatalogOffset === "number";
            const candidateIds: string[] = [];
            for (const skill of candidates.slice(0, 50)) {
              const id = this.rememberSkill(skill);
              if (id) candidateIds.push(id);
              if (scopedSearch && id && !this.skillReadReceipts.has(id)) this.pendingCatalogSearchReads.add(id);
            }
            if (result.toolName === "skill.search" && this.brief?.skillResolution === "agent_semantic") {
              this.searchCandidateIds = candidateIds;
              // A replay of older work cannot establish evidence for newly
              // presented scope, and malformed cards cannot prove an empty search.
              if (strictSkillDiscovery && callId && result.status === "succeeded" && candidateIds.length === candidates.length) {
                const versions = candidates.map(skillVersion);
                if (versions.every((version): version is SkillVersion => Boolean(version))
                  && !this.seenScopedSearchCalls.has(callId)) {
                  this.seenScopedSearchCalls.add(callId);
                  const scoped = this.scopedSearchCandidates ??= new Map();
                  for (const version of versions) scoped.set(version.id, version);
                }
              }
            }
          }
        }
        if (result.toolName === "skill.read" && typeof output.id === "string") {
          if (typeof output.pinAwaitingConfirmation === "boolean") this.pinAwaitingConfirmation = output.pinAwaitingConfirmation;
          this.readIds.add(output.id);
          this.rememberSkill(output);
          const version = skillVersion(output);
          const excerpt = typeof output.excerpt === "string" ? output.excerpt : "";
          if (version && typeof output.readReceiptId === "string" && output.readReceiptId.length > 0 && output.readReceiptId.length <= 200) {
            this.skillReadReceipts.set(output.id, { ...version, readReceiptId: output.readReceiptId, scopeExcerpt: excerpt.slice(0, 1_100) });
            this.pendingCatalogSearchReads.delete(output.id);
            while (this.skillReadReceipts.size > 50) this.skillReadReceipts.delete(this.skillReadReceipts.keys().next().value!);
          }
          this.excerpts.delete(output.id);
          this.excerpts.set(output.id, {
            id: output.id, title: output.title, excerpt: excerpt.slice(0, output.executableTopology ? 800 : 1_800), truncated: excerpt.length > (output.executableTopology ? 800 : 1_800),
            ...(Array.isArray(output.formulaTemplates) ? { formulaTemplates: output.formulaTemplates.slice(0, output.executableTopology ? 4 : 12).map((value) => String(value).slice(0, 180)) } : {}),
            ...(record(output.executableTopology) ? { executableTopology: output.executableTopology, recommendedTools: output.recommendedTools } : {})
          });
          if (record(output.executableTopology) && Array.isArray(output.executableTopology.defaultInputs)) {
            const ids = output.executableTopology.defaultInputs.flatMap((entry) => record(entry) && typeof entry.nodeId === "string" ? [entry.nodeId] : []);
            if (ids.length <= 24 && new Set(ids).size === ids.length) this.topologies.set(output.id, { skillId: output.id, defaultInputIds: ids });
            while (this.topologies.size > 8) this.topologies.delete(this.topologies.keys().next().value!);
          }
          while (this.excerpts.size > 2) this.excerpts.delete(this.excerpts.keys().next().value!);
        }
        if (result.toolName === "skill.select") {
          const selected = skillVersion(output.selectedSkill);
          if (selected && matchesVersion(selected, this.skillReadReceipts.get(selected.id))) {
            this.selectedSkillId = selected.id;
            this.pinAwaitingConfirmation = false;
            this.methodQuestionId = undefined;
            this.gapReported = false;
          }
        }
        if (result.toolName === "skill.report_gap" && this.canReportSkillGap() && output.outcome === "no_applicable_skill") {
          this.selectedSkillId = undefined;
          this.gapReported = true;
        }
      }
    }
  }

  private rememberSkill(value: unknown): string | undefined {
    if (!record(value) || typeof value.id !== "string" || !value.id || value.id.length > 160) return;
    this.skills.set(value.id, {
      ...this.skills.get(value.id),
      id: value.id,
      ...(typeof value.title === "string" ? { title: value.title.slice(0, 200) } : {}),
      ...(typeof value.domain === "string" ? { domain: value.domain.slice(0, 100) } : {}),
      ...(this.brief?.skillResolution === "agent_semantic" && typeof value.description === "string"
        ? { description: value.description.slice(0, 240) } : {}),
      ...(this.brief?.skillResolution === "agent_semantic" && Array.isArray(value.scopeGuidance)
        ? { scopeGuidance: value.scopeGuidance.filter((line): line is string => typeof line === "string").slice(0, 2).map((line) => line.slice(0, 320)) } : {})
    });
    while (this.skills.size > 50) this.skills.delete(this.skills.keys().next().value!);
    return value.id;
  }
}
