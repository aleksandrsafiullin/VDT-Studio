import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { compareVdtProjects, productionVolumeProject, type VdtChangeSet } from "@vdt-studio/vdt-core";
import { openVdtDatabase } from "@vdt-studio/storage";
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
      projects?: Array<{
        project: { id: string; name: string };
        counts: {
          vdts: number;
          revisions: number;
          conversations: number;
          agentRuns: number;
          mutationProposals: number;
          comparisons: number;
        };
        vdts: Array<{ vdt: { id: string }; revisionCount: number }>;
      }>;
    };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      projects: [
        {
          project: {
            id: "project_storage_api",
            name: "Storage-backed project"
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
      ok: true,
      vdt: { id: "vdt_storage_api" },
      revisions: [
        { id: "revision_storage_1" },
        { id: "revision_storage_2" }
      ]
    });

    const explorerResponse = await getProjectExplorer(new Request("http://localhost:3000/api/vdt/projects/project_storage_api/explorer"), {
      params: Promise.resolve({ projectId: "project_storage_api" })
    });
    expect(explorerResponse.status).toBe(200);
    expect(await explorerResponse.json()).toMatchObject({
      ok: true,
      summary: {
        project: { id: "project_storage_api" },
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
    const database = openVdtDatabase(root, { dataDir });
    database.close();

    const createProjectResponse = await createProject(jsonRequest("http://localhost:3000/api/vdt/projects", {
      id: "project_manual",
      name: "Manual project",
      industry: "Mining"
    }));
    expect(createProjectResponse.status).toBe(201);
    expect(await createProjectResponse.json()).toMatchObject({
      ok: true,
      project: { id: "project_manual", name: "Manual project" }
    });

    const updateProjectResponse = await updateProject(jsonRequest("http://localhost:3000/api/vdt/projects/project_manual", {
      name: "Manual project updated",
      description: "Workspace for alternatives"
    }), {
      params: Promise.resolve({ projectId: "project_manual" })
    });
    expect(updateProjectResponse.status).toBe(200);
    expect(await updateProjectResponse.json()).toMatchObject({
      ok: true,
      project: {
        id: "project_manual",
        name: "Manual project updated",
        description: "Workspace for alternatives"
      }
    });

    const createVdtResponse = await createProjectVdt(jsonRequest("http://localhost:3000/api/vdt/projects/project_manual/vdts", {
      id: "vdt_manual",
      name: "Manual VDT",
      rootKpi: "Production Volume",
      project: productionVolumeProject
    }), {
      params: Promise.resolve({ projectId: "project_manual" })
    });
    expect(createVdtResponse.status).toBe(201);
    expect(await createVdtResponse.json()).toMatchObject({
      ok: true,
      vdt: {
        id: "vdt_manual",
        activeRevisionId: expect.any(String)
      },
      revision: {
        revisionNo: 1
      }
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
          revisions: [{ revisionNo: 1 }]
        }
      ]
    });

    const getVdtResponse = await getVdt(new Request("http://localhost:3000/api/vdt/vdts/vdt_manual"), {
      params: Promise.resolve({ vdtId: "vdt_manual" })
    });
    expect(getVdtResponse.status).toBe(200);
    expect(await getVdtResponse.json()).toMatchObject({
      ok: true,
      activeProject: {
        id: productionVolumeProject.id,
        rootNodeId: productionVolumeProject.rootNodeId
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

    const revisionResponse = await saveVdtRevision(jsonRequest("http://localhost:3000/api/vdt/vdts/vdt_manual/revisions", {
      source: "user",
      summary: "Manual save",
      project: productionVolumeProject
    }), {
      params: Promise.resolve({ vdtId: "vdt_manual" })
    });
    expect(revisionResponse.status).toBe(201);
    expect(await revisionResponse.json()).toMatchObject({
      ok: true,
      revision: {
        revisionNo: 2,
        summary: "Manual save"
      }
    });

    const deleteVdtResponse = await deleteVdt(new Request("http://localhost:3000/api/vdt/vdts/vdt_manual", { method: "DELETE" }), {
      params: Promise.resolve({ vdtId: "vdt_manual" })
    });
    expect(deleteVdtResponse.status).toBe(200);
    expect(await deleteVdtResponse.json()).toMatchObject({
      ok: true,
      deletedVdtId: "vdt_manual"
    });

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
      ok: false,
      error: { code: "VDT_NOT_FOUND" }
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

function fixedClock(value: string): () => string {
  return () => value;
}
