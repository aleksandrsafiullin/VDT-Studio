import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openVdtDatabase } from "@vdt-studio/storage";
import { productionVolumeProject, type VdtProject } from "@vdt-studio/vdt-core";
import { GET, POST } from "./route";

const tempDirs: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("VDT comparisons API", () => {
  it("loads two stored revisions, creates a deterministic comparison, and persists the record", async () => {
    const root = tempRoot();
    const dataDir = path.join(root, "data");
    vi.stubEnv("VDT_DATA_DIR", dataDir);
    const database = openVdtDatabase(root, { dataDir, now: fixedClock("2026-06-29T12:30:00.000Z") });
    database.createProject({ id: "project_compare_api", name: "Compare API project" });
    database.createVdt({
      id: "vdt_left_api",
      projectId: "project_compare_api",
      name: "Left VDT",
      rootKpi: "Production Volume"
    });
    database.createVdt({
      id: "vdt_right_api",
      projectId: "project_compare_api",
      name: "Right VDT",
      rootKpi: "Production Volume"
    });
    const leftRevision = database.saveVdtRevision({
      id: "revision_left_api",
      projectId: "project_compare_api",
      vdtId: "vdt_left_api",
      revisionNo: 1,
      source: "agent",
      project: productionVolumeProject
    });
    const rightRevision = database.saveVdtRevision({
      id: "revision_right_api",
      projectId: "project_compare_api",
      vdtId: "vdt_right_api",
      revisionNo: 1,
      source: "agent",
      project: lowerUnplannedDowntime(productionVolumeProject)
    });
    database.close();

    const response = await POST(jsonRequest("http://localhost:3000/api/vdt/comparisons", {
      projectId: "project_compare_api",
      leftRevisionId: leftRevision.id,
      rightRevisionId: rightRevision.id,
      comparisonId: "comparison_api_1"
    }));
    const body = await response.json() as {
      ok: boolean;
      comparison?: {
        id: string;
        result: {
          rootDelta?: { absoluteDelta?: number };
          structuralDiff: { changedValues: string[] };
          bottleneckCandidates: Array<{ nodeId: string; evidence: string }>;
        };
      };
      error?: { message?: string };
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.comparison).toMatchObject({
      id: "comparison_api_1",
      result: {
        rootDelta: expect.objectContaining({ absoluteDelta: expect.any(Number) }),
        structuralDiff: {
          changedValues: expect.arrayContaining(["unplanned_downtime"])
        },
        bottleneckCandidates: expect.arrayContaining([
          expect.objectContaining({ nodeId: "unplanned_downtime" })
        ])
      }
    });

    const listResponse = await GET(new Request("http://localhost:3000/api/vdt/comparisons?projectId=project_compare_api"));
    const listBody = await listResponse.json() as {
      ok: boolean;
      comparisons?: Array<{ id: string; projectId: string }>;
    };
    expect(listResponse.status).toBe(200);
    expect(listBody).toMatchObject({
      ok: true,
      comparisons: [
        {
          id: "comparison_api_1",
          projectId: "project_compare_api"
        }
      ]
    });

    const getResponse = await GET(new Request("http://localhost:3000/api/vdt/comparisons?comparisonId=comparison_api_1"));
    const getBody = await getResponse.json() as {
      ok: boolean;
      comparison?: { id: string };
    };
    expect(getResponse.status).toBe(200);
    expect(getBody).toMatchObject({
      ok: true,
      comparison: { id: "comparison_api_1" }
    });

    const reopened = openVdtDatabase(root, { dataDir });
    expect(reopened.getComparison("comparison_api_1")?.result).toMatchObject(body.comparison!.result);
    reopened.close();
  });

  it("rejects comparisons across projects", async () => {
    const root = tempRoot();
    const dataDir = path.join(root, "data");
    vi.stubEnv("VDT_DATA_DIR", dataDir);
    const database = openVdtDatabase(root, { dataDir });
    database.createProject({ id: "project_left", name: "Left project" });
    database.createProject({ id: "project_right", name: "Right project" });
    database.createVdt({ id: "vdt_left", projectId: "project_left", name: "Left", rootKpi: "Production Volume" });
    database.createVdt({ id: "vdt_right", projectId: "project_right", name: "Right", rootKpi: "Production Volume" });
    database.saveVdtRevision({
      id: "revision_cross_left",
      projectId: "project_left",
      vdtId: "vdt_left",
      revisionNo: 1,
      source: "agent",
      project: productionVolumeProject
    });
    database.saveVdtRevision({
      id: "revision_cross_right",
      projectId: "project_right",
      vdtId: "vdt_right",
      revisionNo: 1,
      source: "agent",
      project: productionVolumeProject
    });
    database.close();

    const response = await POST(jsonRequest("http://localhost:3000/api/vdt/comparisons", {
      projectId: "project_left",
      leftRevisionId: "revision_cross_left",
      rightRevisionId: "revision_cross_right"
    }));
    const body = await response.json() as { ok: boolean; error?: { code?: string } };

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      ok: false,
      error: { code: "PROJECT_MISMATCH" }
    });
  });

  it("returns clear errors for missing comparison lookup inputs", async () => {
    const root = tempRoot();
    const dataDir = path.join(root, "data");
    vi.stubEnv("VDT_DATA_DIR", dataDir);
    const database = openVdtDatabase(root, { dataDir });
    database.createProject({ id: "project_lookup", name: "Lookup project" });
    database.close();

    const missingProjectId = await GET(new Request("http://localhost:3000/api/vdt/comparisons"));
    expect(missingProjectId.status).toBe(400);
    expect(await missingProjectId.json()).toMatchObject({
      ok: false,
      error: { message: "projectId is required." }
    });

    const missingComparison = await GET(new Request("http://localhost:3000/api/vdt/comparisons?comparisonId=comparison_missing"));
    expect(missingComparison.status).toBe(404);
    expect(await missingComparison.json()).toMatchObject({
      ok: false,
      error: { code: "COMPARISON_NOT_FOUND" }
    });
  });
});

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

function tempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vdt-comparison-api-"));
  tempDirs.push(dir);
  return dir;
}

function fixedClock(value: string): () => string {
  return () => value;
}

function lowerUnplannedDowntime(project: VdtProject): VdtProject {
  return {
    ...project,
    id: `${project.id}_lower_downtime`,
    graph: {
      ...project.graph,
      nodes: project.graph.nodes.map((node) =>
        node.id === "unplanned_downtime" ? { ...node, baselineValue: 60 } : node
      )
    }
  };
}
