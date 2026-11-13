import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseRetainedDataset, runRawDataDiscovery, validateDiscoveryApply } from "../../packages/data-harness/src/index.ts";
import {
  applyChangeSet,
  calculateGraph,
  extractFormulaReferences,
  inspectDecompositionHierarchy,
  productionVolumeProject
} from "../../packages/vdt-core/src/index.ts";

const period = { start: "2026-11-02", end: "2026-11-05" };
const cleanHours = { Mechanical: 4.5, Electrical: 2.5, Planned: 4 };
const reviewedHours = { Mechanical: 2, Electrical: 2, Planned: 3.25, "Unspecified (blank)": 0.5 };
const csv = { eventIdColumn: "event_id", categoryColumns: ["stop_type"], duration: { mode: "column", column: "duration_minutes", unit: "minutes" } };
const tsv = { eventIdColumn: "record_id", categoryColumns: ["stop_type"], duration: { mode: "column", column: "duration_hours", unit: "hours" }, numberFormat: "decimal_comma" };
const xlsx = { tableId: "sheet_1", eventIdColumn: "event_id", categoryColumns: ["stop_type"], duration: { mode: "column", column: "elapsed", unit: "days" } };
const json = { eventIdColumn: "incident", categoryColumns: ["cause"], duration: { mode: "timestamps", startColumn: "start_utc", endColumn: "end_utc", format: "iso" } };

async function source(fileName, mimeType, options) {
  const bytes = await readFile(new URL(`./fixtures/${fileName}`, import.meta.url));
  const project = structuredClone(productionVolumeProject);
  const root = project.graph.nodes.find((node) => node.id === project.rootNodeId);
  assert.ok(root);
  root.name = "Average downtime";
  root.unit = "h/day";
  delete root.formula;
  project.graph = { nodes: [root], edges: [] };
  project.scenarios = [];
  return {
    datasetId: "open_alpha_downtime",
    file: {
      fileName, mimeType, sizeBytes: bytes.length, storageRef: "open_alpha_downtime",
      contentHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      uploadedAt: "2026-11-06T00:00:00Z"
    },
    bytes,
    project,
    entryContext: { source: "node_file_action", targetNodeId: root.id, purpose: "incoming_kpis" },
    incomingKpiOptions: {
      tableId: "table_1", period, normalization: { mode: "per_day", basis: "calendar_days", denominator: 4 },
      confirmed: true, ...options
    }
  };
}

function applyPreview(input, snapshot) {
  const preview = snapshot.changeSetPreview;
  assert.ok(preview, input.file.fileName);
  const approved = new Set([
    ...preview.additions, ...preview.updates, ...preview.deletions, ...preview.edgeChanges,
    ...(preview.dataSourceChanges ?? []), ...(preview.dataMappingChanges ?? []), ...(preview.taxonomyChanges ?? [])
  ].map((entry) => entry.id));
  const applied = applyChangeSet(input.project, preview, approved);
  assert.equal(applied.success, true, input.file.fileName);
  return applied.project;
}

function close(actual, expected, label) {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) < 1e-6, `${label}: expected ${expected}, got ${actual}`);
}

async function verifyImport(caseId, input, rows, expectedHours) {
  const snapshot = await runRawDataDiscovery(input);
  assert.equal(validateDiscoveryApply(snapshot).some((issue) => issue.status === "error"), false, input.file.fileName);
  assert.deepEqual(snapshot.incomingKpi.coverage, {
    totalRows: rows, includedRows: rows, excludedRows: 0, categoryCount: Object.keys(expectedHours).length, complete: true
  });
  const project = applyPreview(input, snapshot);
  const root = project.graph.nodes.find((node) => node.id === project.rootNodeId);
  const calculation = calculateGraph(project);
  assert.ok(root.formula, input.file.fileName);
  assert.equal(root.type, "root_kpi");
  if (root.decompositionPlan) {
    const hierarchy = inspectDecompositionHierarchy(project, "incremental_user_apply");
    assert.equal(hierarchy.valid, true, hierarchy.errors.join("\n"));
  }
  assert.deepEqual(calculation.errors, []);
  const factors = project.graph.nodes.filter((node) => node.id !== root.id);
  assert.deepEqual(factors.map((node) => node.name).sort(), Object.keys(expectedHours).sort());
  const factorIds = factors.map((node) => node.id).sort();
  assert.deepEqual(extractFormulaReferences(root.formula).sort(), factorIds);
  assert.ok(project.graph.edges.every((edge) => edge.sourceNodeId === root.id));
  assert.deepEqual(project.graph.edges.map((edge) => edge.targetNodeId).sort(), factorIds);
  for (const node of factors) {
    assert.equal(node.type, "data_mapped");
    assert.equal(node.unit, "h/day");
    assert.equal(node.valueSource?.sourceTier, "file");
    assert.ok(node.description.includes(input.file.fileName) && node.description.includes(input.file.contentHash));
    close(calculation.values[node.id], expectedHours[node.name] / 4, node.name);
  }
  const expectedRoot = Object.values(expectedHours).reduce((sum, hours) => sum + hours, 0) / 4;
  close(calculation.rootValue, expectedRoot, input.file.fileName);
  console.log(JSON.stringify({ caseId, status: "PASS", file: input.file.fileName, rows, hoursPerDay: calculation.rootValue }));
}

const csvInput = await source("downtime-minutes.csv", "text/csv", csv);
const xlsxInput = await source("downtime-elapsed.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xlsx);
const jsonInput = await source("downtime-intervals.json", "application/json", json);

const [csvTable] = (await parseRetainedDataset(csvInput)).tables;
const [xlsxTable] = (await parseRetainedDataset(xlsxInput)).tables;
const [jsonTable] = (await parseRetainedDataset(jsonInput)).tables;
assert.equal(csvTable.rows.length, 10);
assert.equal(xlsxTable.name, "Shift log");
assert.equal(xlsxTable.rows.length, 10);
assert.equal(jsonTable.rows.length, 10);
for (const [index, event] of csvTable.rows.entries()) {
  const excelEvent = xlsxTable.rows[index];
  const interval = jsonTable.rows[index];
  assert.equal(excelEvent.event_id, event.event_id);
  assert.equal(interval.incident, event.event_id);
  assert.equal(excelEvent.stop_type, event.stop_type);
  assert.equal(interval.cause, event.stop_type);
  const minutes = Number(event.duration_minutes);
  close(Number(excelEvent.elapsed) * 1440, minutes, event.event_id);
  close((Date.parse(interval.end_utc) - Date.parse(interval.start_utc)) / 60000, minutes, event.event_id);
}

await verifyImport("FILE-01", csvInput, 10, cleanHours);
await verifyImport("FILE-02", xlsxInput, 10, cleanHours);
await verifyImport("FILE-03", jsonInput, 10, cleanHours);

const dirtyInput = await source("downtime-exceptions.tsv", "text/tab-separated-values", tsv);
const dirty = await runRawDataDiscovery(dirtyInput);
assert.equal(dirty.incomingKpi.coverage.totalRows, 9);
assert.ok(dirty.incomingKpi.blockingReasons.some((message) => /3 of 9 rows have missing, invalid/.test(message)));
assert.ok(dirty.incomingKpi.blockingReasons.some((message) => /Duplicate event IDs.*Q-02/.test(message)));
assert.ok(dirty.incomingKpi.questions.some((item) => item.field === "missingCategoryPolicy"));
assert.ok(validateDiscoveryApply(dirty).some((issue) => issue.status === "error"));
assert.equal(dirty.changeSetPreview?.additions.length ?? 0, 0);
console.log(JSON.stringify({ caseId: "FILE-04", status: "PASS", rawRows: 9, invalidDurations: 3, applyBlocked: true }));

const reviewed = await source("downtime-reviewed.tsv", "text/tab-separated-values", { ...tsv, missingCategoryPolicy: "include_unknown" });
await verifyImport("FILE-04 reviewed", reviewed, 8, reviewedHours);

const duplicateInput = await source("downtime-duplicate.csv", "text/csv", csv);
const duplicateTable = (await parseRetainedDataset(duplicateInput)).tables[0];
assert.equal(duplicateTable.rows.length, 11);
const repeated = duplicateTable.rows.filter((row) => row.event_id === "DT-02");
assert.equal(repeated.length, 2);
assert.deepEqual(repeated[0], repeated[1]);
const duplicate = await runRawDataDiscovery(duplicateInput);
const problems = duplicate.incomingKpi.blockingReasons;
if (validateDiscoveryApply(duplicate).some((issue) => issue.status === "error") &&
    problems.some((message) => /Duplicate event IDs.*DT-02/.test(message)) &&
    duplicate.changeSetPreview.additions.length === 0 && duplicate.changeSetPreview.updates.length === 0) {
  console.log(JSON.stringify({ caseId: "FILE-05", status: "PASS", applyBlocked: true, problems }));
  const repeatedIndex = duplicateTable.rows.lastIndexOf(repeated[1]);
  assert.deepEqual(duplicateTable.rows.filter((_row, index) => index !== repeatedIndex), csvTable.rows);
  await verifyImport("FILE-05 reviewed", csvInput, 10, cleanHours);
} else {
  const actual = duplicate.changeSetPreview?.additions.length
    ? calculateGraph(applyPreview(duplicateInput, duplicate)).rootValue
    : undefined;
  console.log(JSON.stringify({ caseId: "FILE-05", status: "FAIL", repeatedEvent: "DT-02", expectedHoursPerDay: 2.75, actualHoursPerDay: actual, problems }));
  process.exitCode = 2;
}
