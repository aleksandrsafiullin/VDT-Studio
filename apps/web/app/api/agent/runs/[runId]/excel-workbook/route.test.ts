import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createExcelWorkbook, EXCEL_MIME_TYPE, productionVolumeProject } from "@vdt-studio/vdt-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openVdtStorageDatabase } from "../../../../vdt/storage-database";
import { describeExcelWorkbook } from "../../excel-workbook";
import { GET } from "./route";

const scope = {
  runId: "excel_run",
  projectId: "workspace_project",
  vdtId: "workspace_vdt",
  revisionId: "revision_original",
  scenarioId: "scenario_second"
};
const project = {
  ...structuredClone(productionVolumeProject),
  name: "VDT · Production",
  scenarios: [
    ...productionVolumeProject.scenarios,
    {
      ...structuredClone(productionVolumeProject.scenarios[0]!),
      id: scope.scenarioId,
      name: "Second scenario",
      overrides: [{ nodeId: "unplanned_downtime", value: 10 }]
    }
  ]
};

let dataDir: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "vdt-excel-download-"));
  vi.stubEnv("VDT_DATA_DIR", dataDir);
  vi.stubEnv("VDT_APP_MODE", "development_web");
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function download(url: string, runId = scope.runId, headers?: HeadersInit) {
  return GET(new Request(new URL(url, "http://localhost:3000"), headers === undefined ? undefined : { headers }), {
    params: Promise.resolve({ runId })
  });
}

describe("saved Excel workbook download", () => {
  it("replays a descriptor and serves the editor-equivalent workbook after a newer revision is saved", async () => {
    const database = openVdtStorageDatabase(process.cwd());
    let descriptor: ReturnType<typeof describeExcelWorkbook>;
    try {
      database.createProject({ id: scope.projectId, name: "Workspace" });
      for (const vdtId of [scope.vdtId, "other_vdt"]) {
        database.createVdt({ id: vdtId, projectId: scope.projectId, name: "Production", rootKpi: "Production Volume" });
      }
      for (const [id, vdtId] of [[scope.runId, scope.vdtId], ["other_run", "other_vdt"]] as const) {
        database.createAgentRun({ id, projectId: scope.projectId, vdtId, status: "completed", phase: "completed", request: {} });
      }
      database.saveVdtRevision({ id: scope.revisionId, projectId: scope.projectId, vdtId: scope.vdtId, revisionNo: 1, source: "user", project });
      const otherRevision = database.saveVdtRevision({ id: "revision_other_vdt", projectId: scope.projectId, vdtId: "other_vdt", revisionNo: 1, source: "user", project });
      descriptor = describeExcelWorkbook(database, scope);
      expect(descriptor).toEqual({
        kind: "excel_workbook", id: expect.stringMatching(/^excel_[0-9a-f]{64}$/),
        revisionId: scope.revisionId, scenarioId: scope.scenarioId,
        filename: "VDT · Production.xlsx", downloadUrl: expect.stringMatching(/^\/api\/agent\/runs\//)
      });
      expect(() => describeExcelWorkbook(database, { ...scope, revisionId: null })).toThrow(expect.objectContaining({ code: "EXCEL_SAVED_REVISION_REQUIRED" }));
      expect(() => describeExcelWorkbook(database, { ...scope, scenarioId: "missing" })).toThrow(expect.objectContaining({ code: "EXCEL_SCENARIO_UNAVAILABLE" }));
      expect(() => describeExcelWorkbook(database, { ...scope, revisionId: otherRevision.id })).toThrow(expect.objectContaining({ code: "EXCEL_REVISION_UNAVAILABLE" }));

      const updated = { ...project, name: "Newer workbook", scenarios: project.scenarios.slice(0, 1) };
      database.saveVdtRevision({ id: "revision_new", projectId: scope.projectId, vdtId: scope.vdtId, revisionNo: 2,
        parentRevisionId: scope.revisionId, source: "user", project: updated });
      expect(describeExcelWorkbook(database, scope)).toEqual(descriptor);
    } finally {
      database.close();
    }

    const response = await download(descriptor.downloadUrl);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(EXCEL_MIME_TYPE);
    expect(response.headers.get("content-disposition")).toContain("filename*=UTF-8''VDT%20%C2%B7%20Production.xlsx");
    // The exporter fixes ZIP timestamps, so equality covers every sheet, formula, input and scenario cell.
    const workbook = new Uint8Array(await response.arrayBuffer());
    expect(workbook).toEqual(createExcelWorkbook(project, scope.scenarioId));
    expect(workbook).not.toEqual(createExcelWorkbook(project, project.scenarios[0]!.id));

    expect((await download(descriptor.downloadUrl, "other_run")).status).toBe(404);
    expect((await download(descriptor.downloadUrl.replace(scope.revisionId, "revision_new"))).status).toBe(404);
    expect((await download(descriptor.downloadUrl.replace(scope.scenarioId, project.scenarios[0]!.id))).status).toBe(404);
    expect((await download(descriptor.downloadUrl, scope.runId, { "sec-fetch-site": "cross-site" })).status).toBe(403);
  });
});
