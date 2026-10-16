import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { applyChangeSet, calculateGraph, productionVolumeProject, type VdtChangeSet } from "@vdt-studio/vdt-core";
import {
  applyDiscoveryUserEdits,
  reanalyzeDiscoveryWithUserEdits,
  runRawDataDiscovery,
  validateDiscoveryApply,
  type AnalyzeRawDatasetInput,
  type DataDiscoveryStructuredProvider,
  type IncomingKpiOptions
} from "./index";

function inputFor(text: string, options: IncomingKpiOptions = {}): AnalyzeRawDatasetInput {
  const project = structuredClone(productionVolumeProject);
  const root = project.graph.nodes.find((node) => node.id === project.rootNodeId)!;
  root.name = "Downtime";
  root.unit = "hour";
  root.formula = undefined;
  project.graph = { nodes: [root], edges: [] };
  project.scenarios = [];
  return {
    datasetId: "incoming_fixture",
    file: { fileName: "downtime.csv", mimeType: "text/csv", sizeBytes: new TextEncoder().encode(text).length, contentHash: "sha256:fixture", storageRef: "incoming_fixture", uploadedAt: "2026-10-16T00:00:00Z" },
    text, project,
    entryContext: { source: "node_file_action", targetNodeId: root.id, purpose: "incoming_kpis" },
    incomingKpiOptions: {
      tableId: "table_1", categoryColumns: ["Reason"], duration: { mode: "column", column: "Minutes", unit: "minutes" },
      normalization: { mode: "period_total" }, confirmed: true, ...options
    }
  };
}

function allIds(changeSet: VdtChangeSet): Set<string> {
  return new Set([
    ...changeSet.additions, ...changeSet.updates, ...changeSet.deletions, ...changeSet.edgeChanges,
    ...(changeSet.dataSourceChanges ?? []), ...(changeSet.dataMappingChanges ?? []), ...(changeSet.taxonomyChanges ?? [])
  ].map((entry) => entry.id));
}

function workbookInput(rows: Array<Array<string | number>>, options: IncomingKpiOptions, formats: string[] = []): AnalyzeRawDatasetInput {
  const input = inputFor("", { ...options, tableId: "sheet_1" });
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  for (const [index, format] of formats.entries()) if (sheet[`B${index + 2}`]) sheet[`B${index + 2}`]!.z = format;
  XLSX.utils.book_append_sheet(workbook, sheet, "Events");
  input.bytes = new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
  input.text = undefined;
  input.file = { ...input.file, fileName: "events.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sizeBytes: input.bytes.byteLength };
  return input;
}

describe("complete incoming KPI file breakdown", () => {
  it("preserves generic additive numeric imports in the target unit, including negative corrections", async () => {
    const input = inputFor("Category,Amount\nFuel,1500\nMaintenance,700\nFuel,-200", {
      categoryColumns: ["Category"], duration: { mode: "column", column: "Amount", unit: "target" }
    });
    input.project.graph.nodes[0]!.name = "Operating cost";
    input.project.graph.nodes[0]!.unit = "USD";
    const snapshot = await runRawDataDiscovery(input);
    expect(snapshot.status).toBe("waiting_review");
    expect(snapshot.changeSetPreview?.additions.map((addition) => addition.baselineValue)).toEqual([1300, 700]);
    expect(snapshot.changeSetPreview?.additions.every((addition) => addition.unit === "USD" && addition.description?.includes("SUM(Amount [USD]); no unit conversion"))).toBe(true);
    const applied = applyChangeSet(input.project, snapshot.changeSetPreview!, allIds(snapshot.changeSetPreview!));
    expect(applied.success).toBe(true);
    expect(calculateGraph(applied.project).rootValue).toBe(2000);
    input.incomingKpiOptions = { confirmed: true };
    const inferred = await runRawDataDiscovery(input);
    expect(inferred.incomingKpi?.options.duration).toEqual({ mode: "column", column: "Amount", unit: "target" });
    input.project.graph.nodes[0]!.unit = "%";
    const percentage = await runRawDataDiscovery({ ...input, incomingKpiOptions: { tableId: "table_1", categoryColumns: ["Category"], duration: { mode: "column", column: "Amount", unit: "target" }, normalization: { mode: "period_total" }, confirmed: true } });
    expect(validateDiscoveryApply(percentage).some((result) => result.status === "error")).toBe(true);
  });

  it.each(["h", "h/day", "час"])("rejects negative duration values even when the native unit shortcut targets %s", async (unit) => {
    const input = inputFor("Reason,Minutes\nRepair,-30\nWeather,60", {
      duration: { mode: "column", column: "Minutes", unit: "target" },
      ...(unit.includes("/") ? { normalization: { mode: "per_day", basis: "calendar_days", denominator: 1 }, period: { start: "2026-07-01", end: "2026-07-01" } } as const : {})
    });
    input.project.graph.nodes[0]!.unit = unit;
    const snapshot = await runRawDataDiscovery(input);
    expect(snapshot.changeSetPreview?.additions).toEqual([]);
    expect(snapshot.incomingKpi?.coverage.excludedRows).toBe(1);
    expect(snapshot.incomingKpi?.blockingReasons.join(" ")).toContain("negative");
    expect(validateDiscoveryApply(snapshot).some((item) => item.status === "error")).toBe(true);
  });

  it("creates reconciled nested totals, path-specific repeated labels and a confirmed blank category", async () => {
    const input = inputFor("Kind,Reason,Minutes\nMechanical,Repair,60\nMechanical,Waiting,120\nOperational,Repair,180\nOperational,,30", {
      categoryColumns: ["Kind", "Reason"], missingCategoryPolicy: "include_unknown"
    });
    const snapshot = await runRawDataDiscovery(input);
    expect(snapshot.status).toBe("waiting_review");
    expect(snapshot.incomingKpi?.coverage).toEqual({ totalRows: 4, includedRows: 4, excludedRows: 0, categoryCount: 6, complete: true });
    const changeSet = snapshot.changeSetPreview!;
    const repairs = changeSet.additions.filter((addition) => addition.name === "Repair");
    expect(repairs.map((addition) => addition.baselineValue)).toEqual([1, 3]);
    expect(new Set(repairs.map((addition) => addition.nodeId)).size).toBe(2);
    expect(repairs.every((addition) => addition.dataMapping?.filters?.length === 2)).toBe(true);
    expect(changeSet.additions.some((addition) => addition.name === "Unspecified (blank)" && addition.baselineValue === 0.5)).toBe(true);
    const applied = applyChangeSet(input.project, changeSet, allIds(changeSet));
    expect(applied.success).toBe(true);
    expect(calculateGraph(applied.project).rootValue).toBe(6.5);
    for (const addition of changeSet.additions) {
      expect(addition.description).toContain("Source: downtime.csv");
      expect(addition.description).toContain("table: downtime (table_1)");
      expect(addition.description).toContain("columns: Minutes");
      expect(addition.description).toContain("calculation: SUM(Minutes [minutes])");
      expect(addition.description).toContain("sha256:fixture");
      expect(addition.description).toContain("period:");
    }
  });

  it("includes every category beyond both old top-six and top-twelve limits", async () => {
    const input = inputFor(["Reason,Minutes", ...Array.from({ length: 30 }, (_, index) => `Category ${index + 1},15`)].join("\n"));
    const snapshot = await runRawDataDiscovery(input);
    expect(snapshot.changeSetPreview?.additions).toHaveLength(30);
    expect(snapshot.incomingKpi?.coverage.complete).toBe(true);
    const applied = applyChangeSet(input.project, snapshot.changeSetPreview!, allIds(snapshot.changeSetPreview!));
    expect(applied.success).toBe(true);
    expect(calculateGraph(applied.project).rootValue).toBe(7.5);
  });

  it("applies the same retained immutable dataset under a second KPI without changing the first breakdown", async () => {
    const input = inputFor("Reason,Minutes\nRepair,60\nWeather,120");
    const root = input.project.graph.nodes[0]!;
    const firstTarget = { ...structuredClone(root), id: "downtime_a", name: "Line A downtime", type: "input" as const, baselineValue: 0, value: undefined, formula: undefined };
    const secondTarget = { ...structuredClone(root), id: "downtime_b", name: "Line B downtime", type: "input" as const, baselineValue: 0, value: undefined, formula: undefined };
    root.formula = `${firstTarget.id} + ${secondTarget.id}`;
    input.project.graph.nodes.push(firstTarget, secondTarget);
    input.project.graph.edges.push(
      { id: "root_to_a", sourceNodeId: root.id, targetNodeId: firstTarget.id, relation: "formula_dependency", aiGenerated: false },
      { id: "root_to_b", sourceNodeId: root.id, targetNodeId: secondTarget.id, relation: "formula_dependency", aiGenerated: false }
    );
    input.entryContext!.targetNodeId = firstTarget.id;
    const first = await runRawDataDiscovery(input);
    expect(validateDiscoveryApply(first).every((item) => item.status !== "error")).toBe(true);
    const firstApplied = applyChangeSet(input.project, first.changeSetPreview!, allIds(first.changeSetPreview!));
    expect(firstApplied.success).toBe(true);
    const firstNodeIds = new Set([firstTarget.id, ...first.changeSetPreview!.additions.map((addition) => addition.nodeId)]);
    const firstNodes = structuredClone(firstApplied.project.graph.nodes.filter((node) => firstNodeIds.has(node.id)));
    const firstValues = calculateGraph(firstApplied.project).values;
    const secondInput: AnalyzeRawDatasetInput = {
      ...input, project: firstApplied.project,
      entryContext: { ...input.entryContext, targetNodeId: secondTarget.id },
      incomingKpiOptions: { ...input.incomingKpiOptions, confirmed: false }
    };
    const secondProposal = await runRawDataDiscovery(secondInput);
    expect(secondProposal.status).toBe("needs_user_input");
    const second = await reanalyzeDiscoveryWithUserEdits(secondInput, secondProposal, { incomingKpiOptions: { confirmed: true } });
    expect(second.status).toBe("waiting_review");
    expect(validateDiscoveryApply(second).every((item) => item.status !== "error")).toBe(true);
    const firstSource = first.changeSetPreview!.dataSourceChanges!.find((change) => change.action === "add")!;
    const secondSource = second.changeSetPreview!.dataSourceChanges!.find((change) => change.action === "add")!;
    expect(secondSource.dataSource.id).not.toBe(firstSource.dataSource.id);
    expect(secondSource.dataSource.file?.storageRef).toBe(firstSource.dataSource.file?.storageRef);
    expect(secondSource.dataSource.file?.contentHash).toBe(firstSource.dataSource.file?.contentHash);
    const secondApplied = applyChangeSet(firstApplied.project, second.changeSetPreview!, allIds(second.changeSetPreview!));
    expect(secondApplied.success).toBe(true);
    expect(secondApplied.project.graph.nodes.filter((node) => firstNodeIds.has(node.id))).toEqual(firstNodes);
    const after = calculateGraph(secondApplied.project);
    for (const nodeId of firstNodeIds) expect(after.values[nodeId]).toBe(firstValues[nodeId]);
    expect(after.values[firstTarget.id]).toBe(3);
    expect(after.values[secondTarget.id]).toBe(3);
    expect(after.rootValue).toBe(6);
    expect(secondApplied.project.dataSources.filter((source) => source.file?.storageRef === input.file.storageRef)).toHaveLength(2);
  });

  it("requires explicit blank handling and keeps all rows in the preview", async () => {
    const input = inputFor("Reason,Minutes\nRepair,60\n,30");
    const snapshot = await runRawDataDiscovery(input);
    expect(snapshot.status).toBe("needs_user_input");
    expect(snapshot.incomingKpi?.questions.some((question) => question.field === "missingCategoryPolicy")).toBe(true);
    expect(validateDiscoveryApply(snapshot).some((result) => result.status === "error")).toBe(true);
    const confirmed = await reanalyzeDiscoveryWithUserEdits(input, snapshot, { incomingKpiOptions: { missingCategoryPolicy: "include_unknown", confirmed: true } });
    expect(confirmed.status).toBe("waiting_review");
    expect(confirmed.changeSetPreview?.additions).toHaveLength(2);
    expect(confirmed.incomingKpi?.coverage.includedRows).toBe(2);
  });

  it("divides all period hours by confirmed calendar days including days without events", async () => {
    const input = inputFor("Reason,Minutes\nRepair,930\nWeather,930", {
      normalization: { mode: "per_day", basis: "calendar_days", denominator: 31 },
      period: { start: "2026-07-01", end: "2026-07-31" }
    });
    input.project.graph.nodes[0]!.name = "Простои в сутки";
    input.project.graph.nodes[0]!.unit = "час";
    const snapshot = await runRawDataDiscovery(input);
    expect(snapshot.status).toBe("waiting_review");
    expect(snapshot.changeSetPreview?.additions.map((addition) => addition.baselineValue)).toEqual([0.5, 0.5]);
    expect(snapshot.changeSetPreview?.updates[0]?.patch.unit).toBe("час/day");
    expect(snapshot.changeSetPreview?.additions.every((addition) => addition.description?.includes("31 calendar_days") && addition.description.includes("2026-07-01–2026-07-31 inclusive"))).toBe(true);
    const applied = applyChangeSet(input.project, snapshot.changeSetPreview!, allIds(snapshot.changeSetPreview!));
    expect(applied.success).toBe(true);
    expect(calculateGraph(applied.project).rootValue).toBe(1);
  });

  it("never guesses observed-day denominators or accepts a contradictory inclusive period", async () => {
    const input = inputFor("Date,Reason,Minutes\n2026-07-01,Repair,60\n2026-07-03,Weather,60", {
      normalization: { mode: "per_day", basis: "calendar_days" }, period: { start: "2026-07-01", end: "2026-07-31" }
    });
    input.project.graph.nodes[0]!.unit = "h/day";
    const snapshot = await runRawDataDiscovery(input);
    expect(snapshot.incomingKpi?.options.normalization).toEqual({ mode: "per_day", basis: "calendar_days" });
    expect(snapshot.incomingKpi?.questions.some((question) => question.field === "denominator")).toBe(true);
    const contradictory = await reanalyzeDiscoveryWithUserEdits(input, snapshot, { incomingKpiOptions: { normalization: { mode: "per_day", basis: "calendar_days", denominator: 2 }, confirmed: true } });
    expect(contradictory.status).toBe("needs_user_input");
    expect(contradictory.incomingKpi?.questions.find((question) => question.field === "denominator")?.message).toContain("31 days");
  });

  it("lets the user explicitly choose operating-days or entity-days", async () => {
    for (const basis of ["operating_days", "entity_days"] as const) {
      const snapshot = await runRawDataDiscovery(inputFor("Reason,Minutes\nRepair,120", {
        normalization: { mode: "per_day", basis, denominator: 4 }, period: { start: "2026-07-01", end: "2026-07-31" }
      }));
      expect(snapshot.status).toBe("waiting_review");
      expect(snapshot.changeSetPreview?.additions[0]?.baselineValue).toBe(0.5);
      expect(snapshot.changeSetPreview?.additions[0]?.description).toContain(`4 ${basis}`);
    }
  });

  it("calculates timestamp elapsed hours and records both columns", async () => {
    const snapshot = await runRawDataDiscovery(inputFor("Reason,Start,End\nRepair,2026-07-01T23:30:00Z,2026-07-02T01:00:00Z", {
      duration: { mode: "timestamps", startColumn: "Start", endColumn: "End", format: "iso" }
    }));
    expect(snapshot.status).toBe("waiting_review");
    expect(snapshot.changeSetPreview?.additions[0]?.baselineValue).toBe(1.5);
    expect(snapshot.changeSetPreview?.additions[0]?.description).toContain("columns: Start, End");
  });

  it("reports timestamp events outside the stated extract period instead of filtering them silently", async () => {
    const snapshot = await runRawDataDiscovery(inputFor("Reason,Start,End\nRepair,2026-07-02T00:00:00Z,2026-07-02T01:00:00Z", {
      duration: { mode: "timestamps", startColumn: "Start", endColumn: "End", format: "iso" },
      period: { start: "2026-07-01", end: "2026-07-01" }
    }));
    expect(snapshot.changeSetPreview?.additions).toEqual([]);
    expect(snapshot.incomingKpi?.blockingReasons.join(" ")).toContain("outside the confirmed extract period");
  });

  it("does not infer locale or timezone for ambiguous timestamps", async () => {
    const input = inputFor("Reason,Start,End\nRepair,01/07/2026 23:30,02/07/2026 01:00", {
      duration: { mode: "timestamps", startColumn: "Start", endColumn: "End" }
    });
    const snapshot = await runRawDataDiscovery(input);
    expect(snapshot.status).toBe("needs_user_input");
    expect(snapshot.changeSetPreview?.additions).toEqual([]);
    const resolved = await reanalyzeDiscoveryWithUserEdits(input, snapshot, { incomingKpiOptions: { duration: { mode: "timestamps", startColumn: "Start", endColumn: "End", format: "dmy", timezoneOffsetMinutes: 300 }, confirmed: true } });
    expect(resolved.status).toBe("waiting_review");
    expect(resolved.changeSetPreview?.additions[0]?.baselineValue).toBe(1.5);
  });

  it.each([
    ["Reason,Minutes\nRepair,\nWeather,60", "missing"],
    ["Reason,Minutes\nRepair,-30\nWeather,60", "negative"],
    ["Reason,Minutes\nRepair,NaN\nWeather,60", "invalid"]
  ])("blocks %s without calculating only the valid rows (%s)", async (csv) => {
    const snapshot = await runRawDataDiscovery(inputFor(csv));
    expect(snapshot.changeSetPreview?.additions).toEqual([]);
    expect(snapshot.incomingKpi?.coverage.excludedRows).toBe(1);
    expect(validateDiscoveryApply(snapshot).some((result) => result.status === "error")).toBe(true);
  });

  it.each([
    "Reason,Start,End\nRepair,2026-07-02T01:00:00Z,2026-07-01T23:30:00Z",
    "Reason,Start,End\nRepair,2026-02-30T01:00:00Z,2026-03-01T23:30:00Z"
  ])("rejects reversed intervals and impossible dates without rollover assumptions", async (csv) => {
    const snapshot = await runRawDataDiscovery(inputFor(csv, { duration: { mode: "timestamps", startColumn: "Start", endColumn: "End", format: "iso" } }));
    expect(snapshot.changeSetPreview?.additions).toEqual([]);
    expect(snapshot.incomingKpi?.blockingReasons.join(" ")).toContain("invalid");
  });

  it("requires number locale and recomputes full rows after the decision", async () => {
    const input = inputFor("Reason;Minutes\nRepair;1,5\nWeather;2,5");
    const snapshot = await runRawDataDiscovery(input);
    expect(snapshot.incomingKpi?.questions.some((question) => question.field === "numberFormat")).toBe(true);
    const resolved = await reanalyzeDiscoveryWithUserEdits(input, snapshot, { incomingKpiOptions: { numberFormat: "decimal_comma", confirmed: true } });
    expect(resolved.status).toBe("waiting_review");
    expect(resolved.changeSetPreview?.additions.map((addition) => addition.baselineValue)).toEqual([0.025, 0.0416666666666667]);
  });

  it("rejects unsupported target rates and duration columns reused as categories", async () => {
    const input = inputFor("Reason,Minutes\nRepair,60", { normalization: { mode: "per_day", basis: "calendar_days", denominator: 1 }, period: { start: "2026-07-01", end: "2026-07-01" } });
    input.project.graph.nodes[0]!.unit = "h/week";
    const rate = await runRawDataDiscovery(input);
    expect(rate.incomingKpi?.questions.some((question) => question.field === "normalization")).toBe(true);
    expect(validateDiscoveryApply(rate).some((result) => result.status === "error")).toBe(true);
    const duplicate = await runRawDataDiscovery(inputFor("Reason,Minutes\nRepair,60", { categoryColumns: ["Minutes"] }));
    expect(duplicate.incomingKpi?.blockingReasons.join(" ")).toContain("cannot also be category");
  });

  it("blocks the complete hierarchy when depth or node limits are exceeded", async () => {
    const tooDeep = await runRawDataDiscovery(inputFor("A,B,C,D,E,Minutes\na,b,c,d,e,60", { categoryColumns: ["A", "B", "C", "D", "E"] }));
    expect(tooDeep.changeSetPreview?.additions).toEqual([]);
    expect(tooDeep.incomingKpi?.blockingReasons.join(" ")).toContain("4 category levels");
    const tooWide = await runRawDataDiscovery(inputFor(["Reason,Minutes", ...Array.from({ length: 201 }, (_, index) => `Reason ${index},60`)].join("\n")));
    expect(tooWide.changeSetPreview?.additions).toEqual([]);
    expect(tooWide.incomingKpi?.coverage.categoryCount).toBe(201);
    expect(tooWide.incomingKpi?.blockingReasons.join(" ")).toContain("200 KPI limit");
  });

  it("preserves an existing formula or child structure and rejects a stale target", async () => {
    const input = inputFor("Reason,Minutes\nRepair,60");
    input.project.graph.nodes[0]!.formula = "1 + 1";
    expect((await runRawDataDiscovery(input)).incomingKpi?.blockingReasons.join(" ")).toContain("already has a formula");
    input.project.graph.nodes[0]!.formula = undefined;
    input.project.graph.edges.push({ id: "existing", sourceNodeId: input.project.rootNodeId, targetNodeId: "existing_child", relation: "positive_driver", aiGenerated: false });
    expect((await runRawDataDiscovery(input)).changeSetPreview?.additions).toEqual([]);
    input.entryContext!.targetNodeId = "removed_target";
    expect((await runRawDataDiscovery(input)).incomingKpi?.blockingReasons.join(" ")).toContain("no longer exists");
  });

  it("does not allow partial normal-review selections to break the reconciled formula", async () => {
    const input = inputFor("Reason,Minutes\nRepair,60\nWeather,120");
    const changeSet = (await runRawDataDiscovery(input)).changeSetPreview!;
    const selection = allIds(changeSet);
    selection.delete(changeSet.additions[0]!.id);
    const applied = applyChangeSet(input.project, changeSet, selection);
    expect(applied.success).toBe(false);
    expect(applied.warnings.some((warning) => warning.message.includes("must be applied together"))).toBe(true);
    expect(applied.project).toEqual(input.project);
  });

  it("requires fresh confirmation after arithmetic edits and prevents cosmetic edit bypass", async () => {
    const input = inputFor("Reason,Minutes\nRepair,60", { confirmed: false });
    const initial = await runRawDataDiscovery(input);
    const cosmetic = applyDiscoveryUserEdits(initial, { metricEdits: [] });
    expect(validateDiscoveryApply(cosmetic).some((result) => result.status === "error")).toBe(true);
    const confirmed = await reanalyzeDiscoveryWithUserEdits(input, initial, { incomingKpiOptions: { confirmed: true } });
    expect(confirmed.status).toBe("waiting_review");
    const changed = await reanalyzeDiscoveryWithUserEdits(input, confirmed, { incomingKpiOptions: { duration: { mode: "column", column: "Minutes", unit: "hours" } } });
    expect(changed.status).toBe("needs_user_input");
    expect(changed.changeSetPreview?.additions[0]?.baselineValue).toBe(60);
    expect(changed.changeSetPreview?.additions[0]?.description).toContain("Minutes [hours]");
  });

  it("accepts validated AI semantic options for arbitrary-language columns and preserves mandatory questions", async () => {
    const input = inputFor("类别,时长\n维修,60\n天气,30");
    input.incomingKpiOptions = undefined;
    const provider: DataDiscoveryStructuredProvider = {
      async completeStructured(params) {
        if (params.taskType === "data_agent_decision") return { type: "ask_user", questions: ["Should each event count toward the whole reporting period?"], rationale: "The source does not specify period semantics." } as never;
        return {
          datasetId: input.datasetId,
          summary: { rowCount: 2, tableCount: 1, likelyDatasetKind: "downtime", confidence: 0.9, description: "Duration by category." },
          incomingKpiOptions: { tableId: "table_1", categoryColumns: ["类别"], duration: { mode: "column", column: "时长", unit: "minutes" }, normalization: { mode: "period_total" }, confirmed: true },
          columns: [], metricCandidates: [], assumptions: [], questionsForUser: [], warnings: []
        } as never;
      }
    };
    input.provider = provider;
    const initial = await runRawDataDiscovery(input);
    expect(initial.incomingKpi?.options.categoryColumns).toEqual(["类别"]);
    expect(initial.incomingKpi?.options.confirmed).not.toBe(true);
    const providerQuestion = initial.incomingKpi!.questions.find((question) => question.field.startsWith("clarificationAnswers."))!;
    expect(providerQuestion).toBeDefined();
    const stillBlocked = await reanalyzeDiscoveryWithUserEdits({ ...input, provider: undefined }, initial, { incomingKpiOptions: { confirmed: true } });
    expect(stillBlocked.status).toBe("needs_user_input");
    const resolved = await reanalyzeDiscoveryWithUserEdits({ ...input, provider: undefined }, stillBlocked, { incomingKpiOptions: { confirmed: true, clarificationAnswers: { [providerQuestion.id]: "Yes, sum every event in the reporting period; use the period-total mapping." } } });
    expect(resolved.status).toBe("waiting_review");
    expect(resolved.incomingKpi?.clarifications?.[0]?.answer).toContain("sum every event");
    expect(resolved.changeSetPreview?.additions.map((addition) => addition.name)).toEqual(["维修", "天气"]);
    expect(resolved.changeSetPreview?.additions.map((addition) => addition.baselineValue)).toEqual([1, 0.5]);
  });

  it("keeps pending provider questions even when the persisted clarification audit array is empty", async () => {
    const input = inputFor("Reason,Minutes\nRepair,60", { confirmed: false });
    const previous = await runRawDataDiscovery(input);
    previous.incomingKpi!.clarifications = [];
    previous.incomingKpi!.questions.push({ id: "provider_legacy", field: "clarificationAnswers.provider_legacy", message: "Does the extract cover the complete reporting period?", required: true });
    const unanswered = await reanalyzeDiscoveryWithUserEdits(input, previous, { incomingKpiOptions: { confirmed: true } });
    expect(unanswered.status).toBe("needs_user_input");
    expect(unanswered.incomingKpi?.questions.some((question) => question.id === "provider_legacy")).toBe(true);
    const answered = await reanalyzeDiscoveryWithUserEdits(input, unanswered, { incomingKpiOptions: { confirmed: true, clarificationAnswers: { provider_legacy: "Yes, this is the complete extract." } } });
    expect(answered.status).toBe("waiting_review");
    expect(answered.incomingKpi?.clarifications?.find((item) => item.id === "provider_legacy")?.answer).toContain("complete extract");
  });

  it.each(["[h]:mm:ss", "[mm]:ss", "[ss]", "mm:ss"])("uses authoritative Excel serialized-day duration encoding for %s despite conflicting header/manual units", async (format) => {
    for (const unit of ["hours", "target"] as const) {
      const input = workbookInput([["Reason", "Hours"], ["Repair", 0.5], ["Weather", 0.25]], { duration: { mode: "column", column: "Hours", unit } }, [format, format]);
      const snapshot = await runRawDataDiscovery(input);
      expect(snapshot.status).toBe("waiting_review");
      expect(snapshot.incomingKpi?.options.duration).toEqual({ mode: "column", column: "Hours", unit: "days" });
      expect(snapshot.changeSetPreview?.additions.map((addition) => addition.baselineValue)).toEqual([12, 6]);
      expect(snapshot.changeSetPreview?.additions[0]?.description).toContain("serialized days across all relevant cells");
      expect(validateDiscoveryApply(snapshot).every((item) => item.status !== "error")).toBe(true);
    }
  });

  it("keeps authoritative Excel encoding when the provider proposes display hours", async () => {
    const input = workbookInput([["Reason", "Hours"], ["Repair", 0.5]], {}, ["[h]:mm:ss"]);
    input.incomingKpiOptions = undefined;
    input.provider = {
      async completeStructured(params) {
        if (params.taskType === "data_agent_decision") return { type: "final_proposal", rationale: "Use the duration column." } as never;
        return {
          datasetId: input.datasetId, summary: { rowCount: 1, tableCount: 1, likelyDatasetKind: "downtime", confidence: 0.9, description: "Durations by reason." },
          incomingKpiOptions: { tableId: "sheet_1", categoryColumns: ["Reason"], duration: { mode: "column", column: "Hours", unit: "hours" }, normalization: { mode: "period_total" } },
          columns: [], metricCandidates: [], assumptions: [], questionsForUser: [], warnings: []
        } as never;
      }
    };
    const proposed = await runRawDataDiscovery(input);
    expect(proposed.changeSetPreview?.additions[0]?.baselineValue).toBe(12);
    const confirmed = await reanalyzeDiscoveryWithUserEdits({ ...input, provider: undefined }, proposed, { incomingKpiOptions: { duration: { mode: "column", column: "Hours", unit: "target" }, confirmed: true } });
    expect(confirmed.status).toBe("waiting_review");
    expect(confirmed.changeSetPreview?.additions[0]?.baselineValue).toBe(12);
    expect(confirmed.userEdits?.incomingKpiOptions?.duration).toEqual({ mode: "column", column: "Hours", unit: "days" });
  });

  it.each([["[h]:mm:ss", "General"], ["General", "[h]:mm:ss"]])("blocks mixed encoded and ordinary cells throughout the measure column", async (firstFormat, secondFormat) => {
    const input = workbookInput([["Reason", "Hours"], ["Repair", 0.5], ["Weather", 6]], { duration: { mode: "column", column: "Hours", unit: "hours" } }, [firstFormat, secondFormat]);
    const snapshot = await runRawDataDiscovery(input);
    expect(snapshot.changeSetPreview?.additions).toEqual([]);
    expect(snapshot.incomingKpi?.blockingReasons.join(" ")).toContain("mixes Excel time/duration encodings");
    expect(validateDiscoveryApply(snapshot).some((item) => item.status === "error")).toBe(true);
  });

  it("preserves headerless first events and blocks CSV and XLSX incoming imports with numeric first-row cells", async () => {
    const csv = inputFor("Repair,60\nWeather,120", { categoryColumns: ["column_1"], duration: { mode: "column", column: "column_2", unit: "minutes" } });
    const csvSnapshot = await runRawDataDiscovery(csv);
    expect(csvSnapshot.tables[0]?.rowCount).toBe(2);
    expect(csvSnapshot.changeSetPreview?.additions).toEqual([]);
    expect(csvSnapshot.incomingKpi?.coverage.complete).toBe(false);
    expect(csvSnapshot.incomingKpi?.blockingReasons.join(" ")).toContain("header row");
    const xlsx = workbookInput([["Repair", 60], ["Weather", 120]], { categoryColumns: ["column_1"], duration: { mode: "column", column: "column_2", unit: "minutes" } });
    const xlsxSnapshot = await runRawDataDiscovery(xlsx);
    expect(xlsxSnapshot.tables[0]?.rowCount).toBe(2);
    expect(xlsxSnapshot.changeSetPreview?.additions).toEqual([]);
    expect(xlsxSnapshot.incomingKpi?.blockingReasons.join(" ")).toContain("header row");
    const named = await runRawDataDiscovery(inputFor("Reason,FY2026\nRepair,60\nWeather,120", { duration: { mode: "column", column: "FY2026", unit: "minutes" } }));
    expect(named.status).toBe("waiting_review");
    expect(named.changeSetPreview?.additions.map((addition) => addition.baselineValue)).toEqual([1, 2]);
  });

  it("reads XLSX numeric duration values without display rounding, and fails ambiguous title rows", async () => {
    const input = inputFor("", { tableId: "sheet_1" });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Reason", "Minutes"], ["Repair", 90], ["Weather", 30]]), "Events");
    input.bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as Uint8Array;
    input.text = undefined;
    input.file.fileName = "events.xlsx";
    input.file.mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    input.file.sizeBytes = input.bytes.byteLength;
    const snapshot = await runRawDataDiscovery(input);
    expect(snapshot.status).toBe("waiting_review");
    expect(snapshot.changeSetPreview?.additions.map((addition) => addition.baselineValue)).toEqual([1.5, 0.5]);
    expect(snapshot.changeSetPreview?.additions[0]?.description).toContain("table: Events (sheet_1)");
    const titled = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(titled, XLSX.utils.aoa_to_sheet([["Monthly report"], ["Reason", "Minutes"], ["Repair", 90]]), "Events");
    input.bytes = XLSX.write(titled, { type: "array", bookType: "xlsx" }) as Uint8Array;
    const blocked = await runRawDataDiscovery(input);
    expect(blocked.changeSetPreview?.additions).toEqual([]);
    expect(blocked.incomingKpi?.blockingReasons.join(" ")).toContain("header row");
  });
});
