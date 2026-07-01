import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openVdtDatabase } from "@vdt-studio/storage";
import { previewChangeSet, VdtBuilderSession, type VdtChangeSet } from "@vdt-studio/vdt-core";
import { AgentRunStore, type MutationProposal } from "@vdt-studio/vdt-agent-runtime";
import { createSqliteAgentRunPersistence } from "./persistence";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("SQLite agent run persistence", () => {
  it("persists redacted agent runs and events for recovery after a new store is created", () => {
    const root = tempRoot();
    const dataDir = path.join(root, "data");
    const firstDatabase = openVdtDatabase(root, { dataDir, now: fixedClock("2026-06-29T10:00:00.000Z") });
    const firstStore = new AgentRunStore({
      now: fixedClock("2026-06-29T10:00:01.000Z"),
      persistence: createSqliteAgentRunPersistence(firstDatabase)
    });

    const run = firstStore.createRun({
      mode: "generate_vdt",
      input: {
        prompt: "Build a revenue VDT.",
        rootKpi: "Revenue"
      },
      providerId: "openai_compatible",
      providerConfig: {
        apiKey: "sk-secret",
        model: "gpt-test"
      }
    });
    firstStore.updateRun(run.runId, { status: "running", phase: "building_graph" });
    firstStore.appendEvent(run.runId, {
      type: "graph_patch",
      phase: "building_graph",
      title: "Layer created",
      message: "Created the first visible layer.",
      metadata: { pairingToken: "pair-secret", layer: 1 }
    });

    expect(firstDatabase.getAgentRun(run.runId)?.request).toMatchObject({
      providerConfig: {
        apiKey: "[redacted]",
        model: "gpt-test"
      }
    });
    expect(firstDatabase.listAgentEvents(run.runId)).toEqual([
      expect.objectContaining({
        id: `${run.runId}_000001`,
        seq: 1,
        metadata: {
          pairingToken: "[redacted]",
          layer: 1,
          sourceEventId: `${run.runId}:1`
        }
      })
    ]);
    firstDatabase.close();

    const reopenedDatabase = openVdtDatabase(root, { dataDir });
    const recoveredStore = new AgentRunStore({
      persistence: createSqliteAgentRunPersistence(reopenedDatabase)
    });
    expect(recoveredStore.has(run.runId)).toBe(true);
    expect(recoveredStore.getSnapshot(run.runId)).toMatchObject({
      runId: run.runId,
      status: "running",
      phase: "building_graph",
      request: {
        providerConfig: {
          apiKey: "[redacted]",
          model: "gpt-test"
        }
      },
      events: [expect.objectContaining({ type: "graph_patch" })]
    });
    reopenedDatabase.close();

    const rawDb = fs.readFileSync(path.join(dataDir, "app.sqlite"), "utf8");
    expect(rawDb).not.toContain("sk-secret");
    expect(rawDb).not.toContain("pair-secret");
    expect(rawDb).toContain("[redacted]");
  });

  it("persists mutation proposals, preview files, and applied VDT revisions", () => {
    const root = tempRoot();
    const dataDir = path.join(root, "data");
    const database = openVdtDatabase(root, { dataDir, now: fixedClock("2026-06-29T11:00:00.000Z") });
    const store = new AgentRunStore({
      now: fixedClock("2026-06-29T11:00:01.000Z"),
      persistence: createSqliteAgentRunPersistence(database)
    });
    const run = store.createRun({
      mode: "generate_vdt",
      input: {
        prompt: "Build a production volume VDT.",
        rootKpi: "Production Volume",
        unit: "t/year",
        timePeriod: "year"
      },
      workspace: {
        projectId: "mine_plan_project",
        projectName: "Mine plan",
        industry: "Mining"
      },
      providerId: "mock",
      options: { autoApplyPatches: true }
    });
    store.appendChatMessage(run.runId, {
      role: "user",
      kind: "instruction",
      text: "Build a production volume VDT."
    });
    store.appendChatMessage(run.runId, {
      role: "assistant",
      kind: "question",
      questions: [
        {
          id: "operating_hours",
          question: "How many operating hours should the model assume?",
          reason: "Working time needs an operating-hours basis before downtime is decomposed.",
          required: true,
          expectedAnswerType: "number"
        }
      ]
    });
    const draft = buildDraftProject();
    const changeSet = addWorkingTimeChangeSet();
    const previewProject = previewChangeSet(draft, changeSet);
    const proposal: MutationProposal = {
      id: `${run.runId}:mutation:1`,
      runId: run.runId,
      projectId: draft.id,
      vdtId: draft.rootNodeId,
      baseRevisionId: "builder:1",
      baseRevision: 1,
      source: "agent",
      title: "Add Working time layer",
      summary: "Added Working time as the next visible layer.",
      changeSet,
      selectedChangeIds: ["add_working_time", "edge_production_volume_working_time"],
      previewProject,
      validation: { valid: true, errors: [], warnings: [] },
      status: "applied",
      policy: {
        autoApply: true,
        askBeforeFirstPatch: false,
        requireApprovalForGraphStructure: false,
        requireApprovalForFormulaChanges: false,
        requireApprovalForDelete: false
      },
      createdAt: "2026-06-29T11:00:02.000Z",
      appliedAt: "2026-06-29T11:00:03.000Z"
    };

    store.updateRun(run.runId, {
      status: "running",
      phase: "building_graph",
      draftProject: draft,
      validationState: { valid: true, errors: [], warnings: [] }
    });
    store.updateRun(run.runId, {
      status: "running",
      phase: "applying_graph",
      draftProject: previewProject,
      pendingChangeSet: proposal.changeSet,
      mutationProposals: [proposal],
      validationState: proposal.validation
    });

    expect(database.getProject("mine_plan_project")).toMatchObject({
      id: "mine_plan_project",
      name: "Mine plan",
      industry: "Mining"
    });
    expect(database.listVdts("project_agent_workspace")).toEqual([]);

    const vdt = database.listVdts("mine_plan_project")[0];
    expect(vdt).toMatchObject({
      projectId: "mine_plan_project",
      rootKpi: "Production Volume",
      activeRevisionId: expect.stringMatching(/^revision_/)
    });
    const conversation = database.listConversations("mine_plan_project")[0];
    expect(database.getAgentRun(run.runId)).toMatchObject({
      projectId: "mine_plan_project",
      conversationId: conversation!.id
    });
    expect(conversation).toMatchObject({
      projectId: "mine_plan_project",
      vdtId: vdt!.id,
      title: "Production Volume agent thread",
      mode: "generate_vdt"
    });
    expect(database.listMessages(conversation!.id)).toEqual([
      expect.objectContaining({
        role: "user",
        content: "Build a production volume VDT.",
        agentRunId: run.runId,
        position: 1,
        runContext: expect.objectContaining({ kind: "instruction" })
      }),
      expect.objectContaining({
        role: "assistant",
        content: "How many operating hours should the model assume?",
        agentRunId: run.runId,
        position: 2,
        runContext: expect.objectContaining({
          kind: "question",
          questions: [
            expect.objectContaining({
              id: "operating_hours",
              question: "How many operating hours should the model assume?"
            })
          ]
        })
      })
    ]);
    const revisions = database.listVdtRevisions(vdt!.id);
    expect(revisions.map((revision) => revision.revisionNo)).toEqual([1, 2]);
    expect(database.readVdtRevision(revisions[1]!)).toMatchObject({
      rootNodeId: "production_volume",
      graph: {
        nodes: expect.arrayContaining([
          expect.objectContaining({ id: "working_time", name: "Working time" })
        ])
      }
    });

    const persistedProposal = database.listMutationProposals(run.runId)[0];
    expect(persistedProposal).toMatchObject({
      id: expect.stringMatching(/^proposal_/),
      projectId: "mine_plan_project",
      status: "applied",
      title: "Add Working time layer",
      baseRevisionId: revisions[0]!.id,
      appliedAt: "2026-06-29T11:00:03.000Z"
    });
    expect(persistedProposal!.id).not.toContain(":");
    expect(persistedProposal!.previewFilePath).toMatch(/previews/);
    expect(JSON.parse(fs.readFileSync(path.join(dataDir, persistedProposal!.previewFilePath!), "utf8"))).toMatchObject({
      graph: {
        nodes: expect.arrayContaining([
          expect.objectContaining({ id: "working_time" })
        ])
      }
    });
    database.close();
  });

  it("keeps unscoped legacy runs and artifacts in the default agent workspace", () => {
    const root = tempRoot();
    const dataDir = path.join(root, "data");
    const database = openVdtDatabase(root, { dataDir, now: fixedClock("2026-06-29T12:00:00.000Z") });
    const store = new AgentRunStore({
      now: fixedClock("2026-06-29T12:00:01.000Z"),
      persistence: createSqliteAgentRunPersistence(database)
    });
    const run = store.createRun({
      mode: "generate_vdt",
      input: {
        prompt: "Build a production volume VDT.",
        rootKpi: "Production Volume"
      },
      providerId: "mock"
    });
    const draft = buildDraftProject();

    store.updateRun(run.runId, {
      status: "running",
      phase: "building_graph",
      draftProject: draft
    });

    expect(database.getAgentRun(run.runId)?.projectId).toBe("project_agent_workspace");
    expect(database.listVdts("project_agent_workspace")).toHaveLength(1);
    expect(database.listProjects().map((project) => project.id)).toEqual(["project_agent_workspace"]);
    database.close();
  });
});

function tempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vdt-agent-persistence-"));
  tempDirs.push(dir);
  return dir;
}

function fixedClock(value: string): () => string {
  return () => value;
}

function buildDraftProject() {
  const builder = new VdtBuilderSession({ providerId: "test", now: fixedClock("2026-06-29T11:00:00.000Z") });
  return builder.createDraft({
    projectTitle: "Production Volume Driver Model",
    rootKpi: "Production Volume",
    unit: "t/year",
    timePeriod: "year"
  }).project;
}

function addWorkingTimeChangeSet(): VdtChangeSet {
  return {
    id: "changeset_working_time_layer",
    taskType: "generate_tree",
    backendId: "mock",
    createdAt: "2026-06-29T11:00:02.000Z",
    additions: [
      {
        id: "add_working_time",
        nodeId: "working_time",
        parentNodeId: "production_volume",
        relation: "multiplicative_driver",
        name: "Working time",
        type: "input",
        unit: "h/year",
        aiConfidence: 0.8,
        aiRationale: "Working time exposes downtime losses and supports deeper decomposition."
      }
    ],
    updates: [],
    deletions: [],
    edgeChanges: [
      {
        id: "edge_production_volume_working_time",
        action: "add",
        edge: {
          id: "edge_production_volume_working_time",
          sourceNodeId: "production_volume",
          targetNodeId: "working_time",
          relation: "multiplicative_driver",
          aiGenerated: true,
          aiConfidence: 0.8
        }
      }
    ],
    assumptions: [],
    questions: [],
    warnings: []
  };
}
