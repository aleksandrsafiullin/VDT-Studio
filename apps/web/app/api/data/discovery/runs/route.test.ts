import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { productionVolumeProject } from "@vdt-studio/vdt-core";
import { POST as uploadFile } from "../../files/route";
import { GET as getRun } from "./[runId]/route";
import { POST as applyRun } from "./[runId]/apply/route";
import { POST as saveUserInput } from "./[runId]/user-input/route";
import { POST as createRun } from "./route";

let tempDir: string | undefined;

function jsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

function uploadRequest(file: File) {
  const formData = new FormData();
  formData.set("file", file);
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
    tempDir = await mkdtemp(path.join(os.tmpdir(), "vdt-data-api-"));
    vi.stubEnv("VDT_DATA_DIR", tempDir);
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

  it("persists upload and run snapshots, accepts user edits, and gates apply through validation", async () => {
    const csv = ["Date,Region,Minutes", "2026-07-01,North,10", "2026-07-02,South,20"].join("\n");
    const uploadResponse = await uploadFile(uploadRequest(new File([csv], "downtime.csv", { type: "text/csv" })));
    const uploadBody = await readJson<{ ok: boolean; datasetId: string }>(uploadResponse);
    expect(uploadResponse.status).toBe(200);
    expect(uploadBody.ok).toBe(true);

    const runResponse = await createRun(jsonRequest("http://localhost:3000/api/data/discovery/runs", {
      datasetId: uploadBody.datasetId,
      project: productionVolumeProject
    }));
    const runBody = await readJson<{ ok: boolean; runId: string; snapshot: { status: string; changeSetPreview?: unknown } }>(runResponse);
    expect(runResponse.status).toBe(200);
    expect(runBody.snapshot.status).toBe("waiting_review");
    expect(runBody.snapshot.changeSetPreview).toBeTruthy();

    clearStoreCache();
    const persistedResponse = await getRun(new Request(`http://localhost:3000/api/data/discovery/runs/${runBody.runId}`), {
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

    const applyResponse = await applyRun(new Request(`http://localhost:3000/api/data/discovery/runs/${runBody.runId}/apply`, { method: "POST" }), {
      params: Promise.resolve({ runId: runBody.runId })
    });
    const applyBody = await readJson<{ ok: boolean; snapshot: { status: string }; changeSet?: unknown }>(applyResponse);
    expect(applyResponse.status).toBe(200);
    expect(applyBody.ok).toBe(true);
    expect(applyBody.snapshot.status).toBe("succeeded");
    expect(applyBody.changeSet).toBeTruthy();
  });

  // Remove `.fails` in W0.3 when discovery parses immutable full bytes instead of the UI preview.
  it.fails("[known defect F-02] analyzes every row in a CSV larger than the 4096-byte preview", async () => {
    const csv = [
      "id,value",
      ...Array.from({ length: 1_000 }, (_, index) => `${index + 1},${100_000 + index}`)
    ].join("\n");
    const uploadResponse = await uploadFile(uploadRequest(new File([csv], "large.csv", { type: "text/csv" })));
    const uploadBody = await readJson<{ ok: boolean; datasetId: string }>(uploadResponse);
    expect(uploadResponse.status).toBe(200);

    const runResponse = await createRun(jsonRequest("http://localhost:3000/api/data/discovery/runs", {
      datasetId: uploadBody.datasetId,
      project: productionVolumeProject
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
      project: productionVolumeProject
    }));
    const runBody = await readJson<{ ok: boolean; runId: string; snapshot: { status: string; changeSetPreview?: unknown } }>(runResponse);
    expect(runBody.snapshot.status).toBe("failed");
    expect(runBody.snapshot.changeSetPreview).toBeUndefined();

    const applyResponse = await applyRun(new Request(`http://localhost:3000/api/data/discovery/runs/${runBody.runId}/apply`, { method: "POST" }), {
      params: Promise.resolve({ runId: runBody.runId })
    });
    const applyBody = await readJson<{ ok: boolean; error?: { code?: string } }>(applyResponse);
    expect(applyResponse.status).toBe(422);
    expect(applyBody.ok).toBe(false);
    expect(applyBody.error?.code).toBe("DATA_DISCOVERY_VALIDATION_FAILED");
  });
});
