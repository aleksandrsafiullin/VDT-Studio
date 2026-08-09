import { afterEach, describe, expect, it, vi } from "vitest";
import { productionVolumeProject } from "@vdt-studio/vdt-core";
import {
  createStoredProject,
  createStoredVdt,
  fetchStoredProjectExplorerSummary,
  revisionCasFromHead,
  runtimeCasFromState,
  saveStoredVdtRevision,
  updateStoredProject,
  VdtStorageRequestError,
  type ProjectRuntimeStateV1,
  type StoredProjectSummary,
  type StoredVdtRecord,
  type VdtRevisionHeadV2
} from "./vdt-storage-client";

const runtimeState: ProjectRuntimeStateV1 = {
  schemaVersion: "project_runtime_state.v1",
  projectId: "project_client",
  runtimeGeneration: "v1",
  generationVersion: 1,
  migrationState: "shadow_ready",
  writeState: "enabled",
  updatedAt: "2026-07-23T00:00:00.000Z"
};

const vdt: StoredVdtRecord = {
  id: "vdt_client",
  projectId: "project_client",
  name: "Client VDT",
  rootKpi: "Production Volume",
  status: "draft",
  activeRevisionId: "revision_client_1",
  createdAt: "2026-07-23T00:00:00.000Z",
  updatedAt: "2026-07-23T00:00:00.000Z"
};

const head: VdtRevisionHeadV2 = {
  schemaVersion: "vdt_revision_head.v2",
  projectId: "project_client",
  vdtId: "vdt_client",
  activeRevisionId: "revision_client_1",
  activeContentIdentity: {
    scheme: "legacy_graph_sha256",
    hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  pendingRevisionId: null,
  commitGeneration: 1
};

const summary: StoredProjectSummary = {
  project: {
    id: "project_client",
    name: "Client project",
    createdAt: "2026-07-23T00:00:00.000Z",
    updatedAt: "2026-07-23T00:00:00.000Z"
  },
  runtimeState,
  counts: {
    vdts: 1,
    revisions: 1,
    conversations: 0,
    agentRuns: 0,
    mutationProposals: 0,
    comparisons: 0
  },
  vdts: [{ vdt, head, revisionCount: 1 }]
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("VDT storage client atomic envelopes", () => {
  it("sends exact manual CAS and never sends actor or source", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({
      schemaVersion: "manual_vdt_revision_commit_response.v1",
      ok: true,
      vdt,
      revision: {
        id: "revision_client_2",
        vdtId: vdt.id,
        revisionNo: 2,
        source: "user",
        createdAt: "2026-07-23T00:01:00.000Z"
      },
      head: { ...head, activeRevisionId: "revision_client_2", commitGeneration: 2 },
      runtimeState,
      summary
    }, { status: 201 }));
    vi.stubGlobal("fetch", fetcher);

    await saveStoredVdtRevision(vdt.id, {
      idempotencyKey: "manual-save:vdt_client:operation_1",
      expectedHead: revisionCasFromHead(head),
      expectedRuntime: runtimeCasFromState(runtimeState),
      summary: "Manual workspace save",
      project: productionVolumeProject
    });

    const request = fetcher.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      schemaVersion: "manual_vdt_revision_commit_request.v1",
      idempotencyKey: "manual-save:vdt_client:operation_1",
      expectedHead: {
        schemaVersion: "vdt_revision_cas.v1",
        activeRevisionId: "revision_client_1",
        commitGeneration: 1
      },
      expectedRuntime: {
        schemaVersion: "project_runtime_cas.v1",
        runtimeGeneration: "v1",
        generationVersion: 1
      },
      summary: "Manual workspace save"
    });
    expect(body).not.toHaveProperty("actor");
    expect(body).not.toHaveProperty("source");
    expect(body).not.toHaveProperty("validation");
    expect(body).not.toHaveProperty("calculation");
  });

  it("sends the strict combined-create envelope with server-owned intent omitted", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({
      schemaVersion: "create_vdt_with_initial_http_response.v1",
      ok: true,
      vdt,
      revision: {
        id: "revision_client_1",
        vdtId: vdt.id,
        revisionNo: 1,
        source: "user",
        createdAt: "2026-07-23T00:00:00.000Z"
      },
      head,
      runtimeState,
      summary
    }, { status: 201 }));
    vi.stubGlobal("fetch", fetcher);

    await createStoredVdt("project_client", {
      idempotencyKey: "create-vdt:project_client:operation_1",
      expectedRuntime: runtimeCasFromState(runtimeState),
      name: vdt.name,
      rootKpi: vdt.rootKpi,
      project: productionVolumeProject
    });

    const request = fetcher.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      schemaVersion: "create_vdt_with_initial_http_request.v1",
      idempotencyKey: "create-vdt:project_client:operation_1",
      vdt: {
        requestedVdtId: null,
        name: "Client VDT",
        rootKpi: "Production Volume",
        unit: null,
        timePeriod: null,
        status: "draft",
        metadata: null
      }
    });
    expect(body).not.toHaveProperty("actor");
    expect(body).not.toHaveProperty("source");
  });

  it("preserves status, code, and retryability from a typed error envelope", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      schemaVersion: "vdt_storage_error_response.v1",
      ok: false,
      error: {
        code: "REVISION_IN_PROGRESS",
        message: "The matching revision is still in progress.",
        retryable: true
      }
    }, { status: 409, headers: { "retry-after": "1" } })));

    const promise = saveStoredVdtRevision(vdt.id, {
      idempotencyKey: "manual-save:vdt_client:operation_1",
      expectedHead: revisionCasFromHead(head),
      expectedRuntime: runtimeCasFromState(runtimeState),
      summary: "Manual workspace save",
      project: productionVolumeProject
    });

    await expect(promise).rejects.toEqual(expect.objectContaining({
      name: "VdtStorageRequestError",
      status: 409,
      code: "REVISION_IN_PROGRESS",
      retryable: true
    } satisfies Partial<VdtStorageRequestError>));
  });

  it("preserves typed explorer errors instead of downgrading them", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      schemaVersion: "vdt_storage_error_response.v1",
      ok: false,
      error: {
        code: "PROJECT_RUNTIME_STATE_MISSING",
        message: "Project runtime state is unavailable.",
        retryable: false
      }
    }, { status: 503 })));

    await expect(fetchStoredProjectExplorerSummary()).rejects.toEqual(expect.objectContaining({
      name: "VdtStorageRequestError",
      status: 503,
      code: "PROJECT_RUNTIME_STATE_MISSING",
      retryable: false
    } satisfies Partial<VdtStorageRequestError>));
  });

  it.each([
    ["explorer", () => fetchStoredProjectExplorerSummary(), { projects: [summary] }],
    ["create project", () => createStoredProject({ name: "Client project" }), { summary }],
    ["update project", () => updateStoredProject("project_client", { name: "Renamed" }), { summary }]
  ])("rejects an unversioned %s success envelope", async (_label, request, body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      ok: true,
      ...body
    })));

    await expect(request()).rejects.toThrow(/was not returned/i);
  });
});
