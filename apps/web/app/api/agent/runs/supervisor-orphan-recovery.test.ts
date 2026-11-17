import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { AgentRunEventOutbox, AgentRunStore, type AgentSessionBinding, type VdtAgentRunStatus } from "@vdt-studio/vdt-agent-runtime";
import { VdtBuilderSession } from "@vdt-studio/vdt-core";
import { openVdtDatabase, type VdtDatabase } from "@vdt-studio/storage";
import { createStorageWriteActor } from "../../vdt/storage-write-adapter";
import { createSqliteAgentRunPersistence } from "./persistence";
import { supervisorOwnerDeath } from "./supervisor-controller-owner";
import { SqliteAgentSupervisorPersistence } from "./sqlite-supervisor-persistence";

const directories: string[] = [];
const children = new Set<ChildProcessWithoutNullStreams>();
const connections: { close(): void }[] = [];
const HASH = `sha256:${"a".repeat(64)}`;

afterEach(async () => {
  for (const child of children) await stopChild(child);
  children.clear();
  for (const connection of connections.splice(0)) connection.close();
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("orphaned Supervisor terminal recovery", { timeout: 30_000 }, () => {
  it.each(["running", "needs_user_input", "waiting_approval"] as const)("keeps the committed draft after a real %s owner process dies and replays terminal recovery after restart", async status => {
    const fixture = createFixture(status);
    const owner = await startOwner(fixture);
    const recovering = authority(fixture.database.databasePath);
    const before = graphEvidence(fixture.database, fixture.runId);
    const legacyBefore = fixture.database.getAgentRun(fixture.runId)!.internalState!;
    await expect(recovering.cancelOrphanedRun(fixture.runId)).rejects.toMatchObject({ code: "MODEL_AGENT_OWNER_ALIVE" });
    // An independent stale projection writer is denied before it can enter
    // graph publication, even while the actual owner remains alive.
    expect(() => fixture.store.updateRun(fixture.runId, { phase: "applying_graph" })).toThrowError(expect.objectContaining({ code: "STALE_SUPERVISOR_CALLBACK" }));
    expect(graphEvidence(fixture.database, fixture.runId)).toEqual(before);
    await stopChild(owner);

    const terminal = await recovering.cancelOrphanedRun(fixture.runId);
    expect(terminal.binding.sessionEpoch).toBe(2);
    expect(terminal.checkpoint?.sessionEpoch).toBe(2);
    expect(terminal.eventOutbox).toHaveLength(1);
    expect(terminal.eventOutbox?.[0]).toMatchObject({ type: "runtime_status", payload: { code: "RUN_ORPHAN_CANCELLED", state: "cancelled" } });
    expect(await recovering.getExecutionSummary(fixture.runId)).toMatchObject({ sessionEpoch: 2, sessionStatus: "completed", recoveryStatus: "complete", pendingOperation: null });
    const snapshot = fixture.store.reloadPersistedRun(fixture.runId);
    expect(snapshot.status).toBe("cancelled");
    expect(snapshot.pendingQuestions).toBeUndefined();
    expect(snapshot.draftProject).toEqual((legacyBefore.snapshot as Record<string, unknown>).draftProject);
    expect(graphEvidence(fixture.database, fixture.runId)).toEqual(before);

    const restarted = authority(fixture.database.databasePath);
    expect(await restarted.cancelOrphanedRun(fixture.runId)).toEqual(terminal);
    expect(() => fixture.store.updateRun(fixture.runId, { status: "running" })).toThrowError(expect.objectContaining({ code: "STALE_SUPERVISOR_CALLBACK" }));
    expect(fixture.database.getAgentRun(fixture.runId)?.status).toBe("cancelled");
    expect(graphEvidence(fixture.database, fixture.runId)).toEqual(before);
  });

  it("serializes simultaneous recovery in two new processes into exactly one terminal epoch/event", async () => {
    const fixture = createFixture("running"), owner = await startOwner(fixture);
    await stopChild(owner);
    const results = await Promise.all([runRecoveryChild(fixture), runRecoveryChild(fixture)]);
    expect(results).toEqual([{ ok: true, epoch: 2, events: 1 }, { ok: true, epoch: 2, events: 1 }]);
    expect(fixture.database.getAgentRunSupervisorFence(fixture.runId)).toMatchObject({ sessionEpoch: 2, orphanTerminated: true });
  });

  it("replays when another process commits between the observed run and fence reads", async () => {
    const fixture = createFixture("running"), owner = await startOwner(fixture);
    await stopChild(owner);
    const contender = authority(fixture.database.databasePath, {
      orphanRecoveryFaultInjector(point) {
        if (point !== "observation") return;
        const child = spawnSync(process.execPath, ["--import", "tsx",
          path.resolve("apps/web/app/api/agent/runs/fixtures/supervisor-orphan-child.ts"),
          fixture.database.databasePath, JSON.stringify(fixture.binding), "recover"], {
          encoding: "utf8", timeout: 10_000, env: {
            ...process.env, TSX_TSCONFIG_PATH: path.resolve("apps/web/tsconfig.json")
          }
        });
        // Snapshot isolation must preserve the original epoch even after the
        // other connection has committed. See the lookup assertions below.
        expect(child.status, child.stdout + child.stderr).toBe(0);
      },
      ownerDeath(token) {
        expect(supervisorOwnerDeath(token)).toBe("dead");
        // The snapshot must contain the epoch-one owner, rather than the
        // recovering child's epoch-two owner (now also dead).
        expect(token).toBe(originalFence?.ownerToken);
        return "dead";
      }
    });
    const originalFence = fixture.database.getAgentRunSupervisorFence(fixture.runId);
    const terminal = await contender.cancelOrphanedRun(fixture.runId);
    expect(terminal.binding.sessionEpoch).toBe(2);
    expect(terminal.eventOutbox).toHaveLength(1);
  });

  it.each(["epoch", "event", "projection"] as const)("rolls back a failure after the %s write and permits a complete retry", async point => {
    const fixture = createFixture("waiting_approval"), owner = await startOwner(fixture);
    await stopChild(owner);
    const before = fixture.database.getAgentRun(fixture.runId);
    const interrupted = authority(fixture.database.databasePath, { orphanRecoveryFaultInjector: where => { if (where === point) throw new Error(`failure after ${point}`); } });
    await expect(interrupted.cancelOrphanedRun(fixture.runId)).rejects.toThrow(`failure after ${point}`);
    expect(fixture.database.getAgentRun(fixture.runId)).toEqual(before);
    expect(fixture.database.getAgentRunSupervisorFence(fixture.runId)).toMatchObject({ sessionEpoch: 1, orphanTerminated: false });
    const retry = authority(fixture.database.databasePath);
    expect((await retry.cancelOrphanedRun(fixture.runId)).binding.sessionEpoch).toBe(2);
  });

  it("denies legacy/unknown ownership without advancing the epoch or replacing the saved draft", async () => {
    const fixture = createFixture("needs_user_input");
    const legacy = authority(fixture.database.databasePath, { fenceTokenFactory: () => `agent-fence:${randomUUID()}` });
    await legacy.createBinding(fixture.binding);
    const before = fixture.database.getAgentRun(fixture.runId);
    await expect(legacy.cancelOrphanedRun(fixture.runId)).rejects.toMatchObject({ code: "MODEL_AGENT_OWNER_UNVERIFIED" });
    expect(fixture.database.getAgentRun(fixture.runId)).toEqual(before);
    expect(fixture.database.getAgentRunSupervisorFence(fixture.runId)).toMatchObject({ sessionEpoch: 1, orphanTerminated: false });
  });

  it("refuses a verified finish and an ambiguous tool outcome, and rejects stale-epoch callbacks after recovery", async () => {
    const fixture = createFixture("running"), owner = await startOwner(fixture);
    const stale = authority(fixture.database.databasePath);
    const original = (await stale.load(fixture.runId))!;
    await stopChild(owner);
    // Fault fixtures deliberately inject a normalized pending tool receipt; a
    // receipt-free provider wait is cancellable, an unknown mutation is not.
    const inputHash = HASH, now = new Date().toISOString();
    await stale.appendToolOperationReceipt({
      schemaVersion: 2, receiptId: `tool:${fixture.runId}`, runId: fixture.runId, bindingId: fixture.binding.bindingId,
      sessionEpoch: 1, externalCallId: "pending-tool", toolName: "vdt.add_driver", argsHash: inputHash,
      state: "in_flight", idempotencyKey: "pending-tool-key", resultHash: null, resultCode: null, expectedRevision: 1, committedRevision: null,
      startedAt: now, updatedAt: now
    });
    const recovering = authority(fixture.database.databasePath);
    await expect(recovering.cancelOrphanedRun(fixture.runId)).rejects.toMatchObject({ code: "MODEL_AGENT_RECOVERY_AMBIGUOUS" });
    // A separate safe fixture exercises old callback rejection without clearing
    // the ambiguous receipt or pretending that it completed.
    const safe = createFixture("running"), safeOwner = await startOwner(safe), oldWriter = authority(safe.database.databasePath);
    const safeOriginal = (await oldWriter.load(safe.runId))!;
    await stopChild(safeOwner);
    const recovered = authority(safe.database.databasePath);
    await recovered.cancelOrphanedRun(safe.runId);
    await expect(oldWriter.saveCheckpoint({ ...safeOriginal.checkpoint!, checkpointId: `stale:${safe.runId}`, createdAt: new Date(Date.now() + 100).toISOString() })).rejects.toMatchObject({ code: "SESSION_EPOCH_MISMATCH" });
    await expect(new AgentRunEventOutbox(safe.runId, { initialEvents: (await recovered.load(safe.runId))!.eventOutbox,
      sink: { append: event => oldWriter.appendEvent(event) } }).append({ type: "runtime_status", source: "runtime", payload: { code: "LATE_RESULT", message: "late" } })).rejects.toMatchObject({ code: "SESSION_EPOCH_MISMATCH" });

    const finished = createFixture("running"), finishedOwner = await startOwner(finished), finishedWriter = authority(finished.database.databasePath);
    await finishedWriter.appendFinishReceipt({
      schemaVersion: 2, receiptId: `finish:${finished.runId}`, runId: finished.runId, bindingId: finished.binding.bindingId,
      sessionEpoch: 1, state: "verified", projectRevision: 1, projectHash: HASH, receiptHash: HASH, validationHash: HASH, calculationHash: HASH,
      verifiedAt: now, finalMessageHash: null, finalPersistedAt: null
    });
    await stopChild(finishedOwner);
    await expect(finishedWriter.cancelOrphanedRun(finished.runId)).rejects.toMatchObject({ code: "MODEL_AGENT_FINAL_COMMITTED" });
    expect(original.binding.sessionEpoch).toBe(1);
  });
});

function createFixture(status: VdtAgentRunStatus) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vdt-w1-orphan-"));
  directories.push(directory);
  const database = openVdtDatabase(process.cwd(), { dataDir: directory });
  connections.push(database);
  const projectId = `project_${randomUUID()}`;
  const store = new AgentRunStore({ persistence: createSqliteAgentRunPersistence(database, {
    actorFactory: id => createStorageWriteActor(id, { env: { VDT_APP_MODE: "development_web" } })
  }) });
  const state = store.createRun({ mode: "generate_vdt", providerId: "model_agent", executionBindingId: "test-recovery",
    input: { rootKpi: "Revenue", prompt: "Preserve this saved draft." }, workspace: { projectId } });
  const builder = new VdtBuilderSession();
  builder.createDraft({ projectTitle: "Preserved recovery draft", rootKpi: "Revenue", unit: "USD" });
  builder.addDriver({ parentNodeId: "revenue", nodeId: "sold", name: "Sales", unit: "USD" });
  builder.setFormula({ nodeId: "sold", formula: "42" });
  builder.setFormula({ nodeId: "revenue", formula: "sold" });
  const draft = builder.getProject();
  store.updateRun(state.runId, { status, phase: "building_graph", draftProject: draft,
    ...(status === "needs_user_input" ? { pendingQuestions: [{ id: "period", question: "Which period?", reason: "Time basis", required: true, expectedAnswerType: "text" as const }] } : {}) });
  const binding: AgentSessionBinding = { schemaVersion: 2, bindingId: `binding:${state.runId}`, runId: state.runId, projectId,
    executionProfile: "model_agent", engineId: "in-product-model-agent", engineAdapterId: "http-structured-turn-test-v1", backendId: "openai_compatible", modelId: "test-model", protocolVersion: "structured-turn-v1", cliVersion: null,
    toolIsolation: "permission_only", qualificationStatus: "unverified", capabilityEvidenceHash: null,
    settingsHash: HASH, capabilityProfileHash: HASH, toolCatalogHash: HASH, externalSessionId: null, sessionEpoch: 1, boundAt: new Date().toISOString() };
  return { database, store, runId: state.runId, binding };
}

function authority(databasePath: string, options: ConstructorParameters<typeof SqliteAgentSupervisorPersistence>[1] = {}) {
  const value = new SqliteAgentSupervisorPersistence(databasePath, options);
  connections.push(value);
  return value;
}

function graphEvidence(database: VdtDatabase, runId: string) {
  const db = new DatabaseSync(database.databasePath);
  try {
    return { revisions: db.prepare("SELECT * FROM vdt_revisions ORDER BY id").all(), heads: db.prepare("SELECT * FROM vdt_revision_heads ORDER BY vdt_id").all(), commits: db.prepare("SELECT * FROM revision_commit_records ORDER BY rowid").all(), draft: (database.getAgentRun(runId)?.internalState?.snapshot as Record<string, unknown>)?.draftProject };
  } finally { db.close(); }
}

function child(fixture: ReturnType<typeof createFixture>, action: "own" | "recover") {
  const value = spawn(process.execPath, ["--import", "tsx", path.resolve("apps/web/app/api/agent/runs/fixtures/supervisor-orphan-child.ts"), fixture.database.databasePath, JSON.stringify(fixture.binding), action], {
    cwd: process.cwd(), env: { ...process.env, TSX_TSCONFIG_PATH: path.resolve("apps/web/tsconfig.json") }, stdio: ["pipe", "pipe", "pipe"]
  });
  children.add(value);
  return value;
}

async function startOwner(fixture: ReturnType<typeof createFixture>) {
  const value = child(fixture, "own");
  const result = await firstLine(value);
  expect(result).toEqual({ ready: true });
  return value;
}

async function runRecoveryChild(fixture: ReturnType<typeof createFixture>) {
  const value = child(fixture, "recover");
  const result = await firstLine(value);
  await exited(value);
  expect(value.exitCode, JSON.stringify(result)).toBe(0);
  return result;
}

function firstLine(value: ChildProcessWithoutNullStreams): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let stdout = "", stderr = "";
    const timeout = setTimeout(() => { value.kill("SIGKILL"); reject(new Error(`Child handshake timed out: ${stderr}`)); }, 10_000);
    value.stderr.on("data", chunk => { stderr += String(chunk); });
    value.stdout.on("data", chunk => {
      stdout += String(chunk);
      if (stdout.includes("\n")) {
        clearTimeout(timeout);
        try { resolve(JSON.parse(stdout.split("\n")[0]!)); } catch (error) { reject(error); }
      }
    });
    value.once("error", error => { clearTimeout(timeout); reject(error); });
    value.once("close", code => { clearTimeout(timeout); if (!stdout.includes("\n")) reject(new Error(`Child exited ${code}: ${stderr}`)); });
  });
}

async function stopChild(value: ChildProcessWithoutNullStreams) {
  if (value.exitCode === null && value.signalCode === null) { value.kill("SIGKILL"); await exited(value); }
}

function exited(value: ChildProcessWithoutNullStreams): Promise<void> {
  return value.exitCode !== null || value.signalCode !== null ? Promise.resolve() : new Promise(resolve => value.once("exit", () => resolve()));
}
