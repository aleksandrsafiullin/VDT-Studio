import { describe, expect, it } from "vitest";
import { exportProjectExcel, type VdtNode, type VdtProject } from "../packages/vdt-core/src/index";
import { assessWorkspaceJourney, loadWorkspaceFixture, loadWorkspaceOracle, loadWorkspaceRequest, workspaceProjectHash } from "./evaluate-agent-autonomy-workspace.mjs";

function review(oracle: Awaited<ReturnType<typeof loadWorkspaceOracle>>) {
  return { reviewer: "fixture reviewer", independentOfGenerator: true,
    checks: oracle.review.map(() => ({ verdict: "pass", evidenceReference: "fixture transcript" })) };
}

function evidenceFor(project: VdtProject, revision: number, roleBindings: Record<string, string>) {
  return { project, revision, roleBindings };
}

function fact(kind: string, status = "confirmed") {
  return { kind, status, evidenceReference: "user-message-id" };
}

function receipt(project: VdtProject, revision: number, outcome: string) {
  return { state: "final_persisted", outcome, policyVersion: "workspace-v1", projectRevision: revision, projectHash: workspaceProjectHash(project) };
}

function effect(nodeId: string, inputValue: number, baseline: number, simulated: number, unit: string) {
  return { nodeId, inputValue, baseline, simulated, delta: simulated - baseline, unit, claim: "modeled" };
}

type Factor = { id: string; value?: number; formula?: string; parent?: string };

async function model(formula: string, unit: string, factors: Factor[]): Promise<VdtProject> {
  const project: VdtProject = await loadWorkspaceFixture();
  const seed = project.graph.nodes[1]!;
  const root = { ...project.graph.nodes[0]!, unit, formula,
    decompositionPlan: { version: 1 as const, goal: "Workspace case", nodes: factors.map((factor) => ({
      nodeId: factor.id, parentNodeId: factor.parent ?? project.rootNodeId,
      kind: factor.formula ? "calculated" as const : "input" as const
    })) } };
  project.graph.nodes = [root, ...factors.map((factor): VdtNode => ({
    ...seed, id: factor.id, name: factor.id, unit, type: factor.formula ? "calculated" : "input",
    baselineValue: factor.value, value: factor.value, formula: factor.formula,
    valueStatus: factor.formula ? "calculated" : factor.value === undefined ? "unknown" : "user_provided_value"
  }))];
  project.graph.edges = root.decompositionPlan.nodes.map(({ nodeId, parentNodeId }) => ({
    id: `edge-${nodeId}`, sourceNodeId: parentNodeId, targetNodeId: nodeId, relation: "formula_dependency"
  }));
  return project;
}

describe("workspace journey oracles (offline evidence only)", () => {
  it("projects public user turns separately from evaluator checkpoints and remedies", async () => {
    const publicCase = await loadWorkspaceRequest("novice-serial");
    expect(Object.keys(publicCase).sort()).toEqual(["id", "turns"]);
    expect(publicCase.turns[0].prompt).not.toMatch(/min\b|stage B to 100|70 t\/h/);
    expect(publicCase.turns[2]).toMatchObject({ purpose: "calculated_baseline" });
    await expect(loadWorkspaceRequest("bogus")).rejects.toThrow("Unknown or duplicate");
  });

  it("verifies the legacy tree and a reopened correction, scenario, version and downloaded workbook", async () => {
    const legacy = await loadWorkspaceOracle("legacy-manual");
    const baseline: VdtProject = await loadWorkspaceFixture();
    const roles = { scheduled: "scheduled", downtime: "downtime", rate: "rate" };
    const initial = evidenceFor(baseline, 7, roles);
    const legacyEvidence = { checkpoints: { baseline: { ...initial, startingProject: structuredClone(baseline),
      startingRevision: 7, effect: effect("downtime", 90, 1800, 1820, "t") } }, semanticReview: review(legacy) };
    expect(assessWorkspaceJourney(legacy, legacyEvidence).decision).toBe("accepted_case_only");
    legacyEvidence.checkpoints.baseline.revision = 8;
    expect(assessWorkspaceJourney(legacy, legacyEvidence).checkpoints.baseline.checks.no_mutation).toBe("fail");

    const oracle = await loadWorkspaceOracle("professional-recovery");
    const recovery = structuredClone(baseline);
    recovery.scenarios.push({ ...recovery.scenarios[0]!, id: "recovery", name: "Recovery", isMain: false,
      overrides: [{ nodeId: "downtime", value: 90 }] });
    const final = structuredClone(recovery);
    const downtime = final.graph.nodes.find(({ id }) => id === "downtime")!;
    Object.assign(downtime, { value: 110, baselineValue: 110 });
    final.versions.push({ id: "review", name: "Recovery review", createdAt: final.updatedAt, projectSnapshot: structuredClone(final) });
    const reopened: VdtProject = JSON.parse(JSON.stringify(final));
    const workbook = { descriptor: { revisionId: "saved-final", scenarioId: "recovery" },
      bytes: exportProjectExcel(reopened, { scenarioId: "recovery" }) };
    const evidence = { checkpoints: {
      baseline: initial,
      recovery: { ...evidenceFor(recovery, 8, roles), effect: effect("downtime", 90, 1800, 1820, "t") },
      final: { ...evidenceFor(reopened, 10, roles), savedRevisionId: "saved-final", workbook }
    }, semanticReview: review(oracle) };
    const result = assessWorkspaceJourney(oracle, evidence);
    expect(result.checkpoints.final.checks).toMatchObject({ saved_version: "pass", workbook: "pass" });
    expect(result.decision).toBe("accepted_case_only");
    workbook.descriptor.revisionId = "saved-recovery";
    expect(assessWorkspaceJourney(oracle, evidence).checkpoints.final.checks.workbook).toBe("fail");
    workbook.descriptor.revisionId = "saved-final";
    workbook.bytes = exportProjectExcel(recovery, { scenarioId: "recovery" });
    expect(assessWorkspaceJourney(oracle, evidence).checkpoints.final.checks.workbook).toBe("fail");
  });

  it("distinguishes structural and reopened numerical receipts, serial SUM, and an unsupported claim", async () => {
    const oracle = await loadWorkspaceOracle("novice-serial");
    const roles = { stageA: "a", stageB: "b" };
    const structure = await model("min(b, a)", "t/h", [{ id: "a" }, { id: "b" }]);
    const baseline = await model("min(b, a)", "t/h", [{ id: "a", value: 70 }, { id: "b", value: 90 }]);
    const evidence = { checkpoints: {
      structure: { ...evidenceFor(structure, 5, roles), premise: fact("serial"), builderRevision: 4, receipt: receipt(structure, 4, "structural_model") },
      baseline: { ...evidenceFor(baseline, 6, roles), premise: fact("serial"), receipt: receipt(baseline, 1, "calculated_baseline"),
        effect: effect("b", 100, 70, 70, "t/h") }
    }, semanticReview: review(oracle) };
    expect(assessWorkspaceJourney(oracle, evidence).decision).toBe("accepted_case_only");
    evidence.checkpoints.structure.builderRevision = 5;
    expect(assessWorkspaceJourney(oracle, evidence).checkpoints.structure.checks.bound_finish_receipt).toBe("fail");
    evidence.checkpoints.structure.builderRevision = 4;
    evidence.checkpoints.baseline.effect.claim = "achievable";
    expect(assessWorkspaceJourney(oracle, evidence).checkpoints.baseline.checks).toMatchObject({
      root: "pass", effect_calculation: "pass", unsupported_effect: "fail"
    });
    structure.graph.nodes[0]!.formula = "sum(a, b)";
    baseline.graph.nodes[0]!.formula = "sum(a, b)";
    expect(assessWorkspaceJourney(oracle, evidence).checkpoints).toMatchObject({
      structure: { checks: { structure_relationship: "fail", bound_finish_receipt: "fail" } },
      baseline: { checks: { root: "fail", bound_finish_receipt: "fail" } }
    });
  });

  it("accepts parallel alternatives, zero inputs and detailed disjoint costs, and flags overlap", async () => {
    const parallel = await loadWorkspaceOracle("parallel-capacity");
    const project = await model("b + a", "t/h", [{ id: "a", value: 70 }, { id: "b", value: 90 }]);
    const baseline = { ...evidenceFor(project, 1, { stageA: "a", stageB: "b" }), premise: fact("parallel"),
      receipt: receipt(project, 1, "calculated_baseline"), effect: effect("b", 100, 160, 170, "t/h") };
    expect(assessWorkspaceJourney(parallel, { checkpoints: { baseline }, semanticReview: review(parallel) }).decision).toBe("accepted_case_only");

    const disjoint = await loadWorkspaceOracle("maintenance-disjoint");
    const costs = await model("parts + contractors", "USD", [
      { id: "contractors", formula: "mechanical + electrical" }, { id: "parts", value: 200 },
      { id: "mechanical", value: 300, parent: "contractors" }, { id: "electrical", value: 100, parent: "contractors" }
    ]);
    const spend = { ...evidenceFor(costs, 1, { contractors: "contractors", parts: "parts" }), premise: fact("disjoint"),
      receipt: receipt(costs, 1, "calculated_baseline"), effect: effect("parts", 250, 600, 650, "USD") };
    expect(assessWorkspaceJourney(disjoint, { checkpoints: { baseline: spend }, semanticReview: review(disjoint) }).decision).toBe("accepted_case_only");

    const overlap = await loadWorkspaceOracle("maintenance-overlap");
    const clarification = { premise: fact("overlap", "unresolved"),
      clarification: { kind: "question", evidenceReference: "question-message-id", assertedActualResult: false } };
    const evidence = { checkpoints: { clarification }, semanticReview: review(overlap) };
    expect(assessWorkspaceJourney(overlap, evidence).decision).toBe("accepted_case_only");
    clarification.clarification.assertedActualResult = true;
    expect(assessWorkspaceJourney(overlap, evidence).checkpoints.clarification.checks.unresolved_premise).toBe("fail");
  });
});
