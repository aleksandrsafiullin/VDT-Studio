import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DataDiscoveryRunSnapshot } from "@vdt-studio/data-harness";
import { productionVolumeProject } from "@vdt-studio/vdt-core";
import { openVdtDatabase } from "@vdt-studio/storage";
import { AppleTransportError, type AppleCompletionRequest, type AppleModelCapability } from "@vdt-studio/local-runner/apple-foundation-models";
import type { AppleNativePort } from "../../../agent/runs/apple-native-host";
import { admitAppleNativeBinding } from "../../../agent/runs/apple-native-binding";
import { packagedAppleNativePort } from "../../../agent/runs/apple-native-host";
import { agentExecutionBindingRegistry } from "../../../agent/runs/runtime";
import { POST as upload } from "../../files/route";
import { POST as analyze } from "./route";
import { POST as updateMapping } from "./[runId]/user-input/route";
import { POST as apply } from "./[runId]/apply/route";
import { GET as readRun } from "./[runId]/route";

const live = process.env.VDT_A04_LIVE === "1";
const controlled = vi.hoisted(() => ({
  port: undefined as AppleNativePort | undefined,
  afterReanalysis: undefined as (() => Promise<void>) | undefined
}));
vi.mock("../../../agent/runs/apple-native-host", async importOriginal => {
  const actual = await importOriginal<typeof import("../../../agent/runs/apple-native-host")>();
  return { ...actual, packagedAppleNativePort: () => controlled.port ?? actual.packagedAppleNativePort() };
});
vi.mock("@vdt-studio/data-harness", async importOriginal => {
  const actual = await importOriginal<typeof import("@vdt-studio/data-harness")>();
  return {
    ...actual,
    async reanalyzeDiscoveryWithUserEdits(...args: Parameters<typeof actual.reanalyzeDiscoveryWithUserEdits>) {
      const result = await actual.reanalyzeDiscoveryWithUserEdits(...args);
      await controlled.afterReanalysis?.();
      return result;
    }
  };
});

const providerId = "apple_foundation_models";
const pinned: AppleModelCapability = {
  identity: { model: "SystemLanguageModel.default", profile: "vdt-native-guided-v1", osBuild: "A04-fixture", modelRevision: null },
  locale: "en-US", contextSize: 8192, tokenBudgetVerified: true
};
const owner = { projectId: "a04_project", vdtId: "a04_workspace" };
const project = structuredClone(productionVolumeProject);
project.graph.nodes.find(node => node.id === "unplanned_downtime")!.unit = "h/day";
let scratch: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "vdt-a04-"));
  vi.stubEnv("VDT_DATA_DIR", scratch);
  vi.stubEnv("VDT_APP_MODE", live ? "desktop" : "development_web");
  const database = openVdtDatabase(scratch, { dataDir: scratch });
  try {
    database.createProject({ id: owner.projectId, name: "A04 synthetic" });
    database.createVdt({ ...owner, id: owner.vdtId, name: "A04 synthetic", rootKpi: "Production" });
    database.saveVdtRevision({ ...owner, id: "a04_initial", revisionNo: 1, source: "user", project });
  } finally {
    database.close();
  }
});

afterEach(async () => {
  controlled.port = undefined;
  controlled.afterReanalysis = undefined;
  vi.unstubAllEnvs();
  globalThis.__vdtDataApiStore = undefined;
  await rm(scratch, { recursive: true, force: true });
});

function fixture(proposal: unknown, locale = pinned.locale, compact = false) {
  const requests: AppleCompletionRequest[] = [];
  const port: AppleNativePort = {
    discover: async () => ({ ...pinned, locale }),
    async complete(request, validate) {
      requests.push(request);
      try {
        return { value: validate(compact ? proposal : { proposal }), context: { contextSize: 8192, inputTokens: 500, reservedOutputTokens: request.maxOutputTokens } };
      } catch { throw new AppleTransportError("invalid_output"); }
    }
  };
  controlled.port = port;
  return requests;
}

async function retain(file: File) {
  const form = new FormData();
  form.set("file", file);
  form.set("projectId", owner.projectId);
  form.set("vdtId", owner.vdtId);
  const response = await upload(new Request("http://localhost:3000/api/data/files", { method: "POST", body: form }));
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(200);
  return body.datasetId as string;
}

function jsonRequest(path: string, data: Record<string, unknown> = {}) {
  return new Request(`http://localhost:3000/api/data/discovery/runs${path}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...owner, project, ...data })
  });
}

async function selectApple(locale = pinned.locale) {
  const port = packagedAppleNativePort();
  if (!port) throw new Error("The Apple host is unavailable for this test.");
  const binding = await admitAppleNativeBinding(port, agentExecutionBindingRegistry, locale, `sha256:${"b".repeat(64)}`);
  return { providerId, providerConfig: { bindingId: binding.bindingId },
    expectedExecution: { providerId, mode: "local", profileVersion: 1, modelId: binding.modelId, modelRevision: null } };
}

function analyzeSelected(datasetId: string, selection: Awaited<ReturnType<typeof selectApple>>, draft = project, targetNodeId = "unplanned_downtime") {
  return analyze(jsonRequest("", { datasetId, ...selection, project: draft,
    entryContext: { purpose: "incoming_kpis", targetNodeId } }));
}

function saveFixtureProject(next: typeof project, revision: number) {
  const database = openVdtDatabase(scratch, { dataDir: scratch });
  try {
    database.saveVdtRevision({ ...owner, id: `a04_scope_${revision}`, revisionNo: revision, source: "user", project: next });
  } finally {
    database.close();
  }
}

function scopedFixture(description: string, revision = 2) {
  const scoped = structuredClone(project);
  scoped.graph.nodes.find(node => node.id === "unplanned_downtime")!.description = description;
  saveFixtureProject(scoped, revision);
  return scoped;
}

const mapping = { decision: "column", rationale: "Event durations are stated in minutes.",
  tableKey: "T1", categoryKeys: ["C1"], durationKey: "D2", durationUnit: "minutes" };
const fullMapping = { ...mapping, categoryKeys: ["C3"], durationKey: "D6" };
const russianTimestampMapping = { decision: "timestamps", rationale: "Используйте разность времени окончания и начала.",
  tableKey: "T1", categoryKeys: ["C3"], startKey: "S4", endKey: "E5", timestampFormat: "excel_serial" };
const csv = "Category,Duration (min)\nElectrical,60\nMechanical,120\nElectrical,30";

function guidedFields(request: AppleCompletionRequest, decision: string) {
  const root = request.schema.fields.find(field => field.name === "proposal")?.shape;
  if (root?.kind !== "union") return [];
  return root.variants.find(variant => variant.fields.some(field => field.name === "decision"
    && field.shape.kind === "choice" && field.shape.choices.includes(decision)))?.fields ?? [];
}

it("uses only the pinned Apple task and keeps scope, lineage and Apply on the existing Data Discovery route", async () => {
  const requests = fixture({ ...mapping, decision: " Column ", tableKey: " t1 ", durationUnit: " Target " });
  const selection = await selectApple();
  const datasetId = await retain(new File([csv], "a04-book.csv"));
  const response = await analyzeSelected(datasetId, selection);
  const initial: { runId: string; snapshot: DataDiscoveryRunSnapshot } = await response.json();
  expect(response.status, JSON.stringify(initial)).toBe(200);
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ expectedIdentity: pinned.identity, locale: pinned.locale });
  const request = requests[0]!;
  const profile = JSON.parse(request.prompt.slice(request.prompt.lastIndexOf("\n") + 1));
  expect(profile.tables[0].columns).toEqual([
    expect.objectContaining({ column: "Category", keys: ["C1"] }),
    expect.objectContaining({ column: "Duration (min)", keys: ["D2"], declaredDurationUnit: "minutes" }),
  ]);
  const columnFields = guidedFields(request, "column");
  expect(columnFields.map(field => [field.name, field.shape])).toEqual(expect.arrayContaining([
    ["categoryKeys", { kind: "array", maxItems: 4, element: { kind: "choice", choices: ["C1"] } }],
    ["durationKey", { kind: "choice", choices: ["D2"] }]
  ]));
  expect(columnFields.some(field => field.name === "startKey" || field.name === "endKey" || field.name === "questions")).toBe(false);
  expect(guidedFields(request, "timestamps")).toHaveLength(0);
  expect(guidedFields(request, "clarify").map(field => field.name)).toEqual(["decision", "rationale", "questions"]);
  expect(requests[0]!.prompt).not.toContain(csv);
  expect(requests[0]!.prompt).not.toContain(datasetId);
  expect(requests[0]!.prompt).not.toContain(owner.projectId);
  expect(initial.snapshot).toMatchObject({
    workspaceProjectId: owner.projectId, vdtId: owner.vdtId,
    file: { contentHash: expect.stringContaining(createHash("sha256").update(csv).digest("hex")) },
    incomingKpi: { options: { tableId: "table_1", categoryColumns: ["Category"],
      duration: { mode: "column", column: "Duration (min)", unit: "minutes" } } }
  });
  const handle = { params: Promise.resolve({ runId: initial.runId }) };
  expect((await apply(jsonRequest("/apply"), handle)).status).toBe(422);
  const database = openVdtDatabase(scratch, { dataDir: scratch });
  try {
    expect(database.getVdt(owner.vdtId)?.activeRevisionId).toBe("a04_initial");
  } finally {
    database.close();
  }
  const edit = await updateMapping(jsonRequest("/user-input", { edits: { incomingKpiOptions: {
    ...initial.snapshot.incomingKpi!.options,
    normalization: { mode: "per_day", basis: "calendar_days", denominator: 2 },
    period: { start: "2026-11-02", end: "2026-11-03" }, confirmed: true
  } } }), handle);
  const edited = (await edit.json()).snapshot as DataDiscoveryRunSnapshot;
  expect(edit.status).toBe(200);
  expect(edited.incomingKpi).toMatchObject({ coverage: { totalRows: 3, includedRows: 3, excludedRows: 0, complete: true } });
  expect(edited.incomingKpi!.hierarchy.map(node => [node.name, node.baselineValue])).toEqual([["Electrical", 0.75], ["Mechanical", 1]]);
  const staged = await apply(jsonRequest("/apply"), handle);
  expect(staged.status).toBe(200);
  expect(await staged.json()).toMatchObject({ changeSet: { additions: expect.any(Array) } });
  expect(requests).toHaveLength(1);
});

it.each([
  ["Delay [s]", "seconds"], ["Длительность (мин.)", "minutes"],
  ["Время простоя (ч)", "hours"], ["Downtime days", "days"]
])("grounds the unit declared in source header %s", async (header, unit) => {
  const requests = fixture({ ...mapping, durationUnit: "target" });
  const datasetId = await retain(new File([csv.replace("Duration (min)", header)], "declared-unit.csv"));
  const response = await analyzeSelected(datasetId, await selectApple());
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.snapshot.incomingKpi.options.duration).toEqual({ mode: "column", column: header, unit });
  expect(body.snapshot.incomingKpi.options.confirmed).not.toBe(true);
  expect(requests).toHaveLength(1);
});

it("honors a manual duration unit correction in the explicit review", async () => {
  const requests = fixture({ ...mapping, durationUnit: "target" });
  const datasetId = await retain(new File([csv], "reviewed-unit.csv"));
  const response = await analyzeSelected(datasetId, await selectApple());
  const initial = await response.json();
  expect(response.status).toBe(200);
  expect(initial.snapshot.incomingKpi.options.duration.unit).toBe("minutes");
  const handle = { params: Promise.resolve({ runId: initial.runId }) };
  const review = await updateMapping(jsonRequest("/user-input", { edits: { incomingKpiOptions: {
    ...initial.snapshot.incomingKpi.options, duration: { mode: "column", column: "Duration (min)", unit: "hours" },
    normalization: { mode: "per_day", basis: "calendar_days", denominator: 2 },
    period: { start: "2026-11-02", end: "2026-11-03" }, confirmed: true
  } } }), handle);
  const revised = await review.json();
  expect(review.status).toBe(200);
  expect(revised.snapshot.incomingKpi.options.duration.unit).toBe("hours");
  expect(revised.snapshot.incomingKpi.hierarchy.map((node: { baselineValue: number }) => node.baselineValue)).toEqual([45, 60]);
  expect((await apply(jsonRequest("/apply"), handle)).status).toBe(200);
  expect(requests).toHaveLength(1);
});

const codedRows = "Category code,Elapsed (min),Quantity\n1,60,8\n2,120,9\n1,30,7";

it.each([
  { proposal: { ...mapping, durationKey: "Duration (min)" }, source: csv, stage: "response_shape/durationKey" },
  { proposal: { ...mapping, rationale: 123 }, source: csv, stage: "response_shape/rationale" },
  { proposal: { ...mapping, tableKey: "T2" }, source: csv, stage: "table_selector" },
  { proposal: { ...mapping, categoryKeys: ["C1", "C1"] }, source: csv, stage: "category_selectors" },
  { proposal: { ...mapping, durationKey: "C1" }, source: csv, stage: "response_shape/durationKey" },
  { proposal: { ...mapping, durationKey: "D1" }, source: csv, stage: "duration_selectors/foreign_selector" },
  { proposal: { ...mapping, categoryKeys: ["C2"] }, source: csv, stage: "category_selectors" },
  { proposal: { ...mapping, durationKey: "D1" }, source: codedRows, stage: "duration_selectors/category_overlap" },
  { proposal: { ...mapping, startKey: "S3", endKey: "E3" }, source: codedRows, stage: "response_shape/proposal" },
  { proposal: { decision: "timestamps", tableKey: "T1", categoryKeys: ["C1"], startKey: "S3", endKey: "E3" }, source: codedRows, stage: "duration_selectors/equal_timestamps" },
  { proposal: { decision: "timestamps", tableKey: "T1", categoryKeys: ["C1"], startKey: "S1", endKey: "E3" }, source: codedRows, stage: "duration_selectors/category_overlap" },
  { proposal: { decision: "clarify", questions: [" "] }, source: csv, stage: "clarification" },
])("reports the redacted mapping validation stage $stage", async ({ proposal, source, stage }) => {
  const requests = fixture(proposal);
  const datasetId = await retain(new File([source], "selector-validation.csv"));
  const response = await analyzeSelected(datasetId, await selectApple());
  const body = await response.json();
  expect(response.status).toBe(422);
  expect(body.error).toMatchObject({ code: "APPLE_DATA_INVALID_OUTPUT", message: expect.stringContaining(`(${stage})`) });
  expect(body.error.message).not.toContain("Duration (min)");
  expect(requests).toHaveLength(1);
});

it.each([undefined, "   ", "a".repeat(501)])("validates mapped columns and units without usable optional rationale", async rationale => {
  const requests = fixture({ ...mapping, rationale });
  const datasetId = await retain(new File([csv], "optional-rationale.csv"));
  const response = await analyzeSelected(datasetId, await selectApple());
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.snapshot.semanticModel.summary.description).toBe("Review the proposed source-column mapping.");
  expect(body.snapshot.incomingKpi.options).toMatchObject({
    categoryColumns: ["Category"], duration: { mode: "column", column: "Duration (min)", unit: "minutes" }
  });
  expect((await apply(jsonRequest("/apply"), { params: Promise.resolve({ runId: body.runId }) })).status).toBe(422);
  expect(guidedFields(requests[0]!, "column").find(field => field.name === "rationale")?.optional).toBe(true);
  expect(requests).toHaveLength(1);
});

it.each(["Quantity", "Distance (m)", "Speed (m/h)"])("allows a numeric-coded grouping column and preserves the generic amount %s", async header => {
  const requests = fixture({ ...mapping, durationKey: "D3", durationUnit: "target" });
  const datasetId = await retain(new File([codedRows.replace("Quantity", header)], "numeric-categories.csv"));
  const response = await analyzeSelected(datasetId, await selectApple());
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.snapshot.incomingKpi.options).toMatchObject({
    categoryColumns: ["Category code"], duration: { mode: "column", column: header, unit: "target" }
  });
  expect(requests).toHaveLength(1);
});

const nestedCsv = "Area,Reason,Duration (min)\nPlant A,Electrical,60\nPlant B,Mechanical,120\nPlant A,Mechanical,30";

it("offers only scope-authorized levels and preserves the requested order for a real multi-level review", async () => {
  const scoped = scopedFixture("Report the log by Area then Reason in hours per day.");
  const requests = fixture({ ...mapping, categoryKeys: ["C1", "C2"], durationKey: "D3" });
  const datasetId = await retain(new File([nestedCsv], "ordered-source.csv"));
  const response = await analyzeSelected(datasetId, await selectApple(), scoped);
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.snapshot.incomingKpi.options.categoryColumns).toEqual(["Area", "Reason"]);
  expect(body.snapshot.incomingKpi.options.confirmed).not.toBe(true);
  const parsed = JSON.parse(requests[0]!.prompt.split("\n").at(-1)!);
  expect(parsed.tables[0].orderedGroupingKeys).toEqual(["C1", "C2"]);
  expect(guidedFields(requests[0]!, "column").find(field => field.name === "categoryKeys")?.shape)
    .toMatchObject({ kind: "array", maxItems: 2, element: { kind: "choice", choices: ["C1", "C2"] } });
  const handle = { params: Promise.resolve({ runId: body.runId }) };
  expect((await apply(jsonRequest("/apply", { project: scoped }), handle)).status).toBe(422);
  const confirmed = await updateMapping(jsonRequest("/user-input", { project: scoped, edits: { incomingKpiOptions: {
    ...body.snapshot.incomingKpi.options, confirmed: true, normalization: { mode: "per_day", basis: "calendar_days", denominator: 2 },
    period: { start: "2026-11-02", end: "2026-11-03" }
  } } }), handle);
  expect(confirmed.status).toBe(200);
  const reviewed = await confirmed.json();
  expect(reviewed.snapshot.incomingKpi.options.categoryColumns).toEqual(["Area", "Reason"]);
  expect(reviewed.snapshot.incomingKpi.coverage).toMatchObject({ includedRows: 3, complete: true });
  expect((await apply(jsonRequest("/apply", { project: scoped }), handle)).status).toBe(200);
});

it.each([
  { scope: "Use the Area event log to model downtime by event Reason in hours per day.", selected: ["C1", "C2"], allowed: ["C2"] },
  { scope: "Report downtime by Area then Reason in hours per day.", selected: ["C2", "C1"], allowed: ["C1", "C2"] }
])("keeps mismatched scope $scope in unresolved review without deleting or reordering model selections", async ({ scope, selected, allowed }) => {
  const scoped = scopedFixture(scope);
  const requests = fixture({ ...mapping, categoryKeys: selected, durationKey: "D3" });
  const datasetId = await retain(new File([nestedCsv], "mismatched-order.csv"));
  const response = await analyzeSelected(datasetId, await selectApple(), scoped);
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.snapshot.incomingKpi).toMatchObject({ hierarchy: [], requiresExplicitDuration: true });
  expect(body.snapshot.incomingKpi.options.duration).toBeUndefined();
  expect(body.snapshot.incomingKpi.clarifications).toContainEqual(expect.objectContaining({
    question: "Which grouping columns and order should this KPI use?"
  }));
  expect(guidedFields(requests[0]!, "column").find(field => field.name === "categoryKeys")?.shape)
    .toMatchObject({ kind: "array", maxItems: allowed.length, element: { kind: "choice", choices: allowed } });
  expect((await apply(jsonRequest("/apply", { project: scoped }), { params: Promise.resolve({ runId: body.runId }) })).status).toBe(422);
});

it("includes and uses the exact saved selected target beyond the profile excerpt bound", async () => {
  const scoped = structuredClone(project);
  const target = scoped.graph.nodes.find(node => node.id === "unplanned_downtime")!;
  target.description = "Report imported downtime by Reason in hours per day.";
  const earlier = Array.from({ length: 80 }, (_, index) => ({
    ...target, id: `earlier_node_${index}`, name: `Other KPI ${index}`, description: "This KPI uses other evidence."
  }));
  scoped.graph.nodes.unshift(...earlier);
  scoped.graph.edges.push(...earlier.map(node => ({ id: `edge_${node.id}`,
    sourceNodeId: scoped.rootNodeId, targetNodeId: node.id, relation: "contextual_influence" as const, aiGenerated: false })));
  saveFixtureProject(scoped, 2);
  const requests = fixture({ ...mapping, categoryKeys: ["C2"], durationKey: "D3" });
  const datasetId = await retain(new File([nestedCsv], "later-target.csv"));
  const response = await analyzeSelected(datasetId, await selectApple(), scoped);
  expect(response.status).toBe(200);
  const parsed = JSON.parse(requests[0]!.prompt.split("\n").at(-1)!);
  expect(parsed.target).toMatchObject({ name: target.name, unit: target.unit, scope: target.description });
  expect(parsed.tables[0].orderedGroupingKeys).toEqual(["C2"]);
  expect(requests[0]!.prompt).not.toContain("Other KPI");
});

it("rejects missing or changed saved scope before inference and fences Apply after a later saved change", async () => {
  const scoped = scopedFixture("Report downtime by Category in hours per day.");
  const requests = fixture(mapping);
  const datasetId = await retain(new File([csv], "saved-scope.csv"));
  const selection = await selectApple();
  const altered = structuredClone(scoped);
  const spoofed = altered.graph.nodes.find(node => node.id === "unplanned_downtime")!;
  spoofed.description = "Report downtime by somebody else.";
  const mismatch = await analyzeSelected(datasetId, selection, altered);
  expect(mismatch.status).toBe(409);
  expect(await mismatch.json()).toMatchObject({ error: { code: "APPLE_DATA_TARGET_SCOPE_CHANGED" } });
  altered.graph.nodes.push({ ...spoofed, id: "draft_only_target" });
  altered.graph.edges.push({ id: "edge_draft_only", sourceNodeId: altered.rootNodeId,
    targetNodeId: "draft_only_target", relation: "contextual_influence", aiGenerated: false });
  const missing = await analyzeSelected(datasetId, selection, altered, "draft_only_target");
  expect(missing.status).toBe(409);
  expect(requests).toHaveLength(0);

  const draft = structuredClone(scoped);
  draft.graph.nodes.find(node => node.id === "unplanned_downtime")!.position = { x: 120, y: 20 };
  const liveScope = await analyzeSelected(datasetId, selection, draft);
  expect(liveScope.status).toBe(200);
  const body = await liveScope.json();
  const handle = { params: Promise.resolve({ runId: body.runId }) };
  const confirmed = await updateMapping(jsonRequest("/user-input", { project: draft, edits: { incomingKpiOptions: {
    ...body.snapshot.incomingKpi.options, confirmed: true, normalization: { mode: "per_day", basis: "calendar_days", denominator: 2 },
    period: { start: "2026-11-02", end: "2026-11-03" }
  } } }), handle);
  expect(confirmed.status).toBe(200);
  scopedFixture("Report a different saved scope by Area.", 3);
  const rejected = await apply(jsonRequest("/apply", { project: draft }), handle);
  expect(rejected.status).toBe(409);
  expect(await rejected.json()).toMatchObject({ error: { code: "APPLE_DATA_TARGET_SCOPE_CHANGED" } });
  expect(requests).toHaveLength(1);
});

it("rechecks the saved KPI after native readiness before sending any model prompt", async () => {
  const scoped = scopedFixture("Report downtime by Category in hours per day.");
  const requests = fixture(mapping);
  const selection = await selectApple();
  const original = controlled.port!;
  controlled.port = { ...original, async discover(locale, signal) {
    scopedFixture("Report a new scope by Area.", 3);
    return original.discover(locale, signal);
  } };
  const datasetId = await retain(new File([csv], "in-flight-scope.csv"));
  const response = await analyzeSelected(datasetId, selection, scoped);
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ error: { code: "APPLE_DATA_TARGET_SCOPE_CHANGED" } });
  expect(requests).toHaveLength(0);
});

it.each(["user-input", "apply"] as const)("discards a scoped %s result when the KPI changes during reanalysis", async endpoint => {
  const scoped = scopedFixture("Report downtime by Category in hours per day.");
  const requests = fixture(mapping);
  const datasetId = await retain(new File([csv], "racing-saved-scope.csv"));
  const analysis = await analyzeSelected(datasetId, await selectApple(), scoped);
  expect(analysis.status).toBe(200);
  const { runId, snapshot } = await analysis.json();
  const handle = { params: Promise.resolve({ runId }) };
  const confirmed = jsonRequest("/user-input", { project: scoped, edits: { incomingKpiOptions: {
    ...snapshot.incomingKpi.options, confirmed: true,
    normalization: { mode: "per_day", basis: "calendar_days", denominator: 2 },
    period: { start: "2026-11-02", end: "2026-11-03" }
  } } });
  if (endpoint === "apply") expect((await updateMapping(confirmed.clone(), handle)).status).toBe(200);

  const retained = async () => {
    const query = new URLSearchParams(owner);
    const response = await readRun(new Request(`http://localhost:3000/api/data/discovery/runs/${runId}?${query}`), handle);
    expect(response.status).toBe(200);
    return (await response.json()).snapshot;
  };
  const before = await retained();
  let signalReanalysis = () => {};
  const reanalyzed = new Promise<void>(resolve => { signalReanalysis = resolve; });
  let release = () => {};
  const paused = new Promise<void>(resolve => { release = resolve; });
  controlled.afterReanalysis = async () => { signalReanalysis(); await paused; };
  const pending = endpoint === "apply"
    ? apply(jsonRequest("/apply", { project: scoped }), handle)
    : updateMapping(confirmed, handle);
  try {
    await reanalyzed;
    scopedFixture("Report newly saved scope by Area.", 3);
  } finally {
    release();
  }
  const rejected = await pending;
  expect(rejected.status).toBe(409);
  expect(await rejected.json()).toMatchObject({ error: { code: "APPLE_DATA_TARGET_SCOPE_CHANGED" } });
  expect(await retained()).toEqual(before);
  expect(requests).toHaveLength(1);
});

it("asks for a grouping choice when Apple leaves it ungrounded and keeps Apply blocked", async () => {
  const requests = fixture({ ...mapping, categoryKeys: [] });
  const datasetId = await retain(new File([csv], "no-category-choice.csv"));
  const response = await analyzeSelected(datasetId, await selectApple());
  const { runId, snapshot }: { runId: string; snapshot: DataDiscoveryRunSnapshot } = await response.json();
  expect(response.status).toBe(200);
  expect(snapshot.auditLog).toContainEqual(expect.objectContaining({ message: "Model decision: ask_user." }));
  expect(snapshot.incomingKpi?.clarifications).toContainEqual(expect.objectContaining({ question: "Which source columns group the rows for this KPI?" }));
  expect(snapshot.incomingKpi).toMatchObject({ requiresExplicitDuration: true, hierarchy: [] });
  expect(snapshot.incomingKpi?.options.duration).toBeUndefined();
  expect((await apply(jsonRequest("/apply"), { params: Promise.resolve({ runId }) })).status).toBe(422);
  expect(requests).toHaveLength(1);
});

it("rejects colliding parsed headers before native generation", async () => {
  const requests = fixture(mapping);
  const source = "Category,Category,Category_2,Duration (min)\nElectrical,Ignored,Mechanical,60";
  const datasetId = await retain(new File([source], "colliding-headers.csv"));
  const response = await analyzeSelected(datasetId, await selectApple());
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({ error: { code: "APPLE_DATA_DUPLICATE_COLUMNS" } });
  expect(requests).toHaveLength(0);
});

it("makes a grounded proposal from bounded items when the column profile observation is truncated", async () => {
  const requests = fixture(mapping);
  const headers = ["Category", "Duration (min)", ...Array.from({ length: 50 }, (_, index) => `Extra ${index + 1}`)];
  const rows = Array.from({ length: 20 }, (_, index) => [
    index % 2 ? "Mechanical" : "Electrical", "60",
    ...headers.slice(2).map((_, column) => `Column ${column + 1} label number ${index + 1}`)
  ]);
  const bytes = [headers, ...rows].map(row => row.join(",")).join("\n");
  const datasetId = await retain(new File([bytes], "bounded-column-observation.csv"));
  const response = await analyzeSelected(datasetId, await selectApple());
  const body = await response.json();
  expect(response.status, JSON.stringify(body).slice(0, 300)).toBe(200);
  expect(body.snapshot.observations).toContainEqual(expect.objectContaining({
    toolName: "table.profile", output: expect.objectContaining({ truncated: true, items: expect.any(Array) })
  }));
  expect(body.snapshot.incomingKpi.options).toMatchObject({
    categoryColumns: ["Category"], duration: { mode: "column", column: "Duration (min)", unit: "minutes" }
  });
  expect(requests).toHaveLength(1);
  const prompt = requests[0]!.prompt;
  expect(JSON.parse(prompt.slice(prompt.lastIndexOf("\n") + 1)).tables[0].columns).toHaveLength(24);
});

it("retains a blocked clarification without native generation when source roles are insufficient", async () => {
  const requests = fixture(mapping);
  const source = "Category,Note\nElectrical,Unknown duration\nMechanical,Unavailable";
  const datasetId = await retain(new File([source], "ungrounded-roles.csv"));
  const response = await analyzeSelected(datasetId, await selectApple());
  const { runId, snapshot }: { runId: string; snapshot: DataDiscoveryRunSnapshot } = await response.json();
  expect(response.status).toBe(200);
  expect(snapshot.file.contentHash).toContain(createHash("sha256").update(source).digest("hex"));
  expect(snapshot.incomingKpi?.clarifications).toContainEqual(expect.objectContaining({
    question: "Which separate source columns should group the rows and calculate this KPI?"
  }));
  expect(snapshot.incomingKpi).toMatchObject({ requiresExplicitDuration: true, hierarchy: [] });
  expect(snapshot.incomingKpi?.options.duration).toBeUndefined();
  expect((await apply(jsonRequest("/apply"), { params: Promise.resolve({ runId }) })).status).toBe(422);
  expect(requests).toHaveLength(0);
});

it("keeps formatted Excel serial Start hour and End hour columns eligible for timestamp mapping", async () => {
  const XLSX = createRequire(resolve("packages/data-harness/package.json"))("xlsx");
  const workbook = XLSX.utils.book_new();
  const base = Date.UTC(2026, 10, 2, 8) / 86_400_000 + 25569;
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Category", "Start hour", "End hour"],
    ["Electrical", base, base + 1 / 24],
    ["Mechanical", base, base + 2 / 24]
  ]);
  for (const address of ["B2", "C2", "B3", "C3"]) sheet[address].z = "yyyy-mm-dd hh:mm:ss";
  XLSX.utils.book_append_sheet(workbook, sheet, "Events");
  const requests = fixture({ decision: "timestamps", tableKey: "T1", categoryKey: "C1",
    startKey: "S2", endKey: "E3", timestampFormat: "excel_serial" });
  const bytes = new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" }));
  const datasetId = await retain(new File([bytes], "format-bearing-serials.xlsx"));
  const response = await analyzeSelected(datasetId, await selectApple());
  const body = await response.json();
  expect(response.status, JSON.stringify(body).slice(0, 300)).toBe(200);
  expect(body.snapshot.incomingKpi.options).toMatchObject({
    categoryColumns: ["Category"], duration: { mode: "timestamps", startColumn: "Start hour", endColumn: "End hour", format: "excel_serial" }
  });
  const request = requests[0]!;
  const timestampFields = guidedFields(request, "timestamps").map(field => [field.name, field.shape]);
  expect(timestampFields).toEqual(expect.arrayContaining([
    ["categoryKey", { kind: "choice", choices: ["C1"] }],
    ["startKey", { kind: "choice", choices: ["S2"] }],
    ["endKey", { kind: "choice", choices: ["E3"] }],
    ["timestampFormat", { kind: "choice", choices: ["excel_serial"] }]
  ]));
  expect(timestampFields.some(([name]) => name === "durationKey")).toBe(false);
  expect(guidedFields(request, "column")).toHaveLength(0);
  expect(requests).toHaveLength(1);
});

it.each(["Duration", "Duration (min / h)", "Duration h (min)", "Duration (m) [h]", "Elapsed [s/h]", "Elapsed [m/h]"])("requires explicit duration review when %s has no unambiguous unit", async header => {
  fixture({ ...mapping, durationUnit: "hours", rationale: "The duration unit needs review." });
  const datasetId = await retain(new File([csv.replace("Duration (min)", header)], "missing-unit.csv"));
  const response = await analyzeSelected(datasetId, await selectApple());
  const { runId, snapshot }: { runId: string; snapshot: DataDiscoveryRunSnapshot } = await response.json();
  expect(response.status).toBe(200);
  expect(snapshot.auditLog).toContainEqual(expect.objectContaining({ message: "Model decision: ask_user." }));
  const initial = snapshot.incomingKpi!;
  expect(initial.requiresExplicitDuration).toBe(true);
  expect(initial.options.duration).toBeUndefined();
  expect(initial.hierarchy).toEqual([]);
  expect(snapshot.changeSetPreview?.additions).toEqual([]);
  const clarification = initial.clarifications?.find(item => item.question === "What unit does the duration or amount column use?");
  expect(clarification).toBeDefined();
  const handle = { params: Promise.resolve({ runId }) };
  const confirmed = { ...initial.options, tableId: "table_1", categoryColumns: ["Category"], confirmed: true,
    normalization: { mode: "per_day", basis: "calendar_days", denominator: 2 },
    period: { start: "2026-11-02", end: "2026-11-03" },
    clarificationAnswers: { [clarification!.id]: "Minutes" }
  };
  const answer = await updateMapping(jsonRequest("/user-input", { edits: { incomingKpiOptions: confirmed } }), handle);
  const answered: DataDiscoveryRunSnapshot = (await answer.json()).snapshot;
  expect(answer.status).toBe(200);
  expect(answered.status).toBe("needs_user_input");
  expect(answered.incomingKpi?.options.duration).toBeUndefined();
  expect(answered.incomingKpi?.hierarchy).toEqual([]);
  expect(answered.changeSetPreview?.additions).toEqual([]);
  expect((await apply(jsonRequest("/apply"), handle)).status).toBe(422);

  const manual = await updateMapping(jsonRequest("/user-input", { edits: { incomingKpiOptions: {
    ...confirmed, duration: { mode: "column", column: header, unit: "minutes" }
  } } }), handle);
  const resolved: DataDiscoveryRunSnapshot = (await manual.json()).snapshot;
  expect(manual.status).toBe(200);
  expect(resolved.incomingKpi?.coverage).toMatchObject({ totalRows: 3, includedRows: 3, excludedRows: 0, complete: true });
  expect(resolved.incomingKpi?.hierarchy.map(node => [node.name, node.baselineValue]))
    .toEqual([["Electrical", 0.75], ["Mechanical", 1]]);
  expect((await apply(jsonRequest("/apply"), handle)).status).toBe(200);
});

it("distinguishes a helper rejection before mapping validation", async () => {
  controlled.port = {
    discover: async () => pinned,
    async complete() { throw new AppleTransportError("invalid_output"); }
  };
  const datasetId = await retain(new File([csv], "native-rejection.csv"));
  const response = await analyzeSelected(datasetId, await selectApple());
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({ error: {
    code: "APPLE_DATA_INVALID_OUTPUT", message: "The Apple helper did not return a usable mapping proposal. Review the file locally."
  } });
});

it("fails closed on an unsupported grain or forged model without a provider fallback", async () => {
  const requests = fixture({ decision: "unsupported", rationale: "Plant elapsed downtime requires union of overlapping equipment intervals." });
  const selection = await selectApple();
  const datasetId = await retain(new File([csv], "overlap.csv"));
  const wrongModel = await analyzeSelected(datasetId, { ...selection, expectedExecution: { ...selection.expectedExecution, modelId: "other" } });
  expect(wrongModel.status).toBe(409);
  expect(requests).toHaveLength(0);
  const unsupported = await analyzeSelected(datasetId, selection);
  expect(unsupported.status).toBe(422);
  expect(await unsupported.json()).toMatchObject({ error: { code: "APPLE_DATA_GRAIN_UNSUPPORTED" } });
  expect(requests).toHaveLength(1);
});

it.each([["en", "duration-csv"], ["ru", "serial-xlsx"]] as const)("blocks Apply for the untouched Q01 15,000-row %s/%s source", async (locale, form) => {
  const { buildWorkspaceEventFile } = await import(resolve("eval/agent-autonomy/assets/workspace-q01-events.v2.mjs"));
  const file = buildWorkspaceEventFile(locale, form) as { name: string; bytes: Uint8Array | ArrayBuffer };
  const eventIdColumn = locale === "ru" ? "Код события" : "Event ID";
  const proposal = form === "serial-xlsx" ? russianTimestampMapping : fullMapping;
  const requests = fixture(proposal);
  const selection = await selectApple();
  const bytes = file.bytes instanceof Uint8Array ? Uint8Array.from(file.bytes) : new Uint8Array(file.bytes);
  const datasetId = await retain(new File([bytes], file.name));
  const response = await analyzeSelected(datasetId, selection);
  const initial: { runId: string; snapshot: DataDiscoveryRunSnapshot } = await response.json();
  expect(response.status, JSON.stringify(initial).slice(0, 350)).toBe(200);
  expect(initial.snapshot.tables[0], JSON.stringify(initial.snapshot.warnings).slice(0, 600)).toMatchObject({ rowCount: 15_000, truncated: false });
  expect(requests).toHaveLength(1);
  expect(Buffer.byteLength(requests[0]!.prompt)).toBeLessThan(12_000);
  const handle = { params: Promise.resolve({ runId: initial.runId }) };
  const edit = await updateMapping(jsonRequest("/user-input", { edits: { incomingKpiOptions: {
    ...initial.snapshot.incomingKpi!.options, eventIdColumn,
    normalization: { mode: "per_day", basis: "calendar_days", denominator: 30 },
    period: { start: "2026-11-01", end: "2026-11-30" }, missingCategoryPolicy: "include_unknown", confirmed: true
  } } }), handle);
  const preview = await edit.json();
  expect(edit.status, JSON.stringify(preview).slice(0, 350)).toBe(200);
  expect(preview.snapshot.incomingKpi.blockingReasons.join(" ")).toMatch(/Duplicate event IDs/iu);
  const staged = await apply(jsonRequest("/apply"), handle);
  expect(staged.status).toBe(422);
  expect(requests).toHaveLength(1);
}, 30_000);

const dualMeasureCsv = [
  "Category,Start,End,Duration (min)",
  "Electrical,2026-11-02T08:00:00Z,2026-11-02T09:00:00Z,60",
  "Mechanical,2026-11-03T08:00:00Z,2026-11-03T10:00:00Z,120"
].join("\n");

it.each([
  { groups: "C2", measure: "D4", format: "minutes", failure: "groups" },
  { groups: "clarify", measure: "D4", format: "minutes", failure: "groups" },
  { groups: "C1", measure: "D3", format: "minutes", failure: "measure" },
  { groups: "C1", measure: "S2_E3", format: "hours", failure: "format" }
])("rejects an inadmissible compact mapping field $failure before review", async ({ failure, ...proposal }) => {
  const scoped = scopedFixture("Report downtime by Category in hours per day.");
  const requests = fixture({ tableKey: "T1", ...proposal }, pinned.locale, true);
  const datasetId = await retain(new File([dualMeasureCsv], "dual-measure.csv"));
  const response = await analyzeSelected(datasetId, await selectApple(), scoped);
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({ error: {
    code: "APPLE_DATA_INVALID_OUTPUT", message: expect.stringContaining(`response_shape/${failure}`)
  } });
  expect(requests).toHaveLength(1);
});

it.each([
  "Report downtime by Category or Equipment in hours per day.",
  "If needed, report downtime by Category.",
  "Should we model downtime by Category?",
  "We could model downtime by Category.",
  "Report downtime by Category. Group by Department.",
  "Report downtime by our preferred Category."
])("lets the model clarify unresolved grouping in %s", async scope => {
  const scoped = scopedFixture(scope);
  const requests = fixture({ decision: "clarify", questions: ["Which source columns should group the KPI?"] });
  const source = dualMeasureCsv.split("\n").map((row, index) => `${index ? `E${index}` : "Equipment"},${row}`).join("\n");
  const datasetId = await retain(new File([source], "ambiguous-grouping.csv"));
  const response = await analyzeSelected(datasetId, await selectApple(), scoped);
  const body = await response.json();
  expect(response.status, JSON.stringify(body).slice(0, 350)).toBe(200);
  expect(requests).toHaveLength(1);
  const prompt = JSON.parse(requests[0]!.prompt.split("\n").at(-1)!);
  expect(prompt.tables[0].orderedGroupingKeys).toBeUndefined();
  expect(guidedFields(requests[0]!, "column").find(field => field.name === "categoryKeys")?.shape)
    .toMatchObject({ element: { choices: expect.arrayContaining(["C1", "C2"]) } });
  expect(body.snapshot.incomingKpi.clarifications).toContainEqual(expect.objectContaining({
    question: "Which source columns should group the KPI?"
  }));
  expect((await apply(jsonRequest("/apply", { project: scoped }), { params: Promise.resolve({ runId: body.runId }) })).status).toBe(422);
});

it("preserves independent unit and numeric-format choices on a compact amount mapping", async () => {
  const scoped = scopedFixture("Report downtime by Category using the Recorded interval column in hours per day.");
  const requests = fixture({ tableKey: "T1", groups: "C1", measure: "D5", format: "minutes_decimal_comma" }, pinned.locale, true);
  const source = dualMeasureCsv.split("\n").map((row, index) => `${row},${["Recorded interval", '"61,5"', '"121,5"'][index]}`).join("\n");
  const datasetId = await retain(new File([source], "dual-measure-decimals.csv"));
  const response = await analyzeSelected(datasetId, await selectApple(), scoped);
  const body = await response.json();
  expect(response.status, JSON.stringify(body).slice(0, 350)).toBe(200);
  expect(body.snapshot.incomingKpi.options).toMatchObject({
    categoryColumns: ["Category"], duration: { mode: "column", column: "Recorded interval", unit: "minutes" },
    numberFormat: "decimal_comma"
  });
  expect(body.snapshot.incomingKpi.options.confirmed).not.toBe(true);
  expect(requests[0]!.schema.fields).toContainEqual({
    name: "format", shape: { kind: "choice", choices: expect.arrayContaining(["minutes_decimal_comma"]) }
  });
});

it("keeps a compact model clarification blocked even when the scope resolves grouping", async () => {
  const scoped = scopedFixture("Report downtime by Category in hours per day.");
  const requests = fixture({ tableKey: "T1", groups: "C1", measure: "clarify", format: "unknown" }, pinned.locale, true);
  const datasetId = await retain(new File([dualMeasureCsv], "dual-measure.csv"));
  const response = await analyzeSelected(datasetId, await selectApple(), scoped);
  const body = await response.json();
  expect(response.status, JSON.stringify(body).slice(0, 350)).toBe(200);
  expect(body.snapshot.incomingKpi).toMatchObject({ requiresExplicitDuration: true, hierarchy: [] });
  expect(body.snapshot.incomingKpi.options.duration).toBeUndefined();
  expect(body.snapshot.incomingKpi.clarifications).toContainEqual(expect.objectContaining({
    question: "Which columns and units should this KPI use for grouping and calculation?"
  }));
  expect((await apply(jsonRequest("/apply", { project: scoped }), { params: Promise.resolve({ runId: body.runId }) })).status).toBe(422);
  expect(requests).toHaveLength(1);
});

it("keeps valid compact timestamp mapping in unconfirmed review", async () => {
  const scoped = scopedFixture("Report downtime by Category in hours per day using elapsed timestamps.");
  const requests = fixture({ tableKey: "T1", groups: "C1", measure: "S2_E3", format: "iso" }, pinned.locale, true);
  const datasetId = await retain(new File([dualMeasureCsv], "dual-measure.csv"));
  const response = await analyzeSelected(datasetId, await selectApple(), scoped);
  const body = await response.json();
  expect(response.status, JSON.stringify(body).slice(0, 350)).toBe(200);
  expect(body.snapshot.incomingKpi.options).toMatchObject({
    categoryColumns: ["Category"], duration: { mode: "timestamps", startColumn: "Start", endColumn: "End", format: "iso" }
  });
  expect(body.snapshot.incomingKpi.options.confirmed).not.toBe(true);
  expect((await apply(jsonRequest("/apply", { project: scoped }), { params: Promise.resolve({ runId: body.runId }) })).status).toBe(422);
  expect(requests).toHaveLength(1);
});

it.each([
  { compact: false, proposal: { ...mapping, categoryKeys: ["C2"], durationKey: "D1" } },
  { compact: true, proposal: { tableKey: "T1", groups: "C2", measure: "D1", format: "minutes" } }
])("retains editable clarification for a stale native event ID selector with compact=$compact", async ({ compact, proposal }) => {
  const scoped = compact ? scopedFixture("Report downtime by Category using recorded event durations.") : project;
  const source = [
    "Event ID,Category,Start,End,Duration (min)",
    "10,Electrical,2026-11-02T08:00:00Z,2026-11-02T09:00:00Z,60",
    "11,Mechanical,2026-11-03T08:00:00Z,2026-11-03T10:00:00Z,120"
  ].join("\n");
  fixture(proposal, pinned.locale, compact);
  const datasetId = await retain(new File([source], "stale-event-id.csv"));
  const response = await analyzeSelected(datasetId, await selectApple(), scoped);
  const body = await response.json();
  expect(response.status, JSON.stringify(body).slice(0, 350)).toBe(200);
  expect(body.snapshot.incomingKpi).toMatchObject({
    options: { eventIdColumn: "Event ID" }, requiresExplicitDuration: true,
    hierarchy: [], coverage: { complete: false }
  });
  expect(body.snapshot.incomingKpi.options.duration).toBeUndefined();
  const clarification = (body.snapshot as DataDiscoveryRunSnapshot).incomingKpi?.clarifications?.find(item =>
    item.question === "Which column supplies the amount or elapsed time? The event ID identifies rows.");
  expect(clarification).toBeDefined();
  const handle = { params: Promise.resolve({ runId: body.runId }) };
  expect((await apply(jsonRequest("/apply", { project: scoped }), handle)).status).toBe(422);
  const edited = await updateMapping(jsonRequest("/user-input", { project: scoped, edits: { incomingKpiOptions: {
    ...body.snapshot.incomingKpi.options, categoryColumns: ["Category"],
    duration: { mode: "column", column: "Duration (min)", unit: "minutes" },
    normalization: { mode: "per_day", basis: "calendar_days", denominator: 2 },
    period: { start: "2026-11-02", end: "2026-11-03" },
    clarificationAnswers: { [clarification!.id]: "Use Duration (min)." }, confirmed: true
  } } }), handle);
  expect(edited.status).toBe(200);
  expect((await edited.json()).snapshot.incomingKpi.coverage).toMatchObject({ includedRows: 2, complete: true });
  expect((await apply(jsonRequest("/apply", { project: scoped }), handle)).status).toBe(200);
});

it.each(["Event ID,event_id", "Event ID,Event ID"])("retains generic numeric candidates when event identity labels %s compete", async headers => {
  const source = `${headers},Category,Amount\n10,20,Electrical,60\n11,21,Mechanical,120`;
  const requests = fixture({ ...mapping, categoryKeys: ["C3"], durationKey: "D4" });
  const datasetId = await retain(new File([source], "ambiguous-event-id.csv"));
  const response = await analyzeSelected(datasetId, await selectApple());
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.snapshot.incomingKpi.options.eventIdColumn).toBeUndefined();
  expect(body.snapshot.incomingKpi.options.duration.column).toBe("Amount");
  expect(body.snapshot.incomingKpi.questions).toContainEqual(expect.objectContaining({
    field: "eventIdColumn", message: expect.stringContaining("Choose which column identifies a unique event")
  }));
  expect(guidedFields(requests[0]!, "column").find(field => field.name === "durationKey")?.shape)
    .toEqual({ kind: "choice", choices: ["D1", "D2", "D4"] });
});

it("keeps an event-ID collision editable and blocks Apply until the duration is corrected", async () => {
  const source = "Event ID,Category,Duration (min)\n10,Electrical,60\n11,Electrical,120";
  const requests = fixture({ ...mapping, categoryKeys: ["C2"], durationKey: "D3" });
  const datasetId = await retain(new File([source], "review-event-id-collision.csv"));
  const analyzed = await analyzeSelected(datasetId, await selectApple());
  const initial = await analyzed.json();
  expect(analyzed.status).toBe(200);
  expect(guidedFields(requests[0]!, "column").find(field => field.name === "durationKey")?.shape)
    .toEqual({ kind: "choice", choices: ["D3"] });
  expect(guidedFields(requests[0]!, "timestamps")).toHaveLength(0);
  const handle = { params: Promise.resolve({ runId: initial.runId }) };
  const reviewOptions = {
    ...initial.snapshot.incomingKpi.options, confirmed: true,
    normalization: { mode: "per_day", basis: "calendar_days", denominator: 2 },
    period: { start: "2026-11-02", end: "2026-11-03" }
  };
  const update = (column: string) => updateMapping(jsonRequest("/user-input", { edits: { incomingKpiOptions: {
    ...reviewOptions, duration: { mode: "column", column, unit: "minutes" }
  } } }), handle);
  const blocked = await update("Event ID");
  expect(blocked.status).toBe(200);
  const rejected = await blocked.json();
  expect(rejected.snapshot.incomingKpi).toMatchObject({
    options: { eventIdColumn: "Event ID", duration: { column: "Event ID" } },
    coverage: { includedRows: 0, complete: false }, hierarchy: [],
    blockingReasons: [expect.stringMatching(/event ID column identifies rows/)]
  });
  expect((await apply(jsonRequest("/apply"), handle)).status).toBe(422);
  const corrected = await update("Duration (min)");
  expect(corrected.status).toBe(200);
  expect((await corrected.json()).snapshot.incomingKpi.coverage).toMatchObject({ includedRows: 2, complete: true });
  expect((await apply(jsonRequest("/apply"), handle)).status).toBe(200);
});

it("matches the independent Q01 full-data category totals after an explicitly corrected extract", async () => {
  const { buildWorkspaceEventFile } = await import(resolve("eval/agent-autonomy/assets/workspace-q01-events.v2.mjs"));
  const raw = new TextDecoder().decode(buildWorkspaceEventFile("en", "duration-csv").bytes);
  const [header, ...records] = raw.trimEnd().split("\n");
  const known = new Set<string>();
  const corrected = records.filter(line => {
    const [eventId, , , , , duration] = line.split(",");
    if (!eventId || !duration || known.has(eventId) || !Number.isFinite(Number(duration)) || Number(duration) < 0) return false;
    known.add(eventId);
    return true;
  });
  const publicCases = JSON.parse(await readFile(resolve("eval/agent-autonomy/workspace-requests.v2.json"), "utf8")).cases;
  const brief = publicCases.find((entry: { id: string }) => entry.id === "DATA-01-duration").variants.en.turns[0].prompt;
  const scopedProject = scopedFixture(brief);
  const oracle = JSON.parse(await readFile(resolve("eval/agent-autonomy/workspace-oracles.v2.json"), "utf8")).cases
    .find((entry: { id: string }) => entry.id === "DATA-01-duration").dataGolden;
  expect(corrected).toHaveLength(oracle.acceptedRows);
  const requests = fixture({ tableKey: "T1", groups: "C3", measure: "D6", format: "minutes" }, pinned.locale, true);
  const selection = await selectApple();
  const datasetId = await retain(new File([[header, ...corrected].join("\n")], "q01-explicitly-corrected.csv"));
  const response = await analyze(jsonRequest("", { datasetId, ...selection, project: scopedProject,
    entryContext: { purpose: "incoming_kpis", targetNodeId: "unplanned_downtime" } }));
  const { runId, snapshot }: { runId: string; snapshot: DataDiscoveryRunSnapshot } = await response.json();
  expect(response.status).toBe(200);
  const [targetJson, tableJson] = requests[0]!.prompt.split("\n").slice(-2);
  expect(JSON.parse(targetJson!).scope).toBe(brief);
  const mappedPrompt = JSON.parse(tableJson!);
  expect(mappedPrompt.orderedGroups).toEqual(["C3"]);
  expect(mappedPrompt.columns.map((column: { name: string }) => column.name))
    .toEqual(["Event ID", "Equipment", "Category", "Start", "End", "Duration (min)"]);
  expect(requests[0]!.schema.fields).toEqual(expect.arrayContaining([
    { name: "groups", shape: { kind: "choice", choices: ["C3"] } },
    { name: "measure", shape: { kind: "choice", choices: ["D6", "S4_E5", "clarify", "unsupported"] } }
  ]));
  expect(requests).toHaveLength(1);
  expect(requests[0]!.prompt).not.toContain(String(oracle.categories.mechanical.hoursPerDay));
  expect(requests[0]!.prompt).not.toContain(owner.projectId);
  const edited = await updateMapping(jsonRequest("/edit", { project: scopedProject, edits: { incomingKpiOptions: {
    ...snapshot.incomingKpi!.options, eventIdColumn: "Event ID", confirmed: true, missingCategoryPolicy: "include_unknown",
    normalization: { mode: "per_day", basis: "calendar_days", denominator: oracle.denominatorDays },
    period: { start: "2026-11-01", end: "2026-11-30" }
  } } }), { params: Promise.resolve({ runId }) });
  const body = await edited.json();
  expect(edited.status, JSON.stringify(body).slice(0, 350)).toBe(200);
  expect(body.snapshot.incomingKpi.coverage).toMatchObject({ totalRows: oracle.acceptedRows, includedRows: oracle.acceptedRows, complete: true });
  const leaves = (body.snapshot as DataDiscoveryRunSnapshot).incomingKpi!.hierarchy;
  for (const [category, expected] of Object.entries(oracle.categories) as [string, { hoursPerDay: number }][]) {
    const leaf = leaves.find(node => node.name.toLowerCase() === (category === "uncategorized" ? "unspecified (blank)" : category));
    expect(leaf?.baselineValue).toBeCloseTo(expected.hoursPerDay, 8);
    expect(leaf?.description).toContain(body.snapshot.file.contentHash);
  }
  expect(requests).toHaveLength(1);
}, 30_000);

it("matches Q01 working-day totals on a corrected Russian serial-time workbook", async () => {
  const { buildWorkspaceEventFile } = await import(resolve("eval/agent-autonomy/assets/workspace-q01-events.v2.mjs"));
  const { bytes } = buildWorkspaceEventFile("ru", "serial-xlsx");
  const XLSX = createRequire(resolve("packages/data-harness/package.json"))("xlsx");
  const original = XLSX.read(bytes, { type: "array", cellDates: false });
  const [header, ...records] = XLSX.utils.sheet_to_json(original.Sheets[original.SheetNames[0]], { header: 1, raw: true, defval: "" }) as unknown[][];
  const seen = new Set<number>();
  const corrected = records.filter(row => {
    const [id, , , from, to] = row;
    if (typeof id !== "number" || typeof from !== "number" || typeof to !== "number" || to < from || seen.has(id)) return false;
    seen.add(id);
    const day = new Date(Math.round((from - 25569) * 86_400_000)).getUTCDay();
    return day !== 0 && day !== 6;
  });
  const oracle = JSON.parse(await readFile(resolve("eval/agent-autonomy/workspace-oracles.v2.json"), "utf8")).cases
    .find((entry: { id: string }) => entry.id === "DATA-02-serial").dataGolden;
  expect(corrected).toHaveLength(oracle.eligibleRows);
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([header, ...corrected]);
  for (let row = 2; row <= corrected.length + 1; row++) {
    sheet[`D${row}`].z = "yyyy-mm-dd hh:mm:ss";
    sheet[`E${row}`].z = "yyyy-mm-dd hh:mm:ss";
  }
  XLSX.utils.book_append_sheet(workbook, sheet, "События");
  const requests = fixture(russianTimestampMapping, "ru-RU");
  const datasetId = await retain(new File([new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" }))], "q01-corrected-working-days.xlsx"));
  const response = await analyzeSelected(datasetId, await selectApple("ru-RU"));
  const { runId, snapshot }: { runId: string; snapshot: DataDiscoveryRunSnapshot } = await response.json();
  expect(response.status).toBe(200);
  expect(requests[0]?.locale).toBe("ru-RU");
  const result = await updateMapping(jsonRequest("/edit", { edits: { incomingKpiOptions: {
    ...snapshot.incomingKpi!.options, eventIdColumn: "Код события", missingCategoryPolicy: "include_unknown", confirmed: true,
    duration: { mode: "timestamps", startColumn: "Начало", endColumn: "Окончание", format: "excel_serial", timezoneOffsetMinutes: 0 },
    normalization: { mode: "per_day", basis: "operating_days", denominator: oracle.denominatorDays },
    period: { start: "2026-11-01", end: "2026-11-30" }
  } } }), { params: Promise.resolve({ runId }) });
  const body = await result.json();
  expect(result.status, JSON.stringify(body).slice(0, 350)).toBe(200);
  expect(body.snapshot.incomingKpi.coverage).toMatchObject({ totalRows: oracle.eligibleRows, includedRows: oracle.eligibleRows, complete: true });
  const library = { mechanical: "Механика", electrical: "Электрика", waiting: "Ожидание", uncategorized: "Unspecified (blank)" };
  const leaves = (body.snapshot as DataDiscoveryRunSnapshot).incomingKpi!.hierarchy;
  for (const [category, name] of Object.entries(library)) {
    const leaf = leaves.find(node => node.name === name);
    expect(leaf?.baselineValue).toBeCloseTo(oracle.categories[category].hoursPerDay, 7);
    expect(leaf?.description).toContain(body.snapshot.file.contentHash);
  }
  expect(requests).toHaveLength(1);
}, 30_000);

it("profiles portable XLS through the same admitted route", async () => {
  const XLSX = createRequire(resolve("packages/data-harness/package.json"))("xlsx");
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Category", "Duration (min)"], ["Mechanical", 60]]), "Events");
  const bytes = new Uint8Array(XLSX.write(book, { bookType: "xls", type: "array" }));
  const requests = fixture(mapping);
  const datasetId = await retain(new File([bytes], "a04-legacy.xls"));
  const response = await analyzeSelected(datasetId, await selectApple());
  const body = await response.json();
  expect(response.status, JSON.stringify(body).slice(0, 350)).toBe(200);
  expect(body.snapshot.tables[0]).toMatchObject({ rowCount: 1, tableId: "sheet_1" });
  expect(requests).toHaveLength(1);
});

it.runIf(live)("runs the native Apple model once through the normal English Data Discovery route", async () => {
  const native = packagedAppleNativePort();
  if (!native) throw new Error("Native Apple preview is not configured.");
  controlled.port = {
    discover: (locale, signal) => native.discover(locale, signal),
    complete: async (request, validate) => native.complete(request, raw => {
      const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      const proposal = value.proposal && typeof value.proposal === "object" ? value.proposal as Record<string, unknown> : {};
      const variant = typeof proposal.decision === "string" ? guidedFields(request, proposal.decision) : [];
      const visible = Object.fromEntries(variant.filter(field => Object.hasOwn(proposal, field.name)).map(({ name }) =>
        [name, Array.isArray(proposal[name]) ? "array" : proposal[name] === null ? "null" : typeof proposal[name]]));
      console.info("A04 native proposal shape", JSON.stringify(visible));
      return validate(raw);
    })
  };
  const selection = await selectApple();
  const datasetId = await retain(new File([csv], "confirmed-additive-events.csv"));
  const response = await analyzeSelected(datasetId, selection);
  const body = await response.json();
  expect(response.status, JSON.stringify(body).slice(0, 350)).toBe(200);
  expect(body.snapshot.auditLog).toContainEqual(expect.objectContaining({ taskType: "data_agent_decision", status: "ok" }));
  expect(body.snapshot.incomingKpi.options).toMatchObject({ tableId: "table_1", categoryColumns: ["Category"],
    duration: { mode: "column", column: "Duration (min)", unit: "minutes" } });
  expect(body.snapshot.incomingKpi.options.confirmed).not.toBe(true);
  const edited = await updateMapping(jsonRequest("/user-input", { edits: { incomingKpiOptions: {
    ...body.snapshot.incomingKpi.options, confirmed: true,
    normalization: { mode: "per_day", basis: "calendar_days", denominator: 2 },
    period: { start: "2026-11-02", end: "2026-11-03" }
  } } }), { params: Promise.resolve({ runId: body.runId }) });
  const verified = (await edited.json()).snapshot.incomingKpi;
  expect(edited.status).toBe(200);
  expect(verified.coverage).toMatchObject({ totalRows: 3, includedRows: 3, excludedRows: 0, complete: true });
  expect(verified.hierarchy.map((node: { name: string; baselineValue: number }) => [node.name, node.baselineValue]))
    .toEqual([["Electrical", 0.75], ["Mechanical", 1]]);
  console.info("A04 verified full row coverage", JSON.stringify(verified.coverage));
}, 40_000);

type Scenario = "repair" | "forged" | "cancelled" | "stale" | "deadline" | "wrong_scope";
const timeoutMs = 25_000;
const rejectedRationale = "Rejected synthetic rationale incorrectly describes the timestamp as a category.";
const serialProposal = { rationale: rejectedRationale, decision: "timestamps", tableKey: "T1", categoryKeys: ["C3", "C4"],
  startKey: "S4", endKey: "E5", timestampFormat: "excel_serial" };

it.each(["repair", "forged", "cancelled", "stale", "deadline", "wrong_scope"] as Scenario[])(
  "serial worksheet category repair with %s stays under the public API fences", async scenario => {
    const { POST: admit } = await import("@/app/api/agent/bindings/apple/route");
    const { GET: download } = await import("@/app/api/data/files/[datasetId]/route");
    const { GET: readRun } = await import("@/app/api/data/discovery/runs/[runId]/route");
    const { GET: readVdt } = await import("@/app/api/vdt/vdts/[vdtId]/route");
    const source = new URL("http://localhost:3000");
    const requests: AppleCompletionRequest[] = [];
    const controller = new AbortController();
    const scoped = scopedFixture("Use start and end times from the uploaded workbook to model equipment downtime in hours per working day in November. Use Monday through Friday and include working days with no events. An event ID identifies one event.");
    let discoveries = 0;
    const validateFailures: unknown[] = [];
    controlled.port = {
      async discover() {
        discoveries++;
        if (scenario === "stale" && discoveries === 3) return { ...pinned, identity: { ...pinned.identity, osBuild: "changed" } };
        if (scenario === "wrong_scope" && discoveries === 3) scopedFixture("The saved KPI has changed.", 3);
        return pinned;
      },
      async complete(request, validate) {
        requests.push(request);
        try {
          if (scenario === "deadline" && requests.length === 1) vi.spyOn(performance, "now").mockReturnValue(performance.now() + timeoutMs);
          // Use the same validation boundary as the actual transport, which translates a rejected canonical output.
          const raw = requests.length === 1 ? { proposal: serialProposal }
            : scenario === "forged" ? { categoryKeys: ["C3", "C4"] } : { categoryKeys: ["C3", "C2"] };
          const value = validate(raw);
          return { value, context: { contextSize: 8192, inputTokens: 500, reservedOutputTokens: request.maxOutputTokens } };
        } catch (error) {
          validateFailures.push(error);
          if (scenario === "cancelled") controller.abort();
          throw new AppleTransportError("invalid_output", "canonical_validation");
        }
      }
    };
    const XLSX = createRequire(resolve("packages/data-harness/package.json"))("xlsx");
    const book = XLSX.utils.book_new();
    const base = Date.UTC(2026, 10, 2, 8) / 86_400_000 + 25569;
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Event ID", "Equipment", "Category", "Start", "End"],
      [1, "E1", "Electrical", base, base + 1 / 24],
      [2, "E2", "Mechanical", base + 1, base + 1 + 2 / 24],
      [3, "E1", "Mechanical", base + 2, base + 2 + 1 / 24]
    ]);
    // These serial values have General formatting. Parser-declared timestamp
    // columns cannot enter the original amount/category overlap path.
    XLSX.utils.book_append_sheet(book, sheet, "Events");
    const bytes = new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" }));
    const datasetId = await retain(new File([bytes], "owned-serial-overlap.xlsx"));
    const admitted = await admit(new Request(new URL("/api/agent/bindings/apple", source), {
      method: "POST", headers: { origin: source.origin, host: source.host, "content-type": "application/json" },
      body: JSON.stringify({ locale: "en-US" })
    }));
    expect(admitted.status).toBe(200);
    const { binding } = await admitted.json();
    const selection = { providerId, providerConfig: { bindingId: binding.bindingId },
      expectedExecution: { providerId, mode: "local", profileVersion: 1, modelId: binding.modelId, modelRevision: null } };
    const graph = () => readVdt(new Request(new URL(`/api/vdt/vdts/${owner.vdtId}`, source)),
      { params: Promise.resolve({ vdtId: owner.vdtId }) });
    const before = await (await graph()).json();
    let response: Response;
    try {
      response = await analyze(new Request(jsonRequest("", { datasetId, ...selection, project: scoped,
        entryContext: { purpose: "incoming_kpis", targetNodeId: "unplanned_downtime" }
      }), { signal: controller.signal }));
    } finally {
      vi.restoreAllMocks();
    }
    const body = await response.json();
    const expectedStatus = { repair: 200, forged: 422, cancelled: 499, stale: 422, deadline: 422, wrong_scope: 409 }[scenario];
    expect(response.status).toBe(expectedStatus);
    const rejection = { forged: "APPLE_DATA_INVALID_OUTPUT", cancelled: "APPLE_DATA_CANCELLED",
      stale: "APPLE_DATA_STALE_IDENTITY", deadline: "APPLE_DATA_TIMEOUT" }[scenario as "forged"];
    if (rejection) expect(body.code ?? body.error?.code).toBe(rejection);
    expect(validateFailures.length).toBe(scenario === "forged" ? 2 : 1);
    expect((validateFailures[0] as { field?: string })?.field).toBe("category_overlap");
    const retried = scenario === "repair" || scenario === "forged";
    expect(requests).toHaveLength(retried ? 2 : 1);
    if (retried) {
      const [first, second] = requests;
      expect(second!.signal).toBe(first!.signal);
      expect(second!.expectedIdentity).toEqual(first!.expectedIdentity);
      expect(second!.timeoutMs).toBeLessThanOrEqual(first!.timeoutMs);
      expect(second!.timeoutMs).toBeGreaterThan(0);
      expect(second!.schema.fields).toEqual([{ name: "categoryKeys", shape: {
        kind: "array", maxItems: 4, element: { kind: "choice", choices: ["C1", "C2", "C3"] }
      } }]);
      expect(second!.prompt).toContain('"startKey":"S4","endKey":"E5"');
    }
    if (scenario === "repair") {
      expect(body.snapshot.incomingKpi.options).toMatchObject({
        categoryColumns: ["Category", "Equipment"],
        duration: { mode: "timestamps", startColumn: "Start", endColumn: "End", format: "excel_serial" }
      });
      expect(body.snapshot.incomingKpi.options.confirmed).not.toBe(true);
      expect(JSON.stringify(body.snapshot)).not.toContain(rejectedRationale);
      const persisted = await readRun(new Request(new URL(
        `/api/data/discovery/runs/${body.runId}?${new URLSearchParams(owner)}`, source
      )), { params: Promise.resolve({ runId: body.runId }) });
      expect(persisted.status).toBe(200);
      const saved = await persisted.json();
      expect(JSON.stringify(saved.snapshot)).not.toContain(rejectedRationale);
      expect(JSON.stringify(saved.snapshot)).toContain("Review the proposed source-column mapping.");
      expect((await apply(jsonRequest("/apply", { project: scoped }), {
        params: Promise.resolve({ runId: body.runId })
      })).status).toBe(422);
    } else {
      expect(body.runId).toBeUndefined();
      expect(body.snapshot).toBeUndefined();
      const runs = await readdir(join(scratch, "projects", owner.projectId, "data-discovery", "runs")).catch(error => {
        if (error.code === "ENOENT") return [];
        throw error;
      });
      expect(runs).toEqual([]);
    }
    const sourceBytes = await download(new Request(new URL(`/api/data/files/${datasetId}?${new URLSearchParams(owner)}`, source)),
      { params: Promise.resolve({ datasetId }) });
    expect(sourceBytes.status).toBe(200);
    expect(Buffer.from(await sourceBytes.arrayBuffer())).toEqual(Buffer.from(bytes));
    if (scenario !== "wrong_scope") expect((await (await graph()).json()).activeRevision.id).toBe(before.activeRevision.id);
  }
);

const explicitWorksheetScope = "Use start and end times from the uploaded workbook to model equipment downtime in hours per working day in November. Use Monday through Friday and include working days with no events. An event ID identifies one event.";
const observedAmountOverlap = { decision: "column", tableKey: "T1", categoryKeys: ["C1", "C2", "C3", "C4"],
  durationKey: "D4", durationUnit: "hours" };
const timestampReply = { decision: "timestamps", tableKey: "T1", categoryKeys: ["C3", "C2"],
  startKey: "S4", endKey: "E5", timestampFormat: "excel_serial" };
const worksheetCases = [
  { name: "observed amount overlap followed by a valid timestamp proposal", correction: timestampReply, ok: true },
  { name: "separate recorded amount remains available", correction: { decision: "column", tableKey: "T1",
    categoryKeys: ["C3"], durationKey: "D6", durationUnit: "minutes" }, ok: true },
  { name: "forged second overlap", correction: observedAmountOverlap },
  { name: "second proposal names another table", correction: { ...timestampReply, tableKey: "T2" } },
  { name: "legacy XLS keeps one attempt", legacy: true },
] as const;

it.each(worksheetCases)("saved worksheet method: $name", async testCase => {
  const scoped = scopedFixture(explicitWorksheetScope);
  const calls: AppleCompletionRequest[] = [];
  const validationFailures: unknown[] = [];
  controlled.port = {
    discover: async () => pinned,
    async complete(request, validate) {
      calls.push(request);
      try {
        const proposal = calls.length === 1 ? { ...observedAmountOverlap, rationale: "REJECTED_RAW_RATIONALE" }
          : "correction" in testCase ? testCase.correction : observedAmountOverlap;
        return { value: validate({ proposal }),
          context: { contextSize: 8192, inputTokens: 500, reservedOutputTokens: request.maxOutputTokens } };
      } catch (error) {
        validationFailures.push(error);
        throw new AppleTransportError("invalid_output", "canonical_validation");
      }
    }
  };
  const XLSX = createRequire(resolve("packages/data-harness/package.json"))("xlsx");
  const book = XLSX.utils.book_new();
  const time = Date.UTC(2026, 10, 2, 8) / 86_400_000 + 25569;
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Event ID", "Equipment", "Category", "Start", "End", "Duration (min)"],
    [1, "E1", "Electrical", time, time + 1 / 24, 60],
    [2, "E2", "Mechanical", time + 1, time + 1 + 1 / 24, 60]
  ]);
  XLSX.utils.book_append_sheet(book, sheet, "Events");
  const legacy = "legacy" in testCase;
  const bytes = new Uint8Array(XLSX.write(book, { type: "array", bookType: legacy ? "biff8" : "xlsx" }));
  const datasetId = await retain(new File([bytes], legacy ? "events.xls" : "events.xlsx"));
  const { POST: admit } = await import("../../../agent/bindings/apple/route");
  const address = new URL("http://localhost:3000");
  const admitted = await admit(new Request(new URL("/api/agent/bindings/apple", address), {
    method: "POST", headers: { origin: address.origin, host: address.host, "content-type": "application/json" },
    body: JSON.stringify({ locale: "en-US" })
  }));
  expect(admitted.status).toBe(200);
  const { binding } = await admitted.json();
  const response = await analyze(jsonRequest("", { datasetId, project: scoped, providerId,
    providerConfig: { bindingId: binding.bindingId },
    expectedExecution: { providerId, mode: "local", profileVersion: 1, modelId: binding.modelId, modelRevision: null },
    entryContext: { purpose: "incoming_kpis", targetNodeId: "unplanned_downtime" }
  }));
  expect(calls).toHaveLength(legacy ? 1 : 2);
  expect(validationFailures[0]).toMatchObject({ stage: "duration_selectors", field: "category_overlap" });
  if (!legacy) {
    expect(calls[1]!.signal).toBe(calls[0]!.signal);
    expect(calls[1]!.timeoutMs).toBeLessThanOrEqual(calls[0]!.timeoutMs);
    expect(calls[1]!.prompt).toContain('"tableKey":"T1","overlappingCategoryKey":"C4","overlappingAmountKey":"D4"');
    expect(calls[1]!.prompt).not.toContain("REJECTED_RAW_RATIONALE");
    const proposal = calls[1]!.schema.fields.find(field => field.name === "proposal")?.shape;
    const variants = proposal?.kind === "union" ? proposal.variants : [];
    expect(variants.flatMap(variant => variant.fields.flatMap(field =>
      field.name === "decision" && field.shape.kind === "choice" ? field.shape.choices : [])))
      .toEqual(["clarify", "unsupported", "column", "timestamps"]);
    expect(variants.flatMap(variant => variant.fields.filter(field => field.name === "tableKey").map(field => field.shape)))
      .toEqual([{ kind: "choice", choices: ["T1"] }, { kind: "choice", choices: ["T1"] }]);
  }
  const body = await response.json();
  if ("ok" in testCase) {
    expect(response.status).toBe(200);
    expect(body.snapshot.incomingKpi.options.confirmed).not.toBe(true);
    expect((await apply(jsonRequest("/apply", { project: scoped }), { params: Promise.resolve({ runId: body.runId }) })).status).toBe(422);
    if (testCase.correction.decision === "timestamps") {
      expect(body.snapshot.incomingKpi.options.categoryColumns).toEqual(["Category", "Equipment"]);
      expect(body.snapshot.incomingKpi.options.duration).toEqual({ mode: "timestamps", startColumn: "Start", endColumn: "End", format: "excel_serial" });
    } else {
      expect(body.snapshot.incomingKpi.options.categoryColumns).toEqual(["Category"]);
      expect(body.snapshot.incomingKpi.options.duration).toEqual({ mode: "column", column: "Duration (min)", unit: "minutes" });
    }
    expect(JSON.stringify(body.snapshot)).not.toContain("REJECTED_RAW_RATIONALE");
  } else {
    expect(response.status).toBe(422);
    expect(JSON.stringify(body)).toContain(testCase.name.includes("another table") ? "table_selector" : "category_overlap");
    expect(body.runId).toBeUndefined();
    expect(body.snapshot).toBeUndefined();
    const runs = await readdir(join(scratch, "projects", owner.projectId, "data-discovery", "runs")).catch(error => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    expect(runs).toEqual([]);
  }
});


it.each([
  { name: "separate recorded amount", proposal: { decision: "column", tableKey: "T1", categoryKeys: ["C1"],
    durationKey: "D4", durationUnit: "minutes" }, status: 200 },
  { name: "wrong timestamp encoding", proposal: { decision: "timestamps", tableKey: "T1", categoryKeys: ["C1"],
    startKey: "S2", endKey: "E3", timestampFormat: "iso" }, status: 422, field: "timestamp_encoding" },
  { name: "forged date amount alias", proposal: { decision: "column", tableKey: "T1", categoryKeys: ["C1"],
    durationKey: "D2", durationUnit: "hours" }, status: 422, field: "foreign_selector" },
  { name: "reversed timestamp alias", proposal: { decision: "timestamps", tableKey: "T1", categoryKeys: ["C1"],
    startKey: "S3", endKey: "E2", timestampFormat: "excel_serial" }, status: 422, field: "foreign_selector" },
  { name: "clarification", proposal: { decision: "clarify", questions: ["Which representation is authoritative?"] }, status: 200 },
  { name: "mixed timestamp encoding", mixed: true, proposal: { decision: "timestamps", tableKey: "T1", categoryKeys: ["C1"],
    startKey: "S2", endKey: "E3", timestampFormat: "iso" }, status: 200 },
  { name: "conditional date format", conditional: true, proposal: { decision: "timestamps", tableKey: "T1", categoryKeys: ["C1"],
    startKey: "S2", endKey: "E3", timestampFormat: "excel_serial" }, status: 200 }
])("keeps worksheet encoding evidence bounded and canonical for $name", async ({ name, proposal, status, field, mixed, conditional }) => {
  const scoped = scopedFixture("Calculate service effort from the recorded amount or ask which basis applies.");
  const XLSX = createRequire(resolve("packages/data-harness/package.json"))("xlsx");
  const book = XLSX.utils.book_new();
  const start = Date.UTC(2026, 10, 2, 8) / 86_400_000 + 25569;
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Department", "Begin shift", "Finish shift", "Duration (min)"],
    ["Planning", start, start + 1 / 24, 75],
    ["Operations", mixed ? "2026-11-03T08:00:00" : start + 1, start + 1 + 2 / 24, 85]
  ]);
  for (const address of mixed ? ["B2", "C2", "C3"] : ["B2", "C2", "B3", "C3"]) sheet[address].z = "yyyy-mm-dd hh:mm:ss";
  if (conditional) for (const address of ["B2", "B3"]) sheet[address].z = "0;yyyy";
  XLSX.utils.book_append_sheet(book, sheet, "Schedule");
  const bytes = new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" }));
  const datasetId = await retain(new File([bytes], "effort.xlsx"));
  const calls = fixture(proposal);
  const response = await analyzeSelected(datasetId, await selectApple(), scoped);
  const body = await response.json();
  expect(response.status).toBe(status);
  expect(calls).toHaveLength(1);
  expect(guidedFields(calls[0]!, "column").find(item => item.name === "durationKey")?.shape)
    .toEqual({ kind: "choice", choices: ["D4"] });
  expect(guidedFields(calls[0]!, "timestamps").find(item => item.name === "categoryKeys")?.shape)
    .toEqual({ kind: "array", maxItems: 4, element: { kind: "choice", choices: ["C1"] } });
  if (mixed || conditional) {
    expect(guidedFields(calls[0]!, "timestamps").find(item => item.name === "timestampFormat"))
      .toMatchObject({ shape: { choices: ["iso", "excel_serial", "dmy", "mdy"] }, optional: true });
    expect(body.snapshot.incomingKpi.options.duration).toBeUndefined();
    expect(body.snapshot.incomingKpi.clarifications).toEqual(expect.arrayContaining([
      expect.objectContaining({ question: expect.stringContaining("mixed or ambiguous Excel date formatting") })
    ]));
    expect((await apply(jsonRequest("/apply", { project: scoped }), {
      params: Promise.resolve({ runId: body.runId })
    })).status).toBe(422);
  }
  if (field) {
    expect(body.error?.message ?? body.message).toContain(`duration_selectors/${field}`);
    expect(body.runId).toBeUndefined();
  } else {
    expect(body.snapshot.incomingKpi.options.confirmed).not.toBe(true);
    if (name === "separate recorded amount") {
      expect(body.snapshot.incomingKpi.options.duration).toEqual({ mode: "column", column: "Duration (min)", unit: "minutes" });
    } else {
      expect(body.snapshot.incomingKpi.requiresExplicitDuration).toBe(true);
    }
  }
});


it("keeps an explicitly named separate worksheet date grouping reviewable", async () => {
  const scoped = scopedFixture("Show by Reporting date. Use elapsed times.");
  const XLSX = createRequire(resolve("packages/data-harness/package.json"))("xlsx");
  const book = XLSX.utils.book_new();
  const start = Date.UTC(2026, 10, 2, 8) / 86_400_000 + 25569;
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Reporting date", "Begin shift", "Finish shift"],
    [Math.floor(start), start, start + 1 / 24],
    [Math.floor(start) + 1, start + 1, start + 1 + 2 / 24]
  ]);
  for (const address of ["A2", "A3", "B2", "C2", "B3", "C3"]) sheet[address].z = "yyyy-mm-dd hh:mm:ss";
  XLSX.utils.book_append_sheet(book, sheet, "Schedule");
  const bytes = new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" }));
  const datasetId = await retain(new File([bytes], "date-groups.xlsx"));
  const calls = fixture({ decision: "timestamps", tableKey: "T1", categoryKeys: ["C1"],
    startKey: "S2", endKey: "E3", timestampFormat: "excel_serial" });
  const response = await analyzeSelected(datasetId, await selectApple(), scoped);
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(calls).toHaveLength(1);
  expect(body.snapshot.incomingKpi.options.categoryColumns).toEqual(["Reporting date"]);
  expect(body.snapshot.incomingKpi.options.confirmed).not.toBe(true);
});

it("does not treat a renamed binary workbook as parsed XLSX date evidence", async () => {
  const XLSX = createRequire(resolve("packages/data-harness/package.json"))("xlsx");
  const book = XLSX.utils.book_new();
  const start = Date.UTC(2026, 10, 2, 8) / 86_400_000 + 25569;
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Department", "Begin", "Finish", "Duration (min)"],
    ["Planning", start, start + 1 / 24, 75],
    ["Operations", start + 1, start + 1 + 2 / 24, 85]
  ]);
  for (const address of ["B2", "C2", "B3", "C3"]) sheet[address].z = "yyyy-mm-dd hh:mm:ss";
  XLSX.utils.book_append_sheet(book, sheet, "Schedule");
  const bytes = new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsb" }));
  expect(XLSX.read(bytes, { type: "array" }).bookType).toBe("xlsb");
  const datasetId = await retain(new File([bytes], "renamed.xlsx"));
  const calls = fixture({ decision: "column", tableKey: "T1", categoryKeys: ["C1"], durationKey: "D4", durationUnit: "minutes" });
  const response = await analyzeSelected(datasetId, await selectApple());
  expect(response.status).toBe(200);
  expect(calls).toHaveLength(1);
  expect(calls[0]!.prompt).not.toContain('"excelDateEncoding"');
});

const timestampGroupClock = { tableKey: "T1", startKey: "S5", endKey: "E6", timestampFormat: "excel_serial" };
const exploratoryScope = "Use the beginning and ending times to measure equipment downtime per working day.";
it.each([
  { name: "one source classification", brief: exploratoryScope, scalar: true, categoryKey: "C3", choices: ["C2", "C3", "C4"], categoryColumns: ["Service class"] },
  { name: "model-proposed alternate", brief: exploratoryScope, scalar: true, categoryKey: "C4", choices: ["C2", "C3", "C4"], categoryColumns: ["Origin group"] },
  { name: "two plausible classifications", brief: exploratoryScope, scalar: true, clarify: true, choices: ["C2", "C3", "C4"] },
  { name: "model sends an array in exploratory grouping", brief: exploratoryScope, scalar: true,
    result: ["C2", "C3"], choices: ["C2", "C3", "C4"], rejection: "response_shape/categoryKey" },
  { name: "model sends an array in the scalar field", brief: exploratoryScope, scalar: true,
    categoryKey: ["C3"], choices: ["C2", "C3", "C4"], rejection: "response_shape/categoryKey" },
  { name: "model omits the scalar field", brief: exploratoryScope, scalar: true,
    choices: ["C2", "C3", "C4"], rejection: "response_shape/categoryKey" },
  { name: "model sends both grouping shapes", brief: exploratoryScope, scalar: true, categoryKey: "C3",
    result: ["C3"], choices: ["C2", "C3", "C4"], rejection: "response_shape/proposal" },
  { name: "model changes the case of the scalar alias", brief: exploratoryScope, scalar: true, categoryKey: "c3",
    choices: ["C2", "C3", "C4"], rejection: "response_shape/categoryKey" },
  { name: "model sends a foreign scalar alias", brief: exploratoryScope, scalar: true, categoryKey: "C24",
    choices: ["C2", "C3", "C4"], rejection: "category_selectors" },
  { name: "forged event identity", brief: exploratoryScope, scalar: true, categoryKey: "C1",
    choices: ["C2", "C3", "C4"], rejection: "category_selectors" },
  { name: "explicit equipment then category", brief: "Report downtime by EQUIPMENT then Service class.",
    result: ["C2", "C3"], choices: ["C2", "C3"], categoryColumns: ["Equipment", "Service class"], explainedLevels: 2 },
  { name: "scalar alias in an explicitly ordered hierarchy", brief: "Report downtime by Equipment then Service class.",
    categoryKey: "C2", choices: ["C2", "C3"], explainedLevels: 2, rejection: "response_shape/proposal" },
  { name: "explicit arrow order", brief: "Group by Service class → Equipment for each working day.",
    result: ["C3", "C2"], choices: ["C2", "C3"], categoryColumns: ["Service class", "Equipment"], explainedLevels: 2 },
  { name: "explicit identity", brief: "Group by Event ID.", result: ["C1"], choices: ["C1"], categoryColumns: ["Event ID"] },
  { name: "negated scope", brief: "Do not group by equipment or service class.",
    result: ["C2"], choices: ["C2", "C3", "C4"] },
  { name: "conflicting hierarchy", brief: "Report downtime by Equipment then Service class. Group by Service class then Equipment.",
    result: ["C3"], choices: ["C2", "C3", "C4"] },
  { name: "unknown grouping term", brief: "Report downtime by Field sector then Service class.",
    result: ["C3"], choices: ["C2", "C3", "C4"] },
  { name: "unresolved material hierarchy", brief: "Show downtime for each Equipment within each Service class.",
    result: ["C3"], choices: ["C2", "C3", "C4"] },
  { name: "conflicting exclusion", brief: "Group by Equipment. Avoid grouping by Equipment.",
    result: ["C2"], choices: ["C2", "C3", "C4"] },
  { name: "additional nested grouping", brief: "Group by Service class for each Equipment.",
    result: ["C3"], choices: ["C2", "C3", "C4"] },
  { name: "explicit negated breakdown", brief: "No breakdown by Equipment.",
    result: ["C2"], choices: ["C2", "C3", "C4"] },
  { name: "explicit no grouping", brief: "No grouping.",
    result: ["C2"], choices: ["C2", "C3", "C4"] },
  { name: "explicit but unresolved arrow hierarchy", brief: "Use grouping Equipment → Service class.",
    result: ["C3"], choices: ["C2", "C3", "C4"] },
  { name: "negated alternatives", brief: "Do not use Equipment or Service class as groups.",
    result: ["C3"], choices: ["C2", "C3", "C4"] }
])("grounds timestamp grouping and keeps $name behind review", async testCase => {
  const scoped = scopedFixture(testCase.brief);
  const XLSX = createRequire(resolve("packages/data-harness/package.json"))("xlsx");
  const book = XLSX.utils.book_new();
  const start = Date.UTC(2026, 10, 2, 8) / 86_400_000 + 25569;
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Event ID", "Equipment", "Service class", "Origin group", "Begin", "Finish"],
    [54, "K12", "Planning", "Partner", start, start + 1 / 24],
    [55, "K12", "Operations", "Staff", start + 1, start + 1 + 2 / 24],
    [56, "K21", "Operations", "Partner", start + 2, start + 2 + 1 / 24]
  ]);
  for (const address of ["E2", "F2", "E3", "F3", "E4", "F4"]) sheet[address].z = "yyyy-mm-dd hh:mm:ss";
  XLSX.utils.book_append_sheet(book, sheet, "Schedule");
  const bytes = new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" }));
  const datasetId = await retain(new File([bytes], "typed-grouping.xlsx"));
  const calls = fixture(testCase.clarify
    ? { decision: "clarify", questions: ["Should this review group by service classification or origin?"] }
    : { decision: "timestamps", ...timestampGroupClock,
      ...(testCase.result ? { categoryKeys: testCase.result } : {}),
      ...(testCase.categoryKey ? { categoryKey: testCase.categoryKey } : {}) });
  const response = await analyzeSelected(datasetId, await selectApple(), scoped);
  const body = await response.json();
  expect(calls).toHaveLength(1);
  const fields = guidedFields(calls[0]!, "timestamps");
  if (testCase.scalar) {
    expect(fields.find(item => item.name === "categoryKey")?.shape).toEqual({ kind: "choice", choices: testCase.choices });
    expect(fields.some(item => item.name === "categoryKeys")).toBe(false);
  } else {
    expect(fields.find(item => item.name === "categoryKeys")?.shape).toEqual({ kind: "array", maxItems: testCase.explainedLevels ?? 1,
      element: { kind: "choice", choices: testCase.choices } });
    expect(fields.some(item => item.name === "categoryKey")).toBe(false);
  }
  if (testCase.rejection) {
    expect(response.status).toBe(422);
    expect(body.error?.message ?? body.message).toContain(testCase.rejection);
    expect(body.runId).toBeUndefined();
    return;
  }
  expect(response.status).toBe(200);
  expect(body.snapshot.incomingKpi.options.confirmed).not.toBe(true);
  if (testCase.categoryColumns) {
    if ("explainedLevels" in testCase || testCase.name === "explicit identity") {
      const packet = JSON.parse(calls[0]!.prompt.slice(calls[0]!.prompt.lastIndexOf("\n") + 1));
      expect(packet.tables[0].groupingEvidence).toEqual([testCase.brief]);
    }
    expect(body.snapshot.incomingKpi.options.categoryColumns).toEqual(testCase.categoryColumns);
    expect(body.snapshot.incomingKpi.options.duration).toMatchObject({ mode: "timestamps", format: "excel_serial" });
  } else {
    expect(body.snapshot.incomingKpi.requiresExplicitDuration).toBe(true);
    expect(body.snapshot.incomingKpi.options.duration).toBeUndefined();
    expect(body.snapshot.incomingKpi.clarifications).not.toHaveLength(0);
  }
  expect((await apply(jsonRequest("/apply", { project: scoped }), {
    params: Promise.resolve({ runId: body.runId })
  })).status).toBe(422);
});
