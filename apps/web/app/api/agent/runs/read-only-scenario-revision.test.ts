import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openVdtDatabase } from "@vdt-studio/storage";
import { AgentRunStore, ToolRegistry } from "@vdt-studio/vdt-agent-runtime";
import { VdtBuilderSession, productionVolumeProject } from "@vdt-studio/vdt-core";
import { expect, it, vi } from "vitest";
import { createStorageWriteActor } from "../../vdt/storage-write-adapter";
import { createLazySqliteAgentRunPersistence } from "./persistence";
import { registerWorkspaceOperationTools } from "./workspace-operation-tools";

it("anchors only an exact read-only run and leaves a reserved head and its bytes untouched", async () => {
  const directory = mkdtempSync(join(tmpdir(), "vdt-scenario-read-proof-"));
  let stagedFile: string | undefined;
  let interrupt = false;
  let now = "2026-11-26T10:00:00.000Z";
  const database = openVdtDatabase(directory, { dataDir: directory, now: () => now, faultInjector(point, attempt) {
    if (interrupt && point === "after_head_reserved") {
      stagedFile = join(directory, attempt.stagedPayloadRelativePath);
      throw new Error("Pause after reservation");
    }
  } });
  try {
    const projectId = "comparison_project";
    const vdtId = "comparison_vdt";
    const actor = createStorageWriteActor(projectId, { env: { VDT_APP_MODE: "development_web" } });
    database.createProject({ id: projectId, name: "Comparison workspace" });
    const runtime = database.getProjectRuntimeState(projectId)!;
    const expectedRuntime = { expectedRuntimeGeneration: runtime.runtimeGeneration, expectedGenerationVersion: runtime.generationVersion };
    const initial = database.createVdtWithInitialSnapshot({ actor, project: productionVolumeProject, command: {
      schemaVersion: "create_vdt_with_initial_snapshot.v1", projectId, ...expectedRuntime, idempotencyKey: "initial",
      vdt: { requestedVdtId: vdtId, name: "Comparison", rootKpi: "Output", unit: null, timePeriod: null, status: "draft", metadata: null },
      revisionIntent: { source: "user", summary: "Initial model", validation: null, calculation: null }
    } });
    const head = database.getVdtRevisionHead(vdtId)!;
    const project = database.readVdtRevision(initial.revision);
    const savedPath = join(directory, initial.revision.filePath);
    const savedBytes = readFileSync(savedPath);
    const expectedRevision = { ...expectedRuntime, expectedActiveRevisionId: head.activeRevisionId,
      expectedActiveContentIdentity: head.activeContentIdentity, expectedCommitGeneration: head.commitGeneration };
    const workspace = { projectId, vdtId, expectedRevision };
    const factory = vi.fn(() => database);
    const persistence = createLazySqliteAgentRunPersistence(directory, { databaseFactory: factory, actorFactory: () => actor });
    const store = new AgentRunStore({ persistence });
    const conversation = database.createConversation({ id: "comparison_conversation", projectId, vdtId, mode: "continue_project" });
    const request = { providerId: "mock", mode: "continue_project", outcome: "answer",
      conversationId: conversation.id, input: { project }, workspace } as const;
    expect(persistence.readScenarioRevision({ runId: "not_initialized", request }, project)).toBeUndefined();
    expect(factory).not.toHaveBeenCalled();
    const run = store.createRun(request);
    store.updateRun(run.runId, { status: "running" });
    expect(database.getAgentRun(run.runId)).toMatchObject({ projectId, vdtId });
    const lookup = (override = workspace, representation = project) =>
      persistence.readScenarioRevision({ runId: run.runId, request: { ...request, workspace: override } }, representation);
    expect(lookup()).toBe(initial.revision.id);
    const tools = new ToolRegistry();
    const reopen = vi.fn(() => { throw new Error("Unexpected storage open"); });
    registerWorkspaceOperationTools(tools, reopen, (_store, run, representation) => persistence.readScenarioRevision(run, representation));
    const scenarioId = project.scenarios[0]!.id;
    const compare = await tools.run("scenario.compare", { scenarioId }, {
      runId: run.runId, store, builder: new VdtBuilderSession({ project }), signal: run.abortController.signal,
      getRun: () => store.getSnapshot(run.runId),
      emit: event => { store.appendEvent(run.runId, event); },
      updateRun: patch => { store.updateRun(run.runId, patch); }
    });
    expect(compare).toMatchObject({ ok: true, projectChanged: false, output: {
      savedRevisionId: initial.revision.id, result: { scenarioId }
    } });
    expect(reopen).not.toHaveBeenCalled();
    expect(store.getSnapshot(run.runId).workspaceRevision).toBeUndefined();
    expect(lookup({ ...workspace, vdtId: "another_vdt" })).toBeUndefined();
    expect(lookup({ ...workspace, projectId: "another_project" })).toBeUndefined();
    expect(lookup(workspace, { ...project, name: "Unsaved name" })).toBeUndefined();
    expect(persistence.readScenarioRevision({ runId: run.runId, request: { ...request, workspace: { projectId, vdtId } } }, project)).toBeUndefined();
    expect(database.getVdtRevisionHead(vdtId)).toEqual(head);
    expect(readFileSync(savedPath)).toEqual(savedBytes);

    const commit = () => database.commitVdtRevision({
      projectId, vdtId, actor, project: { ...project, name: "Manual edit" },
      command: { schemaVersion: "revision_commit.v2", ...expectedRevision, idempotencyKey: "manual-edit",
        intent: { source: "user", summary: "Unrelated edit", validation: null, calculation: null } }
    });
    interrupt = true;
    expect(commit).toThrow("Pause after reservation");
    const pendingHead = database.getVdtRevisionHead(vdtId)!;
    expect(pendingHead.pendingRevisionId).not.toBeNull();
    const stagedBytes = readFileSync(stagedFile!);
    const databaseBytes = readFileSync(database.databasePath);
    const journalBytes = readFileSync(database.databasePath + "-wal");
    expect(lookup()).toBeUndefined();
    expect(database.getVdtRevisionHead(vdtId)).toEqual(pendingHead);
    expect(readFileSync(stagedFile!)).toEqual(stagedBytes);
    expect(readFileSync(savedPath)).toEqual(savedBytes);
    expect(readFileSync(database.databasePath)).toEqual(databaseBytes);
    expect(readFileSync(database.databasePath + "-wal")).toEqual(journalBytes);
    expect(factory).toHaveBeenCalledTimes(1);

    interrupt = false;
    now = "2026-11-26T10:10:00.000Z";
    commit();
    expect(database.getVdtRevisionHead(vdtId)?.commitGeneration).toBe(head.commitGeneration + 1);
    expect(lookup()).toBeUndefined();
  } finally {
    database.close();
    rmSync(directory, { recursive: true });
  }
});
