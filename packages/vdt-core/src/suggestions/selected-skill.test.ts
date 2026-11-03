import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildKpiSuggestionContext, kpiSuggestionCacheKey } from "./identity";
import { buildKpiSuggestionTaskInput, materializeKpiSuggestion, SMART_KPI_INSTRUCTION, validateKpiSuggestionModelOutput } from "./model-output";
import { createSmartKpiMeasuredFixture } from "./fixtures";
import { incomingKpiProposalFormula, inspectIncomingKpiDraft } from "./incoming-contract";
import { compileIncomingKpiBatch } from "./incoming-compile";
import { calculateGraph } from "../formula/calculate";
import type { IncomingKpiBatchInput } from "./incoming-types";

const skill = (content: string, version = 1) => ({ id: "custom.service_operations", title: "Service operations", version,
  contentHash: `sha256:${createHash("sha256").update(content).digest("hex")}`, content });
const options = { workspaceId: "selected_skill", vdtId: null, targetNodeId: "measured_output", period: { key: "2026-10", grain: "month" as const } };
const execution = { mode: "cli" as const, backendId: "test", modelId: "test", bindingVersion: "test", credentialEpoch: "test" };

describe("selected modelling guidance and complete immediate layers", () => {
  it("retains the full selected version separately from bounded graph text and invalidates cache identity on a new pin", async () => {
    const project = createSmartKpiMeasuredFixture(0), selectedSkill = skill("# Service time\n" + "Site-defined measurement and causes. ".repeat(1100));
    const context = await buildKpiSuggestionContext(project, { ...options, selectedSkill });
    expect(buildKpiSuggestionTaskInput(context).context.selectedSkill).toEqual(selectedSkill);
    expect(context.target.id).toBe(options.targetNodeId);
    const changed = await buildKpiSuggestionContext(project, { ...options, selectedSkill: skill(selectedSkill.content + "\nUpdated scope.", 2) });
    expect(changed.contextHash).not.toBe(context.contextHash);
    expect(kpiSuggestionCacheKey(changed, "catalog", execution)).not.toBe(kpiSuggestionCacheKey(context, "catalog", execution));
    expect(SMART_KPI_INSTRUCTION).not.toMatch(/mining|excavat|bucket|\bore\b/i);
  });

  it("rejects substituted content with an unchanged pin", async () => {
    const selectedSkill = skill("# Service time\nUse disjoint process causes.");
    await expect(buildKpiSuggestionContext(createSmartKpiMeasuredFixture(0), { ...options,
      selectedSkill: { ...selectedSkill, content: "Different content under the old hash" } })).rejects.toMatchObject({ code: "STALE_SKILL" });
  });

  it("materializes, previews and compiles ten non-mining inputs without confusing p_1 with p_10", async () => {
    const project = createSmartKpiMeasuredFixture(0), target = project.graph.nodes[0]!;
    const context = await buildKpiSuggestionContext(project, { ...options, selectedSkill: skill("# Output\nUse the ten disjoint service categories.") });
    const children = Array.from({ length: 10 }, (_, index) => ({ key: `category_${index + 1}`, conceptKey: `service_category_${index + 1}`,
      name: `Service category ${index + 1}`, unit: target.unit!, description: "One exclusive service category.", existingNodeId: null }));
    const output = { status: "ready", rationale: "Complete service partition.", limitations: [], groups: [{ id: "service_partition", title: "Service causes", selectionMode: "all",
      children, requiredKeys: children.map(row => row.key), formula: children.map(row => row.key).join(" + "), recipeId: null, limitations: [] }] };
    expect(validateKpiSuggestionModelOutput(output).groups[0]!.children).toHaveLength(10);
    const proposal = materializeKpiSuggestion(output, context, { proposalId: "ten_categories", requestId: "ten_categories", now: "2026-11-03T00:00:00.000Z", execution })!;
    const reference = target.baselineValue ?? target.value!;
    const input: IncomingKpiBatchInput = { schemaVersion: "incoming_kpi_apply.v2", context, proposal,
      draft: { schemaVersion: "incoming_kpi_draft.v2", targetNodeId: target.id, contextHash: context.contextHash, revision: 0,
        source: { kind: "proposal", proposalId: proposal.proposalId, groupId: "service_partition" }, childKeys: children.map(row => row.key), manualChildren: [], existingFactors: [],
        formula: incomingKpiProposalFormula(proposal, "service_partition")!, formulaAuthorship: "model",
        inputValues: Object.fromEntries(children.map((_, i) => [`p_${i + 1}`, String(reference / 10)])) } };
    expect(inspectIncomingKpiDraft(input, project)).toMatchObject({ readyForCompile: true, newNodeCount: 10 });
    const compiled = await compileIncomingKpiBatch(project, input, { operationId: "smart_ten_service_categories", now: "2026-11-03T00:00:00.000Z" });
    expect(compiled.newNodeIds).toHaveLength(10);
    expect(compiled.aliases.find(row => row.alias === "p_10")!.nodeId).not.toBe(compiled.aliases.find(row => row.alias === "p_1")!.nodeId);
    expect(calculateGraph(compiled.preview).rootValue).toBeCloseTo(reference);
    expect(project.graph.nodes).toHaveLength(1);
  });
});
