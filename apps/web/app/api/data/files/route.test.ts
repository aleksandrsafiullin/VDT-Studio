import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openVdtDatabase, projectDir } from "@vdt-studio/storage";
import { productionVolumeProject } from "@vdt-studio/vdt-core";
import { retainedDatasetProvider } from "../../agent/runs/dataset-provider";
import type { AgentToolContext } from "@vdt-studio/vdt-agent-runtime";
import { POST as createRun } from "../discovery/runs/route";
import { GET as download, PATCH as modify } from "./[datasetId]/route";
import { GET as list, POST as upload } from "./route";
import type { ProjectFileSource } from "@/lib/project-files-client";

const projectId = "project_library";
const firstVdt = "vdt_library_first";
const secondVdt = "vdt_library_second";
let dataDir: string;

function request(pathname: string, method = "GET", body?: unknown): Request {
  return new Request(`http://localhost:3000/api/data/${pathname}`, {
    method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  });
}

async function uploadSource(vdtId?: string, owner = projectId): Promise<ProjectFileSource> {
  const form = new FormData();
  form.set("projectId", owner);
  if (vdtId) form.set("vdtId", vdtId);
  form.set("file", new File(["Reason,Minutes\nRepair,60\nMaintenance,30"], "данные клиента.csv", { type: "text/csv" }));
  const response = await upload(new Request("http://localhost:3000/api/data/files", { method: "POST", body: form }));
  expect(response.status).toBe(200);
  return await response.json() as ProjectFileSource;
}

async function sources(scope: { projectId: string; vdtId?: string; includeArchived?: string } = { projectId }): Promise<ProjectFileSource[]> {
  const response = await list(request(`files?${new URLSearchParams(scope)}`));
  expect(response.status).toBe(200);
  return (await response.json() as { sources: ProjectFileSource[] }).sources;
}

async function change(datasetId: string, body: unknown, owner = projectId): Promise<Response> {
  return modify(request(`files/${datasetId}?projectId=${owner}`, "PATCH", body), { params: Promise.resolve({ datasetId }) });
}

async function original(datasetId: string, vdtId?: string): Promise<Response> {
  const scope = new URLSearchParams({ projectId, ...(vdtId ? { vdtId } : {}) });
  return download(request(`files/${datasetId}?${scope}`), { params: Promise.resolve({ datasetId }) });
}

describe("project file library", () => {
  beforeEach(async () => {
    dataDir = await realpath(await mkdtemp(path.join(os.tmpdir(), "vdt-project-library-")));
    vi.stubEnv("VDT_DATA_DIR", dataDir);
    vi.stubEnv("VDT_APP_MODE", "development_web");
    const database = openVdtDatabase(dataDir, { dataDir });
    try {
      database.createProject({ id: projectId, name: "Client project" });
      database.createProject({ id: "project_library_foreign", name: "Other client" });
      database.createProject({ id: "project_library_empty", name: "Project with no trees" });
      for (const id of [firstVdt, secondVdt]) {
        database.createVdt({ id, projectId, name: id, rootKpi: "Production" });
        database.saveVdtRevision({ id: `revision_${id}`, projectId, vdtId: id, revisionNo: 1, source: "user", project: { ...structuredClone(productionVolumeProject), id: `graph_${id}` } });
      }
      database.createVdt({ id: "vdt_library_foreign", projectId: "project_library_foreign", name: "Other client tree", rootKpi: "Production" });
    } finally { database.close(); }
  });

  afterEach(async () => {
    globalThis.__vdtDataApiStore = undefined;
    vi.unstubAllEnvs();
    await rm(dataDir, { recursive: true, force: true });
  });

  it("stores project uploads without a VDT selection and retains exact original bytes across cache reset", async () => {
    const source = await uploadSource();
    expect(source.file.vdtId).toBeUndefined();
    globalThis.__vdtDataApiStore = undefined;
    expect(await sources()).toMatchObject([{ datasetId: source.datasetId, displayName: "данные клиента.csv", archived: false, vdtIds: [] }]);
    expect(await sources({ projectId, vdtId: firstVdt })).toEqual([]);
    const response = await original(source.datasetId);
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(response.status).toBe(200);
    expect(`sha256:${createHash("sha256").update(bytes).digest("hex")}`).toBe(source.file.contentHash);
    expect(response.headers.get("content-disposition")).toContain(encodeURIComponent(source.file.fileName));
  });

  it("accepts client data in an empty project before its first tree is created", async () => {
    const source = await uploadSource(undefined, "project_library_empty");
    expect(source.file.vdtId).toBeUndefined();
    expect(await sources({ projectId: "project_library_empty" })).toMatchObject([{ datasetId: source.datasetId, vdtIds: [] }]);
  });

  it("automatically lists a builder upload in its project and original VDT", async () => {
    const source = await uploadSource(firstVdt);
    expect(await sources()).toMatchObject([{ datasetId: source.datasetId, vdtIds: [firstVdt] }]);
    expect(await sources({ projectId, vdtId: firstVdt })).toMatchObject([{ datasetId: source.datasetId }]);
    expect(await sources({ projectId, vdtId: secondVdt })).toEqual([]);
    expect((await original(source.datasetId, secondVdt)).status).toBe(404);
  });

  it("shares one retained source with another VDT and runs discovery with the new graph and VDT identity", async () => {
    const source = await uploadSource(firstVdt);
    const location = path.join(projectDir(dataDir, projectId), "files", source.datasetId, "metadata.json");
    const metadataBefore = await readFile(location);
    expect((await change(source.datasetId, { action: "attach", vdtId: secondVdt })).status).toBe(200);
    globalThis.__vdtDataApiStore = undefined;
    expect(await sources()).toMatchObject([{ datasetId: source.datasetId, vdtIds: [firstVdt, secondVdt] }]);
    expect((await sources({ projectId, vdtId: secondVdt }))[0]?.file.vdtId).toBe(secondVdt);
    const response = await createRun(request("discovery/runs", "POST", {
      projectId, vdtId: secondVdt, datasetId: source.datasetId,
      project: { ...structuredClone(productionVolumeProject), id: `graph_${secondVdt}` }
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ snapshot: { workspaceProjectId: projectId, vdtId: secondVdt, projectId: `graph_${secondVdt}`, file: { vdtId: secondVdt, storageRef: source.datasetId } } });
    expect(await readFile(location)).toEqual(metadataBefore);
  });

  it("exposes explicitly attached project data to the existing owner-scoped agent tools", async () => {
    const source = await uploadSource();
    const context = { getRun: () => ({ request: { workspace: { projectId, vdtId: secondVdt } } }) } as unknown as AgentToolContext;
    expect(await retainedDatasetProvider.list(context)).toEqual([]);
    expect((await change(source.datasetId, { action: "attach", vdtId: secondVdt })).status).toBe(200);
    expect(await retainedDatasetProvider.list(context)).toEqual([{ datasetId: source.datasetId, fileName: source.file.fileName, contentHash: source.file.contentHash }]);
  });

  it("detaches availability without breaking original downloads from saved VDT references", async () => {
    const source = await uploadSource(firstVdt);
    await change(source.datasetId, { action: "attach", vdtId: secondVdt });
    for (const vdtId of [firstVdt, secondVdt]) {
      expect((await change(source.datasetId, { action: "detach", vdtId })).status).toBe(200);
      expect(await sources({ projectId, vdtId })).toEqual([]);
      expect((await original(source.datasetId, vdtId)).status).toBe(200);
    }
    expect(await sources()).toMatchObject([{ datasetId: source.datasetId, vdtIds: [] }]);
  });

  it("archives and restores library availability while retaining linked-tree originals", async () => {
    const source = await uploadSource(firstVdt);
    expect((await change(source.datasetId, { action: "archive" })).status).toBe(200);
    expect(await sources()).toEqual([]);
    expect(await sources({ projectId, includeArchived: "true" })).toMatchObject([{ datasetId: source.datasetId, archived: true }]);
    expect(await sources({ projectId, vdtId: firstVdt })).toMatchObject([{ datasetId: source.datasetId, archived: true }]);
    expect((await original(source.datasetId, firstVdt)).status).toBe(200);
    const attach = await change(source.datasetId, { action: "attach", vdtId: secondVdt });
    expect(attach.status).toBe(409);
    expect(await attach.json()).toMatchObject({ error: { code: "DATA_FILE_ARCHIVED" } });
    expect((await change(source.datasetId, { action: "restore" })).status).toBe(200);
    expect((await change(source.datasetId, { action: "attach", vdtId: secondVdt })).status).toBe(200);
  });

  it("renames the library label without changing the original name, hash or payload", async () => {
    const source = await uploadSource();
    const before = new Uint8Array(await (await original(source.datasetId)).arrayBuffer());
    expect((await change(source.datasetId, { action: "rename", displayName: "Client actuals · October" })).status).toBe(200);
    expect(await sources()).toMatchObject([{ displayName: "Client actuals · October", file: { fileName: source.file.fileName, contentHash: source.file.contentHash } }]);
    expect(new Uint8Array(await (await original(source.datasetId)).arrayBuffer())).toEqual(before);
    for (const displayName of [" ", "a".repeat(256), "bad\nname"]) expect((await change(source.datasetId, { action: "rename", displayName })).status).toBe(400);
  });

  it("keeps concurrent independent labels and tree associations", async () => {
    const source = await uploadSource();
    const responses = await Promise.all([
      change(source.datasetId, { action: "rename", displayName: "Monthly extract" }),
      change(source.datasetId, { action: "attach", vdtId: firstVdt }),
      change(source.datasetId, { action: "attach", vdtId: secondVdt })
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
    expect(await sources()).toMatchObject([{ displayName: "Monthly extract", vdtIds: [firstVdt, secondVdt] }]);
  });

  it("rejects foreign projects, tree owners, missing files and malformed identities", async () => {
    const source = await uploadSource();
    expect((await change(source.datasetId, { action: "rename", displayName: "Foreign" }, "project_library_foreign")).status).toBe(404);
    expect((await change(source.datasetId, { action: "attach", vdtId: "vdt_library_foreign" })).status).toBe(404);
    expect((await change(source.datasetId, { action: "detach", vdtId: secondVdt })).status).toBe(404);
    expect((await change(source.datasetId, { action: "attach", vdtId: "../tree" })).status).toBe(400);
    expect((await change("dataset_missing", { action: "archive" })).status).toBe(404);
    expect((await change(source.datasetId, { action: "delete_payload" })).status).toBe(400);
    expect((await list(request("files?projectId=../client"))).status).toBe(400);
    expect((await list(request("files?projectId=project_missing"))).status).toBe(404);
  });

  it("fails closed for hosted mode, foreign browser origins and unsafe library sidecars", async () => {
    const source = await uploadSource();
    vi.stubEnv("VDT_APP_MODE", "hosted_web");
    expect((await change(source.datasetId, { action: "archive" })).status).toBe(403);
    expect((await list(request(`files?projectId=${projectId}`))).status).toBe(403);
    vi.stubEnv("VDT_APP_MODE", "development_web");
    const crossSite = new Request(`http://localhost:3000/api/data/files/${source.datasetId}?projectId=${projectId}`, { method: "PATCH", headers: { origin: "https://foreign.example", "content-type": "application/json" }, body: JSON.stringify({ action: "archive" }) });
    expect((await modify(crossSite, { params: Promise.resolve({ datasetId: source.datasetId }) })).status).toBe(403);
    const directory = path.join(projectDir(dataDir, projectId), "files", source.datasetId);
    await symlink(path.join(directory, "metadata.json"), path.join(directory, "archive.json"));
    expect((await list(request(`files?projectId=${projectId}`))).status).not.toBe(200);
  });
});
