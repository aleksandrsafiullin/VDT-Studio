import { DatabaseSync } from "node:sqlite";
import type {
  StorageMigrationFaultContext,
  StorageMigrationFaultPoint
} from "./types";
import {
  __runStorageMigrationsWithPlanForTests
} from "./migrations";
import { TEST_MIGRATION_PLAN_4 } from "./migration-test-fixtures";

const [databasePath, dataDir, faultPointText, sequenceText] =
  process.argv.slice(2);
if (!databasePath || !dataDir || !faultPointText || !sequenceText) {
  throw new Error(
    "Later migration crash child requires databasePath, dataDir, faultPoint, and sequence."
  );
}
const faultPoint = faultPointText as StorageMigrationFaultPoint;
const sequence = Number(sequenceText);
const allowed = new Set<StorageMigrationFaultPoint>([
  "after_admission_fence_acquired",
  "after_later_backup_owner_fsynced",
  "after_later_backup_fsynced",
  "after_later_attempt_reserved",
  "after_later_applying_persisted",
  "before_later_migration_commit",
  "after_later_migration_committed"
]);
if (!allowed.has(faultPoint) || !Number.isSafeInteger(sequence)) {
  throw new Error("Later migration crash child received an invalid fault boundary.");
}

const db = new DatabaseSync(databasePath, { timeout: 30_000 });
try {
  __runStorageMigrationsWithPlanForTests(
    db,
    dataDir,
    {
      now: () => new Date().toISOString(),
      busyTimeoutMs: 30_000,
      leaseMs: 0,
      faultInjector(
        point: StorageMigrationFaultPoint,
        context?: StorageMigrationFaultContext
      ) {
        if (
          point === faultPoint &&
          (point === "after_admission_fence_acquired" ||
            context?.sequence === sequence)
        ) {
          process.kill(process.pid, "SIGKILL");
        }
      }
    },
    TEST_MIGRATION_PLAN_4
  );
} finally {
  db.close();
}
throw new Error(
  `Later migration fault point did not terminate the child: ${faultPoint} sequence ${sequence}.`
);
