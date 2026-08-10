import { openBootstrapVdtDatabaseForTests } from "./sqlite-test-support";
import { VdtStorageError } from "./types";

const [projectRoot, dataDir, startAtText] = process.argv.slice(2);
if (!projectRoot || !dataDir || !startAtText) {
  throw new Error("Migration concurrency child requires projectRoot, dataDir, and startAt.");
}
const startAt = Number(startAtText);
if (!Number.isFinite(startAt)) throw new Error("Migration concurrency start time is invalid.");
if (Date.now() < startAt) {
  await new Promise((resolve) => setTimeout(resolve, startAt - Date.now()));
}
let db;
for (let attempt = 0; ; attempt += 1) {
  try {
    db = openBootstrapVdtDatabaseForTests(projectRoot, {
      dataDir,
      busyTimeoutMs: 2_000
    });
    break;
  } catch (error) {
    if (
      !(error instanceof VdtStorageError) ||
      error.code !== "MIGRATION_IN_PROGRESS" ||
      attempt >= 2
    ) {
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
db.close();
process.stdout.write('{"opened":true}\n');
