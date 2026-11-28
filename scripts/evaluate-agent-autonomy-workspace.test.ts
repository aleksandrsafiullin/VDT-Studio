import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DEFAULT_DATA_DISCOVERY_LIMITS } from "../packages/data-harness/src/index";
import { parseDatasetInWorker } from "../packages/data-harness/src/parser";
import { buildWorkspaceEventFile } from "../eval/agent-autonomy/assets/workspace-q01-events.v2.mjs";
import { exportProjectExcel, type VdtNode, type VdtProject } from "../packages/vdt-core/src/index";
import { assessWorkspaceJourney, checkWorkspaceSuites, loadWorkspaceFixture, loadWorkspaceOracle, loadWorkspaceRequest, workspaceProjectHash } from "./evaluate-agent-autonomy-workspace.mjs";

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

describe("Q01 independent workspace fixtures", () => {
  it("maps both locales to a single independent oracle and leaves the sealed v1 suite intact", async () => {
    expect(await checkWorkspaceSuites()).toEqual([
      { version: 1, caseCount: 6, requestHash: "sha256:519c636215d7db737b5add51f5d0e744a6a13c1e6039d2f215749c2ab7069431",
        oracleHash: "sha256:5993f9248fd788bd1735bcb540dbacdb6d3a4452164f27f1387e4e7ea542d4be" },
      { version: 2, caseCount: 21, requestHash: expect.stringMatching(/^sha256:/), oracleHash: expect.stringMatching(/^sha256:/) },
    ]);
    const id = "SKILL-01-held-out";
    const en = await loadWorkspaceRequest(id, "en");
    const ru = await loadWorkspaceRequest(id, "ru");
    const oracle = await loadWorkspaceOracle(id);
    expect(en.id).toBe(ru.id);
    expect(oracle.id).toBe(ru.id);
    expect(ru.turns[0].prompt).toContain("Мы считаем принятые субтитры");
    expect(en.turns[0].prompt).toContain("We count accepted captions");
    expect(en.turns[0].prompt).not.toContain("Caption desk acceptance accounting");
    expect(Object.keys(en).sort()).toEqual(["id", "setup", "turns"]);
    expect(Object.keys(en.turns[0])).toEqual(["prompt"]);
    await expect(loadWorkspaceRequest(id)).rejects.toThrow("Select original workspace request locale");
  });

  it("requires chronological capture and identifies retries independently", async () => {
    const oracle = await loadWorkspaceOracle("SKILL-02-confirm");
    const attempt = { number: 1, id: "a-1", locale: "ru", source: "fixture", priorAttemptId: "",
      timeline: [{ elapsedMs: 0, action: "opened disposable VDT", evidenceReference: "storage-head" }] };
    const evidence = { attempt, semanticReview: review(oracle) };
    expect(assessWorkspaceJourney(oracle, evidence).decision).toBe("accepted_case_only");
    attempt.number = 2;
    expect(assessWorkspaceJourney(oracle, evidence).checkpoints.attempt.checks.identity).toBe("fail");
    attempt.priorAttemptId = "a-0";
    expect(assessWorkspaceJourney(oracle, evidence).checkpoints.attempt.checks.identity).toBe("pass");
    attempt.timeline.push({ elapsedMs: -1, action: "submitted answer", evidenceReference: "message-id" });
    expect(assessWorkspaceJourney(oracle, evidence).checkpoints.attempt.checks.operator_timeline).toBe("fail");
  });
});

describe("Q01 parser golden controls", () => {
  const categoryIds = new Map([
    ["Mechanical", "mechanical"], ["Механика", "mechanical"],
    ["Electrical", "electrical"], ["Электрика", "electrical"],
    ["Waiting", "waiting"], ["Ожидание", "waiting"], ["", "uncategorized"],
  ]);

  async function parseEvents(locale: string, form: string, maxRows = DEFAULT_DATA_DISCOVERY_LIMITS.maxRows) {
    const asset = buildWorkspaceEventFile(locale, form);
    const bytes = new Uint8Array(asset.bytes);
    return parseDatasetInWorker({
      file: {
        fileName: asset.name,
        mimeType: form === "serial-xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv",
        sizeBytes: bytes.length,
        contentHash: createHash("sha256").update(bytes).digest("hex"),
        storageRef: "test-fixture",
        uploadedAt: "2026-11-25T00:00:00.000Z",
      },
      bytes, entryContext: { purpose: "incoming_kpis" },
    }, { ...DEFAULT_DATA_DISCOVERY_LIMITS, maxRows });
  }

  it.each([
    ["en", "duration-csv", "DATA-01-duration"],
    ["ru", "duration-csv", "DATA-01-duration"],
    ["en", "serial-xlsx", "DATA-02-serial"],
    ["ru", "serial-xlsx", "DATA-02-serial"],
  ])("reconciles all %s rows in %s to the separate golden totals and hashes", async (locale, form, id) => {
    const oracle = await loadWorkspaceOracle(id);
    const parsed = await parseEvents(locale, form);
    const table = parsed.tables[0]!;
    expect(table.rows).toHaveLength(15000);
    expect(table.truncated).toBe(false);
    const [idColumn, , category, start, end, duration] = table.columns as [string, string, string, string, string, string];
    const weekdaysOnly = form === "serial-xlsx";
    if (weekdaysOnly) expect(table.columnEncodings).toMatchObject({ [start]: "excel_datetime", [end]: "excel_datetime" });
    const uniqueIds = new Set<string>();
    const eventDays = new Set<number>();
    const accepted = new Map<string, Array<[number, number]>>();
    let duplicateCount = 0;
    let invalidCount = 0;
    let acceptedRows = 0;
    let eligibleRows = 0;
    let missingCategoryCount = 0;
    for (const row of table.rows) {
      const key = row[idColumn]!;
      if (uniqueIds.has(key)) {
        duplicateCount++;
        continue;
      }
      uniqueIds.add(key);
      const minutes = weekdaysOnly && row[end] ? Math.round((Number(row[end]) - Number(row[start])) * 1440) : Number(row[duration]);
      if (!Number.isFinite(minutes) || minutes <= 0) {
        invalidCount++;
        continue;
      }
      acceptedRows++;
      if (!row[category]) missingCategoryCount++;
      const date = weekdaysOnly ? new Date((Math.floor(Number(row[start])) - 25569) * 86400000) : new Date(row[start]!);
      if (weekdaysOnly && [0, 6].includes(date.getUTCDay())) continue;
      eligibleRows++;
      eventDays.add(date.getUTCDate());
      const tag = categoryIds.get(row[category]!)!;
      const categoryRows = accepted.get(tag) ?? [];
      categoryRows.push([Number(key), minutes]);
      accepted.set(tag, categoryRows);
    }
    const denominatorDays = Array.from({ length: 30 }, (_, index) => new Date(Date.UTC(2026, 10, index + 1)))
      .filter((day) => !weekdaysOnly || ![0, 6].includes(day.getUTCDay())).length;
    const categories = Object.fromEntries([...accepted].map(([tag, rows]) => {
      const minutes = rows.reduce((total, [, length]) => total + length, 0);
      const rowMinutesSha256 = createHash("sha256").update(rows.map(([eventId, length]) => `${eventId}:${length}\n`).join("")).digest("hex");
      return [tag, { count: rows.length, minutes, hoursPerDay: minutes / 60 / denominatorDays, rowMinutesSha256 }];
    }));
    const data = { rowCount: table.rows.length, duplicateCount, invalidCount, missingCategoryCount, acceptedRows,
      eligibleRows, denominatorDays, zeroEventDays: denominatorDays - eventDays.size, categories };
    expect(data).toEqual(oracle.dataGolden);
    expect(assessWorkspaceJourney(oracle, { data }).checkpoints.data.checks.golden).toBe("pass");
    expect(assessWorkspaceJourney(oracle, { data: { ...data, eligibleRows: 10000 } }).checkpoints.data.checks.golden).toBe("fail");
  });

  it("flags a sampled CSV and rejects a workbook above the configured row limit", async () => {
    const csv = await parseEvents("ru", "duration-csv", 10000);
    expect(csv.tables[0]?.rows).toHaveLength(10000);
    expect(csv.tables[0]?.truncated).toBe(true);
    expect(csv.warnings.some(({ message }) => /sampled/.test(message))).toBe(true);
    const xlsx = await parseEvents("en", "serial-xlsx", 10000);
    expect(xlsx.tables).toHaveLength(0);
    expect(xlsx.warnings.some(({ message }) => /dimensions exceed/.test(message))).toBe(true);
  });
});
