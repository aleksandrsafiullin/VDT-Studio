import fs from "node:fs";
import path from "node:path";
import { productionVolumeProject } from "@vdt-studio/vdt-core";
import { __openWindowsVdtDatabaseForTests } from "./sqlite";

const [runtime, dataDir, fault, readyFile] = process.argv.slice(2);
if (!runtime || !dataDir || !fault || !readyFile || process.platform !== "win32") {
  throw new Error("Expected native Windows crash test arguments.");
}
function reached(point: string): void {
  if (point !== fault) return;
  fs.writeFileSync(readyFile!, point, { flag: "wx" });
  // Let the parent terminate this process while the exact fault boundary and
  // its open SQLite/filesystem handles are still live.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
}

const database = __openWindowsVdtDatabaseForTests(path.dirname(dataDir), {
  dataDir,
  revisionLeaseMs: 0,
  migrationLeaseMs: 0,
  faultInjector: reached,
  migrationFaultInjector: reached
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
