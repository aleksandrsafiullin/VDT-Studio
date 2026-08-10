import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { hashFramed } from "./canonical";
import { __sequence3AssetReadCountsForTests } from "./sequence-3-assets";
import {
  __assertSequence3PlatformCapabilityForTests,
  __createStorageMigrationPlanForTests,
  __runStorageMigrationsForPlatformTests,
  __runStorageMigrationsWithPlanForTests,
  runStorageMigrations
} from "./migrations";
import type {
  JsonValue,
  StorageMigrationFaultContext,
  StorageMigrationFaultPoint
} from "./types";
import { VdtStorageError } from "./types";

const V1_MANIFEST_HASH =
  "sha256:f36158d9e2783a8cd1a9bd41f7d22da1d425a296dec95c8d272bb8fd789686ad";
const V2_MANIFEST_HASH =
  "sha256:791fc7c7cce9abd11b2509ddaa6ba9e92e469178a3d1add6803b083295c849e8";
const V1_PLAN = __createStorageMigrationPlanForTests({
  entries: [],
  expectedManifestHash: V1_MANIFEST_HASH
});
const NOW = "2026-07-31T10:00:00.000Z";
const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) {
    fs.rmSync(roots.pop()!, { recursive: true, force: true });
  }
});

describe("Gate R2 Sequence 3 production migration", () => {
  it(
    "migrates an exact empty v2 database to v3 and reopens idempotently",
    () => {
      const fixture = createV2Fixture();
      const vectorReadsBefore = __sequence3AssetReadCountsForTests().vectors;
      runProduction(fixture);
      expect(__sequence3AssetReadCountsForTests().vectors).toBe(vectorReadsBefore);
      const first = readSequence3Evidence(fixture.databasePath);
      expect(first.version).toBe(3);
      expect(first.state).toEqual({
        manifest_hash: V2_MANIFEST_HASH,
        current_user_version: 3,
        last_applied_sequence: 3,
        status: "ready",
        blocked_reason: null
      });
      expect(first.appliedCount).toBe(3);
      expect(first.transformCount).toBe(1);
      expect(first.adoptionCount).toBe(0);
      expect(first.applicationId).toMatch(/^migration_application_[0-9a-f]{64}$/);
      expect(first.applicationId).toBe(recomputeApplicationId(first.application!));

      runProduction(fixture);
      expect(readSequence3Evidence(fixture.databasePath)).toEqual(first);
    },
    60_000
  );

  it("allows post-migration agent runs without changing frozen adoption evidence", () => {
    const fixture = createV2Fixture();
    runProduction(fixture);
    const migrationEvidence = readSequence3Evidence(fixture.databasePath);

    insertPostMigrationRun(fixture.databasePath);
    expect(readRunAndAdoptionCounts(fixture.databasePath)).toEqual({
      agentRuns: 1,
      adoptions: 0
    });

    runProduction(fixture);
    expect(readSequence3Evidence(fixture.databasePath)).toEqual(
      migrationEvidence
    );
    expect(readRunAndAdoptionCounts(fixture.databasePath)).toEqual({
      agentRuns: 1,
      adoptions: 0
    });
  });

  it("adopts populated legacy rows child-first with deterministic hashes and row contexts", () => {
    const first = createV2Fixture();
    const second = createV2Fixture();
    populateLegacyRuns(first.databasePath);
    populateLegacyRuns(second.databasePath);
    const rowContexts: Array<{
      point: StorageMigrationFaultPoint;
      context: StorageMigrationFaultContext | undefined;
    }> = [];
    runProduction(first, (point, context) => {
      if (
        point === "sequence3_before_adoption_row_insert" ||
        point === "sequence3_after_adoption_row_insert"
      ) {
        rowContexts.push({ point, context });
      }
    });
    runProduction(second);

    const firstEvidence = readSequence3Evidence(first.databasePath);
    const secondEvidence = readSequence3Evidence(second.databasePath);
    expect(firstEvidence.applicationId).toBe(secondEvidence.applicationId);
    expect(firstEvidence.transformResultHash).toBe(
      secondEvidence.transformResultHash
    );
    expect(firstEvidence.adoptionCount).toBe(2);
    expect(readAdoptions(first.databasePath)).toEqual([
      {
        run_id: "run_a",
        original_status: "succeeded",
        disposition: "retained_terminal",
        projected_status: "succeeded"
      },
      {
        run_id: "run_b",
        original_status: "running",
        disposition: "interrupted_nonterminal",
        projected_status: "interrupted_legacy"
      }
    ]);
    expect(
      rowContexts.map(({ point, context }) => ({
        point,
        adoptionIndex: context?.adoptionIndex,
        inputLegacyRunCount: context?.inputLegacyRunCount,
        runId: context?.runId
      }))
    ).toEqual([
      {
        point: "sequence3_before_adoption_row_insert",
        adoptionIndex: 0,
        inputLegacyRunCount: 2,
        runId: "run_a"
      },
      {
        point: "sequence3_after_adoption_row_insert",
        adoptionIndex: 0,
        inputLegacyRunCount: 2,
        runId: "run_a"
      },
      {
        point: "sequence3_before_adoption_row_insert",
        adoptionIndex: 1,
        inputLegacyRunCount: 2,
        runId: "run_b"
      },
      {
        point: "sequence3_after_adoption_row_insert",
        adoptionIndex: 1,
        inputLegacyRunCount: 2,
        runId: "run_b"
      }
    ]);
  });

  it("rolls back Sequence 3 and durably maps invalid legacy evidence to postcondition_failed", () => {
    const fixture = createV2Fixture();
    populateLegacyRuns(fixture.databasePath, true);
    let caught: unknown;
    try {
      runProduction(fixture);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(VdtStorageError);
    expect((caught as VdtStorageError).code).toBe(
      "MIGRATION_RECOVERY_REQUIRED"
    );
    expect((caught as VdtStorageError).retryable).toBe(false);
    const db = new DatabaseSync(fixture.databasePath);
    expect(db.prepare("PRAGMA user_version").get()).toEqual({
      user_version: 2
    });
    expect(
      db.prepare(
        "SELECT status, blocked_reason FROM migration_state"
      ).get()
    ).toEqual({ status: "blocked", blocked_reason: "postcondition_failed" });
    expect(
      db.prepare(
        "SELECT status FROM migration_attempts WHERE target_manifest_hash = ?"
      ).get(V2_MANIFEST_HASH)
    ).toEqual({ status: "blocked" });
    expect(
      db.prepare(
        "SELECT COUNT(*) AS count FROM sqlite_schema WHERE name = 'migration_transform_applications_v1'"
      ).get()
    ).toEqual({ count: 0 });
    db.close();
  });

  it("observes the exact empty-input Sequence 3 transaction and latch order", () => {
    const fixture = createV2Fixture();
    const points: StorageMigrationFaultPoint[] = [];
    runProduction(fixture, (point) => points.push(point));
    expect(points).toEqual([
      "after_admission_fence_acquired",
      "after_later_backup_owner_fsynced",
      "after_later_backup_fsynced",
      "after_later_attempt_reserved",
      "after_later_applying_persisted",
      "sequence3_before_sql",
      "sequence3_after_sql",
      "sequence3_before_transform_invocation",
      "sequence3_after_transform_invocation",
      "sequence3_after_all_adoptions_verified",
      "sequence3_before_transform_application_insert",
      "sequence3_after_transform_application_insert",
      "sequence3_before_applied_migration_insert",
      "sequence3_after_applied_migration_insert",
      "sequence3_before_schema_migration_insert",
      "sequence3_after_schema_migration_insert",
      "sequence3_before_user_version_set",
      "sequence3_after_user_version_set",
      "sequence3_after_postcondition_verified",
      "sequence3_after_migration_state_advanced",
      "sequence3_after_attempt_completed",
      "before_later_migration_commit",
      "sequence3_before_foreign_key_pending_create",
      "after_foreign_key_pending_created",
      "sequence3_before_foreign_key_pending_file_fsync",
      "after_foreign_key_pending_file_fsynced",
      "sequence3_before_foreign_key_pending_directory_fsync",
      "after_foreign_key_pending_fsynced",
      "sequence3_before_foreign_key_check",
      "after_foreign_key_check_passed",
      "sequence3_before_foreign_key_pending_unlink",
      "after_foreign_key_pending_unlinked",
      "sequence3_before_foreign_key_pending_unlink_directory_fsync",
      "sequence3_after_foreign_key_pending_unlink_directory_fsynced",
      "after_later_migration_committed",
      "sequence3_before_post_commit_cleanup",
      "sequence3_after_post_commit_cleanup"
    ]);
  });

  it("fails win32 before touching the database or filesystem", () => {
    const root = tempRoot();
    const dataDir = path.join(root, "existing-data");
    fs.mkdirSync(dataDir);
    const databasePath = path.join(dataDir, "app.sqlite");
    const markerPath = path.join(dataDir, "marker.bin");
    fs.writeFileSync(markerPath, Buffer.from([0, 1, 2, 3]));
    const db = new DatabaseSync(databasePath);
    db.exec("CREATE TABLE sentinel(id TEXT PRIMARY KEY); INSERT INTO sentinel VALUES ('kept');");
    const before = db.prepare(
      "SELECT type, name, sql FROM sqlite_schema ORDER BY type, name"
    ).all();
    const beforeListing = fs.readdirSync(dataDir).sort();
    const beforeDatabaseHash = rawFileHash(databasePath);
    const beforeMarkerHash = rawFileHash(markerPath);
    let caught: unknown;
    try {
      __runStorageMigrationsForPlatformTests(
        db,
        dataDir,
        migrationOptions(),
        "win32"
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(VdtStorageError);
    expect(caught).toMatchObject({
      code: "STORAGE_CAPABILITY_UNSUPPORTED",
      retryable: false,
      message:
        "Sequence 3 migration requires reviewed Windows no-follow directory identity and durable directory fsync support."
    });
    expect(() =>
      __assertSequence3PlatformCapabilityForTests("win32")
    ).toThrowError(
      expect.objectContaining({
        code: "STORAGE_CAPABILITY_UNSUPPORTED",
        retryable: false
      })
    );
    expect(db.prepare("PRAGMA user_version").get()).toEqual({
      user_version: 0
    });
    expect(
      db.prepare(
        "SELECT type, name, sql FROM sqlite_schema ORDER BY type, name"
      ).all()
    ).toEqual(before);
    expect(fs.readdirSync(dataDir).sort()).toEqual(beforeListing);
    expect(rawFileHash(databasePath)).toBe(beforeDatabaseHash);
    expect(rawFileHash(markerPath)).toBe(beforeMarkerHash);
    db.close();
  });

  it("preserves the V1 Gate R1 fixture path at exact user_version 2", () => {
    const fixture = createV2Fixture();
    const db = new DatabaseSync(fixture.databasePath);
    expect(db.prepare("PRAGMA user_version").get()).toEqual({
      user_version: 2
    });
    expect(
      db.prepare(
        "SELECT sequence, manifest_hash FROM applied_migrations ORDER BY sequence"
      ).all()
    ).toEqual([
      { sequence: 1, manifest_hash: V1_MANIFEST_HASH },
      { sequence: 2, manifest_hash: V1_MANIFEST_HASH }
    ]);
    expect(
      db.prepare(
        "SELECT COUNT(*) AS count FROM sqlite_schema WHERE name = 'migration_transform_applications_v1'"
      ).get()
    ).toEqual({ count: 0 });
    db.close();
  });
});

function createV2Fixture(): {
  root: string;
  dataDir: string;
  databasePath: string;
} {
  const root = tempRoot();
  const dataDir = path.join(root, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const databasePath = path.join(dataDir, "app.sqlite");
  const db = new DatabaseSync(databasePath);
  try {
    __runStorageMigrationsWithPlanForTests(
      db,
      dataDir,
      migrationOptions("v1"),
      V1_PLAN
    );
  } finally {
    db.close();
  }
  return { root, dataDir, databasePath };
}

function runProduction(
  fixture: { dataDir: string; databasePath: string },
  faultInjector?: (
    point: StorageMigrationFaultPoint,
    context?: StorageMigrationFaultContext
  ) => void
): void {
  const db = new DatabaseSync(fixture.databasePath, { timeout: 30_000 });
  try {
    runStorageMigrations(db, fixture.dataDir, {
      ...migrationOptions("production"),
      faultInjector
    });
  } finally {
    db.close();
  }
}

function migrationOptions(namespace = "test") {
  let id = 0;
  let owner = 0;
  return {
    now: () => NOW,
    busyTimeoutMs: 30_000,
    leaseMs: 30_000,
    idFactory: () => `${namespace}_id_${++id}`,
    ownerTokenFactory: () => `${namespace}_owner_${++owner}`
  };
}

function populateLegacyRuns(databasePath: string, invalid = false): void {
  const db = new DatabaseSync(databasePath);
  try {
    db.exec("PRAGMA foreign_keys = ON;");
    db.prepare(`
      INSERT INTO projects
      (id, name, description, industry, metadata_json, created_at, updated_at)
      VALUES ('project_1', 'Project', NULL, NULL, NULL, 0, 30)
    `).run();
    db.prepare(`
      INSERT INTO project_runtime_states
      (project_id, schema_version, runtime_generation, generation_version,
       migration_state, write_state, updated_at)
      VALUES ('project_1', 'project_runtime_state.v1', 'v1', 0,
              'not_started', 'disabled', 30)
    `).run();
    db.prepare(`
      INSERT INTO agent_runs
      (id, project_id, vdt_id, conversation_id, status, phase, request_json,
       public_snapshot_json, internal_state_json, created_at, updated_at,
       completed_at)
      VALUES (?, 'project_1', NULL, NULL, ?, 'reporting', '{}', NULL, NULL,
              0, 10, 10)
    `).run("run_a", invalid ? "unknown" : "succeeded");
    if (!invalid) {
      db.prepare(`
        INSERT INTO agent_runs
        (id, project_id, vdt_id, conversation_id, status, phase, request_json,
         public_snapshot_json, internal_state_json, created_at, updated_at,
         completed_at)
        VALUES ('run_b', 'project_1', NULL, NULL, 'running',
                'applying_graph', '{"request":1}', '{"visible":true}', NULL,
                20, 30, NULL)
      `).run();
    }
  } finally {
    db.close();
  }
}

function insertPostMigrationRun(databasePath: string): void {
  const db = new DatabaseSync(databasePath);
  try {
    db.exec("PRAGMA foreign_keys = ON;");
    db.prepare(`
      INSERT INTO projects
      (id, name, description, industry, metadata_json, created_at, updated_at)
      VALUES ('project_post_migration', 'Post migration', NULL, NULL, NULL,
              40, 40)
    `).run();
    db.prepare(`
      INSERT INTO project_runtime_states
      (project_id, schema_version, runtime_generation, generation_version,
       migration_state, write_state, updated_at)
      VALUES ('project_post_migration', 'project_runtime_state.v1', 'v1', 1,
              'shadow_ready', 'enabled', 40)
    `).run();
    db.prepare(`
      INSERT INTO agent_runs
      (id, project_id, vdt_id, conversation_id, status, phase, request_json,
       public_snapshot_json, internal_state_json, created_at, updated_at,
       completed_at)
      VALUES ('run_post_migration', 'project_post_migration', NULL, NULL,
              'failed', 'reporting', '{}', NULL, NULL, 40, 50, 50)
    `).run();
  } finally {
    db.close();
  }
}

function readRunAndAdoptionCounts(databasePath: string): {
  agentRuns: number;
  adoptions: number;
} {
  const db = new DatabaseSync(databasePath);
  try {
    const row = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM agent_runs) AS agent_runs,
        (SELECT COUNT(*) FROM legacy_agent_run_adoptions_v1) AS adoptions
    `).get() as { agent_runs: number; adoptions: number };
    return {
      agentRuns: Number(row.agent_runs),
      adoptions: Number(row.adoptions)
    };
  } finally {
    db.close();
  }
}

function readSequence3Evidence(databasePath: string) {
  const db = new DatabaseSync(databasePath);
  try {
    const application = db.prepare(`
      SELECT database_id, migration_application_id, migration_attempt_id,
             backup_evidence_id, fence_owner_token, fence_lease_generation,
             target_manifest_hash, sequence, migration_id, sql_checksum,
             transform_id, transform_version, module_checksum,
             contract_checksum, golden_vectors_checksum,
             transform_result_hash
      FROM migration_transform_applications_v1
    `).get() as Record<string, unknown> | undefined;
    return {
      version: Number(
        (db.prepare("PRAGMA user_version").get() as { user_version: number })
          .user_version
      ),
      state: db.prepare(`
        SELECT manifest_hash, current_user_version, last_applied_sequence,
               status, blocked_reason FROM migration_state
      `).get(),
      appliedCount: Number(
        (
          db.prepare(
            "SELECT COUNT(*) AS count FROM applied_migrations"
          ).get() as { count: number }
        ).count
      ),
      transformCount: Number(
        (
          db.prepare(
            "SELECT COUNT(*) AS count FROM migration_transform_applications_v1"
          ).get() as { count: number }
        ).count
      ),
      adoptionCount: Number(
        (
          db.prepare(
            "SELECT COUNT(*) AS count FROM legacy_agent_run_adoptions_v1"
          ).get() as { count: number }
        ).count
      ),
      applicationId:
        application === undefined
          ? null
          : String(application.migration_application_id),
      transformResultHash:
        application === undefined
          ? null
          : String(application.transform_result_hash),
      application
    };
  } finally {
    db.close();
  }
}

function recomputeApplicationId(application: Record<string, unknown>): string {
  const hash = hashFramed(
    "vdt-studio/migration-application-identity",
    "migration_application_identity_hash.v1",
    {
      schemaVersion: "migration_application_identity.v1",
      databaseId: application.database_id,
      attemptId: application.migration_attempt_id,
      backupEvidenceId: application.backup_evidence_id,
      fenceOwnerToken: application.fence_owner_token,
      fenceLeaseGeneration: Number(application.fence_lease_generation),
      targetManifestHash: application.target_manifest_hash,
      sequence: 3,
      migrationId: application.migration_id,
      sqlChecksum: application.sql_checksum,
      transformId: application.transform_id,
      transformVersion: Number(application.transform_version),
      moduleChecksum: application.module_checksum,
      contractChecksum: application.contract_checksum,
      goldenVectorsChecksum: application.golden_vectors_checksum
    } as JsonValue
  );
  return `migration_application_${hash.slice("sha256:".length)}`;
}

function readAdoptions(databasePath: string) {
  const db = new DatabaseSync(databasePath);
  try {
    return db.prepare(`
      SELECT run_id, original_status, disposition, projected_status
      FROM legacy_agent_run_adoptions_v1 ORDER BY CAST(run_id AS BLOB)
    `).all();
  } finally {
    db.close();
  }
}

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vdt-sequence3-r2-"));
  roots.push(root);
  return root;
}

function rawFileHash(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}
