import { describe, expect, it } from "vitest";
import { buildKpiSuggestionContext } from "./identity";
import { createSmartKpiMeasuredFixture } from "./fixtures";
import { buildKpiSuggestionTaskInput, kpiSuggestionEnvelopeBytes, materializeKpiSuggestion, SMART_KPI_INSTRUCTION, validateKpiSuggestionTaskInput } from "./model-output";
import { KPI_SUGGESTION_LIMITS } from "./types";

const options = { workspaceId: "project_context_fixture", vdtId: null, targetNodeId: "measured_output", period: { key: "2026", grain: "year" as const } };

describe("domain-neutral Smart project context", () => {
  it("keeps supplied definitions beyond 1500 characters and fingerprints their tail", async () => {
    const project = createSmartKpiMeasuredFixture(0), target = project.graph.nodes[0]!;
    target.assumptions = ["Time period: Year", "The installed area excludes openings.", "Average panel area uses the same panel population.", "Omitted fourth note"];
    project.businessContext = `${"Project-specific measurement definitions. ".repeat(100)}Last definition: net area excludes openings.`;
    const context = await buildKpiSuggestionContext(project, options), input = buildKpiSuggestionTaskInput(context);
    expect(context.business.context).toBe(project.businessContext);
    expect(context.target.assumptions).toEqual(target.assumptions.slice(0, 3));
    expect(context.omissions.text).toBe(true);
    expect(input).not.toHaveProperty("guidance");
    expect(JSON.stringify(input)).not.toMatch(/mining\.excavation|excavator|bucket/i);
    expect(SMART_KPI_INSTRUCTION).not.toMatch(/excavat|haulage|bucket|\bore\b/i);
    expect(() => validateKpiSuggestionTaskInput({ ...input, guidance: { skills: [] } })).toThrow();
    project.businessContext += " Revised measurement cohort.";
    expect((await buildKpiSuggestionContext(project, options)).contextHash).not.toBe(context.contextHash);
  });

  it("reserves instruction, schema and escaped-envelope bytes on dense contexts", async () => {
    const project = createSmartKpiMeasuredFixture(0), target = project.graph.nodes[0]!;
    const crowded = '\\"漢'.repeat(100);
    project.businessContext = crowded.repeat(20);
    for (let i = 0; i < 40; i++) {
      project.graph.nodes.push({ ...target, id: `context_${i}`, name: crowded, description: crowded, assumptions: [crowded, crowded, crowded] });
      project.graph.edges.push({ id: `edge_${i}`, sourceNodeId: target.id, targetNodeId: `context_${i}`, relation: "contextual_influence", aiGenerated: false });
    }
    const context = await buildKpiSuggestionContext(project, options);
    expect(context.omissions.directChildren).toBeGreaterThanOrEqual(28);
    expect(kpiSuggestionEnvelopeBytes(context)).toBeLessThanOrEqual(KPI_SUGGESTION_LIMITS.inputBytes);
    expect(new TextEncoder().encode(JSON.stringify(buildKpiSuggestionTaskInput(context))).byteLength).toBeLessThan(KPI_SUGGESTION_LIMITS.inputBytes);
  });

  it("preserves the nearest parent and siblings before distant ancestry under the byte cap", async () => {
    const project = createSmartKpiMeasuredFixture(0), sample = project.graph.nodes[0]!;
    project.businessContext = "Project measurement definitions and source scope. ".repeat(165).slice(0, 8000);
    const add = (id: string, parent: string) => {
      project.graph.nodes.push({ ...sample, id, name: id, description: "d".repeat(230), assumptions: ["a".repeat(150), "b".repeat(150), "c".repeat(150)] });
      project.graph.edges.push({ id: `edge_${id}`, sourceNodeId: parent, targetNodeId: id, relation: "contextual_influence", aiGenerated: false });
    };
    let parent = project.rootNodeId;
    for (let i = 0; i < 12; i++) { const id = `ancestor_${i}`; add(id, parent); parent = id; }
    add("selected_input", parent); add("existing_nearby_source", parent); add("second_nearby_source", parent);
    const context = await buildKpiSuggestionContext(project, { ...options, targetNodeId: "selected_input" });
    expect(context.ancestors[0]!.id).toBe(parent);
    expect(context.siblings.map(node => node.id)).toEqual(["existing_nearby_source", "second_nearby_source"]);
    expect(context.omissions.ancestors).toBeGreaterThan(3);
    expect(context.root.id).toBe(project.rootNodeId);
    expect(kpiSuggestionEnvelopeBytes(context)).toBeLessThanOrEqual(KPI_SUGGESTION_LIMITS.inputBytes);
  });

  it("admits a construction definition only with cancelling population units", async () => {
    const project = createSmartKpiMeasuredFixture(0);
    project.graph.nodes[0]!.name = "Installed panel area";
    project.graph.nodes[0]!.unit = "m^2";
    const context = await buildKpiSuggestionContext(project, options);
    const output = { status: "ready", rationale: "Installed panels multiplied by mean area per panel.", limitations: [], groups: [{ id: "installed_area", title: "Installed area", selectionMode: "all",
      children: [
        { key: "panels", conceptKey: "installed_panels", name: "Installed panels", unit: "count", description: null, existingNodeId: null },
        { key: "area", conceptKey: "mean_panel_area", name: "Mean panel area", unit: "m^2/count", description: null, existingNodeId: null }
      ], requiredKeys: ["panels", "area"], formula: "panels * area", recipeId: null, limitations: [] }] };
    const host = { proposalId: "construction_fixture", requestId: "construction_fixture", now: "2026-10-25T00:00:00.000Z", execution: { mode: "cli" as const, backendId: "fixture", modelId: "fixture", bindingVersion: "v1", credentialEpoch: "v1" } };
    expect(materializeKpiSuggestion(output, context, host)?.groups[0]!.children).toHaveLength(2);
    output.groups[0]!.children[1]!.unit = "m^2";
    expect(() => materializeKpiSuggestion(output, context, host)).toThrow(/units/);
  });
});
