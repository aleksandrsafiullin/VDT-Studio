import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openVdtDatabase, projectDir } from "@vdt-studio/storage";
import type { DataDiscoveryRunSnapshot, IncomingKpiOptions } from "@vdt-studio/data-harness";
import { productionVolumeProject } from "@vdt-studio/vdt-core";
import { GET as listFiles, POST as uploadFile } from "../../files/route";
import { GET as downloadFile } from "../../files/[datasetId]/route";
import { readDatasetFile, saveDatasetFile, saveDiscoveryRun } from "../../store";
import { GET as getRun } from "./[runId]/route";
import { POST as applyRun } from "./[runId]/apply/route";
import { POST as saveUserInput } from "./[runId]/user-input/route";
import { POST as createRun } from "./route";

let tempDir: string | undefined;
const projectId = "project_data_api";
const vdtId = "vdt_data_api";
const graphProjectId = "graph_project_data_api";
const testProject = { ...structuredClone(productionVolumeProject), id: graphProjectId };
const scope = { projectId, vdtId };
const query = new URLSearchParams(scope).toString();

function jsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...scope, ...(body as object) })
  });
}

function uploadRequest(file: File) {
  const formData = new FormData();
  formData.set("file", file);
  formData.set("projectId", projectId);
  formData.set("vdtId", vdtId);
  return new Request("http://localhost:3000/api/data/files", {
    method: "POST",
    body: formData
  });
}

async function readJson<T>(response: Response): Promise<T> {
  return await response.json() as T;
}

function clearStoreCache() {
  delete (globalThis as { __vdtDataApiStore?: unknown }).__vdtDataApiStore;
}

describe("data discovery run API lifecycle", () => {
  beforeEach(async () => {
    tempDir = await realpath(await mkdtemp(path.join(os.tmpdir(), "vdt-data-api-")));
    vi.stubEnv("VDT_DATA_DIR", tempDir);
    vi.stubEnv("VDT_APP_MODE", "development_web");
    const database = openVdtDatabase(tempDir, { dataDir: tempDir });
    database.createProject({ id: projectId, name: "Data project" });
    database.createVdt({ id: vdtId, projectId, name: "Data VDT", rootKpi: "Production" });
    database.createVdt({ id: "vdt_other", projectId, name: "Other VDT", rootKpi: "Production" });
    database.createProject({ id: "project_other", name: "Other project" });
    database.createVdt({ id: "vdt_foreign", projectId: "project_other", name: "Foreign VDT", rootKpi: "Production" });
    for (const stored of [
      { projectId, vdtId, graph: testProject },
      { projectId, vdtId: "vdt_other", graph: { ...testProject, id: "graph_other" } },
      { projectId: "project_other", vdtId: "vdt_foreign", graph: { ...testProject, id: "graph_foreign" } }
    ]) {
      database.saveVdtRevision({ id: `revision_${stored.vdtId}`, projectId: stored.projectId, vdtId: stored.vdtId, revisionNo: 1, source: "user", project: stored.graph });
    }
    database.close();
    clearStoreCache();
  });

  afterEach(async () => {
    clearStoreCache();
    vi.unstubAllEnvs();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("completes a persisted lifecycle with distinct workspace, VDT record and graph identities", async () => {
    const csv = ["Date,Region,Minutes", "2026-07-01,North,10", "2026-07-02,South,20"].join("\n");
    const uploadResponse = await uploadFile(uploadRequest(new File([csv], "downtime.csv", { type: "text/csv" })));
    const uploadBody = await readJson<{ ok: boolean; datasetId: string }>(uploadResponse);
    expect(uploadResponse.status).toBe(200);
    expect(uploadBody.ok).toBe(true);

    const runResponse = await createRun(jsonRequest("http://localhost:3000/api/data/discovery/runs", {
      datasetId: uploadBody.datasetId,
      project: testProject
    }));
    const runBody = await readJson<{ ok: boolean; runId: string; snapshot: { status: string; changeSetPreview?: unknown } }>(runResponse);
    expect(runResponse.status).toBe(200);
    expect(runBody.snapshot.status).toBe("waiting_review");
    expect(runBody.snapshot.changeSetPreview).toBeTruthy();
    expect(runBody.snapshot).toMatchObject({ projectId: graphProjectId, workspaceProjectId: projectId, vdtId });

    clearStoreCache();
    const persistedResponse = await getRun(new Request(`http://localhost:3000/api/data/discovery/runs/${runBody.runId}?${query}`), {
      params: Promise.resolve({ runId: runBody.runId })
    });
    const persistedBody = await readJson<{ ok: boolean; snapshot: { runId: string } }>(persistedResponse);
    expect(persistedBody.snapshot.runId).toBe(runBody.runId);

    const editResponse = await saveUserInput(jsonRequest(`http://localhost:3000/api/data/discovery/runs/${runBody.runId}/user-input`, {
      edits: {
        columnRoles: [
          {
            tableId: "table_1",
            columnName: "Minutes",
            logicalType: "duration",
            unit: "minute"
          }
        ]
      }
    }), { params: Promise.resolve({ runId: runBody.runId }) });
    const editBody = await readJson<{ ok: boolean; snapshot: { status: string; validationResults: Array<{ status: string }> } }>(editResponse);
    expect(editBody.ok).toBe(true);
    expect(editBody.snapshot.status).toBe("waiting_review");
    expect(editBody.snapshot.validationResults.some((result) => result.status === "error")).toBe(false);

    const applyResponse = await applyRun(jsonRequest(`http://localhost:3000/api/data/discovery/runs/${runBody.runId}/apply`, {}), {
      params: Promise.resolve({ runId: runBody.runId })
    });
    const applyBody = await readJson<{ ok: boolean; snapshot: { status: string }; changeSet?: unknown }>(applyResponse);
    expect(applyResponse.status).toBe(200);
    expect(applyBody.ok).toBe(true);
    expect(applyBody.snapshot.status).toBe("succeeded");
    expect(applyBody.changeSet).toBeTruthy();
  });

  it("analyzes every row in a CSV larger than the 4096-byte UI preview", async () => {
    const csv = [
      "id,value",
      ...Array.from({ length: 1_000 }, (_, index) => `${index + 1},${100_000 + index}`)
    ].join("\n");
    const uploadResponse = await uploadFile(uploadRequest(new File([csv], "large.csv", { type: "text/csv" })));
    const uploadBody = await readJson<{ ok: boolean; datasetId: string }>(uploadResponse);
    expect(uploadResponse.status).toBe(200);

    const runResponse = await createRun(jsonRequest("http://localhost:3000/api/data/discovery/runs", {
      datasetId: uploadBody.datasetId,
      project: testProject
    }));
    const runBody = await readJson<{
      snapshot: { tables: Array<{ rowCount: number; truncated: boolean }> };
    }>(runResponse);

    expect(runResponse.status).toBe(200);
    expect(runBody.snapshot.tables[0]).toMatchObject({
      rowCount: 1_000,
      truncated: false
    });
  });

  it("blocks apply for failed unsupported discovery runs", async () => {
    const uploadResponse = await uploadFile(uploadRequest(new File(["zip"], "archive.zip", { type: "application/zip" })));
    const uploadBody = await readJson<{ ok: boolean; datasetId: string }>(uploadResponse);

    const runResponse = await createRun(jsonRequest("http://localhost:3000/api/data/discovery/runs", {
      datasetId: uploadBody.datasetId,
      project: testProject
    }));
    const runBody = await readJson<{ ok: boolean; runId: string; snapshot: { status: string; changeSetPreview?: unknown } }>(runResponse);
    expect(runBody.snapshot.status).toBe("failed");
    expect(runBody.snapshot.changeSetPreview).toBeUndefined();

    const applyResponse = await applyRun(jsonRequest(`http://localhost:3000/api/data/discovery/runs/${runBody.runId}/apply`, {}), {
      params: Promise.resolve({ runId: runBody.runId })
    });
    const applyBody = await readJson<{ ok: boolean; error?: { code?: string } }>(applyResponse);
    expect(applyResponse.status).toBe(422);
    expect(applyBody.ok).toBe(false);
    expect(applyBody.error?.code).toBe("DATA_DISCOVERY_VALIDATION_FAILED");
  });

  it("retains exact source bytes in the owning project after cache reset and discarded review", async () => {
    const bytes = new Uint8Array([0, 255, 13, 10, 65, 128]);
    const upload = await readJson<{ datasetId: string; sourceUrl: string; file: { fileName: string; contentHash: string } }>(await uploadFile(uploadRequest(new File([bytes], "источник.xlsx"))));
    expect(upload.file.fileName).toBe("источник.xlsx");
    expect(upload.file.contentHash).toBe(`sha256:${createHash("sha256").update(bytes).digest("hex")}`);
    expect(await readFile(path.join(projectDir(tempDir!, projectId), "files", upload.datasetId, "payload.bin"))).toEqual(Buffer.from(bytes));
    // Closing/discarding a client review clears client state; it never deletes a retained source.
    clearStoreCache();
    const download = await downloadFile(new Request(`http://localhost:3000${upload.sourceUrl}`), { params: Promise.resolve({ datasetId: upload.datasetId }) });
    expect(download.status).toBe(200);
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(bytes);
    expect(download.headers.get("content-disposition")).toContain(encodeURIComponent("источник.xlsx"));
    const listed = await readJson<{ sources: Array<{ datasetId: string; sourceUrl: string }> }>(await listFiles(new Request(`http://localhost:3000/api/data/files?${query}`)));
    expect(listed.sources).toContainEqual(expect.objectContaining({ datasetId: upload.datasetId, sourceUrl: upload.sourceUrl }));
  });

  it("rejects rewriting a source version and detects tampering before and after cache reset", async () => {
    const upload = await readJson<{ datasetId: string; sourceUrl: string }>(await uploadFile(uploadRequest(new File(["Reason,Minutes\nA,60"], "immutable.csv"))));
    const owner = { ...scope, dataDir: tempDir! };
    const source = (await readDatasetFile(upload.datasetId, owner))!;
    await expect(saveDatasetFile(source, owner)).rejects.toMatchObject({ code: "DATASET_ALREADY_EXISTS" });
    await writeFile(path.join(projectDir(tempDir!, projectId), "files", upload.datasetId, "payload.bin"), "corrupted");
    for (const reset of [false, true]) {
      if (reset) clearStoreCache();
      const response = await downloadFile(new Request(`http://localhost:3000${upload.sourceUrl}`), { params: Promise.resolve({ datasetId: upload.datasetId }) });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: { code: "DATA_SOURCE_INTEGRITY_FAILED" } });
    }
  });

  it("rejects cross-project, cross-VDT and unscoped access even when IDs are known", async () => {
    const upload = await readJson<{ datasetId: string }>(await uploadFile(uploadRequest(new File(["Reason,Minutes\nA,60"], "owned.csv"))));
    const run = await readJson<{ runId: string }>(await createRun(jsonRequest("http://localhost:3000/api/data/discovery/runs", { datasetId: upload.datasetId, project: testProject })));
    for (const wrongScope of [{ projectId, vdtId: "vdt_other" }, { projectId: "project_other", vdtId: "vdt_foreign" }]) {
      const wrongQuery = new URLSearchParams(wrongScope);
      const response = await downloadFile(new Request(`http://localhost:3000/api/data/files/${upload.datasetId}?${wrongQuery}`), { params: Promise.resolve({ datasetId: upload.datasetId }) });
      expect(response.status).toBe(404);
      const runResponse = await getRun(new Request(`http://localhost:3000/api/data/discovery/runs/${run.runId}?${wrongQuery}`), { params: Promise.resolve({ runId: run.runId }) });
      expect(runResponse.status).toBe(404);
      const listing = await readJson<{ sources: unknown[] }>(await listFiles(new Request(`http://localhost:3000/api/data/files?${wrongQuery}`)));
      expect(listing.sources).toEqual([]);
    }
    expect(await readDatasetFile(upload.datasetId)).toBeUndefined();
    const unscoped = await getRun(new Request(`http://localhost:3000/api/data/discovery/runs/${run.runId}`), { params: Promise.resolve({ runId: run.runId }) });
    expect(unscoped.status).toBe(404);
    const unscopedStage = await applyRun(new Request(`http://localhost:3000/api/data/discovery/runs/${run.runId}/apply`, { method: "POST" }), { params: Promise.resolve({ runId: run.runId }) });
    expect(unscopedStage.status).toBe(404);
  });

  it("fails closed outside local mode and validates the actual SQLite owner relationship", async () => {
    vi.stubEnv("VDT_APP_MODE", "hosted_web");
    expect((await uploadFile(uploadRequest(new File(["x"], "source.csv")))).status).toBe(403);
    expect((await listFiles(new Request(`http://localhost:3000/api/data/files?${query}`))).status).toBe(403);
    vi.stubEnv("VDT_APP_MODE", "development_web");
    expect((await listFiles(new Request(`http://localhost:3000/api/data/files?projectId=${projectId}&vdtId=vdt_foreign`))).status).toBe(404);
    expect((await listFiles(new Request("http://localhost:3000/api/data/files?projectId=../project_data_api&vdtId=vdt_data_api"))).status).toBe(400);
  });

  it("rejects unsafe source and run IDs without alias sanitization or symlink traversal", async () => {
    for (const datasetId of ["../payload", "dataset/a", "dataset.a", " dataset_a", "dataset_a ", "%2Fetc"]) {
      expect((await downloadFile(new Request(`http://localhost:3000/api/data/files/safe?${query}`), { params: Promise.resolve({ datasetId }) })).status).toBe(400);
      expect((await getRun(new Request(`http://localhost:3000/api/data/discovery/runs/safe?${query}`), { params: Promise.resolve({ runId: datasetId }) })).status).toBe(400);
    }
    await uploadFile(uploadRequest(new File(["x"], "source.csv")));
    await symlink(tempDir!, path.join(projectDir(tempDir!, projectId), "files", "dataset_symlink"));
    const response = await downloadFile(new Request(`http://localhost:3000/api/data/files/dataset_symlink?${query}`), { params: Promise.resolve({ datasetId: "dataset_symlink" }) });
    expect(response.status).toBe(409);
  });

  it("preserves legacy global sources without exposing them as project-owned uploads", async () => {
    const bytes = new TextEncoder().encode("Reason,Minutes\nA,60");
    const datasetId = "dataset_legacy";
    await saveDatasetFile({ datasetId, bytes, textPreview: "preview", metadata: {
      fileName: "legacy.csv", mimeType: "text/csv", sizeBytes: bytes.byteLength,
      contentHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`, storageRef: datasetId, uploadedAt: new Date().toISOString()
    } });
    clearStoreCache();
    expect((await readDatasetFile(datasetId))?.bytes).toEqual(bytes);
    expect(await readDatasetFile(datasetId, { ...scope, dataDir: tempDir! })).toBeUndefined();
    const legacyRun = await createRun(new Request("http://localhost:3000/api/data/discovery/runs", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ datasetId, project: testProject })
    }));
    expect(legacyRun.status).toBe(200);
  });

  it("recomputes full retained rows with timestamp, hierarchy and per-day decisions, then stages only the complete preview", async () => {
    const project = incomingProject();
    const csv = ["System,Reason,Minutes,Start,End", ...Array.from({ length: 1000 }, (_, index) =>
      `${index % 2 ? "Electrical" : "Mechanical"},Reason ${index % 3},120,2026-10-01T00:00:00Z,2026-10-01T01:00:00Z`
    )].join("\n");
    const { datasetId } = await readJson<{ datasetId: string }>(await uploadFile(uploadRequest(new File([csv], "downtime-period.csv"))));
    const run = await readJson<{ runId: string; snapshot: DataDiscoveryRunSnapshot }>(await createRun(jsonRequest("http://localhost:3000/api/data/discovery/runs", {
      datasetId, project, entryContext: { purpose: "incoming_kpis", targetNodeId: "unplanned_downtime" }
    })));
    expect(run.snapshot.status).toBe("needs_user_input");
    const blocked = await applyRun(jsonRequest("http://localhost:3000/apply", { project }), { params: Promise.resolve({ runId: run.runId }) });
    expect(blocked.status).toBe(422);
    const metadataEdit = await readJson<{ snapshot: DataDiscoveryRunSnapshot }>(await saveUserInput(jsonRequest("http://localhost:3000/edit", { project, edits: { metricEdits: [{ metricId: "ignored", name: "Renamed" }] } }), { params: Promise.resolve({ runId: run.runId }) }));
    expect(metadataEdit.snapshot.status).toBe("needs_user_input");
    clearStoreCache();
    const incomingKpiOptions: IncomingKpiOptions = {
      tableId: "table_1", categoryColumns: ["System", "Reason"], duration: { mode: "timestamps", startColumn: "Start", endColumn: "End", format: "iso" },
      normalization: { mode: "per_day", basis: "calendar_days", denominator: 10 }, period: { start: "2026-10-01", end: "2026-10-10" }, confirmed: true
    };
    const editedResponse = await saveUserInput(jsonRequest("http://localhost:3000/edit", { project, edits: { incomingKpiOptions } }), { params: Promise.resolve({ runId: run.runId }) });
    const edited = await readJson<{ snapshot: DataDiscoveryRunSnapshot }>(editedResponse);
    expect(editedResponse.status).toBe(200);
    expect(edited.snapshot.incomingKpi?.coverage).toMatchObject({ totalRows: 1000, includedRows: 1000, excludedRows: 0, complete: true });
    expect(edited.snapshot.incomingKpi?.hierarchy.filter((node) => node.depth === 1).reduce((sum, node) => sum + (node.baselineValue ?? 0), 0)).toBe(100);
    expect(edited.snapshot.incomingKpi?.hierarchy.every((node) => node.description.includes("downtime-period.csv") && node.description.includes(edited.snapshot.file.contentHash))).toBe(true);
    const staged = await applyRun(jsonRequest("http://localhost:3000/apply", { project }), { params: Promise.resolve({ runId: run.runId }) });
    expect(staged.status).toBe(200);
    expect(await staged.json()).toMatchObject({ ok: true, changeSet: { additions: expect.any(Array) } });
    expect((await readDatasetFile(datasetId, { ...scope, dataDir: tempDir! }))?.bytes.byteLength).toBeGreaterThan(4096);
  });

  it("stages additive numeric KPI values in the confirmed target unit without imposing duration semantics", async () => {
    const project = incomingProject();
    const target = project.graph.nodes.find((node) => node.id === "unplanned_downtime")!;
    target.name = "Maintenance cost";
    target.unit = "USD";
    const { datasetId } = await readJson<{ datasetId: string }>(await uploadFile(uploadRequest(new File([
      "Category,Amount\nMechanical,12.5\nMechanical,-2.5\nElectrical,50"
    ], "costs.csv"))));
    const run = await readJson<{ runId: string; snapshot: DataDiscoveryRunSnapshot }>(await createRun(jsonRequest("http://localhost:3000/api/data/discovery/runs", {
      datasetId, project, entryContext: { purpose: "incoming_kpis", targetNodeId: target.id },
      incomingKpiOptions: {
        tableId: "table_1", categoryColumns: ["Category"], duration: { mode: "column", column: "Amount", unit: "target" },
        normalization: { mode: "period_total" }, numberFormat: "decimal_dot", confirmed: true
      }
    })));
    expect(run.snapshot.status).toBe("waiting_review");
    expect(run.snapshot.incomingKpi?.coverage).toMatchObject({ totalRows: 3, includedRows: 3, complete: true });
    expect(run.snapshot.incomingKpi?.hierarchy).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Mechanical", unit: "USD", baselineValue: 10 }),
      expect.objectContaining({ name: "Electrical", unit: "USD", baselineValue: 50 })
    ]));
    const staged = await applyRun(jsonRequest("http://localhost:3000/apply", { project }), { params: Promise.resolve({ runId: run.runId }) });
    expect(staged.status).toBe(200);
  });

  it("keeps provider clarification questions mandatory through metadata edits and direct staging", async () => {
    const project = incomingProject();
    const { datasetId } = await readJson<{ datasetId: string }>(await uploadFile(uploadRequest(new File(["Reason,Minutes\nA,60"], "questions.csv"))));
    const run = await readJson<{ runId: string; snapshot: DataDiscoveryRunSnapshot }>(await createRun(jsonRequest("http://localhost:3000/api/data/discovery/runs", {
      datasetId, project, entryContext: { purpose: "incoming_kpis", targetNodeId: "unplanned_downtime" },
      incomingKpiOptions: { tableId: "table_1", categoryColumns: ["Reason"], duration: { mode: "column", column: "Minutes", unit: "minutes" }, normalization: { mode: "per_day", basis: "calendar_days", denominator: 1 }, period: { start: "2026-10-01", end: "2026-10-01" }, confirmed: true }
    })));
    run.snapshot.incomingKpi!.questions.push({ id: "provider_1", field: "clarificationAnswers.provider_1", message: "Confirm whether breaks are included.", required: true });
    await saveDiscoveryRun(run.snapshot, { ...scope, dataDir: tempDir! });
    const edit = await readJson<{ snapshot: DataDiscoveryRunSnapshot }>(await saveUserInput(jsonRequest("http://localhost:3000/edit", { project, edits: { metricEdits: [{ metricId: "ignored", enabled: false }] } }), { params: Promise.resolve({ runId: run.runId }) }));
    expect(edit.snapshot.incomingKpi?.questions.some((question) => question.id === "provider_1")).toBe(true);
    expect((await applyRun(jsonRequest("http://localhost:3000/apply", { project }), { params: Promise.resolve({ runId: run.runId }) })).status).toBe(422);
  });

  it("rejects another VDT snapshot and a semantically changed target, while allowing card movement", async () => {
    const project = incomingProject();
    const { datasetId } = await readJson<{ datasetId: string }>(await uploadFile(uploadRequest(new File(["Reason,Minutes\nA,60"], "target.csv"))));
    const mismatch = await createRun(jsonRequest("http://localhost:3000/api/data/discovery/runs", { datasetId, project: { ...project, id: "vdt_other" } }));
    expect(mismatch.status).toBe(409);
    const run = await readJson<{ runId: string }>(await createRun(jsonRequest("http://localhost:3000/api/data/discovery/runs", { datasetId, project, entryContext: { purpose: "incoming_kpis", targetNodeId: "unplanned_downtime" } })));
    const changed = structuredClone(project);
    changed.graph.nodes.find((node) => node.id === "unplanned_downtime")!.unit = "minutes/day";
    const response = await applyRun(jsonRequest("http://localhost:3000/apply", { project: changed }), { params: Promise.resolve({ runId: run.runId }) });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "DATA_TARGET_CHANGED" } });
    const moved = structuredClone(project);
    moved.graph.nodes.find((node) => node.id === "unplanned_downtime")!.position = { x: 123, y: 456 };
    const movedResponse = await applyRun(jsonRequest("http://localhost:3000/apply", { project: moved }), { params: Promise.resolve({ runId: run.runId }) });
    expect(movedResponse.status).toBe(422); // Required mapping confirmation still blocks, not the layout change.
  });

});


function incomingProject() {
  const project = structuredClone(testProject);
  const target = project.graph.nodes.find((node) => node.id === "unplanned_downtime")!;
  target.name = "Downtime per day";
  target.unit = "h/day";
  return project;
}
