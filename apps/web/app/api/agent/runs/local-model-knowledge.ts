import { collectLiteralUserQuantities, type LiteralUserQuantity } from "@vdt-studio/vdt-agent-runtime";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => !!value && typeof value === "object" && !Array.isArray(value);

type SkillVersion = { id: string; version: number; contentHash: string };
type SkillReadReceipt = SkillVersion & { readReceiptId: string };

export type LocalSkillResolution = {
  catalogBrowsed: boolean;
  nextCatalogOffset: number | undefined;
  gapAvailable: boolean;
  pinnedSkillId: string | undefined;
  selectedSkillId: string | undefined;
  gapReported: boolean;
  readReceipts: Array<{ skillId: string; readReceiptId: string }>;
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
  private receivedHumanInput = false;
  private readonly topologies = new Map<string, { skillId: string; defaultInputIds: string[] }>();
  private readonly readIds = new Set<string>();
  private nextCatalogOffset: number | null | undefined;
  private catalogSearchConfirmed = false;
  private readonly pendingCatalogSearchReads = new Set<string>();
  private readonly skillReadReceipts = new Map<string, SkillReadReceipt>();
  private selectedSkillId: string | undefined;
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
    return {
      catalogBrowsed: this.nextCatalogOffset !== undefined,
      nextCatalogOffset: this.nextCatalogOffset ?? undefined,
      gapAvailable: !pin && this.canReportSkillGap(),
      pinnedSkillId: pin?.id,
      selectedSkillId: pin ? (matchesVersion(pin, this.skillReadReceipts.get(pin.id)) ? pin.id : undefined) : this.selectedSkillId,
      gapReported: !pin && this.gapReported,
      readReceipts: [...this.skillReadReceipts.values()].map(({ id, readReceiptId }) => ({ skillId: id, readReceiptId }))
    };
  }
  private canReportSkillGap(): boolean {
    return this.nextCatalogOffset === null || (this.catalogSearchConfirmed && this.pendingCatalogSearchReads.size === 0);
  }
  originalBrief(): RecordValue | undefined { return this.brief; }
  literalUserQuantities(): LiteralUserQuantity[] | undefined { return this.receivedHumanInput || this.quantitiesTruncated ? undefined : this.quantities; }

  observePrompt(prompt: string): void {
    try {
      const input: unknown = JSON.parse(prompt);
      if (record(input) && record(input.delta)) this.observe(input.delta);
    } catch { /* Non-agent provider input has no Gateway evidence. */ }
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
    return result;
  }

  private observe(delta: RecordValue): void {
    if (delta.type === "initial_context" && record(delta.context) && Array.isArray(delta.context.tools)) {
      if (this.initialized) return;
      this.initialized = true;
      for (const tool of delta.context.tools) if (record(tool) && typeof tool.name === "string") this.admitted.add(tool.name);
      if (record(delta.context.brief)) {
        this.brief = structuredClone(delta.context.brief);
        const { quantities, truncated } = collectLiteralUserQuantities([this.brief.prompt, this.brief.businessContext],
          typeof this.brief.unit === "string" ? this.brief.unit : undefined);
        this.quantities.push(...quantities);
        this.quantitiesTruncated = truncated;
      }
    } else if (delta.type === "checkpoint_inputs" && record(delta.checkpointDelta)) {
      if (Array.isArray(delta.inputs) && delta.inputs.some((input) => record(input) && ["user_answer", "user_instruction"].includes(String(input.type)))) this.receivedHumanInput = true;
      this.observe(delta.checkpointDelta);
    } else if (delta.type === "human_inputs" && Array.isArray(delta.inputs)) {
      this.receivedHumanInput = true;
    } else if ((delta.type === "tool_results" || delta.type === "manual_reconciliation") && Array.isArray(delta.results)) {
      for (const result of delta.results) {
        if (!record(result) || !this.admitted.has(String(result.toolName)) || !["succeeded", "replayed"].includes(String(result.status))
          || !record(result.payload) || !record(result.payload.output)) continue;
        const output = result.payload.output;
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
            if (scopedSearch) this.catalogSearchConfirmed = true;
            for (const skill of candidates.slice(0, 50)) {
              const id = this.rememberSkill(skill);
              if (scopedSearch && id && !this.skillReadReceipts.has(id)) this.pendingCatalogSearchReads.add(id);
            }
          }
        }
        if (result.toolName === "skill.read" && typeof output.id === "string") {
          this.readIds.add(output.id);
          this.rememberSkill(output);
          const version = skillVersion(output);
          if (version && typeof output.readReceiptId === "string" && output.readReceiptId.length > 0 && output.readReceiptId.length <= 200) {
            this.skillReadReceipts.set(output.id, { ...version, readReceiptId: output.readReceiptId });
            this.pendingCatalogSearchReads.delete(output.id);
            while (this.skillReadReceipts.size > 50) this.skillReadReceipts.delete(this.skillReadReceipts.keys().next().value!);
          }
          const excerpt = typeof output.excerpt === "string" ? output.excerpt : "";
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
    if (!record(value) || typeof value.id !== "string" || value.id.length > 160) return;
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
