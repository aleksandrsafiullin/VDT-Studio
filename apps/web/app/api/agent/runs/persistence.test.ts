import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openVdtDatabase, VdtStorageError } from "@vdt-studio/storage";
import { previewChangeSet, VdtBuilderSession, type VdtChangeSet } from "@vdt-studio/vdt-core";
import { AgentRunStore, type MutationProposal } from "@vdt-studio/vdt-agent-runtime";
import { createStorageWriteActor } from "@/app/api/vdt/storage-write-adapter";
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
    const createAgentRunSpy = vi.spyOn(firstDatabase, "createAgentRun");
    const updateAgentRunSpy = vi.spyOn(firstDatabase, "updateAgentRun");
    const firstStore = new AgentRunStore({
      now: fixedClock("2026-06-29T10:00:01.000Z"),
      persistence: createTestPersistence(firstDatabase)
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
      },
      options: { researchMode: "on" }
    });
    firstStore.updateRun(run.runId, { status: "running", phase: "building_graph" });
    firstStore.appendEvent(run.runId, {
      type: "graph_patch",
      phase: "building_graph",
      title: "Layer created",
      message: "Created the first visible layer.",
      metadata: { pairingToken: "pair-secret", layer: 1 }
    });

    const createRunInput = createAgentRunSpy.mock.calls[0]?.[0];
    expect(createRunInput?.request).toMatchObject({
      options: { researchMode: "on" },
      providerConfig: {
        apiKey: "[redacted]",
        model: "gpt-test"
      }
    });
    expect(JSON.stringify(createRunInput?.request)).not.toContain("sk-secret");
    expect(snapshotRequest(createRunInput?.publicSnapshot)).toEqual(createRunInput?.request);
    expect(internalStateSnapshotRequest(createRunInput?.internalState)).toEqual(createRunInput?.request);
    for (const [, patch] of updateAgentRunSpy.mock.calls) {
      expect(JSON.stringify(patch.request)).not.toContain("sk-secret");
      expect(snapshotRequest(patch.publicSnapshot)).toEqual(patch.request);
      expect(internalStateSnapshotRequest(patch.internalState)).toEqual(patch.request);
    }

    expect(firstDatabase.getAgentRun(run.runId)?.request).toMatchObject({
      options: { researchMode: "on" },
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
      persistence: createTestPersistence(reopenedDatabase)
    });
    expect(recoveredStore.has(run.runId)).toBe(true);
    expect(recoveredStore.getSnapshot(run.runId)).toMatchObject({
      runId: run.runId,
      status: "running",
      phase: "building_graph",
      request: {
        options: { researchMode: "on" },
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
    const initialCommitSpy = vi.spyOn(
      database,
      "createVdtWithInitialSnapshot"
    );
    const proposalCommitSpy = vi.spyOn(database, "commitVdtRevision");
    const createProposalSpy = vi.spyOn(database, "createMutationProposal");
    const updateProposalSpy = vi.spyOn(database, "updateMutationProposal");
    const store = new AgentRunStore({
      now: fixedClock("2026-06-29T11:00:01.000Z"),
      persistence: createTestPersistence(database)
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
      selectedChangeIds: ["add_working_time"],
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
    expect(revisions.map((revision) => revision.source)).toEqual([
      "agent",
      "agent"
    ]);
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
    expect(initialCommitSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        command: expect.objectContaining({
          idempotencyKey: `agent-run:${run.runId}:initial-v1`,
          revisionIntent: expect.objectContaining({ source: "agent" })
        })
      })
    );
    expect(proposalCommitSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        command: expect.objectContaining({
          idempotencyKey: `agent-proposal:${proposal.id}:apply-v1`,
          intent: expect.objectContaining({ source: "agent" })
        })
      })
    );
    expect(createProposalSpy.mock.calls[0]?.[0]).toMatchObject({
      status: "approved",
      appliedAt: undefined,
      baseRevisionId: revisions[0]!.id
    });
    const appliedUpdate = updateProposalSpy.mock.calls.find(
      ([, patch]) => patch.status === "applied"
    );
    expect(appliedUpdate?.[1]).toMatchObject({
      status: "applied",
      appliedAt: proposal.appliedAt
    });
    expect(createProposalSpy.mock.invocationCallOrder[0]).toBeLessThan(
      proposalCommitSpy.mock.invocationCallOrder[0]!
    );
    expect(proposalCommitSpy.mock.invocationCallOrder[0]).toBeLessThan(
      updateProposalSpy.mock.invocationCallOrder.find(
        (_, index) => updateProposalSpy.mock.calls[index]?.[1].status === "applied"
      )!
    );
    database.close();
  });

  it("uses one agent-sourced combined initial commit and treats repeated state persistence as replay", () => {
    const root = tempRoot();
    const database = openVdtDatabase(root, {
      dataDir: path.join(root, "data"),
      now: fixedClock("2026-06-29T12:00:00.000Z")
    });
    const initialCommitSpy = vi.spyOn(
      database,
      "createVdtWithInitialSnapshot"
    );
    const { store, run, draft, projectId } = createDraftRun(
      database,
      "agent_initial_replay"
    );
    const patch = {
      status: "running" as const,
      phase: "building_graph" as const,
      draftProject: draft,
      validationState: { valid: true, errors: [], warnings: [] }
    };
    store.updateRun(run.runId, patch);
    store.updateRun(run.runId, patch);

    const vdt = database.listVdts(projectId)[0]!;
    const revisions = database.listVdtRevisions(vdt.id);
    expect(revisions).toEqual([
      expect.objectContaining({
        revisionNo: 1,
        source: "agent",
        summary: "Initial VDT draft"
      })
    ]);
    expect(initialCommitSpy).toHaveBeenCalledTimes(2);
    expect(initialCommitSpy.mock.calls[0]?.[0]).toMatchObject({
      command: {
        idempotencyKey: `agent-run:${run.runId}:initial-v1`,
        revisionIntent: {
          source: "agent",
          summary: "Initial VDT draft"
        }
      }
    });
    expect(initialCommitSpy.mock.calls[1]?.[0]).toEqual(
      initialCommitSpy.mock.calls[0]?.[0]
    );
    expect(initialCommitSpy.mock.results[1]?.value).toEqual(
      initialCommitSpy.mock.results[0]?.value
    );
    const raw = new DatabaseSync(database.databasePath);
    expect(
      raw.prepare(`
        SELECT operation, idempotency_key, status
        FROM idempotency_records
        WHERE idempotency_key = ?
      `).all(`agent-run:${run.runId}:initial-v1`)
    ).toEqual([
      {
        operation: "vdt.create_with_initial",
        idempotency_key: `agent-run:${run.runId}:initial-v1`,
        status: "succeeded"
      }
    ]);
    raw.close();
    database.close();
  });

  it("atomically fills an existing ready empty VDT with the same stable initial key", () => {
    const root = tempRoot();
    const database = openVdtDatabase(root, {
      dataDir: path.join(root, "data"),
      now: fixedClock("2026-06-29T12:30:00.000Z")
    });
    const { store, run, draft, projectId } = createDraftRun(
      database,
      "agent_existing_empty"
    );
    const vdtId = testStorageVdtId(run.runId, draft);
    database.createVdt({
      id: vdtId,
      projectId,
      name: "Pre-created empty VDT",
      rootKpi: "Production Volume"
    });
    const combinedSpy = vi.spyOn(
      database,
      "createVdtWithInitialSnapshot"
    );
    const commitSpy = vi.spyOn(database, "commitVdtRevision");
    const patch = {
      status: "running" as const,
      phase: "building_graph" as const,
      draftProject: draft
    };
    store.updateRun(run.runId, patch);
    store.updateRun(run.runId, patch);

    expect(combinedSpy).not.toHaveBeenCalled();
    expect(commitSpy).toHaveBeenCalledTimes(2);
    expect(commitSpy.mock.calls[0]?.[0]).toMatchObject({
      projectId,
      vdtId,
      command: {
        expectedActiveRevisionId: null,
        expectedCommitGeneration: 0,
        idempotencyKey: `agent-run:${run.runId}:initial-v1`,
        intent: { source: "agent" }
      }
    });
    expect(commitSpy.mock.calls[1]?.[0]).toEqual(
      commitSpy.mock.calls[0]?.[0]
    );
    expect(commitSpy.mock.results[1]?.value).toEqual(
      commitSpy.mock.results[0]?.value
    );
    expect(database.listVdtRevisions(vdtId)).toEqual([
      expect.objectContaining({ revisionNo: 1, source: "agent" })
    ]);
    database.close();
  });

  it("persists an approved proposal before an intervening-winner conflict and never creates a third revision", () => {
    const root = tempRoot();
    const database = openVdtDatabase(root, {
      dataDir: path.join(root, "data"),
      now: fixedClock("2026-06-29T13:00:00.000Z")
    });
    const { store, run, draft, projectId } = createDraftRun(
      database,
      "agent_conflict"
    );
    store.updateRun(run.runId, {
      status: "running",
      phase: "building_graph",
      draftProject: draft
    });
    const vdt = database.listVdts(projectId)[0]!;
    const base = database.listVdtRevisions(vdt.id)[0]!;
    const head = database.getVdtRevisionHead(vdt.id)!;
    const runtime = database.getProjectRuntimeState(projectId)!;
    const manualWinner = database.commitVdtRevision({
      projectId,
      vdtId: vdt.id,
      actor: testStorageActor(projectId),
      command: {
        schemaVersion: "revision_commit.v2",
        expectedActiveRevisionId: head.activeRevisionId,
        expectedActiveContentIdentity: head.activeContentIdentity,
        expectedCommitGeneration: head.commitGeneration,
        expectedRuntimeGeneration: runtime.runtimeGeneration,
        expectedGenerationVersion: runtime.generationVersion,
        idempotencyKey: `manual-winner:${run.runId}`,
        intent: {
          source: "user",
          summary: "Intervening manual winner",
          validation: null,
          calculation: null
        }
      },
      project: JSON.parse(JSON.stringify(draft))
    });
    const proposal = buildAppliedProposal(run.runId, draft, "conflict");

    let conflict: unknown;
    try {
      store.updateRun(run.runId, {
        status: "running",
        phase: "applying_graph",
        draftProject: proposal.previewProject,
        mutationProposals: [proposal],
        validationState: proposal.validation
      });
    } catch (error) {
      conflict = error;
    }
    expect(conflict).toBeInstanceOf(VdtStorageError);
    expect((conflict as VdtStorageError).code).toBe("REVISION_CONFLICT");
    expect(database.getVdtRevisionHead(vdt.id)?.activeRevisionId).toBe(
      manualWinner.revision.id
    );
    expect(database.listVdtRevisions(vdt.id)).toHaveLength(2);
    expect(
      database.listVdtRevisions(vdt.id).map((revision) => revision.id)
    ).toContain(base.id);
    const persisted = database.listMutationProposals(run.runId);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      baseRevisionId: base.id,
      status: "approved"
    });
    expect(persisted[0]).not.toHaveProperty("appliedAt");
    database.close();
  });

  it("reconciles a committed proposal after a real store/database restart without a second revision", () => {
    const root = tempRoot();
    const dataDir = path.join(root, "data");
    const database = openVdtDatabase(root, {
      dataDir,
      now: fixedClock("2026-06-29T14:00:00.000Z")
    });
    const { store, run, draft, projectId } = createDraftRun(
      database,
      "agent_replay"
    );
    store.updateRun(run.runId, {
      status: "running",
      phase: "building_graph",
      draftProject: draft
    });
    const vdt = database.listVdts(projectId)[0]!;
    const proposal = {
      ...buildAppliedProposal(run.runId, draft, "replay"),
      source: "user" as const
    };
    const commitSpy = vi.spyOn(database, "commitVdtRevision");
    const updateProposal = database.updateMutationProposal.bind(database);
    let failAppliedUpdate = true;
    vi.spyOn(database, "updateMutationProposal").mockImplementation(
      (proposalId, patch) => {
        if (patch.status === "applied" && failAppliedUpdate) {
          failAppliedUpdate = false;
          throw new Error("simulated crash after committed revision");
        }
        return updateProposal(proposalId, patch);
      }
    );
    const patch = {
      status: "running" as const,
      phase: "applying_graph" as const,
      draftProject: proposal.previewProject,
      mutationProposals: [proposal],
      validationState: proposal.validation
    };
    expect(() => store.updateRun(run.runId, patch)).toThrow(
      "simulated crash after committed revision"
    );
    const committedHead = database.getVdtRevisionHead(vdt.id)!;
    const persistedProposalId =
      database.listMutationProposals(run.runId)[0]!.id;
    expect(database.listVdtRevisions(vdt.id)).toHaveLength(2);
    const stagedProposal = database.getMutationProposal(persistedProposalId);
    expect(stagedProposal).toMatchObject({ status: "approved" });
    expect(stagedProposal).not.toHaveProperty("appliedAt");
    const firstCommit = commitSpy.mock.calls[0]![0];
    const firstResult = commitSpy.mock.results[0]!.value;
    database.close();

    const reopened = openVdtDatabase(root, {
      dataDir,
      now: fixedClock("2026-06-29T14:00:00.000Z")
    });
    const replaySpy = vi.spyOn(reopened, "commitVdtRevision");
    const recoveredStore = new AgentRunStore({
      persistence: createTestPersistence(reopened)
    });
    expect(recoveredStore.has(run.runId)).toBe(true);
    expect(recoveredStore.getState(run.runId).mutationProposals).toEqual([
      expect.objectContaining({
        id: proposal.id,
        status: "applied",
        appliedAt: proposal.appliedAt
      })
    ]);

    expect(reopened.listVdtRevisions(vdt.id)).toHaveLength(2);
    expect(reopened.getVdtRevisionHead(vdt.id)).toEqual(committedHead);
    expect(reopened.getMutationProposal(persistedProposalId)).toMatchObject({
      status: "applied",
      appliedAt: proposal.appliedAt
    });
    expect(commitSpy).toHaveBeenCalledTimes(1);
    expect(replaySpy).toHaveBeenCalledTimes(1);
    expect(replaySpy.mock.calls[0]?.[0]).toEqual(firstCommit);
    expect(replaySpy.mock.calls[0]?.[0].command).toEqual(firstCommit.command);
    expect(replaySpy.mock.calls[0]?.[0].command.intent.source).toBe("agent");
    expect(replaySpy.mock.results[0]?.value).toEqual(firstResult);
    reopened.close();
  });

  it("preserves the exact legacy base identity and full CAS across restart replay", () => {
    const root = tempRoot();
    const dataDir = path.join(root, "data");
    const database = openVdtDatabase(root, {
      dataDir,
      now: fixedClock("2026-06-29T14:30:00.000Z")
    });
    const { store, run, draft, projectId } = createDraftRun(
      database,
      "agent_legacy_replay"
    );
    const vdtId = testStorageVdtId(run.runId, draft);
    database.createVdt({
      id: vdtId,
      projectId,
      name: "Legacy agent VDT",
      rootKpi: "Production Volume",
      metadata: {
        sourceRunId: run.runId,
        sourceProjectId: draft.id
      }
    });
    database.saveVdtRevision({
      id: "revision_legacy_agent_base",
      projectId,
      vdtId,
      revisionNo: 1,
      source: "agent",
      summary: "Legacy initial VDT draft",
      project: draft
    });
    store.updateRun(run.runId, {
      status: "running",
      phase: "building_graph",
      draftProject: draft
    });

    const proposal = buildAppliedProposal(run.runId, draft, "legacy_replay");
    const commitSpy = vi.spyOn(database, "commitVdtRevision");
    const updateProposal = database.updateMutationProposal.bind(database);
    vi.spyOn(database, "updateMutationProposal").mockImplementation(
      (proposalId, patch) => {
        if (patch.status === "applied") {
          throw new Error("simulated legacy post-commit crash");
        }
        return updateProposal(proposalId, patch);
      }
    );
    expect(() => store.updateRun(run.runId, {
      status: "running",
      phase: "applying_graph",
      draftProject: proposal.previewProject,
      mutationProposals: [proposal],
      validationState: proposal.validation
    })).toThrow("simulated legacy post-commit crash");
    const firstInput = commitSpy.mock.calls[0]![0];
    expect(firstInput.command.expectedActiveContentIdentity).toEqual({
      scheme: "legacy_graph_sha256",
      hash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/)
    });
    const committedHead = database.getVdtRevisionHead(vdtId)!;
    database.close();

    const reopened = openVdtDatabase(root, {
      dataDir,
      now: fixedClock("2026-06-29T14:30:00.000Z")
    });
    const replaySpy = vi.spyOn(reopened, "commitVdtRevision");
    const recovered = new AgentRunStore({
      persistence: createTestPersistence(reopened)
    });
    expect(recovered.has(run.runId)).toBe(true);
    expect(replaySpy).toHaveBeenCalledTimes(1);
    expect(replaySpy.mock.calls[0]![0]).toEqual(firstInput);
    expect(reopened.listVdtRevisions(vdtId)).toHaveLength(2);
    expect(reopened.getVdtRevisionHead(vdtId)).toEqual(committedHead);
    expect(reopened.listMutationProposals(run.runId)[0]).toMatchObject({
      status: "applied",
      appliedAt: proposal.appliedAt
    });
    reopened.close();
  });

  it("rejects a non-dense preview before writing a preview artifact or proposal", () => {
    const root = tempRoot();
    const database = openVdtDatabase(root, {
      dataDir: path.join(root, "data"),
      now: fixedClock("2026-06-29T15:00:00.000Z")
    });
    const { store, run, draft } = createDraftRun(
      database,
      "agent_strict_preview"
    );
    store.updateRun(run.runId, {
      status: "running",
      phase: "building_graph",
      draftProject: draft
    });
    const proposal = buildAppliedProposal(run.runId, draft, "strict_preview");
    const invalidPreview = {
      ...proposal.previewProject,
      toJSON() {
        return proposal.previewProject;
      }
    };
    const writeSpy = vi.spyOn(fs, "writeFileSync");

    expect(() => store.updateRun(run.runId, {
      status: "running",
      phase: "applying_graph",
      draftProject: draft,
      mutationProposals: [{
        ...proposal,
        status: "proposed",
        appliedAt: undefined,
        previewProject: invalidPreview
      }]
    })).toThrow(/must not define toJSON/);
    expect(writeSpy).not.toHaveBeenCalled();
    expect(database.listMutationProposals(run.runId)).toEqual([]);
    database.close();
  });

  it("fails closed when a persisted replay command is changed under the same key", () => {
    const root = tempRoot();
    const database = openVdtDatabase(root, {
      dataDir: path.join(root, "data"),
      now: fixedClock("2026-06-29T15:30:00.000Z")
    });
    const { store, run, draft } = createDraftRun(
      database,
      "agent_replay_tamper"
    );
    store.updateRun(run.runId, {
      status: "running",
      phase: "building_graph",
      draftProject: draft
    });
    const proposal = buildAppliedProposal(run.runId, draft, "tamper");
    store.updateRun(run.runId, {
      status: "running",
      phase: "applying_graph",
      draftProject: proposal.previewProject,
      mutationProposals: [proposal],
      validationState: proposal.validation
    });

    const record = database.getAgentRun(run.runId)!;
    const internalState = structuredClone(record.internalState!);
    const replayState = internalState.__vdtStorageReplayStateV1 as {
      proposals: Array<{
        command: {
          intent: { summary: string | null };
        };
      }>;
    };
    replayState.proposals[0]!.command.intent.summary = "tampered replay";
    database.updateAgentRun(run.runId, { internalState });
    const recovered = new AgentRunStore({
      persistence: createTestPersistence(database)
    });

    expect(() => recovered.has(run.runId)).toThrowError(
      expect.objectContaining({ code: "IDEMPOTENCY_KEY_REUSE" })
    );
    expect(database.listVdtRevisions(testStorageVdtId(run.runId, draft))).toHaveLength(2);
    database.close();
  });

  it("keeps unscoped legacy runs and artifacts in the default agent workspace", () => {
    const root = tempRoot();
    const dataDir = path.join(root, "data");
    const database = openVdtDatabase(root, { dataDir, now: fixedClock("2026-06-29T12:00:00.000Z") });
    const store = new AgentRunStore({
      now: fixedClock("2026-06-29T12:00:01.000Z"),
      persistence: createTestPersistence(database)
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

function createDraftRun(
  database: ReturnType<typeof openVdtDatabase>,
  projectId: string
) {
  const store = new AgentRunStore({
    now: fixedClock("2026-06-29T12:00:01.000Z"),
    persistence: createTestPersistence(database)
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
      projectId,
      projectName: "Agent persistence test"
    },
    providerId: "mock"
  });
  return {
    store,
    run,
    draft: buildDraftProject(),
    projectId
  };
}

function buildAppliedProposal(
  runId: string,
  draft: ReturnType<typeof buildDraftProject>,
  suffix: string
): MutationProposal {
  const changeSet = addWorkingTimeChangeSet();
  return {
    id: `${runId}:mutation:${suffix}`,
    runId,
    projectId: draft.id,
    vdtId: draft.rootNodeId,
    baseRevisionId: "builder:1",
    baseRevision: 1,
    source: "agent",
    title: "Add Working time layer",
    summary: "Added Working time as the next visible layer.",
    changeSet,
    selectedChangeIds: ["add_working_time"],
    previewProject: previewChangeSet(draft, changeSet),
    validation: { valid: true, errors: [], warnings: [] },
    status: "applied",
    policy: {
      autoApply: true,
      askBeforeFirstPatch: false,
      requireApprovalForGraphStructure: false,
      requireApprovalForFormulaChanges: false,
      requireApprovalForDelete: false
    },
    createdAt: "2026-06-29T12:00:02.000Z",
    appliedAt: "2026-06-29T12:00:03.000Z"
  };
}

function tempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vdt-agent-persistence-"));
  tempDirs.push(dir);
  return dir;
}

function fixedClock(value: string): () => string {
  return () => value;
}

function createTestPersistence(database: ReturnType<typeof openVdtDatabase>) {
  return createSqliteAgentRunPersistence(database, {
    actorFactory: testStorageActor
  });
}

function testStorageActor(projectId: string) {
  return createStorageWriteActor(projectId, {
    env: { VDT_APP_MODE: "development_web" },
    now: fixedClock("2026-06-29T10:00:00.000Z")
  });
}

function testStorageVdtId(
  runId: string,
  draft: ReturnType<typeof buildDraftProject>
): string {
  return testSafeStorageId("vdt", `${draft.rootNodeId || draft.id}_${runId}`);
}

function testSafeStorageId(prefix: string, value: string): string {
  const hash = createHash("sha256").update(value).digest("hex").slice(0, 12);
  const body =
    value
      .replace(/[^A-Za-z0-9_-]+/g, "_")
      .replace(/^[^A-Za-z0-9]+/, "")
      .slice(0, 90) || "item";
  return `${prefix}_${body}_${hash}`;
}

function snapshotRequest(value: unknown): unknown {
  return (value as { request?: unknown } | undefined)?.request;
}

function internalStateSnapshotRequest(value: unknown): unknown {
  return (value as { snapshot?: { request?: unknown } } | undefined)?.snapshot?.request;
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
    edgeChanges: [],
    assumptions: [],
    questions: [],
    warnings: []
  };
}
