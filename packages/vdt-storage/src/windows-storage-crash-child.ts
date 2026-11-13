import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { __runStorageMigrationsWithPlanForTests } from "./migrations";
import { TEST_MIGRATION_PLAN_INVALID_DEFERRED_FK } from "./migration-test-fixtures";
import { acquireWindowsStorageProfile, openWindowsStorage } from "./windows-storage";
import { productionVolumeProject } from "@vdt-studio/vdt-core";
import { __openWindowsVdtDatabaseForTests } from "./sqlite";

const [runtime, dataDir, fault, readyFile] = process.argv.slice(2);
if (!runtime || !dataDir || !fault || !readyFile || process.platform !== "win32") {
  throw new Error("Expected native Windows crash test arguments.");
}
const frozenNow = "2026-11-13T00:00:00.000Z";

function reached(point: string): void {
  if (point !== fault) return;
  fs.writeFileSync(readyFile!, point, { flag: "wx" });
  // Let the parent terminate this process while the exact fault boundary and
  // its open SQLite/filesystem handles are still live.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
}

if (fault.startsWith("invalid:")) {
  const boundary = fault.slice("invalid:".length);
  const profile = acquireWindowsStorageProfile(dataDir, () => openWindowsStorage(runtime, dataDir, true));
  const database = new DatabaseSync(profile.directory.sqlitePath());
  try {
    __runStorageMigrationsWithPlanForTests(database, dataDir, {
      now: () => frozenNow, busyTimeoutMs: 5_000, leaseMs: 0,
      faultInjector(point, context) {
        if (point === boundary && context?.sequence === 3) reached(fault);
      }
    }, TEST_MIGRATION_PLAN_INVALID_DEFERRED_FK);
  } finally {
    database.close();
    profile.release();
  }
  throw new Error(`Fault boundary was not reached: ${fault}`);
}

const database = __openWindowsVdtDatabaseForTests(path.dirname(dataDir), {
  dataDir,
  now: () => frozenNow,
  revisionLeaseMs: 0,
  migrationLeaseMs: 0,
  faultInjector: reached,
  migrationFaultInjector(point, context) {
    if (fault.startsWith("sequence3_") && context?.sequence !== 3) return;
    reached(point);
  }
}, runtime);
try {
  const projectId = "native";
  const vdtId = "tree";
  const head = database.getVdtRevisionHead(vdtId);
  const state = database.getProjectRuntimeState(projectId);
  if (!head || !state) throw new Error(`Fault boundary was not reached: ${fault}`);
  database.commitVdtRevision({
    projectId, vdtId,
    actor: {
      schemaVersion: "actor_context.v1", principalId: "desktop_native_test", projectId,
      roles: ["vdt_writer"], authSource: "desktop_local", sessionId: "crash_child",
      issuedAt: "2026-11-13T00:00:00.000Z"
    },
    command: {
      schemaVersion: "revision_commit.v2", expectedActiveRevisionId: head.activeRevisionId,
      expectedActiveContentIdentity: head.activeContentIdentity, expectedCommitGeneration: head.commitGeneration,
      expectedRuntimeGeneration: state.runtimeGeneration, expectedGenerationVersion: state.generationVersion,
      idempotencyKey: `native-crash-${fault}`,
      intent: { source: "user", summary: "Native crash test", validation: null, calculation: null }
    },
    project: productionVolumeProject
  });
  throw new Error(`Fault boundary was not reached: ${fault}`);
} finally {
  database.close();
}
