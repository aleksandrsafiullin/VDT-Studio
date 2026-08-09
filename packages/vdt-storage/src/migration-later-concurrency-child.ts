import { DatabaseSync } from "node:sqlite";
import {
  __runStorageMigrationsWithPlanForTests
} from "./migrations";
import { TEST_MIGRATION_PLAN_4 } from "./migration-test-fixtures";
import { VdtStorageError } from "./types";

const [databasePath, dataDir, startAtText] = process.argv.slice(2);
if (!databasePath || !dataDir || !startAtText) {
  throw new Error(
    "Later migration concurrency child requires databasePath, dataDir, and startAt."
  );
}
const startAt = Number(startAtText);
if (!Number.isFinite(startAt)) {
  throw new Error("Later migration concurrency start time is invalid.");
}
while (Date.now() < startAt) {
  // Deliberately align independent processes at the admission boundary.
}
const deadline = Date.now() + 30_000;
const sleeper = new Int32Array(
  new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
);
for (;;) {
  const db = new DatabaseSync(databasePath, { timeout: 100 });
  try {
    __runStorageMigrationsWithPlanForTests(
      db,
      dataDir,
      {
        now: () => new Date().toISOString(),
        busyTimeoutMs: 100,
        leaseMs: 30_000
      },
      TEST_MIGRATION_PLAN_4
    );
    break;
  } catch (error) {
    if (
      !(error instanceof VdtStorageError) ||
      error.code !== "MIGRATION_IN_PROGRESS" ||
      Date.now() >= deadline
    ) {
      throw error;
    }
  } finally {
    db.close();
  }
  Atomics.wait(sleeper, 0, 0, 25);
}
