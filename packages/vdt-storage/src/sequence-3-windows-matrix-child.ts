import fs from "node:fs";
import { canonicalizeJson, hashFramed } from "./canonical";
import { DatabaseSync } from "node:sqlite";
import { __runBootstrapStorageMigrationsForTests, __runSequence3StorageMigrationsForNativeTests, __runSequence3StorageMigrationsForTests } from "./migrations";
import { acquireWindowsStorageProfile, openWindowsStorage } from "./windows-storage";
import { VdtStorageError } from "./types";
import { assertMatrixAdoptionBoundary, injectMatrixCondition, MATRIX_NOW, MATRIX_REOPEN, seedMatrixLegacyRuns } from "./sequence-3-windows-matrix-fixtures";
import { inspectMatrixArtifacts, observeMatrixDatabase, observeMatrixDirectory } from "./sequence-3-windows-matrix-observe";

const [runtime, root, mode, fixture, fault, index, handshake] = process.argv.slice(2);
if (process.platform !== "win32" || !runtime || !root || !mode || !fixture) throw new Error("Expected Windows matrix arguments");
const acquired = acquireWindowsStorageProfile(root, () => openWindowsStorage(runtime, root, mode === "seed"));
const db = new DatabaseSync(acquired.directory.sqlitePath(), { timeout: 5_000, readOnly: mode === "inspect" || fixture === "windows_unsupported" && mode !== "seed" });
let identifier = 0;
const options = {
  now: () => (mode === "reopen" || mode === "final") && fixture !== "stale_owner_takeover" ? MATRIX_REOPEN : MATRIX_NOW,
  busyTimeoutMs: 5_000,
  leaseMs: 30_000,
  idFactory: () => `matrix_${mode}_${++identifier}`,
  ownerTokenFactory: () => `matrix_owner_${mode}_${++identifier}`
};
let observation: ReturnType<typeof observeMatrixDatabase> | undefined;
try {
  if (mode === "seed") {
    __runBootstrapStorageMigrationsForTests(db, root, options);
    seedMatrixLegacyRuns(db, fixture);
  } else if (mode === "inspect") {
    observation = observeMatrixDatabase(db);
  } else if (fixture === "windows_unsupported") {
    // Exercise the normal platform denial with actual Windows process.platform.
    __runSequence3StorageMigrationsForTests(db, root, options);
  } else {
    __runSequence3StorageMigrationsForNativeTests(db, root, {
      ...options,
      faultInjector(point, context) {
        if (mode === "execute" && point === "after_later_applying_persisted" && fixture === "applied_prefix_mismatch") {
          db.exec("UPDATE applied_migrations SET migration_id='matrix_prefix_mismatch' WHERE sequence=2");
        }
        if (mode === "execute" && point === "after_later_applying_persisted" && fixture === "schema_precondition_mismatch") {
          db.exec("CREATE TABLE matrix_unexpected_precondition(id TEXT)");
        }
        if (mode === "execute" && point === "after_later_applying_persisted" && fixture === "stale_owner_takeover") {
          db.exec("UPDATE migration_attempts SET owner_token='matrix_successor', lease_generation=lease_generation+1 WHERE status='applying'");
        }
        if (mode === "execute" && fixture === "pending_collision" && point === "sequence3_before_foreign_key_pending_create") {
          const row = db.prepare("SELECT database_id,attempt_id,owner_token,lease_generation,target_manifest_hash FROM migration_attempts WHERE attempt_id=?").get(context?.attemptId ?? "");
          if (!row) throw new Error("Missing active migration attempt");
          const identity = {
            schemaVersion: "migration_foreign_key_check_identity.v1", databaseId: String(row.database_id),
            attemptId: String(row.attempt_id), fenceOwnerToken: String(row.owner_token),
            fenceLeaseGeneration: Number(row.lease_generation), targetManifestHash: String(row.target_manifest_hash),
            sequence: 3, migrationId: "003-durable-agent-run-coordination"
          };
          const hash = hashFramed("vdt-studio/migration-foreign-key-check-identity", "migration_foreign_key_check_identity_hash.v1", {}, Buffer.from(canonicalizeJson(identity)));
          const migrations = acquired.directory.openChild("migrations");
          try {
            const blocks = migrations.openChild("migration-blocks");
            try { blocks.writeExclusive(`${hash.slice(7)}.pending.json`, Buffer.from("{")); }
            finally { blocks.close(); }
          } finally { migrations.close(); }
        }
        if (fixture === "foreign_key_violation" || fixture === "partial_evidence" && mode === "prepare" || mode === "execute") {
          injectMatrixCondition(db, fixture === "partial_evidence" && mode === "prepare" ? "foreign_key_violation" : fixture, point);
        }
        if ((mode !== "execute" && mode !== "prepare") || point !== fault || context?.sequence !== 3) return;
        if (index !== "none" && context?.adoptionIndex !== Number(index)) return;
        if (index !== "none") assertMatrixAdoptionBoundary(context, Number(index));
        if (!handshake) throw new Error("Crash handshake path absent");
        fs.writeFileSync(handshake, JSON.stringify({ pid: process.pid, point, adoptionIndex: context.adoptionIndex ?? null, context }), { flag: "wx" });
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
      }
    }, {
      corruptSqlChecksum: mode === "execute" && fixture === "artifact_checksum_mismatch",
      corruptVerifiedTransformApplicationId: mode === "execute" && fixture === "invalid_transform_output"
    });
  }
  if (mode !== "inspect") console.log(JSON.stringify({ kind: "success", pid: process.pid }));
} catch (error) {
  if (!(error instanceof VdtStorageError)) throw error;
  console.log(JSON.stringify({ kind: "storage_error", code: error.code, retryable: error.retryable, message: error.message, pid: process.pid }));
  process.exitCode = 1;
} finally {
  db.close();
  acquired.release();
}
if (observation) {
  const directoryEntries = observeMatrixDirectory(root);
  console.log(JSON.stringify({ ...observation, directoryEntries, artifacts: inspectMatrixArtifacts(root, directoryEntries), pid: process.pid }));
}
