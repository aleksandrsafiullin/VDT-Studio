type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => !!value && typeof value === "object" && !Array.isArray(value);
export interface LiteralUserQuantity { value: number; quote: string }

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

  hasReadSkill(): boolean { return this.excerpts.size > 0; }
  discoveredSkillIds(): string[] { return [...this.skills.keys()]; }
  readTopologyDefinitions(): Array<{ skillId: string; defaultInputIds: string[] }> { return [...this.topologies.values()]; }
  readSkillIds(): string[] { return [...this.readIds]; }
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
    if (this.excerpts.size) result.readSkills = [...this.excerpts.values()].slice(-1);
    if (this.quantities.length) result.literalUserQuantities = this.quantities;
    if (this.quantitiesTruncated) result.literalUserQuantitiesTruncated = true;
    if (JSON.stringify(result).length > 10_000) { delete result.readSkills; result.readSkillsOmitted = true; }
    const skills = result.discoveredSkills as { entries: RecordValue[]; truncated: boolean } | undefined;
    while (JSON.stringify(result).length > 10_000 && skills && skills.entries.length > 2) { skills.entries.shift(); skills.truncated = true; }
    while (JSON.stringify(result).length > 10_000 && entries.length) omittedToolNames.push(String(entries.pop()!.name));
    return result;
  }

  private observe(delta: RecordValue): void {
    if (delta.type === "initial_context" && record(delta.context) && Array.isArray(delta.context.tools)) {
      if (this.initialized) return;
      this.initialized = true;
      for (const tool of delta.context.tools) if (record(tool) && typeof tool.name === "string") this.admitted.add(tool.name);
      if (record(delta.context.brief)) {
        this.brief = structuredClone(delta.context.brief);
        const texts = [...new Set([this.brief.prompt, this.brief.businessContext].filter((text): text is string => typeof text === "string"))];
        for (const text of texts) {
          const matches = [...text.matchAll(/[-+]?\d+(?:[.,]\d+)?(?:[eE][-+]?\d+)?/g)];
          for (const [index, match] of matches.entries()) {
            const value = Number(match[0].replace(",", "."));
            const start = match.index!; const end = start + match[0].length;
            const previousEnd = index ? matches[index - 1]!.index! + matches[index - 1]![0].length : 0;
            const leftText = text.slice(previousEnd, start);
            const separator = Math.max(...[",", ";", ".", "!", "?", "\n"].map((char) => leftText.lastIndexOf(char)));
            const left = Math.max(previousEnd + separator + 1, start - 60);
            const next = Math.min(matches[index + 1]?.index ?? text.length, end + 90);
            const right = text.slice(end, next).split(/[,;.!?\n]/u)[0]!;
            const quote = text.slice(left, end + right.length).trim();
            if (!Number.isFinite(value) || quote.length < 4 || quote.length > 160 || !/\p{L}/u.test(quote)) continue;
            if (!this.quantities.some((item) => item.value === value && item.quote === quote)) {
              if (this.quantities.length < 30) this.quantities.push({ value, quote });
              else this.quantitiesTruncated = true;
            }
          }
        }
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
        if (result.toolName === "tools.describe" && Array.isArray(output.tools)) {
          for (const tool of output.tools) {
            if (!record(tool) || typeof tool.name !== "string" || !this.admitted.has(tool.name) || !record(tool.inputJsonSchema)) continue;
            this.schemas.delete(tool.name);
            this.schemas.set(tool.name, structuredClone(tool.inputJsonSchema));
          }
        }
        if (result.toolName === "skill.list" || result.toolName === "skill.search") {
          const candidates = output.skills ?? output.candidates;
          if (Array.isArray(candidates)) for (const skill of candidates.slice(0, 50)) this.rememberSkill(skill);
        }
        if (result.toolName === "skill.read" && typeof output.id === "string") {
          this.readIds.add(output.id);
          this.rememberSkill(output);
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
      }
    }
  }

  private rememberSkill(value: unknown): void {
    if (!record(value) || typeof value.id !== "string" || value.id.length > 160) return;
    this.skills.set(value.id, {
      id: value.id,
      ...(typeof value.title === "string" ? { title: value.title.slice(0, 200) } : {}),
      ...(typeof value.domain === "string" ? { domain: value.domain.slice(0, 100) } : {})
    });
    while (this.skills.size > 50) this.skills.delete(this.skills.keys().next().value!);
  }
}
