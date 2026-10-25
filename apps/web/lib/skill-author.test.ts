import { describe, expect, it, vi } from "vitest";
import { VdtBuilderSession } from "@vdt-studio/vdt-core";
import { readExecutableSkillTopology } from "@vdt-studio/vdt-agent";
import type { AiProvider } from "@vdt-studio/ai-harness";
import { authorSkillFromVdt, skillAuthorSource } from "./skill-author";

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
});
