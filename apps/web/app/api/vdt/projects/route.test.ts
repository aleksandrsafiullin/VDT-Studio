import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { compareVdtProjects, productionVolumeProject, type VdtChangeSet } from "@vdt-studio/vdt-core";
import {
  openVdtDatabase,
  type ProjectRuntimeStateV1,
  type VdtRevisionHeadV2
} from "@vdt-studio/storage";
import { DELETE as deleteProject, GET as getProject, PATCH as updateProject } from "./[projectId]/route";
import { GET as getProjectComparisons } from "./[projectId]/comparisons/route";
import { GET as getProjectExplorer } from "./[projectId]/explorer/route";
import { GET as listProjects, POST as createProject } from "./route";
import { GET as listProjectVdts, POST as createProjectVdt } from "./[projectId]/vdts/route";
import { DELETE as deleteVdt, GET as getVdt, PATCH as updateVdt } from "../vdts/[vdtId]/route";
import { GET as listVdtRevisions, POST as saveVdtRevision } from "../vdts/[vdtId]/revisions/route";

const tempDirs: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("VDT project storage APIs", () => {
  it("lists stored projects with VDT, revision, conversation, run, proposal, and comparison counts", async () => {
    const { dataDir } = seedStoredProject();
    vi.stubEnv("VDT_DATA_DIR", dataDir);

    const response = await listProjects();
    const body = await response.json() as {
      ok: boolean;
      schemaVersion?: string;
      projects?: Array<{
        project: { id: string; name: string };
        runtimeState: ProjectRuntimeStateV1;
        counts: {
          vdts: number;
          revisions: number;
          conversations: number;
          agentRuns: number;
          mutationProposals: number;
          comparisons: number;
        };
        vdts: Array<{ vdt: { id: string }; head: VdtRevisionHeadV2; revisionCount: number }>;
      }>;
    };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      schemaVersion: "project_explorer_response.v1",
      ok: true,
      projects: [
        {
          project: {
            id: "project_storage_api",
            name: "Storage-backed project"
          },
          runtimeState: {
            schemaVersion: "project_runtime_state.v1",
            projectId: "project_storage_api"
          },
          counts: {
            vdts: 1,
            revisions: 2,
            conversations: 1,
            agentRuns: 1,
            mutationProposals: 1,
            comparisons: 1
          },
          vdts: [
            {
              vdt: { id: "vdt_storage_api" },
              head: {
                schemaVersion: "vdt_revision_head.v2",
                vdtId: "vdt_storage_api",
                activeRevisionId: "revision_storage_2"
              },
              revisionCount: 2
            }
          ]
        }
      ]
    });
  });

  it("loads a stored project detail tree and VDT revision list", async () => {
    const { dataDir } = seedStoredProject();
    vi.stubEnv("VDT_DATA_DIR", dataDir);

    const projectResponse = await getProject(new Request("http://localhost:3000/api/vdt/projects/project_storage_api"), {
      params: Promise.resolve({ projectId: "project_storage_api" })
    });
    const projectBody = await projectResponse.json() as {
      ok: boolean;
      vdts?: Array<{ vdt: { id: string }; revisions: Array<{ id: string }> }>;
      conversations?: Array<{ id: string }>;
      agentRuns?: Array<{ id: string }>;
      mutationProposals?: Array<{ id: string }>;
      comparisons?: Array<{ id: string }>;
    };

    expect(projectResponse.status).toBe(200);
    expect(projectBody).toMatchObject({
      ok: true,
      vdts: [
        {
          vdt: { id: "vdt_storage_api" },
          revisions: [
            { id: "revision_storage_1" },
            { id: "revision_storage_2" }
          ]
        }
      ],
      conversations: [{ id: "conversation_storage_api" }],
      agentRuns: [{ id: "run_storage_api" }],
      mutationProposals: [{ id: "proposal_storage_api" }],
      comparisons: [{ id: "comparison_storage_api" }]
    });

    const revisionsResponse = await listVdtRevisions(new Request("http://localhost:3000/api/vdt/vdts/vdt_storage_api/revisions"), {
      params: Promise.resolve({ vdtId: "vdt_storage_api" })
    });
    expect(revisionsResponse.status).toBe(200);
    expect(await revisionsResponse.json()).toMatchObject({
      schemaVersion: "vdt_revisions_response.v1",
      ok: true,
      vdt: { id: "vdt_storage_api" },
      revisions: [
        { id: "revision_storage_1" },
        { id: "revision_storage_2" }
      ],
      head: {
        schemaVersion: "vdt_revision_head.v2",
        activeRevisionId: "revision_storage_2"
      },
      runtimeState: {
        schemaVersion: "project_runtime_state.v1",
        projectId: "project_storage_api"
      }
    });

    const explorerResponse = await getProjectExplorer(new Request("http://localhost:3000/api/vdt/projects/project_storage_api/explorer"), {
      params: Promise.resolve({ projectId: "project_storage_api" })
    });
    expect(explorerResponse.status).toBe(200);
    expect(await explorerResponse.json()).toMatchObject({
      ok: true,
      summary: {
        project: { id: "project_storage_api" },
        runtimeState: {
          schemaVersion: "project_runtime_state.v1",
          projectId: "project_storage_api"
        },
        vdts: [{
          vdt: { id: "vdt_storage_api" },
          head: { activeRevisionId: "revision_storage_2" }
        }],
        counts: {
          vdts: 1,
          revisions: 2,
          conversations: 1,
          agentRuns: 1,
          mutationProposals: 1,
          comparisons: 1
        }
      },
      comparisons: [{ id: "comparison_storage_api" }],
      recentRuns: [{ id: "run_storage_api" }],
      pendingProposals: []
    });

    const comparisonsResponse = await getProjectComparisons(new Request("http://localhost:3000/api/vdt/projects/project_storage_api/comparisons"), {
      params: Promise.resolve({ projectId: "project_storage_api" })
    });
    expect(comparisonsResponse.status).toBe(200);
    expect(await comparisonsResponse.json()).toMatchObject({
      ok: true,
      comparisons: [{ id: "comparison_storage_api" }]
    });
  });

  it("creates, updates, loads, revisions, and deletes manual projects and VDTs", async () => {
    const root = tempRoot();
    const dataDir = path.join(root, "data");
    vi.stubEnv("VDT_DATA_DIR", dataDir);
    vi.stubEnv("VDT_APP_MODE", "development_web");
    const database = openVdtDatabase(root, { dataDir });
    database.close();

    const createProjectResponse = await createProject(jsonRequest("http://localhost:3000/api/vdt/projects", {
      id: "project_manual",
      name: "Manual project",
      industry: "Mining"
    }));
    expect(createProjectResponse.status).toBe(201);
    const createdProjectPayload = await createProjectResponse.json() as {
      schemaVersion: string;
      summary: {
        project: { id: string; name: string };
        runtimeState: ProjectRuntimeStateV1;
      };
    };
    expect(createdProjectPayload).toMatchObject({
      schemaVersion: "project_summary_response.v1",
      ok: true,
      summary: {
        project: { id: "project_manual", name: "Manual project" },
        runtimeState: {
          schemaVersion: "project_runtime_state.v1",
          projectId: "project_manual"
        }
      }
    });

    const updateProjectResponse = await updateProject(jsonRequest("http://localhost:3000/api/vdt/projects/project_manual", {
      name: "Manual project updated",
      description: "Workspace for alternatives"
    }), {
      params: Promise.resolve({ projectId: "project_manual" })
    });
    expect(updateProjectResponse.status).toBe(200);
    const updatedProjectPayload = await updateProjectResponse.json() as {
      schemaVersion: string;
      summary: {
        project: { id: string; name: string; description?: string };
        runtimeState: ProjectRuntimeStateV1;
      };
    };
    expect(updatedProjectPayload).toMatchObject({
      schemaVersion: "project_summary_response.v1",
      ok: true,
      summary: {
        project: {
          id: "project_manual",
          name: "Manual project updated",
          description: "Workspace for alternatives"
        }
      }
    });

    const createVdtRequest = {
      schemaVersion: "create_vdt_with_initial_http_request.v1",
      idempotencyKey: "create-vdt:project_manual:operation_1",
      expectedRuntime: runtimeCas(updatedProjectPayload.summary.runtimeState),
      vdt: {
        requestedVdtId: "vdt_manual",
        name: "Manual VDT",
        rootKpi: "Production Volume",
        unit: null,
        timePeriod: null,
        status: "draft",
        metadata: null
      },
      project: productionVolumeProject
    };
    const rejectedCreate = await createProjectVdt(jsonRequest(
      "http://localhost:3000/api/vdt/projects/project_manual/vdts",
      { ...createVdtRequest, source: "agent" }
    ), {
      params: Promise.resolve({ projectId: "project_manual" })
    });
    expect(rejectedCreate.status).toBe(400);
    expect(await rejectedCreate.json()).toMatchObject({
      schemaVersion: "vdt_storage_error_response.v1",
      error: { code: "INVALID_STORAGE_REQUEST", retryable: false }
    });

    const createVdtResponse = await createProjectVdt(jsonRequest(
      "http://localhost:3000/api/vdt/projects/project_manual/vdts",
      createVdtRequest
    ), {
      params: Promise.resolve({ projectId: "project_manual" })
    });
    expect(createVdtResponse.status).toBe(201);
    const createVdtPayload = await createVdtResponse.json() as {
      schemaVersion: string;
      vdt: { id: string; activeRevisionId?: string };
      revision: { id: string; revisionNo: number };
      head: VdtRevisionHeadV2;
      runtimeState: ProjectRuntimeStateV1;
    };
    expect(createVdtPayload).toMatchObject({
      schemaVersion: "create_vdt_with_initial_http_response.v1",
      ok: true,
      vdt: {
        id: "vdt_manual",
        activeRevisionId: expect.any(String)
      },
      revision: {
        revisionNo: 1
      },
      head: {
        schemaVersion: "vdt_revision_head.v2",
        activeRevisionId: expect.any(String),
        commitGeneration: 1
      },
      runtimeState: {
        schemaVersion: "project_runtime_state.v1",
        projectId: "project_manual"
      }
    });

    const createReplayResponse = await createProjectVdt(jsonRequest(
      "http://localhost:3000/api/vdt/projects/project_manual/vdts",
      createVdtRequest
    ), {
      params: Promise.resolve({ projectId: "project_manual" })
    });
    expect(createReplayResponse.status).toBe(201);
    expect(await createReplayResponse.json()).toMatchObject({
      vdt: { id: createVdtPayload.vdt.id },
      revision: { id: createVdtPayload.revision.id },
      head: createVdtPayload.head
    });

    const listVdtsResponse = await listProjectVdts(new Request("http://localhost:3000/api/vdt/projects/project_manual/vdts"), {
      params: Promise.resolve({ projectId: "project_manual" })
    });
    expect(listVdtsResponse.status).toBe(200);
    expect(await listVdtsResponse.json()).toMatchObject({
      ok: true,
      vdts: [
        {
          vdt: { id: "vdt_manual" },
          head: {
            activeRevisionId: createVdtPayload.revision.id,
            commitGeneration: 1
          },
          revisions: [{ revisionNo: 1 }]
        }
      ]
    });

    const getVdtResponse = await getVdt(new Request("http://localhost:3000/api/vdt/vdts/vdt_manual"), {
      params: Promise.resolve({ vdtId: "vdt_manual" })
    });
    expect(getVdtResponse.status).toBe(200);
    expect(await getVdtResponse.json()).toMatchObject({
      schemaVersion: "vdt_load_response.v1",
      ok: true,
      activeProject: {
        id: productionVolumeProject.id,
        rootNodeId: productionVolumeProject.rootNodeId
      },
      head: createVdtPayload.head,
      runtimeState: {
        projectId: "project_manual"
      }
    });

    const updateVdtResponse = await updateVdt(jsonRequest("http://localhost:3000/api/vdt/vdts/vdt_manual", {
      name: "Manual VDT reviewed",
      status: "reviewed"
    }), {
      params: Promise.resolve({ vdtId: "vdt_manual" })
    });
    expect(updateVdtResponse.status).toBe(200);
    expect(await updateVdtResponse.json()).toMatchObject({
      ok: true,
      vdt: {
        id: "vdt_manual",
        name: "Manual VDT reviewed",
        status: "reviewed"
      }
    });

    const revisionRequest = {
      schemaVersion: "manual_vdt_revision_commit_request.v1",
      idempotencyKey: "manual-save:vdt_manual:operation_1",
      expectedHead: revisionCas(createVdtPayload.head),
      expectedRuntime: runtimeCas(createVdtPayload.runtimeState),
      summary: "Manual save",
      project: productionVolumeProject
    };
    const rejectedRevision = await saveVdtRevision(jsonRequest(
      "http://localhost:3000/api/vdt/vdts/vdt_manual/revisions",
      { ...revisionRequest, source: "agent" }
    ), {
      params: Promise.resolve({ vdtId: "vdt_manual" })
    });
    expect(rejectedRevision.status).toBe(400);
    expect(await rejectedRevision.json()).toMatchObject({
      schemaVersion: "vdt_storage_error_response.v1",
      error: { code: "INVALID_STORAGE_REQUEST", retryable: false }
    });

    const revisionResponse = await saveVdtRevision(jsonRequest(
      "http://localhost:3000/api/vdt/vdts/vdt_manual/revisions",
      revisionRequest
    ), {
      params: Promise.resolve({ vdtId: "vdt_manual" })
    });
    expect(revisionResponse.status).toBe(201);
    const revisionPayload = await revisionResponse.json() as {
      schemaVersion: string;
      revision: { id: string; revisionNo: number; summary?: string };
      head: VdtRevisionHeadV2;
    };
    expect(revisionPayload).toMatchObject({
      schemaVersion: "manual_vdt_revision_commit_response.v1",
      ok: true,
      revision: {
        revisionNo: 2,
        summary: "Manual save"
      },
      head: {
        activeRevisionId: expect.any(String),
        commitGeneration: 2
      },
      runtimeState: {
        projectId: "project_manual"
      }
    });

    const revisionReplay = await saveVdtRevision(jsonRequest(
      "http://localhost:3000/api/vdt/vdts/vdt_manual/revisions",
      revisionRequest
    ), {
      params: Promise.resolve({ vdtId: "vdt_manual" })
    });
    expect(revisionReplay.status).toBe(201);
    expect(await revisionReplay.json()).toMatchObject({
      revision: { id: revisionPayload.revision.id, revisionNo: 2 },
      head: revisionPayload.head
    });

    const staleCasResponse = await saveVdtRevision(jsonRequest(
      "http://localhost:3000/api/vdt/vdts/vdt_manual/revisions",
      {
        ...revisionRequest,
        idempotencyKey: "manual-save:vdt_manual:stale",
        summary: "Stale overwrite"
      }
    ), {
      params: Promise.resolve({ vdtId: "vdt_manual" })
    });
    expect(staleCasResponse.status).toBe(409);
    expect(await staleCasResponse.json()).toMatchObject({
      schemaVersion: "vdt_storage_error_response.v1",
      ok: false,
      error: {
        code: "REVISION_CONFLICT",
        retryable: false
      }
    });

    const dbBeforeDelete = openVdtDatabase(root, { dataDir });
    dbBeforeDelete.createConversation({
      id: "conversation_manual",
      projectId: "project_manual",
      vdtId: "vdt_manual",
      title: "Manual VDT chat"
    });
    dbBeforeDelete.appendMessage({
      id: "message_manual",
      conversationId: "conversation_manual",
      role: "user",
      content: "Build the manual VDT"
    });
    dbBeforeDelete.createAgentRun({
      id: "run_manual",
      projectId: "project_manual",
      vdtId: "vdt_manual",
      conversationId: "conversation_manual",
      status: "succeeded",
      phase: "reporting",
      request: { mode: "generate_vdt" }
    });
    dbBeforeDelete.appendAgentEvent({
      runId: "run_manual",
      seq: 1,
      type: "classification",
      phase: "classifying_request",
      title: "Classified",
      message: "Classified request"
    });
    dbBeforeDelete.close();

    const deleteVdtResponse = await deleteVdt(new Request("http://localhost:3000/api/vdt/vdts/vdt_manual", { method: "DELETE" }), {
      params: Promise.resolve({ vdtId: "vdt_manual" })
    });
    expect(deleteVdtResponse.status).toBe(200);
    expect(await deleteVdtResponse.json()).toMatchObject({
      ok: true,
      deletedVdtId: "vdt_manual"
    });

    const dbAfterDelete = openVdtDatabase(root, { dataDir });
    expect(dbAfterDelete.getConversation("conversation_manual")).toBeNull();
    expect(dbAfterDelete.getAgentRun("run_manual")).toBeNull();
    expect(dbAfterDelete.listAgentEvents("run_manual")).toEqual([]);
    dbAfterDelete.close();

    const deleteProjectResponse = await deleteProject(new Request("http://localhost:3000/api/vdt/projects/project_manual", { method: "DELETE" }), {
      params: Promise.resolve({ projectId: "project_manual" })
    });
    expect(deleteProjectResponse.status).toBe(200);
    expect(await deleteProjectResponse.json()).toMatchObject({
      ok: true,
      deletedProjectId: "project_manual"
    });
  });

  it("returns clear not-found responses", async () => {
    const root = tempRoot();
    const dataDir = path.join(root, "data");
    vi.stubEnv("VDT_DATA_DIR", dataDir);
    const database = openVdtDatabase(root, { dataDir });
    database.close();

    const missingProject = await getProject(new Request("http://localhost:3000/api/vdt/projects/project_missing"), {
      params: Promise.resolve({ projectId: "project_missing" })
    });
    expect(missingProject.status).toBe(404);
    expect(await missingProject.json()).toMatchObject({
      ok: false,
      error: { code: "PROJECT_NOT_FOUND" }
    });

    const missingVdt = await listVdtRevisions(new Request("http://localhost:3000/api/vdt/vdts/vdt_missing/revisions"), {
      params: Promise.resolve({ vdtId: "vdt_missing" })
    });
    expect(missingVdt.status).toBe(404);
    expect(await missingVdt.json()).toMatchObject({
      schemaVersion: "vdt_storage_error_response.v1",
      ok: false,
      error: { code: "VDT_NOT_FOUND", retryable: false }
    });
  });

  it("fails closed for hosted and missing mode even with loopback URL and Host", async () => {
    const root = tempRoot();
    const dataDir = path.join(root, "data");
    const database = openVdtDatabase(root, { dataDir });
    const project = database.createProject({
      id: "project_mode_gate",
      name: "Mode gate project"
    });
    const runtimeState = database.getProjectRuntimeState(project.id)!;
    database.close();
    vi.stubEnv("VDT_DATA_DIR", dataDir);
    vi.stubEnv("VDT_APP_MODE", "hosted_web");
    vi.stubEnv("NEXT_PUBLIC_VDT_APP_MODE", "desktop");

    const request = new Request(
      "http://127.0.0.1:3000/api/vdt/projects/project_mode_gate/vdts",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          host: "localhost:3000"
        },
        body: JSON.stringify({
          schemaVersion: "create_vdt_with_initial_http_request.v1",
          idempotencyKey: "create-vdt:project_mode_gate:blocked",
          expectedRuntime: runtimeCas(runtimeState),
          vdt: {
            requestedVdtId: "vdt_blocked",
            name: "Blocked VDT",
            rootKpi: "Production Volume",
            unit: null,
            timePeriod: null,
            status: "draft",
            metadata: null
          },
          project: productionVolumeProject
        })
      }
    );
    const response = await createProjectVdt(request, {
      params: Promise.resolve({ projectId: project.id })
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      schemaVersion: "vdt_storage_error_response.v1",
      ok: false,
      error: {
        code: "HOSTED_REVISION_WRITES_DISABLED",
        message: expect.any(String),
        retryable: false
      }
    });

    const verify = openVdtDatabase(root, { dataDir });
    expect(verify.listVdts(project.id)).toEqual([]);
    verify.close();

    vi.stubEnv("VDT_APP_MODE", undefined);
    vi.stubEnv("NEXT_PUBLIC_VDT_APP_MODE", undefined);
    const missingMode = await saveVdtRevision(jsonRequest(
      "http://localhost:3000/api/vdt/vdts/does_not_matter/revisions",
      {}
    ), {
      params: Promise.resolve({ vdtId: "does_not_matter" })
    });
    expect(missingMode.status).toBe(403);
    expect(await missingMode.json()).toMatchObject({
      error: { code: "HOSTED_REVISION_WRITES_DISABLED" }
    });
  });
});

function seedStoredProject() {
  const root = tempRoot();
  const dataDir = path.join(root, "data");
  const database = openVdtDatabase(root, { dataDir, now: fixedClock("2026-06-29T13:00:00.000Z") });
  database.createProject({ id: "project_storage_api", name: "Storage-backed project", industry: "Mining" });
  database.createVdt({
    id: "vdt_storage_api",
    projectId: "project_storage_api",
    name: "Production VDT",
    rootKpi: "Production Volume"
  });
  const firstRevision = database.saveVdtRevision({
    id: "revision_storage_1",
    projectId: "project_storage_api",
    vdtId: "vdt_storage_api",
    revisionNo: 1,
    source: "agent",
    project: productionVolumeProject
  });
  const secondRevision = database.saveVdtRevision({
    id: "revision_storage_2",
    projectId: "project_storage_api",
    vdtId: "vdt_storage_api",
    revisionNo: 2,
    source: "agent",
    summary: "Lower unplanned downtime",
    project: productionVolumeProject
  });
  database.createConversation({
    id: "conversation_storage_api",
    projectId: "project_storage_api",
    vdtId: "vdt_storage_api",
    title: "Build production VDT"
  });
  database.appendMessage({
    id: "message_storage_api",
    conversationId: "conversation_storage_api",
    role: "user",
    content: "Build the model"
  });
  database.createAgentRun({
    id: "run_storage_api",
    projectId: "project_storage_api",
    vdtId: "vdt_storage_api",
    conversationId: "conversation_storage_api",
    status: "succeeded",
    phase: "reporting",
    request: { mode: "generate_vdt" }
  });
  database.createMutationProposal({
    id: "proposal_storage_api",
    runId: "run_storage_api",
    projectId: "project_storage_api",
    vdtId: "vdt_storage_api",
    baseRevisionId: firstRevision.id,
    status: "applied",
    title: "Apply visible layer",
    changeSet: emptyChangeSet(),
    validation: { valid: true }
  });
  database.createComparison({
    id: "comparison_storage_api",
    projectId: "project_storage_api",
    leftVdtId: "vdt_storage_api",
    rightVdtId: "vdt_storage_api",
    leftRevisionId: firstRevision.id,
    rightRevisionId: secondRevision.id,
    result: compareVdtProjects(productionVolumeProject, productionVolumeProject)
  });
  database.close();
  return { root, dataDir };
}

function emptyChangeSet(): VdtChangeSet {
  return {
    id: "changeset_storage_api",
    taskType: "deepen_node",
    backendId: "test",
    createdAt: "2026-06-29T13:00:00.000Z",
    additions: [],
    updates: [],
    deletions: [],
    edgeChanges: [],
    assumptions: [],
    questions: [],
    warnings: []
  };
}

function tempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vdt-project-api-"));
  tempDirs.push(dir);
  return dir;
}

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

function runtimeCas(state: ProjectRuntimeStateV1) {
  return {
    schemaVersion: "project_runtime_cas.v1",
    runtimeGeneration: state.runtimeGeneration,
    generationVersion: state.generationVersion
  } as const;
}

function revisionCas(head: VdtRevisionHeadV2) {
  return {
    schemaVersion: "vdt_revision_cas.v1",
    activeRevisionId: head.activeRevisionId,
    activeContentIdentity: head.activeContentIdentity,
    commitGeneration: head.commitGeneration
  } as const;
}

function fixedClock(value: string): () => string {
  return () => value;
}
