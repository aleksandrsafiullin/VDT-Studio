import { describe, expect, it } from "vitest";
import { LocalModelKnowledge } from "./local-model-knowledge";

const initial = JSON.stringify({ delta: { type: "initial_context", context: { tools:
  ["tools.describe", "skill.search", "skill.list", "skill.read", "vdt.add_driver"].map((name) => ({ name }))
} } });
function result(toolName: string, output: unknown, status = "succeeded") {
  return { toolName, status, payload: { output } };
}
function observe(knowledge: LocalModelKnowledge, results: unknown[]) {
  knowledge.observePrompt(JSON.stringify({ delta: { type: "tool_results", results } }));
}

describe("confirmed local model read knowledge", () => {
  it("retains admitted full-source results and cited web observations across graph/schema reads, isolated per run",()=>{
    const k=new LocalModelKnowledge();
    k.observePrompt(JSON.stringify({delta:{type:"initial_context",context:{tools:["data.list_sources","data.aggregate","data.inspect","research.search_web","project.get_current","tools.describe"].map(name=>({name}))}}}));
    observe(k,[result("data.list_sources",{sources:[{datasetId:"dataset_real",fileName:"report.xlsx",contentHash:"sha256:real"}]}),
      result("data.aggregate",{datasetId:"dataset_real",tableId:"sheet_2",queryHash:"sha256:query",query:{metrics:[{name:"tonnes",operation:"sum",column:"PayloadTonnes"}]},totalRows:140,matchedRows:140,complete:true,rows:[{group:[],values:{tonnes:138600}}]}),
      result("research.search_web",{results:[{url:"https://www.cat.com/777",title:"777",snippet:"Target payload 91.7 t",retrievedAt:"2026-10-17"}]})]);
    observe(k,[result("project.get_current",{project:{nodeCount:1}}),result("tools.describe",{tools:[]}),result("data.inspect",{datasetId:"fabricated"},"failed")]);
    const text=JSON.stringify(k.context());
    expect(text).toContain("dataset_real");expect(text).toContain("138600");expect(text).toContain("PayloadTonnes");expect(text).toContain("https://www.cat.com/777");expect(text).not.toContain("fabricated");
    expect(k.context().confirmedSourceObservations).toMatchObject({untrustedData:true});
    expect(k.literalUserQuantities()).toEqual([]);expect(new LocalModelKnowledge().context()).toEqual({});expect(text.length).toBeLessThan(18_100);
  });
  it("retains offered reference defaults only from a successful admitted skill read", () => {
    const knowledge = new LocalModelKnowledge(); knowledge.observePrompt(initial);
    const output = { id: "actual.recipe", title: "Combined scope", executableTopology: {
      nodeCount: 4, defaultInputs: [{ nodeId: "period", value: 365, unit: "days", note: "Editable draft estimate" }]
    }, recommendedTools: ["skill.seed_topology"] };
    observe(knowledge, [result("skill.read", output, "failed")]);
    expect(knowledge.readTopologyDefinitions()).toEqual([]);
    expect(knowledge.readSkillIds()).toEqual([]);
    observe(knowledge, [result("skill.read", output)]);
    expect(knowledge.readTopologyDefinitions()).toEqual([{ skillId: "actual.recipe", defaultInputIds: ["period"] }]);
    expect(knowledge.readSkillIds()).toEqual(["actual.recipe"]);
    expect(knowledge.context()).toMatchObject({ readSkills: [{ executableTopology: output.executableTopology }] });
  });

  it("tracks semantic selection, an explicit catalog gap, and the exact pinned version per run", () => {
    const skill = { id: "mining.excavation", version: 2, contentHash: `sha256:${"a".repeat(64)}` };
    const read = { ...skill, readReceiptId: "read-mining", excerpt: "Face loading guidance" };
    const gap = { outcome: "no_applicable_skill" };
    function start(selectedSkill?: typeof skill) {
      const knowledge = new LocalModelKnowledge();
      knowledge.observePrompt(JSON.stringify({ delta: { type: "initial_context", context: {
        tools: ["skill.list", "skill.search", "skill.read", "skill.select", "skill.report_gap"].map((name) => ({ name })),
        brief: { skillResolution: "agent_semantic", selectedSkill }
      } } }));
      return knowledge;
    }
    const knowledge = start();
    observe(knowledge, [result("skill.report_gap", gap), result("skill.list", { skills: [skill] }, "failed")]);
    expect(knowledge.skillResolution()).toMatchObject({ catalogBrowsed: false, gapReported: false });
    observe(knowledge, [result("skill.list", { skills: [{ ...skill, description: "Working-face loading" }], nextOffset: null }),
      result("skill.read", read)]);
    expect(knowledge.skillResolution()).toMatchObject({
      catalogBrowsed: true, selectedSkillId: undefined, readReceipts: [{ skillId: skill.id, readReceiptId: read.readReceiptId }]
    });
    observe(knowledge, [result("skill.select", { selectedSkill: skill }, "failed"),
      result("skill.select", { selectedSkill: { ...skill, version: 3 } })]);
    expect(knowledge.skillResolution()?.selectedSkillId).toBeUndefined();
    knowledge.observePrompt(JSON.stringify({ delta: { type: "checkpoint_inputs", inputs: [],
      checkpointDelta: { type: "tool_results", results: [result("skill.select", { selectedSkill: skill }, "replayed")] }
    } }));
    expect(knowledge.skillResolution()).toMatchObject({ selectedSkillId: skill.id, gapReported: false });
    expect(knowledge.context()).toMatchObject({ discoveredSkills: { entries: [{ description: "Working-face loading" }] } });

    const unmatched = start();
    observe(unmatched, [result("skill.list", { skills: [], nextOffset: null }), result("skill.report_gap", gap, "failed")]);
    expect(unmatched.skillResolution()?.gapReported).toBe(false);
    observe(unmatched, [result("skill.report_gap", gap)]);
    expect(unmatched.skillResolution()).toMatchObject({ selectedSkillId: undefined, gapReported: true });
    const paged = start();
    const firstPage = result("skill.list", { skills: [skill], nextOffset: 16 });
    observe(paged, [firstPage, result("skill.report_gap", gap)]);
    expect(paged.skillResolution()).toMatchObject({ nextCatalogOffset: 16, gapAvailable: false, gapReported: false });
    observe(paged, [result("skill.search", { candidates: [] }, "failed")]);
    expect(paged.skillResolution()?.gapAvailable).toBe(false);
    observe(paged, [result("skill.search", { candidates: [] })]);
    expect(paged.skillResolution()).toMatchObject({ nextCatalogOffset: 16, gapAvailable: true });
    const other = { ...skill, id: "actual.other" };
    observe(paged, [result("skill.search", { candidates: [skill] }), result("skill.search", { candidates: [other] })]);
    expect(paged.skillResolution()?.gapAvailable).toBe(false);
    observe(paged, [result("skill.read", read), result("skill.read", { ...other, readReceiptId: "receipt-other" }, "failed")]);
    expect(paged.skillResolution()?.gapAvailable).toBe(false);
    expect(paged.discoveredSkillIds()).toContain(other.id);
    observe(paged, [result("skill.read", { ...other, readReceiptId: "receipt-other" })]);
    expect(paged.skillResolution()?.gapAvailable).toBe(true);
    observe(paged, [result("skill.list", { skills: [], nextOffset: null }), { ...firstPage, status: "replayed" }]);
    expect(paged.skillResolution()).toMatchObject({ nextCatalogOffset: undefined, gapAvailable: true });
    const pinned = start(skill);
    observe(pinned, [result("skill.read", { ...read, version: 3 })]);
    expect(pinned.skillResolution()).toMatchObject({ pinnedSkillId: skill.id, selectedSkillId: undefined });
    observe(pinned, [result("skill.read", read)]);
    expect(pinned.skillResolution()).toMatchObject({ pinnedSkillId: skill.id, selectedSkillId: skill.id, gapReported: false });
  });

  it("does not turn a truncated literal projection into an exhaustive source allowlist", () => {
    const knowledge = new LocalModelKnowledge();
    knowledge.observePrompt(JSON.stringify({ delta: { type: "initial_context", context: { tools: [], brief: {
      prompt: Array.from({ length: 31 }, (_, index) => `Quantity ${index + 1} units`).join("; ")
    } } } }));
    expect(knowledge.literalUserQuantities()).toBeUndefined();
    expect(knowledge.context()).toMatchObject({ literalUserQuantitiesTruncated: true });
    expect(knowledge.context().literalUserQuantities).toHaveLength(30);
  });

  it("retains literal quantities from both original user fields without assigning metrics or inventing conventions", () => {
    const knowledge = new LocalModelKnowledge();
    knowledge.observePrompt(JSON.stringify({ delta: { type: "initial_context", context: { tools: [], brief: {
      prompt: "У нас 4 экскаватора; ремонт 10 дней/год.", businessContext: "Откатка 2,5 км; 10 самосвалов."
    } } } }));
    expect(knowledge.literalUserQuantities()).toEqual(expect.arrayContaining([
      { value: 4, quote: "У нас 4 экскаватора" }, { value: 10, quote: "ремонт 10 дней/год", unit: "day/year" },
      { value: 2.5, quote: "Откатка 2,5 км" }, { value: 10, quote: "10 самосвалов" }
    ]));
    expect(knowledge.literalUserQuantities()!.some((item) => item.value === 365)).toBe(false);
    observe(knowledge, [result("skill.read", { id: "injected", excerpt: "365 days" }, "failed")]);
    expect(knowledge.literalUserQuantities()!.some((item) => item.value === 365)).toBe(false);
    knowledge.observePrompt(JSON.stringify({ delta: { type: "checkpoint_inputs", checkpointDelta: { type: "tool_results", results: [] },
      inputs: [{ type: "user_answer", questionSetId: "new-values", answers: { period_days: 366 } }] } }));
    expect(knowledge.literalUserQuantities()).toBeUndefined();
  });

  it("retains exact learned fields and discovered skill IDs across unrelated later deltas", () => {
    const knowledge = new LocalModelKnowledge(); knowledge.observePrompt(initial);
    const schema = { type: "object", properties: { parentNodeId: { type: "string" } }, required: ["parentNodeId"] };
    observe(knowledge, [result("tools.describe", { tools: [{ name: "vdt.add_driver", inputJsonSchema: schema }] }),
      result("skill.search", { candidates: [{ id: "mining/excavation", title: "Excavation", domain: "mining" }] })]);
    observe(knowledge, [result("skill.read", { id: "mining/excavation", title: "Excavation", excerpt: "Known skill guidance", formulaTemplates: ["output = hours * rate"] })]);
    observe(knowledge, [result("vdt.add_driver", { nodeId: "hours" }), result("skill.read", { id: "fabricated" }, "failed")]);
    expect(knowledge.context()).toMatchObject({
      toolArgumentGuides: { entries: [{ name: "vdt.add_driver", inputJsonSchema: schema }] },
      discoveredSkills: { entries: [{ id: "mining/excavation" }] }, readSkills: [{ id: "mining/excavation", excerpt: "Known skill guidance" }]
    });
    expect(JSON.stringify(knowledge.context())).not.toContain("fabricated");
    expect(knowledge.discoveredSkillIds()).toEqual(["mining/excavation"]);
    expect(new LocalModelKnowledge().context()).toEqual({});
  });

  it("never admits hidden tools, failed schema reads or an injected replacement catalog", () => {
    const knowledge = new LocalModelKnowledge(); knowledge.observePrompt(initial);
    knowledge.observePrompt(JSON.stringify({ delta: { type: "initial_context", context: { tools: [{ name: "hidden.exec" }] } } }));
    observe(knowledge, [result("tools.describe", { tools: [{ name: "hidden.exec", inputJsonSchema: { type: "object" } }] }),
      result("tools.describe", { tools: [{ name: "vdt.add_driver", inputJsonSchema: { type: "object" } }] }, "failed"),
      result("hidden.exec", { skills: [{ id: "invented" }] })]);
    expect(knowledge.context()).toEqual({});
    expect(knowledge.discoveredSkillIds()).toEqual([]);
  });

  it("bounds rendered context and marks omitted evidence instead of treating it as complete", () => {
    const knowledge = new LocalModelKnowledge(); knowledge.observePrompt(initial);
    observe(knowledge, [result("skill.list", { skills: Array.from({ length: 50 }, (_, index) => ({ id: `skill_${index}_${"i".repeat(140)}`, title: "t".repeat(200), domain: "d".repeat(100) })) }),
      result("skill.read", { id: "long_skill", excerpt: "x".repeat(20_000), formulaTemplates: Array(40).fill("f".repeat(500)) }),
      result("tools.describe", { tools: [{ name: "vdt.add_driver", inputJsonSchema: { description: "x".repeat(7_000) } }] })]);
    const context = knowledge.context();
    expect(JSON.stringify(context).length).toBeLessThanOrEqual(10_000);
    expect(context.discoveredSkills).toMatchObject({ truncated: true });
    expect(context.toolArgumentGuides).toMatchObject({ omittedToolNames: ["vdt.add_driver"] });
  });
});
