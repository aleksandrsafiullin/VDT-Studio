import { describe, expect, it } from "vitest";
import { VdtBuilderSession } from "@vdt-studio/vdt-core";
import { applySkillChanges, skillAuthorSource, skillWorkflowSourceKey, type SkillUpdateChange } from "./skill-workflow";

const raw = "---\r\nname: sales-method\r\ndescription: Reusable sales modelling\r\n---\r\n\r\n# Sales\r\n\r\nMatch the reporting period.\r\n\r\nKeep this existing exception.\r\n";
const change = (overrides: Partial<SkillUpdateChange> = {}): SkillUpdateChange => ({
  id: "period", title: "Clarify the period", reason: "Inputs must share a measurement period.", nodeIds: ["root"],
  before: "Match the reporting period.", after: "Match the reporting period and population.", kind: "replace", ...overrides
});

function fixture() {
  const builder = new VdtBuilderSession();
  builder.createDraft({ rootKpi: "Sales", projectTitle: "Private site", unit: "USD" });
  const root = builder.getProject().rootNodeId;
  builder.addDriver({ nodeId: "units", parentNodeId: root, name: "Units", unit: "unit", baselineValue: 123456,
    description: "Use the same sales population.", assumptions: ["One reporting period."] });
  builder.addDriver({ nodeId: "price", parentNodeId: root, name: "Price", unit: "USD/unit", baselineValue: 789 });
  builder.setFormula({ nodeId: root, formula: "units * price" });
  return builder.getProject();
}

describe("tree-to-skill shared review contract", () => {
  it("passes meaningful descriptions and assumptions while excluding observations and embedded local paths", () => {
    const project = fixture();
    project.graph.nodes[1]!.description = "Use the same sales population. Measured 123456 units; file /Users/private/source.csv.";
    project.graph.nodes[1]!.assumptions = ["Use reporting period from C:\\private\\source.xlsx and a sample of 789 records."];
    const source = JSON.stringify(skillAuthorSource(project));
    expect(source).toContain("same sales population");
    expect(source).toContain("reporting period");
    expect(source).toContain("units * price");
    expect(source).not.toMatch(/123456|789|baselineValue|Private site|source\.(?:csv|xlsx)|dataSources/);
  });
  it("invalidates drafts for changed meaning, retaining them for a numerical or layout change", () => {
    const project = fixture(), key = skillWorkflowSourceKey(project);
    project.graph.nodes[1]!.baselineValue = 999;
    project.graph.nodes[1]!.position = { x: 400, y: 300 };
    expect(skillWorkflowSourceKey(project)).toBe(key);
    project.graph.nodes[1]!.description = "Only include fulfilled units.";
    expect(skillWorkflowSourceKey(project)).not.toBe(key);
  });
  it("keeps exact methodological periods and thresholds in the browser key, separate from redacted provider context", () => {
    const project = fixture(), root = project.graph.nodes.find(node => node.id === project.rootNodeId)!;
    root.assumptions = ["Time period: 12 months"];
    project.graph.nodes[1]!.description = "Include observations above 100 units.";
    project.graph.nodes[1]!.assumptions = ["Investigate a threshold of 200 units."];
    let key = skillWorkflowSourceKey(project), source = JSON.stringify(skillAuthorSource(project));
    root.assumptions = ["Time period: 6 months"];
    expect(skillWorkflowSourceKey(project)).not.toBe(key);
    expect(JSON.stringify(skillAuthorSource(project))).toBe(source);
    key = skillWorkflowSourceKey(project);
    project.graph.nodes[1]!.description = "Include observations above 200 units.";
    expect(skillWorkflowSourceKey(project)).not.toBe(key);
    expect(JSON.stringify(skillAuthorSource(project))).toBe(source);
    key = skillWorkflowSourceKey(project); source = JSON.stringify(skillAuthorSource(project));
    project.graph.nodes[1]!.assumptions = ["Investigate a threshold of 300 units."];
    expect(skillWorkflowSourceKey(project)).not.toBe(key);
    expect(JSON.stringify(skillAuthorSource(project))).toBe(source);
    const providerNode = skillAuthorSource(project).nodes.find(node => node.id === root.id)!;
    expect(providerNode.assumptions).toEqual(["Time period: [site value omitted] months"]);
  });
  it("applies a selected subset without changing metadata, line endings or unrelated exceptions", () => {
    const updated = applySkillChanges(raw, [change()]);
    expect(updated).toBe(raw.replace("Match the reporting period.", "Match the reporting period and population."));
    expect(applySkillChanges(raw, [])).toBe(raw);
  });
  it("anchors every replacement in the original document, independent of review order", () => {
    const replacement = change({ id: "exception", before: "Keep this existing exception.", after: "Keep the reporting exception.", nodeIds: ["units"] });
    expect(applySkillChanges(raw, [change(), replacement])).toBe(applySkillChanges(raw, [replacement, change()]));
  });
  it("rejects stale, ambiguous, overlapping and no-op changes instead of guessing", () => {
    expect(() => applySkillChanges(raw, [change({ before: "Old wording" })])).toThrow(/unique/);
    expect(() => applySkillChanges(raw + "Match the reporting period.", [change()])).toThrow(/unique/);
    expect(() => applySkillChanges(raw, [change(), change({ id: "overlap", before: "reporting period", after: "period" })])).toThrow(/overlap/);
    expect(() => applySkillChanges(raw, [change({ after: "Match the reporting period." })])).toThrow(/empty/);
    expect(() => applySkillChanges(raw, [change(), change()])).toThrow(/unique ID/);
  });
  it("cannot use a guidance patch to change frontmatter or canonical/alternate topology fences", () => {
    expect(() => applySkillChanges(raw, [change({ before: "name: sales-method", after: "name: another" })])).toThrow(/unique/);
    for (const fence of ["```vdt-topology\n{\"rootFormula\":\"units * price\"}\n```", "  ~~~~ VDT-TOPOLOGY\nprotected formula\n  ~~~~", "``` vdt-topology\nprotected formula"]) {
      expect(() => applySkillChanges(raw + fence, [change({ before: fence.includes("protected") ? "protected formula" : "units * price", after: "wrong" })])).toThrow(/topology/);
    }
    expect(() => applySkillChanges(raw, [change({ kind: "add", before: "", after: "~~~vdt-topology\n{}\n~~~" })])).toThrow(/host/);
  });
  it("rejects promoting an existing JSON block through a fence-label-only guidance change", () => {
    const source = raw + "\n```json\n{\"rootFormula\":\"units * price * 10\"}\n```\n";
    const promotion = change({ before: "json", after: "vdt-topology" });
    expect(() => applySkillChanges(source, [promotion])).toThrow(/promote executable topology/);
  });
  it("checks assembled marker boundaries, including deletion and separately harmless fragments", () => {
    const joined = raw + "\n```vdt-\nREMOVE THIS BREAK\ntopology\n{}\n```\n";
    expect(() => applySkillChanges(joined, [change({ before: "\nREMOVE THIS BREAK\n", after: "", kind: "remove" })])).toThrow(/promote executable topology/);
    const source = raw + "\n```FORMAT-SUFFIX\n{}\n```\n";
    const prefix = change({ id: "prefix", before: "FORMAT-", after: "vdt-" });
    const suffix = change({ id: "suffix", before: "SUFFIX", after: "topology" });
    expect(applySkillChanges(source, [prefix])).toBe(source.replace("FORMAT-", "vdt-"));
    expect(applySkillChanges(source, [suffix])).toBe(source.replace("SUFFIX", "topology"));
    expect(() => applySkillChanges(source, [prefix, suffix])).toThrow(/promote executable topology/);
  });
  it("enforces topology invariants for every selected subset even when accepting the full proposal would be harmless", () => {
    const source = raw + "\n# Sample\n\n```FORMAT-SUFFIX\n{}\n```\n";
    const proposals = [
      change({ id: "prefix", before: "FORMAT-", after: "vdt-" }),
      change({ id: "suffix", before: "SUFFIX", after: "topology" }),
      change({ id: "remove-fence", before: "# Sample\n\n```", after: "# Sample\n\n" })
    ];
    for (let mask = 0; mask < 8; mask++) {
      const selected = proposals.filter((_, index) => mask & (1 << index));
      if (mask === 3) expect(() => applySkillChanges(source, selected)).toThrow(/promote executable topology/);
      else expect(() => applySkillChanges(source, selected)).not.toThrow();
    }
  });
  it("cannot hide a promoted guidance block behind an independently selected host topology", () => {
    const source = raw + "\n```json\n{\"rootFormula\":\"units * price * 10\"}\n```\n";
    const host = change({ id: "host.topology", before: "", after: "```vdt-topology\n{}\n```", kind: "topology" });
    expect(() => applySkillChanges(source, [change({ before: "json", after: "vdt-topology" }), host])).toThrow(/promote executable topology/);
  });
  it("keeps optional host topology separate from independently accepted prose changes", () => {
    const block = "```vdt-topology\n{}\n```";
    const topology = change({ id: "host.topology", before: "", after: block, kind: "topology" });
    const proseOnly = applySkillChanges(raw, [change()]);
    expect(proseOnly).not.toContain("vdt-topology");
    expect(applySkillChanges(raw, [change(), topology])).toBe(proseOnly + "\n" + block);
    expect(() => applySkillChanges(raw, [change({ id: "fake.topology", before: "", after: block, kind: "topology" })])).toThrow(/host/);
  });
  it("enforces final UTF-8 size after edits", () => {
    const almostFull = raw + "я".repeat(65_000);
    expect(() => applySkillChanges(almostFull, [change({ kind: "add", before: "", after: "я".repeat(1000) })])).toThrow(/128 KiB/);
  });
});
