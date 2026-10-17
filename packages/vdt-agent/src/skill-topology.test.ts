import { describe, expect, it } from "vitest";
import { compileSkillRecipe, loadDefaultSkillLibrary } from "./index";
import { readExecutableSkillTopology } from "./skill-topology";

const small = { schemaVersion: "vdt_skill_topology.v1", rootUnit: "t", timePeriod: "Year", rootFormula: "capacity", notes: [], nodes: [
  { id: "capacity", parentId: "$root", name: "Capacity", type: "calculated", unit: "t", formula: "amount * 2" },
  { id: "amount", parentId: "capacity", name: "Amount", type: "input", unit: "t" }
] };
const parse = (value: unknown) => readExecutableSkillTopology({ body: `\n\`\`\`vdt-topology\n${JSON.stringify(value)}\n\`\`\`\n` });

describe("declarative executable skill topologies", () => {
  it("reads the complete joint mining model from one canonical artifact without selecting or applying it", async () => {
    const skill = (await loadDefaultSkillLibrary()).byId.get("mining.load_and_haul")!;
    expect(skill).toBeDefined();
    const topology = readExecutableSkillTopology(skill)!;
    expect(topology.nodes).toHaveLength(34);
    expect(topology.nodes.filter((node) => node.illustrativeDefault)).toHaveLength(16);
    expect(topology.rootFormula).toBe("min(excavation_capacity_t, haulage_capacity_t)");
    expect(compileSkillRecipe(skill)).toMatchObject({ recipeQuality: "complete", recipeSource: "markdown_extracted",
      formulaTemplates: expect.arrayContaining([{ targetNodeId: "root", formula: topology.rootFormula }]) });
  });

  it("rejects duplicate IDs, absent parents, missing references, constant roots and unused nodes", () => {
    expect(parse(small)?.nodes).toHaveLength(2);
    expect(() => parse({ ...small, nodes: [...small.nodes, small.nodes[1]] })).toThrow("Duplicate");
    expect(() => parse({ ...small, nodes: [small.nodes[0], { ...small.nodes[1], parentId: "missing" }] })).toThrow("parent");
    expect(() => parse({ ...small, rootFormula: "missing" })).toThrow("root references");
    expect(() => parse({ ...small, rootFormula: "0" })).toThrow("root references");
    expect(() => parse({ ...small, nodes: [...small.nodes, { ...small.nodes[1], id: "unused" }] })).toThrow("outside the root");
    expect(() => parse({ ...small, nodes: [{ ...small.nodes[0], formula: "missing" }, small.nodes[1]] })).toThrow("formula reference");
  });

  it("rejects parent/formula cycles and prevents illustrative defaults on calculated nodes", () => {
    expect(() => parse({ ...small, nodes: [{ ...small.nodes[0], parentId: "amount" }, small.nodes[1]] })).toThrow("cycle");
    expect(() => parse({ ...small, nodes: [{ ...small.nodes[0], formula: "capacity + amount" }, small.nodes[1]] })).toThrow("cycle");
    expect(() => parse({ ...small, nodes: [{ ...small.nodes[0], illustrativeDefault: { value: 12, note: "Not a formula" } }, small.nodes[1]] })).toThrow("cannot contain numeric defaults");
    expect(readExecutableSkillTopology({ body: "An ordinary skill with no executable block." })).toBeUndefined();
  });
});
