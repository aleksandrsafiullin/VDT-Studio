import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compareVdtProjects, productionVolumeProject, VdtBuilderSession, type VdtChangeSet, type VdtProject } from "@vdt-studio/vdt-core";
import {
  openVdtDatabase,
  readProjectManifestFromDatabaseLocation,
  scanProjectLocation
} from "./index";
import type { VdtDatabase } from "./types";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("openVdtDatabase", () => {
  it("creates schema v1 and persists projects, VDTs, and revision files across reopen", () => {
    const root = tempRoot();
    const dataDir = path.join(root, "data");
    const first = openVdtDatabase(root, { dataDir, now: fixedClock("2026-06-29T05:00:00.000Z") });
    const project = first.createProject({
      id: "project_mining",
      name: "Mining productivity improvement",
      industry: "Mining",
      metadata: { source: "test" }
    });
    const vdt = first.createVdt({
      id: "vdt_production_volume",
      projectId: project.id,
      name: "Production volume VDT",
      rootKpi: "Production Volume",
      unit: "t"
    });
    const draft = buildWorkingTimeProject();
    const revision = first.saveVdtRevision({
      id: "revision_000001",
      projectId: project.id,
      vdtId: vdt.id,
      revisionNo: 1,
      source: "agent",
      summary: "Initial visible layer",
      project: draft,
      validation: { valid: true },
      calculation: { valueCount: 0 }
    });
    const conversation = first.createConversation({
      id: "conversation_mining",
      projectId: project.id,
      title: "Initial build thread"
    });
    expect(first.updateConversation(conversation.id, {
      vdtId: vdt.id,
      title: "Production volume build thread"
    })).toMatchObject({
      id: "conversation_mining",
      vdtId: "vdt_production_volume",
      title: "Production volume build thread"
    });
    first.close();

    const reopened = openVdtDatabase(root, { dataDir });
    expect(reopened.getProject(project.id)).toMatchObject({
      id: "project_mining",
      name: "Mining productivity improvement",
      industry: "Mining",
      metadata: { source: "test" }
    });
    expect(reopened.getVdt(vdt.id)).toMatchObject({
      id: "vdt_production_volume",
      activeRevisionId: "revision_000001"
    });
    const reloadedRevision = reopened.getVdtRevision(revision.id);
    expect(reloadedRevision).toMatchObject({
      id: "revision_000001",
      filePath: path.join("projects", "project_mining", "vdts", "vdt_production_volume", "revisions", "000001.vdt.json"),
      validation: { valid: true },
      calculation: { valueCount: 0 }
    });
    expect(reopened.readVdtRevision(reloadedRevision!)).toMatchObject({
      rootNodeId: "production_volume",
      graph: {
        nodes: expect.arrayContaining([
          expect.objectContaining({ id: "working_time", name: "Working time" })
        ])
      }
    });
    expect(reopened.listConversations(project.id)).toEqual([
      expect.objectContaining({
        id: "conversation_mining",
        vdtId: vdt.id,
        title: "Production volume build thread"
      })
    ]);
    expect(readProjectManifestFromDatabaseLocation(dataDir, project.id)).toMatchObject({
      schemaVersion: 1,
      id: "project_mining",
      name: "Mining productivity improvement",
      industry: "Mining"
    });
    expect(scanProjectLocation(dataDir)).toHaveLength(1);
    reopened.close();
  });

  it("updates and deletes projects and VDTs with their storage directories", () => {
    const root = tempRoot();
    const dataDir = path.join(root, "data");
    const db = openVdtDatabase(root, { dataDir, now: fixedClock("2026-06-29T09:00:00.000Z") });
    db.createProject({ id: "project_crud", name: "Draft project", industry: "Mining" });
    db.createVdt({
      id: "vdt_crud",
      projectId: "project_crud",
      name: "Draft VDT",
      rootKpi: "Production Volume"
    });
    db.saveVdtRevision({
      id: "revision_crud",
      projectId: "project_crud",
      vdtId: "vdt_crud",
      revisionNo: 1,
      source: "user",
      project: buildWorkingTimeProject()
    });

    expect(db.updateProject("project_crud", {
      name: "Updated project",
      description: "Managed workspace",
      industry: "Processing"
    })).toMatchObject({
      id: "project_crud",
      name: "Updated project",
      description: "Managed workspace",
      industry: "Processing"
    });
    expect(readProjectManifestFromDatabaseLocation(dataDir, "project_crud")).toMatchObject({
      name: "Updated project",
      industry: "Processing"
    });

    expect(db.updateVdt("vdt_crud", {
      name: "Updated VDT",
      rootKpi: "Throughput",
      unit: "t/h",
      status: "reviewed"
    })).toMatchObject({
      id: "vdt_crud",
      name: "Updated VDT",
      rootKpi: "Throughput",
      unit: "t/h",
      status: "reviewed"
    });

    expect(db.deleteVdt("vdt_crud")).toBe(true);
    expect(db.getVdt("vdt_crud")).toBeNull();
    expect(db.listVdtRevisions("vdt_crud")).toEqual([]);
    expect(fs.existsSync(path.join(dataDir, "projects", "project_crud", "vdts", "vdt_crud"))).toBe(false);

    db.createVdt({
      id: "vdt_delete_project",
      projectId: "project_crud",
      name: "Delete with project",
      rootKpi: "Production Volume"
    });
    expect(db.deleteProject("project_crud")).toBe(true);
    expect(db.getProject("project_crud")).toBeNull();
    expect(fs.existsSync(path.join(dataDir, "projects", "project_crud"))).toBe(false);
    expect(db.deleteProject("project_crud")).toBe(false);
    db.close();
  });

  it("redacts provider secrets from agent runs and message run contexts", () => {
    const root = tempRoot();
    const db = openVdtDatabase(root, { now: fixedClock("2026-06-29T06:00:00.000Z") });
    db.createProject({ id: "project_secret_test", name: "Secret test" });
    db.createConversation({ id: "conversation_1", projectId: "project_secret_test" });

    const run = db.createAgentRun({
      id: "run_1",
      projectId: "project_secret_test",
      status: "running",
      phase: "building_graph",
      request: {
        providerId: "local_runner",
        providerConfig: {
          apiKey: "sk-secret",
          pairingToken: "pairing-secret",
          nested: { accessToken: "access-secret", safe: "kept" }
        }
      }
    });
    db.appendMessage({
      id: "message_1",
      conversationId: "conversation_1",
      role: "user",
      content: "Build a VDT",
      agentRunId: run.id,
      runContext: {
        apiKey: "message-secret",
        pairing_token: "message-pairing-secret",
        safe: "visible"
      }
    });

    expect(db.getConversation("conversation_1")).toMatchObject({
      id: "conversation_1",
      projectId: "project_secret_test"
    });
    expect(db.listConversations("project_secret_test").map((conversation) => conversation.id)).toEqual(["conversation_1"]);
    expect(db.listMessages("conversation_1")).toEqual([
      expect.objectContaining({
        id: "message_1",
        runContext: {
          apiKey: "[redacted]",
          pairing_token: "[redacted]",
          safe: "visible"
        }
      })
    ]);
    expect(db.listAgentRuns("project_secret_test").map((agentRun) => agentRun.id)).toEqual(["run_1"]);
    expect(db.getAgentRun(run.id)?.request).toEqual({
      providerId: "local_runner",
      providerConfig: {
        apiKey: "[redacted]",
        pairingToken: "[redacted]",
        nested: { accessToken: "[redacted]", safe: "kept" }
      }
    });
    db.close();

    const rawDb = fs.readFileSync(path.join(root, ".vdt", "app.sqlite"), "utf8");
    expect(rawDb).not.toContain("sk-secret");
    expect(rawDb).not.toContain("pairing-secret");
    expect(rawDb).not.toContain("message-secret");
    expect(rawDb).toContain("[redacted]");
  });

  it("persists agent events and mutation proposal lifecycle records", () => {
    const root = tempRoot();
    const db = openVdtDatabase(root, { now: fixedClock("2026-06-29T07:00:00.000Z") });
    db.createProject({ id: "project_mutations", name: "Mutation project" });
    db.createVdt({ id: "vdt_mutations", projectId: "project_mutations", name: "Mutation VDT", rootKpi: "Production Volume" });
    const revision = db.saveVdtRevision({
      id: "revision_base",
      projectId: "project_mutations",
      vdtId: "vdt_mutations",
      revisionNo: 1,
      source: "user",
      project: buildWorkingTimeProject()
    });
    db.createAgentRun({
      id: "run_mutations",
      projectId: "project_mutations",
      vdtId: "vdt_mutations",
      status: "running",
      phase: "building_graph",
      request: { mode: "generate_vdt" }
    });
    db.appendAgentEvent({
      runId: "run_mutations",
      seq: 1,
      type: "graph_patch",
      phase: "building_graph",
      title: "Proposal created",
      message: "Prepared a visible layer.",
      metadata: { apiKey: "hidden", layer: 1 }
    });
    const proposal = db.createMutationProposal({
      id: "proposal_1",
      runId: "run_mutations",
      projectId: "project_mutations",
      vdtId: "vdt_mutations",
      baseRevisionId: revision.id,
      status: "proposed",
      title: "Add Working time decomposition",
      changeSet: minimalChangeSet(),
      validation: { valid: true }
    });
    const updated = db.updateMutationProposal(proposal.id, {
      status: "applied",
      appliedAt: "2026-06-29T07:05:00.000Z"
    });

    expect(db.listAgentEvents("run_mutations")).toEqual([
      expect.objectContaining({
        seq: 1,
        metadata: { apiKey: "[redacted]", layer: 1 }
      })
    ]);
    expect(db.listVdtRevisions("vdt_mutations").map((record) => record.id)).toEqual(["revision_base"]);
    expect(db.getMutationProposal(proposal.id)).toMatchObject({
      id: "proposal_1",
      status: "applied"
    });
    expect(db.listMutationProposals("run_mutations").map((record) => record.id)).toEqual(["proposal_1"]);
    expect(db.listProjectMutationProposals("project_mutations").map((record) => record.id)).toEqual(["proposal_1"]);
    expect(updated).toMatchObject({
      id: "proposal_1",
      status: "applied",
      appliedAt: "2026-06-29T07:05:00.000Z"
    });
    db.close();
  });

  it("persists deterministic VDT comparison records", () => {
    const root = tempRoot();
    const db = openVdtDatabase(root, { now: fixedClock("2026-06-29T08:00:00.000Z") });
    db.createProject({ id: "project_compare", name: "Compare project" });
    db.createVdt({ id: "vdt_left", projectId: "project_compare", name: "Left VDT", rootKpi: "Production Volume" });
    db.createVdt({ id: "vdt_right", projectId: "project_compare", name: "Right VDT", rootKpi: "Production Volume" });
    const leftProject = productionVolumeProject;
    const rightProject = withLowerUnplannedDowntime(leftProject);
    const leftRevision = db.saveVdtRevision({
      id: "revision_left",
      projectId: "project_compare",
      vdtId: "vdt_left",
      revisionNo: 1,
      source: "agent",
      project: leftProject
    });
    const rightRevision = db.saveVdtRevision({
      id: "revision_right",
      projectId: "project_compare",
      vdtId: "vdt_right",
      revisionNo: 1,
      source: "agent",
      project: rightProject
    });
    const result = compareVdtProjects(leftProject, rightProject);

    db.createComparison({
      id: "comparison_1",
      projectId: "project_compare",
      leftVdtId: "vdt_left",
      rightVdtId: "vdt_right",
      leftRevisionId: leftRevision.id,
      rightRevisionId: rightRevision.id,
      result,
      summary: "Right VDT reduces unplanned downtime."
    });

    expect(db.getComparison("comparison_1")).toMatchObject({
      id: "comparison_1",
      result: {
        rootDelta: expect.objectContaining({ absoluteDelta: expect.any(Number) }),
        structuralDiff: expect.objectContaining({
          changedValues: expect.arrayContaining(["unplanned_downtime"])
        })
      },
      summary: "Right VDT reduces unplanned downtime."
    });
    expect(db.listComparisons("project_compare").map((record) => record.id)).toEqual(["comparison_1"]);
    db.close();
  });

  it("rejects unsafe ids and detects revision file tampering", () => {
    const root = tempRoot();
    const db = openVdtDatabase(root);
    expect(() => db.createProject({ id: "../escape", name: "Bad" })).toThrow(/safe id/);
    db.createProject({ id: "project_safe", name: "Safe" });
    db.createVdt({ id: "vdt_safe", projectId: "project_safe", name: "Safe VDT", rootKpi: "Production Volume" });
    const revision = db.saveVdtRevision({
      id: "revision_safe",
      projectId: "project_safe",
      vdtId: "vdt_safe",
      revisionNo: 1,
      source: "agent",
      project: buildWorkingTimeProject()
    });
    fs.appendFileSync(path.join(db.dataDir, revision.filePath), "\n", "utf8");
    expect(() => db.readVdtRevision(revision)).toThrow(/hash mismatch/);
    db.close();
  });
});

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vdt-storage-"));
  tempDirs.push(root);
  return root;
}

function fixedClock(timestamp: string): () => string {
  return () => timestamp;
}

function buildWorkingTimeProject() {
  const builder = new VdtBuilderSession({ providerId: "test" });
  builder.createDraft({ projectTitle: "Production Volume Driver Model", rootKpi: "Production Volume", unit: "t" });
  builder.addDriver({
    parentNodeId: "production_volume",
    nodeId: "throughput_rate",
    name: "Throughput rate",
    unit: "t/h",
    relation: "multiplicative_driver"
  });
  builder.addDriver({
    parentNodeId: "production_volume",
    nodeId: "working_time",
    name: "Working time",
    unit: "h",
    relation: "multiplicative_driver"
  });
  builder.setFormula({ nodeId: "production_volume", formula: "throughput_rate * working_time" });
  return builder.getProject();
}

function withLowerUnplannedDowntime(project: VdtProject) {
  return {
    ...project,
    id: `${project.id}_right`,
    graph: {
      ...project.graph,
      nodes: project.graph.nodes.map((node) =>
        node.id === "unplanned_downtime" ? { ...node, baselineValue: 60 } : node
      )
    }
  };
}

function minimalChangeSet(): VdtChangeSet {
  return {
    id: "changeset_working_time",
    taskType: "deepen_node",
    backendId: "test",
    createdAt: "2026-06-29T07:00:00.000Z",
    additions: [],
    updates: [],
    deletions: [],
    edgeChanges: [],
    assumptions: [],
    questions: [],
    warnings: []
  };
}
