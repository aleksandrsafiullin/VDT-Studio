import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { __runBootstrapStorageMigrationsForTests } from "./migrations";
import { assertInside, ensureProjectLocation } from "./project-files";
import { SqliteVdtDatabase } from "./sqlite";
import type {
  OpenVdtDatabaseOptions,
  VdtDatabase
} from "./types";

/** Internal V1 bootstrap opener for migration regression tests only. */
export function openBootstrapVdtDatabaseForTests(
  projectRoot: string,
  options: OpenVdtDatabaseOptions = {}
): VdtDatabase {
  const dataDir = ensureProjectLocation(
    options.dataDir ?? process.env.VDT_DATA_DIR ?? path.join(projectRoot, ".vdt")
  );
  const databasePath = path.join(dataDir, "app.sqlite");
  assertInside(dataDir, databasePath);
  const db = new DatabaseSync(databasePath, {
    timeout: options.busyTimeoutMs ?? 5_000
  });
  try {
    __runBootstrapStorageMigrationsForTests(db, dataDir, {
      now: options.now ?? (() => new Date().toISOString()),
      busyTimeoutMs: options.busyTimeoutMs ?? 5_000,
      leaseMs: options.migrationLeaseMs ?? 30_000,
      idFactory: options.idFactory,
      ownerTokenFactory: options.ownerTokenFactory,
      faultInjector: options.migrationFaultInjector
    });
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA foreign_keys = ON;");
    const result = new SqliteVdtDatabase(db, dataDir, databasePath, options);
    result.recoverRevisionCommits();
    return result;
  } catch (error) {
    db.close();
    throw error;
  }
}
