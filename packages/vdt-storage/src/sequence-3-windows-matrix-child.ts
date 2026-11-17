import fs from "node:fs";
import path from "node:path";
import { canonicalizeJson, hashFramed } from "./canonical";
import { DatabaseSync } from "node:sqlite";
import { __runBootstrapStorageMigrationsForTests, __runSequence3StorageMigrationsForNativeTests, __runSequence3StorageMigrationsForTests } from "./migrations";
import { acquireWindowsStorageProfile, openWindowsStorage } from "./windows-storage";
import { openVdtDatabase } from "./sqlite";
import { VdtStorageError } from "./types";
import { assertMatrixAdoptionBoundary, injectMatrixCondition, MATRIX_MANIFEST, MATRIX_NOW, MATRIX_REOPEN, seedMatrixLegacyRuns } from "./sequence-3-windows-matrix-fixtures";
import { inspectMatrixArtifacts, observeMatrixDatabase, observeMatrixDirectory, verifyMatrixNativeNamespace } from "./sequence-3-windows-matrix-observe";

const [runtime, root, mode, fixture, fault, index, handshake] = process.argv.slice(2);
const smoke = process.platform === "darwin" && runtime === "--mac-smoke";
if ((!smoke && process.platform !== "win32") || !runtime || !root || !mode || !fixture) throw new Error("Expected Windows matrix or explicit Mac smoke arguments");
if (smoke && mode === "seed") fs.mkdirSync(root, { mode: 0o700 });
const unsupportedOperation = fixture === "windows_unsupported" && ["execute", "reopen", "final"].includes(mode);
const acquired = smoke || unsupportedOperation ? undefined
  : acquireWindowsStorageProfile(root, () => openWindowsStorage(runtime, root, mode === "seed"));
if (unsupportedOperation) {
  try {
    const database = openVdtDatabase(path.dirname(root), { dataDir: root });
    database.close();
    throw new Error("An unadmitted Windows profile was opened");
  } catch (error) {
    if (!(error instanceof VdtStorageError)) throw error;
    console.log(JSON.stringify({ kind: "storage_error", code: error.code, retryable: error.retryable, message: error.message, pid: process.pid }));
    process.exit(1);
  }
}
const db = new DatabaseSync(acquired?.directory.sqlitePath() ?? path.join(root, "app.sqlite"),
  { timeout: 5_000, readOnly: mode === "inspect" });
let identifier = 0;
const options = {
  now: () => (mode === "reopen" || mode === "final" || mode === "execute" && ["backup_failure", "artifact_checksum_mismatch"].includes(fixture)) && fixture !== "stale_owner_takeover" ? MATRIX_REOPEN : MATRIX_NOW,
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
  } else if (mode === "corrupt_backup") {
    const row = db.prepare(`SELECT b.backup_relative_path FROM migration_backup_evidence b
      JOIN migration_attempts a ON a.backup_evidence_id=b.backup_evidence_id
      WHERE a.target_manifest_hash=? AND a.status='applying'`).get(MATRIX_MANIFEST);
    const relative = String(row?.backup_relative_path ?? "");
    const names = relative.split(/[\\/]/);
    if (names.length !== 4 || names[0] !== "migrations" || names[1] !== "backups" ||
        !/^\.later-owned-[A-Za-z0-9_-]+$/.test(names[2]!) || names[3] !== "backup.sqlite") {
      throw new Error("Fixture does not own the reserved backup path");
    }
    const filename = path.join(root, ...names);
    const bytes = fs.readFileSync(filename);
    bytes[0] = (bytes[0] ?? 0) ^ 0xff;
    fs.writeFileSync(filename, bytes, { flag: "r+" });
  } else if (mode === "inspect") {
    observation = observeMatrixDatabase(db);
  } else {
    const migrationOptions = {
      ...options,
      faultInjector(point: import("./types").StorageMigrationFaultPoint, context?: import("./types").StorageMigrationFaultContext) {
        if (mode === "execute" && point === "after_later_applying_persisted" && fixture === "applied_prefix_mismatch") {
          db.exec("UPDATE applied_migrations SET migration_id='003-durable-agent-run-coordination' WHERE sequence=2");
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
          const name = `${hash.slice(7)}.pending.json`;
          if (acquired) {
            const migrations = acquired.directory.openChild("migrations");
            try {
              const blocks = migrations.openChild("migration-blocks");
              try { blocks.writeExclusive(name, Buffer.from("{")); }
              finally { blocks.close(); }
            } finally { migrations.close(); }
          } else {
            fs.writeFileSync(path.join(root, "migrations", "migration-blocks", name), "{", { flag: "wx", mode: 0o600 });
          }
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
    };
    if (smoke) __runSequence3StorageMigrationsForTests(db, root, migrationOptions);
    else __runSequence3StorageMigrationsForNativeTests(db, root, migrationOptions, {
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
  acquired?.release();
}
if (observation) {
  const directoryEntries = observeMatrixDirectory(root);
  if (!smoke) {
    const native = openWindowsStorage(runtime, root);
    try { verifyMatrixNativeNamespace(native, directoryEntries); }
    finally { native.close(); }
  }
  console.log(JSON.stringify({ ...observation, directoryEntries, artifacts: inspectMatrixArtifacts(root, directoryEntries),
    nativeNamespaceVerified: !smoke, pid: process.pid }));
}
