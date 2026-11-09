import { describe, expect, it, vi } from "vitest";
import { VdtBuilderSession } from "@vdt-studio/vdt-core";
import { readExecutableSkillTopology } from "@vdt-studio/vdt-agent";
import { getStrictResponseJsonSchema } from "@vdt-studio/model-bridge";
import type { AiProvider } from "@vdt-studio/ai-harness";
import { authorSkillFromVdt, authorSkillUpdateFromVdt, skillAuthorSource, SkillAuthorInputError } from "./skill-author";
import { applySkillChanges, type SkillUpdateTarget } from "./skill-workflow";

function fixture() {
  const builder = new VdtBuilderSession();
  builder.createDraft({ rootKpi: "Выручка", projectTitle: "Private project", unit: "USD" });
  const root = builder.getProject().rootNodeId;
  builder.addDriver({ nodeId: "units", parentNodeId: root, name: "Units sold", unit: "unit", baselineValue: 123456 });
  builder.addDriver({ nodeId: "price", parentNodeId: root, name: "Price", unit: "USD/unit", baselineValue: 789 });
  builder.setFormula({ nodeId: root, formula: "units * price" });
  return builder.getProject();
}
const draft = { title: "Revenue model", description: "Decompose revenue into quantity and price.", domain: "finance", patterns: ["Revenue"], instructions: "## When to use\nUse this approach for revenue.\n\n## Method\nMultiply units sold by the realized unit price; check units and period." };
function provider(output: unknown) { return { id: "test", type: "mock", name: "Test", completeStructured: vi.fn().mockResolvedValue(output) } as unknown as AiProvider; }

describe("VDT Skill Author", () => {
  it("removes site values and raw source details from the author input", () => {
    const source = JSON.stringify(skillAuthorSource(fixture()));
    expect(source).toContain("units * price");
    expect(source).not.toMatch(/123456|789|Private project|baselineValue|dataSources/);
  });
  it("returns an unsaved reviewable draft with original formulas and no numeric defaults", async () => {
    const project = fixture(), snapshot = JSON.stringify(project);
    const result = await authorSkillFromVdt(provider({ type: "call_tool", toolName: "skill.author_draft", args: draft, statusMessage: "Draft ready." }), project, new AbortController().signal);
    const topology = readExecutableSkillTopology({ body: result.raw });
    expect(topology?.rootFormula).toBe("units * price");
    expect(topology?.nodes.every(node => !node.illustrativeDefault)).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.raw).not.toContain("123456");
    expect(JSON.stringify(project)).toBe(snapshot);
  });
  it("retains the exact bounded host period while keeping numeric prose redacted from provider context", async () => {
    const project = fixture(), root = project.graph.nodes.find(node => node.id === project.rootNodeId)!;
    root.assumptions = ["Time period: 12 months"];
    const selected = provider({ type: "call_tool", toolName: "skill.author_draft", args: draft, statusMessage: "Ready" });
    const result = await authorSkillFromVdt(selected, project, new AbortController().signal);
    expect(readExecutableSkillTopology({ body: result.raw })?.timePeriod).toBe("12 months");
    expect(result.raw).not.toContain("[site value omitted]");
    expect(vi.mocked(selected.completeStructured).mock.calls[0]?.[0].input).toMatchObject({
      source: { nodes: expect.arrayContaining([expect.objectContaining({ id: root.id, assumptions: ["Time period: [site value omitted] months"] })]) }
    });
  });
  it("keeps guidance only if executable period metadata is oversized or contains source paths", async () => {
    for (const timePeriod of ["x".repeat(81), "/Users/private/source.csv", "[site value omitted] months"]) {
      const project = fixture(), root = project.graph.nodes.find(node => node.id === project.rootNodeId)!;
      root.assumptions = [`Time period: ${timePeriod}`];
      const result = await authorSkillFromVdt(provider({ type: "call_tool", toolName: "skill.author_draft", args: draft, statusMessage: "Ready" }), project, new AbortController().signal);
      expect(readExecutableSkillTopology({ body: result.raw })).toBeUndefined();
      expect(result.warnings).toEqual([expect.stringContaining("time period")]);
    }
  });
  it("rejects an agent attempt to call a mutation tool or publish content", async () => {
    await expect(authorSkillFromVdt(provider({ type: "call_tool", toolName: "vdt.delete_node", args: {}, statusMessage: "Delete" }), fixture(), new AbortController().signal)).rejects.toThrow(/unsupported/);
  });
  it("rejects invalid model fields and preserves a guidance draft when topology cannot be compiled", async () => {
    await expect(authorSkillFromVdt(provider({ type: "call_tool", toolName: "skill.author_draft", args: { ...draft, instructions: "short" }, statusMessage: "Ready" }), fixture(), new AbortController().signal)).rejects.toThrow();
    const project = fixture(); project.graph.nodes.push({ ...project.graph.nodes[1]!, id: "extra_input", name: "Unused context input" });
    const result = await authorSkillFromVdt(provider({ type: "call_tool", toolName: "skill.author_draft", args: draft, statusMessage: "Ready" }), project, new AbortController().signal);
    expect(result.warnings).toHaveLength(1);
    expect(result.raw).not.toContain("```vdt-topology");
  });
  it("forwards explicit author feedback without changing the tree or running a tool", async () => {
    const selected = provider({ type: "call_tool", toolName: "skill.author_draft", args: draft, statusMessage: "Ready" });
    await authorSkillFromVdt(selected, fixture(), new AbortController().signal, "Explain required measurement periods.");
    expect(selected.completeStructured).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ feedback: "Explain required measurement periods." }),
      userPrompt: expect.stringContaining("measurement periods")
    }));
  });
  it("requests the actual flat wire encoding and still admits a valid canonical draft", async () => {
    const selected = provider({ type: "call_tool", toolName: "skill.author_draft", argsJson: JSON.stringify(draft), callsJson: "[]", questionsJson: "[]", summary: "", nextSuggestedActions: [], statusMessage: "Draft ready." });
    expect((await authorSkillFromVdt(selected, fixture(), new AbortController().signal)).raw).toContain("Revenue model");
    const params = vi.mocked(selected.completeStructured).mock.calls[0]![0];
    expect(params.systemPrompt).toContain("argsJson");
    expect(params.input).toMatchObject({ outputContract: { type: "call_tool", argsEncoding: "argsJson", argsJsonMaxLength: 12000,
      callsJson: "[]", questionsJson: "[]", summary: "", nextSuggestedActions: [] } });
    expect(getStrictResponseJsonSchema("agent-decision-v2")).toMatchObject({ properties: { argsJson: { maxLength: 12000 } } });
  });
  it("rejects model-authored alternate topology fences and frontmatter", async () => {
    for (const instructions of ["## Method\n\n~~~ vdt-topology\n{}\n~~~\nDo not execute this content.", "---\nname: impersonated-skill\n---\nSome instructions that are long enough for validation."]) {
      await expect(authorSkillFromVdt(provider({ type: "call_tool", toolName: "skill.author_draft", args: { ...draft, instructions }, statusMessage: "Ready" }), fixture(), new AbortController().signal)).rejects.toThrow(/host/);
    }
  });
});

const working = "---\nname: revenue-method\ndescription: Model revenue consistently.\n---\n\n# Revenue\n\nUse a common period.\n\nPreserve the latest exception.\n";
const target: SkillUpdateTarget = { id: "user.revenue", version: 2, contentHash: "sha256:latest", fileHash: "sha256:working",
  baseVersion: 1, baseContentHash: "sha256:base", selectionRevision: 3 };
const update = { summary: "Clarify the input populations.", changes: [{ id: "population", title: "Align the population", reason: "The tree distinguishes units sold from produced units.",
  nodeIds: ["units"], before: "Use a common period.", after: "Use a common reporting period and the same sales population.", kind: "replace" as const }] };
const updateProvider = (args: unknown) => provider({ type: "call_tool", toolName: "skill.author_update", args, statusMessage: "Review ready." });

describe("VDT Skill Author update proposals", () => {
  it("admits the flat update wire response while retaining exact patch validation", async () => {
    const selected = provider({ type: "call_tool", toolName: "skill.author_update", argsJson: JSON.stringify(update), callsJson: "[]", questionsJson: "[]", summary: "", nextSuggestedActions: [], statusMessage: "Update ready." });
    const proposal = await authorSkillUpdateFromVdt(selected, fixture(), { baseRaw: working, raw: working, target }, new AbortController().signal);
    expect(proposal.changes[0]).toMatchObject(update.changes[0]!);
    const params = vi.mocked(selected.completeStructured).mock.calls[0]![0];
    expect(params.systemPrompt).toContain("argsJson");
    expect(params.input).toMatchObject({ outputContract: { toolName: "skill.author_update", argsEncoding: "argsJson", argsJsonMaxLength: 12000 } });
  });
  it("compares pinned and latest content, preserves newer exceptions and returns a separate optional host topology", async () => {
    const project = fixture(), snapshot = JSON.stringify(project), selected = updateProvider(update);
    const proposal = await authorSkillUpdateFromVdt(selected, project, { baseRaw: working.replace("Preserve the latest exception.\n", ""), raw: working, target }, new AbortController().signal);
    const guidance = proposal.changes.filter(change => change.kind !== "topology");
    expect(applySkillChanges(proposal.raw, guidance)).toContain("Preserve the latest exception.");
    expect(applySkillChanges(proposal.raw, guidance)).not.toContain("vdt-topology");
    expect(readExecutableSkillTopology({ body: applySkillChanges(proposal.raw, proposal.changes) })?.rootFormula).toBe("units * price");
    expect(proposal.target).toEqual(target);
    expect(proposal.warnings).toEqual([expect.stringContaining("changed since")]);
    expect(selected.completeStructured).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({
      baseSkill: expect.objectContaining({ version: 1 }), latestSkill: { version: 2, raw: working }
    }) }));
    expect(JSON.stringify(project)).toBe(snapshot);
  });
  it("supports a guidance-only no-change response when source topology cannot be compiled", async () => {
    const project = fixture(); project.graph.nodes.push({ ...project.graph.nodes[1]!, id: "unused", name: "Unused explanatory input" });
    const proposal = await authorSkillUpdateFromVdt(updateProvider({ summary: "No reusable changes.", changes: [] }), project, { baseRaw: working, raw: working, target }, new AbortController().signal);
    expect(proposal.changes).toEqual([]);
    expect(proposal.raw).toBe(working);
    expect(proposal.warnings.length).toBeGreaterThan(0);
  });
  it("rejects promoting arbitrary JSON formulas even when the edited tree cannot supply executable topology", async () => {
    const project = fixture(); project.graph.nodes.push({ ...project.graph.nodes[1]!, id: "unused", name: "Unused explanatory input" });
    const topology = { schemaVersion: "vdt_skill_topology.v1", rootUnit: "USD", timePeriod: "12 months", rootFormula: "units * price * 10", nodes: [
      { id: "units", parentId: "$root", name: "Units", type: "input", unit: "unit" },
      { id: "price", parentId: "$root", name: "Price", type: "input", unit: "USD/unit" }
    ], notes: [] };
    const source = working + `\n\`\`\`json\n${JSON.stringify(topology)}\n\`\`\`\n`;
    const promotion = { ...update.changes[0]!, before: "json", after: "vdt-topology" };
    await expect(authorSkillUpdateFromVdt(updateProvider({ ...update, changes: [promotion] }), project,
      { baseRaw: source, raw: source, target }, new AbortController().signal)).rejects.toThrow(/promote executable topology/);
  });
  it("prepares a separate exact host period change rather than using the redacted provider assumption", async () => {
    const project = fixture(), root = project.graph.nodes.find(node => node.id === project.rootNodeId)!;
    root.assumptions = ["Time period: 6 months"];
    const proposal = await authorSkillUpdateFromVdt(updateProvider({ summary: "No prose changes.", changes: [] }), project,
      { baseRaw: working, raw: working, target }, new AbortController().signal);
    expect(proposal.changes).toHaveLength(1);
    expect(proposal.changes[0]?.kind).toBe("topology");
    expect(readExecutableSkillTopology({ body: applySkillChanges(working, proposal.changes) })?.timePeriod).toBe("6 months");
    expect(proposal.changes[0]?.after).not.toContain("[site value omitted]");
  });
  it("rejects invented source nodes, stale anchors, frontmatter and model-authored topology", async () => {
    for (const change of [
      { ...update.changes[0]!, nodeIds: ["invented"] },
      { ...update.changes[0]!, before: "A passage only in the old skill." },
      { ...update.changes[0]!, before: "name: revenue-method", after: "name: renamed" },
      { ...update.changes[0]!, after: "```vdt-topology\n{}\n```" },
      { ...update.changes[0]!, kind: "topology" }
    ]) {
      await expect(authorSkillUpdateFromVdt(updateProvider({ ...update, changes: [change] }), fixture(), { baseRaw: working, raw: working, target }, new AbortController().signal)).rejects.toThrow();
    }
  });
  it("fails before provider execution if full base/latest guidance cannot fit the existing envelope", async () => {
    const selected = updateProvider(update), large = working + "A long reusable methodological paragraph. ".repeat(4000);
    await expect(authorSkillUpdateFromVdt(selected, fixture(), { baseRaw: large, raw: large, target }, new AbortController().signal)).rejects.toBeInstanceOf(SkillAuthorInputError);
    expect(selected.completeStructured).not.toHaveBeenCalled();
  });
  it("does not publish a late model result after cancellation", async () => {
    const controller = new AbortController(), selected = updateProvider(update);
    vi.mocked(selected.completeStructured).mockImplementationOnce(async () => { controller.abort(); return { type: "call_tool", toolName: "skill.author_update", args: update, statusMessage: "Ready" } as never; });
    await expect(authorSkillUpdateFromVdt(selected, fixture(), { baseRaw: working, raw: working, target }, controller.signal)).rejects.toThrow(/aborted/);
  });
});
