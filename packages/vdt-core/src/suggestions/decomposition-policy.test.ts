import { describe, expect, it } from "vitest";
import { buildKpiSuggestionContext } from "./identity";
import { createIncomingGraphFixture, fixtureContext, modelProposal } from "./incoming-contract.fixtures";
import { materializeKpiSuggestion, type KpiSuggestionModelOutput } from "./model-output";
import { validateKpiSuggestionDecomposition, validateKpiSuggestionSet } from "./validation";

const host = { proposalId: "direction_fixture", requestId: "direction_fixture", now: "2026-10-19T00:00:00.000Z",
  execution: { mode: "api" as const, backendId: "fixture", modelId: "fixture", bindingVersion: "v1", credentialEpoch: "v1" } };
const inverse: KpiSuggestionModelOutput = { status: "ready", rationale: "Inverse distance/time definition.", limitations: [], groups: [{
  id: "inverse", title: "Distance / time", selectionMode: "all", requiredKeys: ["distance", "time"], formula: "distance / time", recipeId: null, limitations: [], children: [
    { key: "distance", conceptKey: "distance", name: "Renamed measured distance", unit: "km/trip", description: null, existingNodeId: "distance" },
    { key: "time", conceptKey: "time", name: "Supposedly independent moving time", unit: "h/trip", description: null, existingNodeId: null }
  ] }] };

describe("Suggested decomposition direction", () => {
  it("rejects the reported speed-from-sibling-distance inversion before materialization", async () => {
    const context = await fixtureContext(createIncomingGraphFixture("shared_speed"));
    expect(context.root.formula).toBe("distance / target");
    expect(context.siblings.map(node => node.id)).toContain("distance");
    expect(() => materializeKpiSuggestion(inverse, context, host)).toThrow(/cannot reuse a sibling/);
  });

  it("rejects the reverse distance-from-sibling-speed identity too", async () => {
    const project = createIncomingGraphFixture("shared_speed");
    const context = await buildKpiSuggestionContext(project, { targetNodeId: "distance", workspaceId: "fixture", vdtId: null, period: { key: "2026-10", grain: "month" } });
    const output = structuredClone(inverse), group = output.groups[0]!;
    group.formula = "distance * time";
    group.children[0] = { ...group.children[0]!, name: "Renamed measured speed", unit: "km/h", existingNodeId: "target" };
    expect(() => materializeKpiSuggestion(output, context, host)).toThrow(/cannot reuse a sibling/);
  });

  it.each(["distance", "output", "target", "unobserved"])("excludes %s from proposed reuse even with a changed display name", async nodeId => {
    const context = await fixtureContext(createIncomingGraphFixture("shared_speed")), proposal = modelProposal(context);
    proposal.groups[0]!.children[0]!.existingNodeId = nodeId;
    expect(() => validateKpiSuggestionDecomposition(proposal, context)).toThrow(/cannot reuse a sibling/);
    // The historical wire contract remains readable for exact commit recovery.
    expect(validateKpiSuggestionSet(proposal)).toBe(proposal);
  });

  it.each(["root", "target", "sibling"])("rejects a new copy of a %s metric with a null source ID", async kind => {
    const context = await fixtureContext(createIncomingGraphFixture("shared_speed")), proposal = modelProposal(context);
    const node = kind === "root" ? context.root : kind === "target" ? context.target : context.siblings[0]!;
    proposal.groups[0]!.children[0]!.name = `  ${node.name.toUpperCase()}  `;
    expect(() => validateKpiSuggestionDecomposition(proposal, context)).toThrow(/copy of the target/);
  });

  it("permits genuine existing direct components and new components while preserving rejected-node exclusion", async () => {
    const context = await fixtureContext(createIncomingGraphFixture("measured")), proposal = modelProposal(context);
    expect(validateKpiSuggestionDecomposition(proposal, context)).toBe(proposal);
    proposal.groups[0]!.children[0]!.existingNodeId = "old_context";
    expect(validateKpiSuggestionDecomposition(proposal, context)).toBe(proposal);
    context.children[0]!.status = "rejected";
    expect(() => validateKpiSuggestionDecomposition(proposal, context)).toThrow(/cannot reuse a sibling/);
  });
});
