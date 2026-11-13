import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { VdtBuilderSession } from "@vdt-studio/vdt-core";
import { openVdtDatabase, projectDir } from "@vdt-studio/storage";
import { createStorageWriteActor, parseCreateVdtWithInitialHttpRequest } from "../../vdt/storage-write-adapter";
import { saveDatasetFile, updateLibraryDatasetFile } from "../../data/store";
import { GET as downloadSource } from "../../data/files/[datasetId]/route";
import { retainedDatasetProvider } from "./dataset-provider";
import type { AgentToolContext } from "@vdt-studio/vdt-agent-runtime";
import { POST } from "./[runId]/saved-copy/route";

it("copies one immutable revision for repeated requests without modifying the interrupted run or its graph", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "vdt-saved-copy-"));
  vi.stubEnv("VDT_DATA_DIR", dataDir);
  vi.stubEnv("VDT_APP_MODE", "development_web");
  const db = openVdtDatabase(process.cwd(), { dataDir });
  try {
    const owner = db.createProject({ id: "owner", name: "Recovery test" });
    const runtime = db.getProjectRuntimeState(owner.id)!;
    const builder = new VdtBuilderSession();
    builder.createDraft({ projectTitle: "Sales", rootKpi: "Sales" });
    builder.setFormula({ nodeId: "sales", formula: "42" });
    const bytes = new TextEncoder().encode("Revenue,Orders\n100,4\n200,5\n300,6\n");
    const metadata = { fileName: "sales.csv", mimeType: "text/csv", sizeBytes: bytes.length,
      contentHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`, uploadedAt: "2026-11-13T00:00:00.000Z",
      storageRef: "retained_sales", tableCount: 1 };
    const graph = { ...builder.getProject(), dataSources: [{ id: "sales_source", name: "Sales",
      type: "file" as const, file: metadata }] };
    const initial = db.createVdtWithInitialSnapshot({
      actor: createStorageWriteActor(owner.id),
      command: {
        schemaVersion: "create_vdt_with_initial_snapshot.v1", projectId: owner.id,
        expectedRuntimeGeneration: runtime.runtimeGeneration, expectedGenerationVersion: runtime.generationVersion,
        idempotencyKey: "fixture", vdt: { requestedVdtId: "original", name: "Sales", rootKpi: "Sales",
          unit: null, timePeriod: null, status: "draft", metadata: null },
        revisionIntent: { source: "user", summary: "Initial", validation: null, calculation: null }
      },
      project: graph
    });
    const record = db.createAgentRun({ id: "interrupted", projectId: owner.id, vdtId: "original",
      status: "running", phase: "building_graph", request: {} });
    const request = (vdtId: string) => POST(new Request("http://localhost/saved-copy", {
      method: "POST", body: JSON.stringify({ projectId: owner.id, vdtId, revisionId: initial.revision.id })
    }), { params: Promise.resolve({ runId: record.id }) });
    expect((await request("wrong-vdt")).status).toBe(404);
    const unavailable = await request("original");
    expect(unavailable.status).toBe(409);
    expect(db.listVdts(owner.id)).toHaveLength(1);
    const originalOwner = { dataDir, projectId: owner.id, vdtId: "original" };
    await saveDatasetFile({ datasetId: "retained_sales", metadata: { ...metadata, projectId: owner.id, vdtId: "original" }, bytes, textPreview: "" }, originalOwner);
    await updateLibraryDatasetFile("retained_sales", originalOwner, { action: "archive" });
    const identity = createHash("sha256").update(JSON.stringify([record.id, owner.id, "original", initial.revision.id])).digest("hex");
    const deterministicId = `vdt_saved_copy_${identity}`;
    expect(() => parseCreateVdtWithInitialHttpRequest({
      schemaVersion: "create_vdt_with_initial_http_request.v1", idempotencyKey: `saved-copy:${identity}`,
      expectedRuntime: {}, vdt: {}, project: graph
    })).toThrow("reserved");
    db.createVdt({ id: deterministicId, projectId: owner.id, name: "Spoofed", rootKpi: "Sales",
      metadata: { source: "interrupted_run_saved_copy", sourceVdtId: "original", sourceRevisionId: initial.revision.id, sourceRunId: record.id } });
    const spoof = await request("original");
    expect(spoof.status).toBe(409);
    expect(await spoof.json()).toMatchObject({ error: { code: "SAVED_COPY_IDENTITY_CONFLICT" } });
    db.deleteVdt(deterministicId);
    const links = path.join(projectDir(dataDir, owner.id), "files", "retained_sales", "vdts");
    fs.mkdirSync(links, { recursive: true });
    const existingLink = path.join(links, `vdt_saved_copy_${identity}.json`);
    fs.writeFileSync(existingLink, '{"attached":false}');
    expect((await request("original")).status).toBe(409);
    expect(db.listVdts(owner.id)).toHaveLength(1);
    fs.unlinkSync(existingLink);
    const responses = await Promise.all([request("original"), request("original")]);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    const results = await Promise.all(responses.map(response => response.json()));
    expect(results[0]).toEqual(results[1]);
    expect(results[0].vdtId).not.toBe("original");
    expect(db.listVdts(owner.id)).toHaveLength(2);
    const [copiedRevision] = db.listVdtRevisions(results[0].vdtId);
    expect(db.readVdtRevision(copiedRevision!)).toEqual(graph);
    const vdtId = results[0].vdtId;
    const download = await downloadSource(new Request(`http://localhost/api/data/files/retained_sales?projectId=${owner.id}&vdtId=${vdtId}`),
      { params: Promise.resolve({ datasetId: "retained_sales" }) });
    expect(download.status).toBe(200);
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(bytes);
    const context = { getRun: () => ({ request: { workspace: { projectId: owner.id, vdtId } }, draftProject: graph }) } as AgentToolContext;
    expect(await retainedDatasetProvider.list(context)).toMatchObject([{ datasetId: "retained_sales", contentHash: metadata.contentHash }]);
    expect(await retainedDatasetProvider.read(context, "retained_sales")).toMatchObject({ datasetId: "retained_sales", contentHash: metadata.contentHash });
    await updateLibraryDatasetFile("retained_sales", { ...originalOwner, vdtId }, { action: "detach", vdtId });
    db.updateVdt(vdtId, { name: "Edited copy", metadata: { edited: true } });
    expect((await request("original")).status).toBe(200);
    expect(db.getVdt(vdtId)).toMatchObject({ name: "Edited copy", metadata: { edited: true } });
    expect(await retainedDatasetProvider.list(context)).toEqual([]);
    expect(db.getVdtRevisionHead("original")).toEqual(initial.head);
    expect(db.getAgentRun(record.id)).toEqual(record);
  } finally {
    db.close();
    vi.unstubAllEnvs();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
