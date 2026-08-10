import { openBootstrapVdtDatabaseForTests } from "./sqlite-test-support";
import type { StorageMigrationFaultPoint } from "./types";

const [projectRoot, dataDir, faultPointText] = process.argv.slice(2);
if (!projectRoot || !dataDir || !faultPointText) {
  throw new Error("Migration crash child requires projectRoot, dataDir, and faultPoint.");
}
const migrationFaultPoints = new Set<StorageMigrationFaultPoint>([
  "after_admission_fence_acquired",
  "after_backup_fsynced",
  "after_bootstrap_journal_fsynced",
  "after_sequence_1_committed",
  "before_sequence_2_commit",
  "after_sequence_2_committed"
]);
if (!migrationFaultPoints.has(faultPointText as StorageMigrationFaultPoint)) {
  throw new Error(`Unknown migration fault point: ${faultPointText}.`);
}
const faultPoint = faultPointText as StorageMigrationFaultPoint;
openBootstrapVdtDatabaseForTests(projectRoot, {
  dataDir,
  migrationLeaseMs: 0,
  migrationFaultInjector(point) {
    if (point === faultPoint) {
      process.kill(process.pid, "SIGKILL");
    }
  }
});
throw new Error(`Migration fault point did not terminate the child: ${faultPoint}.`);
