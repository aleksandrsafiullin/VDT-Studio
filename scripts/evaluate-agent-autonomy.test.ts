import { beforeAll, describe, expect, it } from "vitest";
import { productionVolumeProject } from "../packages/vdt-core/src/examples/production-volume";
import type { VdtProject } from "../packages/vdt-core/src/types";
import { agentInputForCase, assessAgentCase, loadOracles, loadPublicCases, publicInputHash, privateOracleHash, REVIEW_DIMENSIONS } from "./evaluate-agent-autonomy.mjs";

type Case = Awaited<ReturnType<typeof loadPublicCases>>["cases"][number];
type Oracle = Awaited<ReturnType<typeof loadOracles>>["cases"][number];
let cases: Case[];
let oracles: Oracle[];
beforeAll(async () => { cases = (await loadPublicCases()).cases; oracles = (await loadOracles()).cases; });

function projectFor(categories = false): VdtProject {
  const project = structuredClone(productionVolumeProject);
  const seed = project.graph.nodes.find((node) => node.id === project.rootNodeId)!;
  const leaf = (id: string, name: string, unit: string, value: number) => ({ ...seed, id, name, type: "input" as const, unit,
    formula: undefined, decompositionPlan: undefined, baselineValue: value, value, valueStatus: "user_provided_value" as const });
  const root = { ...seed, id: "r", name: "Выручка", unit: "USD", type: "root_kpi" as const,
    baselineValue: undefined, value: undefined, formula: categories ? "rev_one + rev_two" : "b * a",
    decompositionPlan: { version: 1 as const, goal: "Revenue", nodes: categories ? [
      { nodeId: "rev_one", parentNodeId: "r", kind: "calculated" as const },
      { nodeId: "rev_two", parentNodeId: "r", kind: "calculated" as const },
      { nodeId: "a", parentNodeId: "rev_one", kind: "input" as const }, { nodeId: "b", parentNodeId: "rev_one", kind: "input" as const },
      { nodeId: "c", parentNodeId: "rev_two", kind: "input" as const }, { nodeId: "d", parentNodeId: "rev_two", kind: "input" as const }
    ] : [{ nodeId: "a", parentNodeId: "r", kind: "input" as const }, { nodeId: "b", parentNodeId: "r", kind: "input" as const }] } };
  const nodes: VdtProject["graph"]["nodes"] = [root, leaf("a", "Проданные товары", "unit", 100), leaf("b", "Цена", "USD/unit", 20)];
  if (categories) nodes.push(
    { ...leaf("rev_one", "Продажи категории 1", "USD", 0), type: "calculated", formula: "a * b", baselineValue: undefined, value: undefined },
    { ...leaf("rev_two", "Продажи категории 2", "USD", 0), type: "calculated", formula: "c * d", baselineValue: undefined, value: undefined },
    leaf("c", "Товары категории 2", "unit", 20), leaf("d", "Цена категории 2", "USD/unit", 50)
  );
  project.rootNodeId = "r";
  project.graph.nodes = nodes;
  project.graph.edges = root.decompositionPlan.nodes.map((node) => ({ id: `edge_${node.nodeId}`, sourceNodeId: node.parentNodeId,
    targetNodeId: node.nodeId, relation: node.parentNodeId === "r" && categories ? "additive_component" : "multiplicative_driver" }));
  project.scenarios = project.scenarios.map((scenario) => ({ ...scenario, overrides: [] }));
  return project;
}

function observation(entry: Case, project = projectFor()) {
  const startingProject = structuredClone(project);
  startingProject.graph.nodes = [startingProject.graph.nodes.find((node) => node.id === startingProject.rootNodeId)!];
  Object.assign(startingProject.graph.nodes[0]!, { formula: undefined, decompositionPlan: undefined, baselineValue: undefined, value: undefined });
  startingProject.graph.edges = [];
  return {
    capture: { origin: "live_app", requestClass: "business_autonomy", freshSession: true, interventions: [] as Array<{ kind: string }>,
      oracleHash: privateOracleHash(oracles.find((oracle: Oracle) => oracle.id === entry.id)), oracleFrozenAt: "2026-10-27T00:00:00Z" },
    snapshot: { runId: "unit-fixture-only", createdAt: "2026-10-27T00:01:00Z", status: "succeeded", request: { executionBindingId: "fixture_binding", input: { ...agentInputForCase(entry), project: startingProject } },
      executionSummary: { backendId: "ollama", modelId: "unit-fixture-model", finishState: "final_persisted" },
      events: [{ type: "run_completed", metadata: { finishReceiptId: "unit_fixture_receipt" } }], pendingQuestions: [] as Array<{ question: string }> },
    persistedProject: project,
    roleBindings: { quantity: "a", price: "b" } as Record<string, string>,
    semanticReview: { reviewer: "unit fixture reviewer", independentOfGenerator: true,
      checks: Object.fromEntries(REVIEW_DIMENSIONS.map((dimension: string) => [dimension, { verdict: "pass", evidenceReferences: [`fixture:${dimension}`] }])) }
  };
}

describe("business agent evaluation boundary (fixtures, not live agent qualification)", () => {
  it("keeps business inputs separate from evaluator answers and exports no workflow instructions", () => {
    expect(cases).toHaveLength(10);
    expect(new Set(cases.map((entry: Case) => entry.id))).toEqual(new Set(oracles.map((entry: Oracle) => entry.id)));
    const entry = cases[0]!;
    const input = agentInputForCase(entry);
    expect(Object.keys(input).sort()).toEqual(["prompt", "rootKpi", "timePeriod", "unit"]);
    expect(input.prompt).toBe(entry.userRequest);
    expect(JSON.stringify(input)).not.toContain("2000");
    const before = publicInputHash(entry);
    const privateCopy = structuredClone(oracles[0]!);
    privateCopy.expectedRootValue = 987654;
    privateCopy.rubric.push("PRIVATE_EVALUATOR_SENTINEL");
    expect(publicInputHash(entry)).toBe(before);
    expect(JSON.stringify(agentInputForCase(entry))).not.toContain("PRIVATE_EVALUATOR_SENTINEL");
    expect(() => agentInputForCase({ ...entry, oracle: privateCopy })).toThrow(/unsupported fields/);
    expect(cases.every((item: Case) => !/vdt\.|run\.request_finish|skill\.read|задай формулу|проверь и рассчитай|вопросов пользователю не требуется/i.test(item.userRequest))).toBe(true);
  });

  it("accepts an equivalent reordered expression with supported semantic review, without provider promotion", () => {
    const result = assessAgentCase(cases[0], oracles[0], observation(cases[0]));
    expect(result.decision).toBe("accepted_case_only");
    expect(result.sensitivityProbes.every((probe: { ok: boolean }) => probe.ok)).toBe(true);
    expect(result).toMatchObject({ supportsGeneralAutonomyClaim: false, providerCertificationChanged: false });
  });

  it("allows a valid seven-node category model rather than demanding the three-node example", () => {
    const entry = cases.find((item: Case) => item.id === "sales-file")!;
    const oracle = oracles.find((item: Oracle) => item.id === entry.id)!;
    const evidence = observation(entry, projectFor(true));
    const result = assessAgentCase(entry, oracle, evidence);
    expect(result.decision).toBe("accepted_case_only");
    expect(result.observation.calculatedRootValue).toBe(3000);
  });

  it("does not pass a correct base total with wrong causal behavior", () => {
    const evidence = observation(cases[0]);
    evidence.persistedProject.graph.nodes[0]!.formula = "b * a + (a - 100) * 3";
    const result = assessAgentCase(cases[0], oracles[0], evidence);
    expect(result.observation.calculatedRootValue).toBe(2000);
    expect(result.decision).toBe("failed_case");
    expect(result.failedChecks).toContain("sensitivity:quantity:110");
  });

  it("fails a constant root padded with zero-weight drivers", () => {
    const evidence = observation(cases[0]);
    evidence.persistedProject.graph.nodes[0]!.formula = "2000 + 0 * a + 0 * b";
    const result = assessAgentCase(cases[0], oracles[0], evidence);
    expect(result.decision).toBe("failed_case");
    expect(result.failedChecks).toContain("sensitivity:price:25");
  });

  it("fails missing units even when arithmetic and runtime completion pass", () => {
    const evidence = observation(cases[0]);
    evidence.persistedProject.graph.nodes.find((node) => node.id === "a")!.unit = undefined;
    const result = assessAgentCase(cases[0], oracles[0], evidence);
    expect(result.decision).toBe("failed_case");
    expect(result.missingUnitNodeIds).toEqual(["a"]);
  });

  it.each(["guided prompt", "mock provider", "operator rescue", "hidden goal hint"])("does not count %s as natural autonomy evidence", (problem) => {
    const evidence = observation(cases[0]);
    if (problem === "guided prompt") evidence.snapshot.request.input.prompt += " First set the formula and run validation.";
    if (problem === "mock provider") evidence.snapshot.executionSummary.backendId = "mock";
    if (problem === "operator rescue") evidence.capture.interventions.push({ kind: "routine_confirmation" });
    if (problem === "hidden goal hint") Object.assign(evidence.snapshot.request.input, { goal: "Call vdt.calculate, then finish." });
    expect(assessAgentCase(cases[0], oracles[0], evidence).decision).toBe("ineligible_evidence");
  });

  it("keeps a legitimate missing-fact question as the correct case endpoint", () => {
    const entry = cases.find((item: Case) => item.id === "missing-selling-price")!;
    const oracle = oracles.find((item: Oracle) => item.id === entry.id)!;
    const evidence = observation(entry);
    evidence.snapshot.status = "needs_user_input";
    evidence.snapshot.pendingQuestions = [{ question: "Какова фактическая средняя цена за товар?" }];
    evidence.snapshot.events = [];
    evidence.snapshot.executionSummary.finishState = "not_requested";
    const result = assessAgentCase(entry, oracle, evidence);
    expect(result.decision).toBe("accepted_case_only");
    expect(result.observation.finishReceiptId).toBeNull();
  });

  it("does not label an invented completed result as a correct missing-data clarification", () => {
    const entry = cases.find((item: Case) => item.id === "missing-selling-price")!;
    const oracle = oracles.find((item: Oracle) => item.id === entry.id)!;
    const evidence = observation(entry);
    const result = assessAgentCase(entry, oracle, evidence);
    expect(result.decision).toBe("failed_case");
    expect(result.failedChecks).toContain("appropriateEndpoint");
  });

  it("requires actual semantic review; missing reviewer work is not an agent failure", () => {
    const evidence = observation(cases[0]);
    evidence.roleBindings = {};
    evidence.semanticReview.independentOfGenerator = false;
    const result = assessAgentCase(cases[0], oracles[0], evidence);
    expect(result.decision).toBe("needs_review");
    expect(result.pendingEvidence).toContain("roleBinding:quantity");
    expect(result.failedChecks).toEqual([]);
  });

  it("treats a broken reviewer mapping as invalid evidence", () => {
    const evidence = observation(cases[0]);
    evidence.roleBindings.quantity = "r";
    expect(assessAgentCase(cases[0], oracles[0], evidence).decision).toBe("invalid_evidence");
  });

  it("retains a supported semantic failure despite passing numeric probes", () => {
    const evidence = observation(cases[0]);
    evidence.semanticReview.checks.provenance = { verdict: "fail", evidenceReferences: ["fixture:the supplied source was misattributed"] };
    expect(assessAgentCase(cases[0], oracles[0], evidence).decision).toBe("failed_case");
  });

  it("cannot pass by retuning the oracle after seeing the output", () => {
    const evidence = observation(cases[0]);
    const edited = structuredClone(oracles[0]);
    edited.rubric.push("Accept any output now.");
    const result = assessAgentCase(cases[0], edited, evidence);
    expect(result.decision).toBe("ineligible_evidence");
    expect(result.failedEligibility).toContain("frozenOracle");
    evidence.capture.oracleFrozenAt = "2026-10-27T00:02:00Z";
    expect(assessAgentCase(cases[0], oracles[0], evidence).failedEligibility).toContain("oracleFrozenBeforeRun");
  });
});
