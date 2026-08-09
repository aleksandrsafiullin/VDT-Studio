import fs from "node:fs";
import path from "node:path";
import { openVdtDatabase, VdtStorageError } from "./index";
import type { RevisionCommitInputV2 } from "./types";

const [dataDir, payloadPath, workerText, countText, startAtText] = process.argv.slice(2);
if (!dataDir || !payloadPath || !workerText || !countText || !startAtText) {
  throw new Error("Concurrency child requires dataDir, payloadPath, worker, count, and startAt.");
}
const worker = Number(workerText);
const count = Number(countText);
const startAt = Number(startAtText);
if (![worker, count, startAt].every(Number.isFinite)) {
  throw new Error("Concurrency child received invalid numeric arguments.");
}
const project = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
if (Date.now() < startAt) {
  await new Promise((resolve) => setTimeout(resolve, startAt - Date.now()));
}

let committed = 0;
let conflicts = 0;
for (let index = 0; index < count; index += 1) {
  const db = openVdtDatabase(path.dirname(dataDir), {
    dataDir,
    busyTimeoutMs: 30_000,
    revisionLeaseMs: 30_000
  });
  const input: RevisionCommitInputV2 = {
    projectId: "project_concurrent",
    vdtId: "vdt_concurrent",
    actor: {
      schemaVersion: "actor_context.v1",
      principalId: "desktop_local_principal",
      projectId: "project_concurrent",
      roles: [],
      authSource: "desktop_local",
      sessionId: `worker_${worker}`,
      issuedAt: "2026-07-23T00:00:00.000Z"
    },
    command: {
      schemaVersion: "revision_commit.v2",
      expectedActiveRevisionId: null,
      expectedActiveContentIdentity: null,
      expectedCommitGeneration: 0,
      expectedRuntimeGeneration: "v1",
      expectedGenerationVersion: 1,
      idempotencyKey: `worker_${worker}_attempt_${index}`,
      intent: {
        source: "user",
        summary: null,
        validation: null,
        calculation: null
      }
    },
    project
  };
  try {
    db.commitVdtRevision(input);
    committed += 1;
  } catch (error) {
    if (error instanceof VdtStorageError && error.code === "REVISION_CONFLICT") {
      conflicts += 1;
    } else {
      db.close();
      throw error;
    }
  }
  db.close();
}

process.stdout.write(`${JSON.stringify({ committed, conflicts, count })}\n`);
