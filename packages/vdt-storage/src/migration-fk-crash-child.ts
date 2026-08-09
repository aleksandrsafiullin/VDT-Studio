import { DatabaseSync } from "node:sqlite";
import {
  __runStorageMigrationsWithPlanForTests
} from "./migrations";
import {
  TEST_MIGRATION_PLAN_INVALID_DEFERRED_FK,
  TEST_MIGRATION_PLAN_VALID_DEFERRED_FK
} from "./migration-test-fixtures";
import type {
  StorageMigrationFaultContext,
  StorageMigrationFaultPoint
} from "./types";

const [databasePath, dataDir, faultPointText, planKind] =
  process.argv.slice(2);
if (
  !databasePath ||
  !dataDir ||
  !faultPointText ||
  (planKind !== "invalid" && planKind !== "valid")
) {
  throw new Error(
    "Foreign-key crash child requires databasePath, dataDir, faultPoint, and invalid|valid."
  );
}
const faultPoint = faultPointText as StorageMigrationFaultPoint;
const allowed = new Set<StorageMigrationFaultPoint>([
  "after_foreign_key_pending_created",
  "after_foreign_key_pending_file_fsynced",
  "after_foreign_key_pending_fsynced",
  "after_foreign_key_check_passed",
  "after_foreign_key_pending_unlinked",
  "after_foreign_key_violation_rollback",
  "after_foreign_key_evidence_created",
  "after_foreign_key_evidence_file_fsynced",
  "after_foreign_key_evidence_fsynced",
  "before_foreign_key_block_commit",
  "after_foreign_key_block_committed"
]);
if (!allowed.has(faultPoint)) {
  throw new Error(
    "Foreign-key crash child received an invalid fault boundary."
  );
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
        if (point === faultPoint && context?.sequence === 3) {
          process.kill(process.pid, "SIGKILL");
        }
      }
    },
    planKind === "invalid"
      ? TEST_MIGRATION_PLAN_INVALID_DEFERRED_FK
      : TEST_MIGRATION_PLAN_VALID_DEFERRED_FK
  );
} finally {
  db.close();
}
throw new Error(
  `Foreign-key fault point did not terminate the child: ${faultPoint}.`
);
