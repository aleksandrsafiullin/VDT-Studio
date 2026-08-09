import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalizeJson, hashFramed } from "./canonical";
import * as storageApi from "./index";
import {
  ATOMIC_REVISION_SCHEMA_HASH,
  STORAGE_MIGRATION_MANIFEST,
  computeSchemaHash,
  openVdtDatabase,
  runStorageMigrations,
  VdtStorageError
} from "./index";
import {
  __createStorageMigrationPlanForTests,
  __runStorageMigrationsWithPlanForTests
} from "./migrations";
import {
  TEST_MIGRATION_PLAN_3,
  TEST_MIGRATION_PLAN_4,
  TEST_MIGRATION_PLAN_INVALID_DEFERRED_FK,
  TEST_MIGRATION_PLAN_VALID_DEFERRED_FK,
  TEST_INVALID_DEFERRED_FK_SCHEMA_HASH,
  TEST_INVALID_DEFERRED_FK_SCHEMA_SQL,
  TEST_SEQUENCE_3_ENTRY,
  TEST_SEQUENCE_3_MANIFEST_HASH,
  TEST_SEQUENCE_3_SCHEMA_HASH,
  TEST_SEQUENCE_4_ENTRY,
  TEST_SEQUENCE_4_MANIFEST_HASH,
  TEST_SEQUENCE_4_SCHEMA_HASH
} from "./migration-test-fixtures";
import type {
  JsonValue,
  Sha256,
  StorageMigrationFaultContext,
  StorageMigrationFaultPoint
} from "./types";
import type { StorageMigrationTestPlan } from "./migrations";

const tempDirs: string[] = [];
const BOOTSTRAP_MANIFEST_HASH =
  "sha256:f36158d9e2783a8cd1a9bd41f7d22da1d425a296dec95c8d272bb8fd789686ad";
const LEGACY_SQL = fs.readFileSync(
  new URL("./migrations/001-legacy-v1-bootstrap.sql", import.meta.url),
  "utf8"
);
const TEST_MIGRATION_PLAN_VERSION_7 =
  __createStorageMigrationPlanForTests({
    entries: [
      {
        sequence: 3,
        migrationId: "003-test-fixture-version-seven",
        fromUserVersion: 2,
        toUserVersion: 7,
        preconditionSchemaHash: ATOMIC_REVISION_SCHEMA_HASH,
        postconditionSchemaHash:
          "sha256:6707fc189532cdfecd7a883cf0f294cce7da43d2e33c542d44dc5e1facaf4c48",
        sqlBytes: TEST_SEQUENCE_3_ENTRY.sqlBytes,
        expectedChecksum:
          "sha256:deede7b7bf57e2f3be8839582cdfa4f65c8f3e8cd53a9c97fd154e8c216fd10d"
      }
    ],
    expectedManifestHash:
      "sha256:aa1353bb3fdb75d82fa27fd38b34e2ee18db2a5ea05cd9d866dfe5e67517f022"
  });
const TEST_MIGRATION_PLAN_SQL_FAILURE = singleEntryPlan({
  migrationId: "003-test-permanent-sql-failure",
  sqlBytes: Buffer.from("THIS IS NOT VALID SQLITE;\n", "utf8"),
  postconditionSchemaHash:
    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
});
const TEST_MIGRATION_PLAN_POSTCONDITION_FAILURE = singleEntryPlan({
  migrationId: "003-test-permanent-postcondition-failure",
  sqlBytes: Buffer.from(
    "CREATE TABLE migration_fixture_wrong_postcondition(id TEXT PRIMARY KEY);\n",
    "utf8"
  ),
  postconditionSchemaHash:
    "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
});
const TEST_MIGRATION_PLAN_MANY_INVALID_DEFERRED_FKS = singleEntryPlan({
  migrationId: "003-test-many-invalid-deferred-fks",
  sqlBytes: Buffer.from(
    [
      TEST_INVALID_DEFERRED_FK_SCHEMA_SQL,
      ...Array.from(
        { length: 55 },
        (_, index) =>
          `INSERT INTO migration_fk_child(id, parent_id) VALUES ('child_${String(
            55 - index
          ).padStart(2, "0")}', 'missing');`
      ),
      ""
    ].join("\n"),
    "utf8"
  ),
  postconditionSchemaHash: TEST_INVALID_DEFERRED_FK_SCHEMA_HASH
});
const TEST_MIGRATION_PLAN_INT64_INVALID_DEFERRED_FK = singleEntryPlan({
  migrationId: "003-test-int64-invalid-deferred-fk",
  sqlBytes: Buffer.from(
    [
      TEST_INVALID_DEFERRED_FK_SCHEMA_SQL,
      "INSERT INTO migration_fk_child(rowid, id, parent_id) VALUES (9223372036854775807, 'child', 'missing');",
      ""
    ].join("\n"),
    "utf8"
  ),
  postconditionSchemaHash: TEST_INVALID_DEFERRED_FK_SCHEMA_HASH
});

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("generalized append-only storage migration plans", () => {
  it("keeps the immutable bootstrap prefix and rejects malformed extensions", () => {
    expect("__createStorageMigrationPlanForTests" in storageApi).toBe(false);
    expect("__runStorageMigrationsWithPlanForTests" in storageApi).toBe(false);
    expect(STORAGE_MIGRATION_MANIFEST.manifestHash).toBe(
      BOOTSTRAP_MANIFEST_HASH
    );
    expect(TEST_MIGRATION_PLAN_3.manifest.entries.slice(0, 2)).toEqual(
      STORAGE_MIGRATION_MANIFEST.entries
    );
    expect(TEST_MIGRATION_PLAN_3.manifest.manifestHash).toBe(
      TEST_SEQUENCE_3_MANIFEST_HASH
    );
    expect(TEST_MIGRATION_PLAN_4.manifest.manifestHash).toBe(
      TEST_SEQUENCE_4_MANIFEST_HASH
    );

    expect(() =>
      __createStorageMigrationPlanForTests({
        entries: [{ ...TEST_SEQUENCE_3_ENTRY, sequence: 4 }],
        expectedManifestHash: TEST_SEQUENCE_3_MANIFEST_HASH
      })
    ).toThrow(/contiguous/);
    expect(() =>
      __createStorageMigrationPlanForTests({
        entries: [
          {
            ...TEST_SEQUENCE_3_ENTRY,
            expectedChecksum:
              "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
          }
        ],
        expectedManifestHash: TEST_SEQUENCE_3_MANIFEST_HASH
      })
    ).toThrow(/drifted/);
    expect(() =>
      __createStorageMigrationPlanForTests({
        entries: [
          {
            ...TEST_SEQUENCE_3_ENTRY,
            preconditionSchemaHash:
              "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
          }
        ],
        expectedManifestHash: TEST_SEQUENCE_3_MANIFEST_HASH
      })
    ).toThrow(/not contiguous/);
    expect(() =>
      __createStorageMigrationPlanForTests({
        entries: [TEST_SEQUENCE_3_ENTRY],
        expectedManifestHash:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      })
    ).toThrow(/manifest drifted/i);
  });

  it.each(["fresh", "legacy", "existing"] as const)(
    "migrates a %s database through a multi-entry fixture plan",
    (mode) => {
      const fixture = storageFixture(mode);
      runPlan(fixture.databasePath, fixture.dataDir, TEST_MIGRATION_PLAN_4);
      const db = new DatabaseSync(fixture.databasePath);
      expect(db.prepare("PRAGMA user_version").get()).toEqual({
        user_version: 4
      });
      expect(computeSchemaHash(db, 4)).toBe(TEST_SEQUENCE_4_SCHEMA_HASH);
      expect(
        db.prepare(
          "SELECT sequence, migration_id, manifest_hash FROM applied_migrations ORDER BY sequence"
        ).all()
      ).toEqual([
        {
          sequence: 1,
          migration_id: "001-legacy-v1-bootstrap",
          manifest_hash: BOOTSTRAP_MANIFEST_HASH
        },
        {
          sequence: 2,
          migration_id: "002-atomic-revisions",
          manifest_hash: BOOTSTRAP_MANIFEST_HASH
        },
        {
          sequence: 3,
          migration_id: TEST_SEQUENCE_3_ENTRY.migrationId,
          manifest_hash: TEST_SEQUENCE_4_MANIFEST_HASH
        },
        {
          sequence: 4,
          migration_id: TEST_SEQUENCE_4_ENTRY.migrationId,
          manifest_hash: TEST_SEQUENCE_4_MANIFEST_HASH
        }
      ]);
      expect(
        db.prepare(
          "SELECT COUNT(*) AS count FROM migration_backup_evidence"
        ).get()
      ).toEqual({ count: 2 });
      expect(
        db.prepare("SELECT COUNT(*) AS count FROM migration_attempts").get()
      ).toEqual({ count: 2 });
      db.close();
    }
  );

  it("reopens idempotently without creating new evidence", () => {
    const fixture = storageFixture("existing");
    runPlan(fixture.databasePath, fixture.dataDir, TEST_MIGRATION_PLAN_4);
    const before = migrationEvidenceCounts(fixture.databasePath);
    runPlan(fixture.databasePath, fixture.dataDir, TEST_MIGRATION_PLAN_4);
    expect(migrationEvidenceCounts(fixture.databasePath)).toEqual(before);
  });

  it("tracks sequence independently from non-equal user-version boundaries", () => {
    const fixture = storageFixture("existing");
    runPlan(
      fixture.databasePath,
      fixture.dataDir,
      TEST_MIGRATION_PLAN_VERSION_7
    );
    const db = new DatabaseSync(fixture.databasePath);
    expect(db.prepare("PRAGMA user_version").get()).toEqual({
      user_version: 7
    });
    expect(
      db.prepare(
        "SELECT current_user_version, last_applied_sequence FROM migration_state"
      ).get()
    ).toEqual({ current_user_version: 7, last_applied_sequence: 3 });
    expect(
      db.prepare(
        "SELECT version FROM schema_migrations ORDER BY version"
      ).all()
    ).toEqual([{ version: 1 }, { version: 2 }, { version: 7 }]);
    db.close();
    runPlan(
      fixture.databasePath,
      fixture.dataDir,
      TEST_MIGRATION_PLAN_VERSION_7
    );
  });

  it("enables foreign-key enforcement before the immutable sequence-1/2 bootstrap", () => {
    const fixture = storageFixture("fresh");
    const db = new DatabaseSync(fixture.databasePath, {
      enableForeignKeyConstraints: false
    });
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({
      foreign_keys: 0
    });
    runStorageMigrations(db, fixture.dataDir, migrationOptions());
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({
      foreign_keys: 1
    });
    expect(db.prepare("PRAGMA user_version").get()).toEqual({
      user_version: 2
    });
    expect(
      db.prepare(
        "SELECT sequence FROM applied_migrations ORDER BY sequence"
      ).all()
    ).toEqual([{ sequence: 1 }, { sequence: 2 }]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  });

  it("fails before DDL when foreign-key enforcement cannot be enabled inside an existing transaction", () => {
    const fixture = storageFixture("fresh");
    const db = new DatabaseSync(fixture.databasePath, {
      enableForeignKeyConstraints: false
    });
    db.exec("BEGIN;");
    expect(() =>
      runStorageMigrations(db, fixture.dataDir, migrationOptions())
    ).toThrow(/foreign-key enforcement could not be enabled outside a transaction/i);
    db.exec("ROLLBACK;");
    expect(db.prepare("PRAGMA user_version").get()).toEqual({
      user_version: 0
    });
    expect(
      db.prepare(
        "SELECT COUNT(*) AS count FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'"
      ).get()
    ).toEqual({ count: 0 });
    db.close();
  });

  it("commits a valid deferred foreign-key chain", () => {
    const fixture = storageFixture("existing");
    runPlan(
      fixture.databasePath,
      fixture.dataDir,
      TEST_MIGRATION_PLAN_VALID_DEFERRED_FK
    );
    const db = new DatabaseSync(fixture.databasePath);
    expect(db.prepare("PRAGMA user_version").get()).toEqual({
      user_version: 3
    });
    expect(
      db.prepare(`
        SELECT c.id AS child_id, c.parent_id AS child_parent_id,
               p.id AS parent_id
        FROM migration_fk_child c
        JOIN migration_fk_parent p ON p.id = c.parent_id
      `).get()
    ).toEqual({
      child_id: "child",
      child_parent_id: "parent",
      parent_id: "parent"
    });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(
      db.prepare(
        "SELECT status FROM migration_attempts WHERE target_manifest_hash = ?"
      ).get(TEST_MIGRATION_PLAN_VALID_DEFERRED_FK.manifest.manifestHash)
    ).toEqual({ status: "completed" });
    db.close();
    expect(
      fs.readdirSync(
        path.join(fixture.dataDir, "migrations", "migration-blocks")
      )
    ).toEqual([]);
    if (process.platform !== "win32") {
      expect(
        fs.statSync(
          path.join(fixture.dataDir, "migrations", "migration-blocks")
        ).mode & 0o777
      ).toBe(0o700);
    }
  });

  it("rolls back and durably blocks a deferred foreign-key violation", () => {
    const fixture = storageFixture("existing");
    let failure: unknown;
    try {
      runPlan(
        fixture.databasePath,
        fixture.dataDir,
        TEST_MIGRATION_PLAN_INVALID_DEFERRED_FK
      );
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(VdtStorageError);
    expect(failure).toMatchObject({
      code: "MIGRATION_RECOVERY_REQUIRED",
      retryable: false
    });
    const db = new DatabaseSync(fixture.databasePath);
    expect(db.prepare("PRAGMA user_version").get()).toEqual({
      user_version: 2
    });
    expect(computeSchemaHash(db, 2)).toBe(ATOMIC_REVISION_SCHEMA_HASH);
    expect(
      db.prepare(`
        SELECT COUNT(*) AS count
        FROM sqlite_schema
        WHERE name IN ('migration_fk_parent', 'migration_fk_child')
      `).get()
    ).toEqual({ count: 0 });
    expect(
      db.prepare(
        "SELECT COUNT(*) AS count FROM applied_migrations WHERE sequence = 3"
      ).get()
    ).toEqual({ count: 0 });
    expect(
      db.prepare(`
        SELECT status
        FROM migration_attempts
        WHERE target_manifest_hash = ?
      `).get(TEST_MIGRATION_PLAN_INVALID_DEFERRED_FK.manifest.manifestHash)
    ).toEqual({ status: "blocked" });
    const state = db.prepare(
      "SELECT status, blocked_reason FROM migration_state"
    ).get() as Record<string, unknown>;
    expect(state.status).toBe("blocked");
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();

    const blockDir = path.join(
      fixture.dataDir,
      "migrations",
      "migration-blocks"
    );
    const sidecarFiles = fs.readdirSync(blockDir).sort();
    expect(sidecarFiles).toHaveLength(2);
    const pendingFile = sidecarFiles.find((file) =>
      file.endsWith(".pending.json")
    )!;
    const evidenceFile = sidecarFiles.find((file) =>
      file.endsWith(".evidence.json")
    )!;
    expect(pendingFile.replace(".pending.json", "")).toBe(
      evidenceFile.replace(".evidence.json", "")
    );
    const rawPending = fs.readFileSync(
      path.join(blockDir, pendingFile),
      "utf8"
    );
    const pending = JSON.parse(rawPending) as Record<string, JsonValue>;
    expect(canonicalizeJson(pending)).toBe(rawPending);
    expect(pending).toMatchObject({
      schemaVersion: "migration_foreign_key_pending_latch.v1",
      identity: {
        schemaVersion: "migration_foreign_key_check_identity.v1",
        migrationId: "003-test-invalid-deferred-fk",
        sequence: 3,
        targetManifestHash:
          TEST_MIGRATION_PLAN_INVALID_DEFERRED_FK.manifest.manifestHash
      }
    });
    const identityHash = hashFramed(
      "vdt-studio/migration-foreign-key-check-identity",
      "migration_foreign_key_check_identity_hash.v1",
      {},
      Buffer.from(
        canonicalizeJson(pending.identity as JsonValue),
        "utf8"
      )
    );
    expect(pending.identityHash).toBe(identityHash);
    expect(pendingFile).toBe(
      `${identityHash.slice("sha256:".length)}.pending.json`
    );
    const pendingBody = { ...pending };
    delete pendingBody.pendingLatchHash;
    expect(pending.pendingLatchHash).toBe(
      hashFramed(
        "vdt-studio/migration-foreign-key-pending-latch",
        "migration_foreign_key_pending_latch_hash.v1",
        {},
        Buffer.from(canonicalizeJson(pendingBody), "utf8")
      )
    );
    const rawEvidence = fs.readFileSync(
      path.join(blockDir, evidenceFile),
      "utf8"
    );
    const evidence = JSON.parse(rawEvidence) as Record<string, JsonValue>;
    expect(canonicalizeJson(evidence)).toBe(rawEvidence);
    expect(evidence).toMatchObject({
      schemaVersion: "migration_foreign_key_check_evidence.v1",
      identity: pending.identity,
      identityHash,
      pendingLatchHash: pending.pendingLatchHash,
      violationCount: 1,
      violations: [
        {
          table: "migration_fk_child",
          rowIdDecimal: "1",
          parent: "migration_fk_parent",
          foreignKeyIndex: 0
        }
      ],
      truncated: false
    });
    const evidenceBody = { ...evidence };
    delete evidenceBody.evidenceHash;
    const expectedEvidenceHash = hashFramed(
      "vdt-studio/migration-foreign-key-check",
      "migration_foreign_key_check_evidence_hash.v1",
      {},
      Buffer.from(canonicalizeJson(evidenceBody), "utf8")
    );
    expect(evidence.evidenceHash).toBe(expectedEvidenceHash);
    const exactReason =
      "foreign_key_check_failed:003-test-invalid-deferred-fk:" +
      `1:${expectedEvidenceHash}`;
    expect((failure as Error).message).toBe(exactReason);
    expect(state.blocked_reason).toBe("postcondition_failed");
    const beforeCounts = migrationEvidenceCounts(fixture.databasePath);
    let replayFailure: unknown;
    try {
      runPlan(
        fixture.databasePath,
        fixture.dataDir,
        TEST_MIGRATION_PLAN_INVALID_DEFERRED_FK
      );
    } catch (error) {
      replayFailure = error;
    }
    expect(replayFailure).toMatchObject({
      code: "MIGRATION_RECOVERY_REQUIRED",
      retryable: false,
      message: exactReason
    });
    expect(migrationEvidenceCounts(fixture.databasePath)).toEqual(
      beforeCounts
    );
  });

  it("sorts and bounds foreign-key block evidence to the first 50 violations", () => {
    const fixture = storageFixture("existing");
    expect(() =>
      runPlan(
        fixture.databasePath,
        fixture.dataDir,
        TEST_MIGRATION_PLAN_MANY_INVALID_DEFERRED_FKS
      )
    ).toThrow(/foreign_key_check_failed:/);
    const blockDir = path.join(
      fixture.dataDir,
      "migrations",
      "migration-blocks"
    );
    const files = fs.readdirSync(blockDir);
    expect(files).toHaveLength(2);
    const evidenceFile = files.find((file) =>
      file.endsWith(".evidence.json")
    )!;
    const evidence = JSON.parse(
      fs.readFileSync(path.join(blockDir, evidenceFile), "utf8")
    ) as {
      violationCount: number;
      violations: Array<{ rowIdDecimal: string | null }>;
      truncated: boolean;
    };
    expect(evidence.violationCount).toBe(55);
    expect(evidence.truncated).toBe(true);
    expect(evidence.violations).toHaveLength(50);
    expect(
      evidence.violations.map((violation) => violation.rowIdDecimal)
    ).toEqual(
      Array.from({ length: 50 }, (_, index) => String(index + 1))
    );
  });

  it("preserves a signed-int64 foreign-key rowid as canonical decimal text", () => {
    const fixture = storageFixture("existing");
    expect(() =>
      runPlan(
        fixture.databasePath,
        fixture.dataDir,
        TEST_MIGRATION_PLAN_INT64_INVALID_DEFERRED_FK
      )
    ).toThrow(/foreign_key_check_failed:/);
    const blockDir = path.join(
      fixture.dataDir,
      "migrations",
      "migration-blocks"
    );
    const evidenceFile = fs
      .readdirSync(blockDir)
      .find((file) => file.endsWith(".evidence.json"))!;
    const evidence = JSON.parse(
      fs.readFileSync(path.join(blockDir, evidenceFile), "utf8")
    ) as {
      violations: Array<{ rowIdDecimal: string | null }>;
    };
    expect(evidence.violations).toEqual([
      expect.objectContaining({
        rowIdDecimal: "9223372036854775807"
      })
    ]);
  });

  it.each([
    "after_foreign_key_pending_created",
    "after_foreign_key_pending_file_fsynced",
    "after_foreign_key_pending_fsynced",
    "after_foreign_key_violation_rollback",
    "after_foreign_key_evidence_created",
    "after_foreign_key_evidence_file_fsynced",
    "after_foreign_key_evidence_fsynced",
    "before_foreign_key_block_commit",
    "after_foreign_key_block_committed"
  ] as const)(
    "never replays violating DDL after SIGKILL at %s",
    async (faultPoint) => {
      const fixture = storageFixture("existing");
      const helper = fileURLToPath(
        new URL("./migration-fk-crash-child.ts", import.meta.url)
      );
      await runCrashChild(
        helper,
        [
          fixture.databasePath,
          fixture.dataDir,
          faultPoint,
          "invalid"
        ],
        `foreign-key crash ${faultPoint}`
      );
      const interrupted = new DatabaseSync(fixture.databasePath);
      expect(interrupted.prepare("PRAGMA user_version").get()).toEqual({
        user_version: 2
      });
      expect(
        interrupted.prepare(`
          SELECT COUNT(*) AS count FROM sqlite_schema
          WHERE name IN ('migration_fk_parent', 'migration_fk_child')
        `).get()
      ).toEqual({ count: 0 });
      const beforeAttempt = interrupted.prepare(`
        SELECT status FROM migration_attempts
        WHERE target_manifest_hash = ?
      `).get(
        TEST_MIGRATION_PLAN_INVALID_DEFERRED_FK.manifest.manifestHash
      ) as { status: string };
      interrupted.close();

      const beforeCounts = migrationEvidenceCounts(fixture.databasePath);
      const recoveryError = captureError(() =>
        runPlan(
          fixture.databasePath,
          fixture.dataDir,
          TEST_MIGRATION_PLAN_INVALID_DEFERRED_FK,
          { leaseMs: 0 }
        )
      );
      expect(recoveryError).toMatchObject({
        code: "MIGRATION_RECOVERY_REQUIRED",
        retryable: false
      });
      const recovered = new DatabaseSync(fixture.databasePath);
      expect(recovered.prepare("PRAGMA user_version").get()).toEqual({
        user_version: 2
      });
      expect(
        recovered.prepare(`
          SELECT COUNT(*) AS count FROM applied_migrations WHERE sequence = 3
        `).get()
      ).toEqual({ count: 0 });
      const afterAttempt = recovered.prepare(`
        SELECT status FROM migration_attempts
        WHERE target_manifest_hash = ?
      `).get(
        TEST_MIGRATION_PLAN_INVALID_DEFERRED_FK.manifest.manifestHash
      ) as { status: string };
      recovered.close();
      const linkedFinalWasDurable =
        faultPoint === "after_foreign_key_evidence_file_fsynced" ||
        faultPoint === "after_foreign_key_evidence_fsynced" ||
        faultPoint === "before_foreign_key_block_commit" ||
        faultPoint === "after_foreign_key_block_committed";
      expect(beforeAttempt.status).toBe(
        faultPoint === "after_foreign_key_block_committed"
          ? "blocked"
          : "applying"
      );
      expect(afterAttempt.status).toBe(
        linkedFinalWasDurable ? "blocked" : "applying"
      );
      expect(migrationEvidenceCounts(fixture.databasePath)).toEqual(
        beforeCounts
      );
    },
    30_000
  );

  it(
    "treats a SIGKILL after a zero-row check as pending-only recovery",
    async () => {
      const fixture = storageFixture("existing");
      const helper = fileURLToPath(
        new URL("./migration-fk-crash-child.ts", import.meta.url)
      );
      await runCrashChild(
        helper,
        [
          fixture.databasePath,
          fixture.dataDir,
          "after_foreign_key_check_passed",
          "valid"
        ],
        "foreign-key zero-row check crash"
      );
      const error = captureError(() =>
        runPlan(
          fixture.databasePath,
          fixture.dataDir,
          TEST_MIGRATION_PLAN_VALID_DEFERRED_FK,
          { leaseMs: 0 }
        )
      );
      expect(error).toMatchObject({
        code: "MIGRATION_RECOVERY_REQUIRED",
        retryable: false
      });
      const db = new DatabaseSync(fixture.databasePath);
      expect(db.prepare("PRAGMA user_version").get()).toEqual({
        user_version: 2
      });
      expect(
        db.prepare(`
          SELECT status FROM migration_attempts
          WHERE target_manifest_hash = ?
        `).get(TEST_MIGRATION_PLAN_VALID_DEFERRED_FK.manifest.manifestHash)
      ).toEqual({ status: "applying" });
      db.close();
    },
    15_000
  );

  it("safely retries after SIGKILL following the zero-row pending unlink", async () => {
    const fixture = storageFixture("existing");
    const helper = fileURLToPath(
      new URL("./migration-fk-crash-child.ts", import.meta.url)
    );
    await runCrashChild(
      helper,
      [
        fixture.databasePath,
        fixture.dataDir,
        "after_foreign_key_pending_unlinked",
        "valid"
      ],
      "foreign-key zero-row unlink crash"
    );
    expect(
      fs.readdirSync(
        path.join(fixture.dataDir, "migrations", "migration-blocks")
      )
    ).toEqual([]);
    runPlan(
      fixture.databasePath,
      fixture.dataDir,
      TEST_MIGRATION_PLAN_VALID_DEFERRED_FK,
      { leaseMs: 0 }
    );
    const db = new DatabaseSync(fixture.databasePath);
    expect(db.prepare("PRAGMA user_version").get()).toEqual({
      user_version: 3
    });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  });

  it("does not block migration state when final-evidence exclusive create collides", () => {
    const fixture = storageFixture("existing");
    const blockDir = path.join(
      fixture.dataDir,
      "migrations",
      "migration-blocks"
    );
    const error = captureError(() =>
      runPlan(
        fixture.databasePath,
        fixture.dataDir,
        TEST_MIGRATION_PLAN_INVALID_DEFERRED_FK,
        {
          faultInjector(point) {
            if (point !== "after_foreign_key_pending_fsynced") return;
            const pending = fs
              .readdirSync(blockDir)
              .find((file) => file.endsWith(".pending.json"))!;
            fs.writeFileSync(
              path.join(
                blockDir,
                pending.replace(/\.pending\.json$/, ".evidence.json")
              ),
              "{}",
              { flag: "wx", mode: 0o600 }
            );
          }
        }
      )
    );

    expect(error).toMatchObject({
      code: "MIGRATION_RECOVERY_REQUIRED",
      retryable: false
    });
    const db = new DatabaseSync(fixture.databasePath);
    expect(
      db.prepare(
        "SELECT status, blocked_reason FROM migration_state"
      ).get()
    ).toEqual({ status: "ready", blocked_reason: null });
    expect(
      db.prepare(`
        SELECT status FROM migration_attempts
        WHERE target_manifest_hash = ?
      `).get(
        TEST_MIGRATION_PLAN_INVALID_DEFERRED_FK.manifest.manifestHash
      )
    ).toEqual({ status: "applying" });
    expect(
      db.prepare(`
        SELECT COUNT(*) AS count FROM applied_migrations WHERE sequence = 3
      `).get()
    ).toEqual({ count: 0 });
    db.close();
  });

  it("does not mutate a violating attempt after its owner fence changes", async () => {
    const fixture = storageFixture("existing");
    const helper = fileURLToPath(
      new URL("./migration-fk-crash-child.ts", import.meta.url)
    );
    await runCrashChild(
      helper,
      [
        fixture.databasePath,
        fixture.dataDir,
        "after_foreign_key_evidence_fsynced",
        "invalid"
      ],
      "foreign-key changed-fence setup"
    );
    const db = new DatabaseSync(fixture.databasePath);
    const original = db.prepare(`
      SELECT attempt_id, owner_token, lease_generation
      FROM migration_attempts WHERE target_manifest_hash = ?
    `).get(
      TEST_MIGRATION_PLAN_INVALID_DEFERRED_FK.manifest.manifestHash
    ) as {
      attempt_id: string;
      owner_token: string;
      lease_generation: number;
    };
    db.prepare(`
      UPDATE migration_attempts
      SET owner_token = 'replacement_owner',
          lease_generation = lease_generation + 1,
          lease_expires_at = lease_expires_at + 1000
      WHERE attempt_id = ?
    `).run(original.attempt_id);
    const changed = db.prepare(`
      SELECT owner_token, lease_generation, status
      FROM migration_attempts WHERE attempt_id = ?
    `).get(original.attempt_id);
    db.close();

    const error = captureError(() =>
      runPlan(
        fixture.databasePath,
        fixture.dataDir,
        TEST_MIGRATION_PLAN_INVALID_DEFERRED_FK,
        { leaseMs: 0 }
      )
    );
    expect(error).toMatchObject({
      code: "MIGRATION_RECOVERY_REQUIRED",
      retryable: false
    });
    const reopened = new DatabaseSync(fixture.databasePath);
    expect(
      reopened.prepare(`
        SELECT owner_token, lease_generation, status
        FROM migration_attempts WHERE attempt_id = ?
      `).get(original.attempt_id)
    ).toEqual(changed);
    expect(
      reopened.prepare(
        "SELECT status, blocked_reason FROM migration_state"
      ).get()
    ).toEqual({ status: "ready", blocked_reason: null });
    reopened.close();
  });

  it("rejects final-only and tampered evidence without a state write", async () => {
    for (const mutation of ["remove_pending", "tamper_final"] as const) {
      const fixture = storageFixture("existing");
      const helper = fileURLToPath(
        new URL("./migration-fk-crash-child.ts", import.meta.url)
      );
      await runCrashChild(
        helper,
        [
          fixture.databasePath,
          fixture.dataDir,
          "after_foreign_key_evidence_fsynced",
          "invalid"
        ],
        `foreign-key ${mutation} setup`
      );
      const blockDir = path.join(
        fixture.dataDir,
        "migrations",
        "migration-blocks"
      );
      const files = fs.readdirSync(blockDir);
      if (mutation === "remove_pending") {
        fs.unlinkSync(
          path.join(
            blockDir,
            files.find((file) => file.endsWith(".pending.json"))!
          )
        );
      } else {
        const evidencePath = path.join(
          blockDir,
          files.find((file) => file.endsWith(".evidence.json"))!
        );
        const raw = fs.readFileSync(evidencePath, "utf8");
        fs.writeFileSync(
          evidencePath,
          raw.replace(
            /"evidenceHash":"sha256:([0-9a-f])/,
            (_match, first: string) =>
              `"evidenceHash":"sha256:${first === "0" ? "1" : "0"}`
          )
        );
      }
      const before = migrationEvidenceCounts(fixture.databasePath);
      const error = captureError(() =>
        runPlan(
          fixture.databasePath,
          fixture.dataDir,
          TEST_MIGRATION_PLAN_INVALID_DEFERRED_FK,
          { leaseMs: 0 }
        )
      );
      expect(error).toMatchObject({
        code: "MIGRATION_RECOVERY_REQUIRED",
        retryable: false
      });
      expect(migrationEvidenceCounts(fixture.databasePath)).toEqual(before);
      const db = new DatabaseSync(fixture.databasePath);
      expect(
        db.prepare(`
          SELECT status FROM migration_attempts
          WHERE target_manifest_hash = ?
        `).get(
          TEST_MIGRATION_PLAN_INVALID_DEFERRED_FK.manifest.manifestHash
        )
      ).toEqual({ status: "applying" });
      expect(
        db.prepare(
          "SELECT status, blocked_reason FROM migration_state"
        ).get()
      ).toEqual({ status: "ready", blocked_reason: null });
      db.close();
    }
  });

  it("rejects an over-bound sidecar and a permissive block directory before DDL", () => {
    for (const mutation of ["oversize", "permissions"] as const) {
      const fixture = storageFixture("existing");
      const blockDir = path.join(
        fixture.dataDir,
        "migrations",
        "migration-blocks"
      );
      if (mutation === "oversize") {
        fs.writeFileSync(
          path.join(
            blockDir,
            `${"a".repeat(64)}.pending.json`
          ),
          Buffer.alloc(32_769, 0x20),
          { flag: "wx", mode: 0o600 }
        );
      } else if (process.platform !== "win32") {
        fs.chmodSync(blockDir, 0o755);
      } else {
        continue;
      }
      const before = migrationEvidenceCounts(fixture.databasePath);
      const error = captureError(() =>
        runPlan(
          fixture.databasePath,
          fixture.dataDir,
          TEST_MIGRATION_PLAN_VALID_DEFERRED_FK
        )
      );
      expect(error).toMatchObject({
        code: "MIGRATION_RECOVERY_REQUIRED",
        retryable: false
      });
      expect(migrationEvidenceCounts(fixture.databasePath)).toEqual(before);
      const db = new DatabaseSync(fixture.databasePath);
      expect(db.prepare("PRAGMA user_version").get()).toEqual({
        user_version: 2
      });
      expect(
        db.prepare(`
          SELECT COUNT(*) AS count FROM sqlite_schema
          WHERE name IN ('migration_fk_parent', 'migration_fk_child')
        `).get()
      ).toEqual({ count: 0 });
      db.close();
      if (mutation === "permissions") fs.chmodSync(blockDir, 0o700);
    }
  });

  it("supports legacy 0755 parents while retaining an exact 0700 block directory", () => {
    if (process.platform === "win32") return;
    const fixture = storageFixture("existing");
    const migrationDir = path.join(fixture.dataDir, "migrations");
    const blockDir = path.join(migrationDir, "migration-blocks");
    fs.chmodSync(fixture.dataDir, 0o755);
    fs.chmodSync(migrationDir, 0o755);

    runPlan(
      fixture.databasePath,
      fixture.dataDir,
      TEST_MIGRATION_PLAN_VALID_DEFERRED_FK
    );

    expect(fs.statSync(fixture.dataDir).mode & 0o777).toBe(0o755);
    expect(fs.statSync(migrationDir).mode & 0o777).toBe(0o755);
    expect(fs.statSync(blockDir).mode & 0o777).toBe(0o700);
    const db = new DatabaseSync(fixture.databasePath);
    expect(db.prepare("PRAGMA user_version").get()).toEqual({
      user_version: 3
    });
    db.close();
  });

  it("opens every migration directory component with no-follow directory flags", () => {
    if (process.platform === "win32") return;
    const fixture = storageFixture("existing");
    const migrationDir = path.join(fixture.dataDir, "migrations");
    const blockDir = path.join(migrationDir, "migration-blocks");
    const expectedPaths = new Set([
      fixture.dataDir,
      migrationDir,
      blockDir
    ]);
    const openedPaths = new Set<string>();
    const open = fs.openSync.bind(fs);
    const spy = vi.spyOn(fs, "openSync").mockImplementation(
      ((filePath: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode) => {
        if (
          typeof filePath === "string" &&
          typeof flags === "number" &&
          (flags & fs.constants.O_DIRECTORY) !== 0 &&
          (flags & fs.constants.O_NOFOLLOW) !== 0 &&
          (flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR)) === 0 &&
          expectedPaths.has(filePath)
        ) {
          openedPaths.add(filePath);
        }
        return open(filePath, flags, mode);
      }) as typeof fs.openSync
    );
    try {
      runPlan(
        fixture.databasePath,
        fixture.dataDir,
        TEST_MIGRATION_PLAN_VALID_DEFERRED_FK
      );
    } finally {
      spy.mockRestore();
    }

    expect(openedPaths).toEqual(expectedPaths);
  });

  it("rejects group- or other-writable migration parents before DDL", () => {
    if (process.platform === "win32") return;
    for (const [parent, mode] of [
      ["dataDir", 0o775],
      ["migrations", 0o757]
    ] as const) {
      const fixture = storageFixture("existing");
      const target =
        parent === "dataDir"
          ? fixture.dataDir
          : path.join(fixture.dataDir, "migrations");
      fs.chmodSync(target, mode);
      const before = migrationEvidenceCounts(fixture.databasePath);

      const error = captureError(() =>
        runPlan(
          fixture.databasePath,
          fixture.dataDir,
          TEST_MIGRATION_PLAN_VALID_DEFERRED_FK
        )
      );

      expect(error).toMatchObject({
        code: "MIGRATION_RECOVERY_REQUIRED",
        retryable: false
      });
      expect(migrationEvidenceCounts(fixture.databasePath)).toEqual(before);
      const db = new DatabaseSync(fixture.databasePath);
      expect(db.prepare("PRAGMA user_version").get()).toEqual({
        user_version: 2
      });
      expect(
        db.prepare(`
          SELECT COUNT(*) AS count FROM sqlite_schema
          WHERE name IN ('migration_fk_parent', 'migration_fk_child')
        `).get()
      ).toEqual({ count: 0 });
      db.close();
    }
  });

  it.each([
    ["tmpfs", 0x01021994n],
    ["overlayfs", 0x794c7630n]
  ] as const)(
    "rejects Linux %s as an unreviewed migration filesystem before DDL",
    (_fileSystemName, fileSystemType) => {
      const fixture = storageFixture("existing");
      const before = migrationEvidenceCounts(fixture.databasePath);
      const actualFileSystem = fs.statfsSync(fixture.dataDir, {
        bigint: true
      });
      const statfs = vi.spyOn(fs, "statfsSync").mockImplementation(
        (() => ({
          ...actualFileSystem,
          type: fileSystemType
        })) as unknown as typeof fs.statfsSync
      );
      let failure: unknown;
      try {
        failure = captureError(() =>
          runPlan(
            fixture.databasePath,
            fixture.dataDir,
            TEST_MIGRATION_PLAN_VALID_DEFERRED_FK
          )
        );
      } finally {
        statfs.mockRestore();
      }

      expect(failure).toMatchObject({
        code: "MIGRATION_RECOVERY_REQUIRED",
        retryable: false
      });
      expect(migrationEvidenceCounts(fixture.databasePath)).toEqual(before);
      const db = new DatabaseSync(fixture.databasePath);
      expect(db.prepare("PRAGMA user_version").get()).toEqual({
        user_version: 2
      });
      expect(
        db.prepare(
          "SELECT status, blocked_reason FROM migration_state"
        ).get()
      ).toEqual({ status: "ready", blocked_reason: null });
      expect(
        db.prepare(`
          SELECT COUNT(*) AS count FROM sqlite_schema
          WHERE name IN ('migration_fk_parent', 'migration_fk_child')
        `).get()
      ).toEqual({ count: 0 });
      db.close();
    }
  );

  it("rejects a hard-linked sidecar before DDL", () => {
    const fixture = storageFixture("existing");
    const blockDir = path.join(
      fixture.dataDir,
      "migrations",
      "migration-blocks"
    );
    const first = path.join(
      blockDir,
      `${"a".repeat(64)}.pending.json`
    );
    const second = path.join(
      blockDir,
      `${"b".repeat(64)}.evidence.json`
    );
    fs.writeFileSync(first, "{}", { flag: "wx", mode: 0o600 });
    fs.linkSync(first, second);
    const before = migrationEvidenceCounts(fixture.databasePath);
    const error = captureError(() =>
      runPlan(
        fixture.databasePath,
        fixture.dataDir,
        TEST_MIGRATION_PLAN_VALID_DEFERRED_FK
      )
    );
    expect(error).toMatchObject({
      code: "MIGRATION_RECOVERY_REQUIRED",
      retryable: false
    });
    expect(migrationEvidenceCounts(fixture.databasePath)).toEqual(before);
  });

  it("detects block-directory replacement while a pending file is open", () => {
    const fixture = storageFixture("existing");
    const blockDir = path.join(
      fixture.dataDir,
      "migrations",
      "migration-blocks"
    );
    const movedDir = path.join(
      fixture.dataDir,
      "migrations",
      "migration-blocks-replaced"
    );
    const error = captureError(() =>
      runPlan(
        fixture.databasePath,
        fixture.dataDir,
        TEST_MIGRATION_PLAN_INVALID_DEFERRED_FK,
        {
          faultInjector(point) {
            if (point !== "after_foreign_key_pending_file_fsynced") return;
            fs.renameSync(blockDir, movedDir);
            fs.mkdirSync(blockDir, { mode: 0o700 });
          }
        }
      )
    );
    expect(error).toMatchObject({
      code: "MIGRATION_RECOVERY_REQUIRED",
      retryable: false
    });
    const db = new DatabaseSync(fixture.databasePath);
    expect(db.prepare("PRAGMA user_version").get()).toEqual({
      user_version: 2
    });
    expect(
      db.prepare(`
        SELECT COUNT(*) AS count FROM applied_migrations WHERE sequence = 3
      `).get()
    ).toEqual({ count: 0 });
    db.close();
  });

  it("detects pending-file replacement before the zero-row unlink", () => {
    const fixture = storageFixture("existing");
    const blockDir = path.join(
      fixture.dataDir,
      "migrations",
      "migration-blocks"
    );
    const error = captureError(() =>
      runPlan(
        fixture.databasePath,
        fixture.dataDir,
        TEST_MIGRATION_PLAN_VALID_DEFERRED_FK,
        {
          faultInjector(point) {
            if (point !== "after_foreign_key_check_passed") return;
            const pending = fs
              .readdirSync(blockDir)
              .find((file) => file.endsWith(".pending.json"))!;
            const pendingPath = path.join(blockDir, pending);
            fs.unlinkSync(pendingPath);
            fs.writeFileSync(pendingPath, "{}", {
              flag: "wx",
              mode: 0o600
            });
          }
        }
      )
    );
    expect(error).toMatchObject({
      code: "MIGRATION_RECOVERY_REQUIRED",
      retryable: false
    });
    const db = new DatabaseSync(fixture.databasePath);
    expect(db.prepare("PRAGMA user_version").get()).toEqual({
      user_version: 2
    });
    expect(
      db.prepare(`
        SELECT COUNT(*) AS count FROM applied_migrations WHERE sequence = 3
      `).get()
    ).toEqual({ count: 0 });
    db.close();
  });

  it("does not attribute valid foreign-key evidence beside a committed migration", () => {
    const fixture = storageFixture("existing");
    runPlan(
      fixture.databasePath,
      fixture.dataDir,
      TEST_MIGRATION_PLAN_VALID_DEFERRED_FK
    );
    const db = new DatabaseSync(fixture.databasePath);
    const attempt = db.prepare(`
      SELECT attempt_id, database_id, owner_token, lease_generation,
             target_manifest_hash
      FROM migration_attempts WHERE target_manifest_hash = ?
    `).get(
      TEST_MIGRATION_PLAN_VALID_DEFERRED_FK.manifest.manifestHash
    ) as {
      attempt_id: string;
      database_id: string;
      owner_token: string;
      lease_generation: number;
      target_manifest_hash: Sha256;
    };
    db.close();
    writeTestForeignKeyEvidencePair(fixture.dataDir, {
      schemaVersion: "migration_foreign_key_check_identity.v1",
      databaseId: attempt.database_id,
      attemptId: attempt.attempt_id,
      fenceOwnerToken: attempt.owner_token,
      fenceLeaseGeneration: attempt.lease_generation,
      targetManifestHash: attempt.target_manifest_hash,
      sequence: 3,
      migrationId: "003-test-valid-deferred-fk"
    });
    const before = migrationEvidenceCounts(fixture.databasePath);
    const error = captureError(() =>
      runPlan(
        fixture.databasePath,
        fixture.dataDir,
        TEST_MIGRATION_PLAN_VALID_DEFERRED_FK
      )
    );
    expect(error).toMatchObject({
      code: "MIGRATION_RECOVERY_REQUIRED",
      retryable: false
    });
    expect(migrationEvidenceCounts(fixture.databasePath)).toEqual(before);
    const reopened = new DatabaseSync(fixture.databasePath);
    expect(
      reopened.prepare(
        "SELECT status FROM migration_attempts WHERE attempt_id = ?"
      ).get(attempt.attempt_id)
    ).toEqual({ status: "completed" });
    expect(
      reopened.prepare(
        "SELECT status, blocked_reason FROM migration_state"
      ).get()
    ).toEqual({ status: "ready", blocked_reason: null });
    reopened.close();
  });

  it("keeps bootstrap journal and durable sequence-1/2 evidence on the frozen hash", () => {
    const fixture = storageFixture("fresh");
    runPlan(fixture.databasePath, fixture.dataDir, TEST_MIGRATION_PLAN_4);
    const journalDir = path.join(
      fixture.dataDir,
      "migrations",
      "bootstrap-journal"
    );
    const journalFiles = fs
      .readdirSync(journalDir)
      .filter((file) => file.endsWith(".json"));
    expect(journalFiles).toHaveLength(1);
    const journal = JSON.parse(
      fs.readFileSync(path.join(journalDir, journalFiles[0]!), "utf8")
    ) as Record<string, unknown>;
    expect(journal.targetManifestHash).toBe(BOOTSTRAP_MANIFEST_HASH);
    expect(
      (journal.backupEvidence as Record<string, unknown>).manifestHash
    ).toBe(BOOTSTRAP_MANIFEST_HASH);
    const db = new DatabaseSync(fixture.databasePath);
    expect(
      db.prepare(
        "SELECT DISTINCT manifest_hash FROM applied_migrations WHERE sequence <= 2"
      ).all()
    ).toEqual([{ manifest_hash: BOOTSTRAP_MANIFEST_HASH }]);
    expect(
      db.prepare(`
        SELECT target_manifest_hash
        FROM migration_attempts
        WHERE backup_evidence_id = ?
      `).get(
        (journal.backupEvidence as Record<string, unknown>).backupEvidenceId as
          string
      )
    ).toEqual({ target_manifest_hash: BOOTSTRAP_MANIFEST_HASH });
    db.close();
  });

  it("preserves historical target hashes when a later plan is appended", () => {
    const fixture = storageFixture("existing");
    runPlan(fixture.databasePath, fixture.dataDir, TEST_MIGRATION_PLAN_3);
    const afterThree = new DatabaseSync(fixture.databasePath);
    const sequenceThree = afterThree.prepare(
      "SELECT * FROM applied_migrations WHERE sequence = 3"
    ).get() as Record<string, unknown>;
    const attemptThree = afterThree.prepare(
      "SELECT * FROM migration_attempts WHERE target_manifest_hash = ?"
    ).get(TEST_SEQUENCE_3_MANIFEST_HASH) as Record<string, unknown>;
    afterThree.close();

    runPlan(fixture.databasePath, fixture.dataDir, TEST_MIGRATION_PLAN_4);
    const db = new DatabaseSync(fixture.databasePath);
    expect(
      db.prepare(
        "SELECT sequence, manifest_hash FROM applied_migrations ORDER BY sequence"
      ).all()
    ).toEqual([
      { sequence: 1, manifest_hash: BOOTSTRAP_MANIFEST_HASH },
      { sequence: 2, manifest_hash: BOOTSTRAP_MANIFEST_HASH },
      { sequence: 3, manifest_hash: TEST_SEQUENCE_3_MANIFEST_HASH },
      { sequence: 4, manifest_hash: TEST_SEQUENCE_4_MANIFEST_HASH }
    ]);
    expect(
      db.prepare(
        "SELECT * FROM applied_migrations WHERE sequence = 3"
      ).get()
    ).toEqual(sequenceThree);
    expect(
      db.prepare(
        "SELECT * FROM migration_attempts WHERE target_manifest_hash = ?"
      ).get(TEST_SEQUENCE_3_MANIFEST_HASH)
    ).toEqual(attemptThree);
    expect(
      db.prepare(
        "SELECT manifest_hash, current_user_version, last_applied_sequence, status FROM migration_state"
      ).get()
    ).toEqual({
      manifest_hash: TEST_SEQUENCE_4_MANIFEST_HASH,
      current_user_version: 4,
      last_applied_sequence: 4,
      status: "ready"
    });
    expect(
      db.prepare(
        "SELECT COUNT(*) AS count FROM migration_backup_evidence"
      ).get()
    ).toEqual({ count: 3 });
    db.close();
  });

  it("blocks downgrade, schema drift, unknown history, backup tamper, and orphan evidence", () => {
    const downgrade = storageFixture("existing");
    runPlan(downgrade.databasePath, downgrade.dataDir, TEST_MIGRATION_PLAN_4);
    expect(() =>
      runPlan(downgrade.databasePath, downgrade.dataDir, TEST_MIGRATION_PLAN_3)
    ).toThrow(/MIGRATION_BLOCKED/);

    const drift = storageFixture("existing");
    const driftDb = new DatabaseSync(drift.databasePath);
    driftDb.exec("CREATE TABLE unexpected_later_drift(id TEXT PRIMARY KEY);");
    driftDb.close();
    expect(() =>
      runPlan(drift.databasePath, drift.dataDir, TEST_MIGRATION_PLAN_3)
    ).toThrow(/MIGRATION_BLOCKED/);

    const unknownHistory = storageFixture("existing");
    runPlan(
      unknownHistory.databasePath,
      unknownHistory.dataDir,
      TEST_MIGRATION_PLAN_4
    );
    const unknownDb = new DatabaseSync(unknownHistory.databasePath);
    unknownDb.prepare(
      "UPDATE applied_migrations SET manifest_hash = ? WHERE sequence = 3"
    ).run(
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    );
    unknownDb.close();
    expect(() =>
      runPlan(
        unknownHistory.databasePath,
        unknownHistory.dataDir,
        TEST_MIGRATION_PLAN_4
      )
    ).toThrow(/MIGRATION_BLOCKED/);

    const backupTamper = storageFixture("existing");
    runPlan(
      backupTamper.databasePath,
      backupTamper.dataDir,
      TEST_MIGRATION_PLAN_3
    );
    const backupDb = new DatabaseSync(backupTamper.databasePath);
    const backup = backupDb.prepare(
      "SELECT backup_relative_path FROM migration_backup_evidence WHERE manifest_hash = ?"
    ).get(TEST_SEQUENCE_3_MANIFEST_HASH) as Record<string, unknown>;
    backupDb.close();
    fs.appendFileSync(
      path.join(backupTamper.dataDir, String(backup.backup_relative_path)),
      "tamper"
    );
    expect(() =>
      runPlan(
        backupTamper.databasePath,
        backupTamper.dataDir,
        TEST_MIGRATION_PLAN_3
      )
    ).toThrow(/MIGRATION_BLOCKED/);

    const orphan = storageFixture("existing");
    const orphanDb = new DatabaseSync(orphan.databasePath);
    const databaseId = String((
      orphanDb.prepare("SELECT database_id FROM migration_state").get() as Record<
        string,
        unknown
      >
    ).database_id);
    orphanDb.prepare(`
      INSERT INTO migration_backup_evidence
      (backup_evidence_id, schema_version, database_id, from_user_version,
       manifest_hash, source_database_hash, backup_hash, backup_relative_path,
       created_at)
      VALUES ('orphan_later', 'migration_backup_evidence.v1', ?, 2, ?, ?, ?,
              'migrations/backups/orphan-later.sqlite', 1)
    `).run(
      databaseId,
      TEST_SEQUENCE_3_MANIFEST_HASH,
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    );
    orphanDb.close();
    expect(() =>
      runPlan(orphan.databasePath, orphan.dataDir, TEST_MIGRATION_PLAN_3)
    ).toThrow(/MIGRATION_BLOCKED/);
  });

  it("rejects an unexpired lease, reuses one backup on takeover, and advances generation", () => {
    const fixture = storageFixture("existing");
    const firstTime = "2026-07-24T00:00:00.000Z";
    expect(() =>
      runPlan(
        fixture.databasePath,
        fixture.dataDir,
        TEST_MIGRATION_PLAN_3,
        {
          now: () => firstTime,
          leaseMs: 30_000,
          faultInjector(point) {
            if (point === "after_later_attempt_reserved") {
              throw new Error("stop-after-later-attempt");
            }
          }
        }
      )
    ).toThrow("stop-after-later-attempt");
    expect(() =>
      runPlan(
        fixture.databasePath,
        fixture.dataDir,
        TEST_MIGRATION_PLAN_3,
        {
          now: () => "2026-07-24T00:00:29.999Z",
          leaseMs: 30_000
        }
      )
    ).toThrow(VdtStorageError);
    runPlan(
      fixture.databasePath,
      fixture.dataDir,
      TEST_MIGRATION_PLAN_3,
      {
        now: () => "2026-07-24T00:00:30.000Z",
        leaseMs: 30_000
      }
    );
    const db = new DatabaseSync(fixture.databasePath);
    expect(
      db.prepare(`
        SELECT lease_generation, status
        FROM migration_attempts WHERE target_manifest_hash = ?
      `).get(TEST_SEQUENCE_3_MANIFEST_HASH)
    ).toEqual({ lease_generation: 4, status: "completed" });
    expect(
      db.prepare(
        "SELECT COUNT(*) AS count FROM migration_backup_evidence WHERE manifest_hash = ?"
      ).get(TEST_SEQUENCE_3_MANIFEST_HASH)
    ).toEqual({ count: 1 });
    db.close();
  });

  it("takes over at exact lease expiry during each entry of a multi-entry attempt", () => {
    const fixture = storageFixture("existing");
    const times = [
      "2026-07-24T00:00:00.000Z",
      "2026-07-24T00:00:00.010Z",
      "2026-07-24T00:00:00.015Z",
      "2026-07-24T00:00:00.025Z",
      "2026-07-24T00:00:00.030Z"
    ];
    let timeIndex = 0;
    const applyingGenerations: number[] = [];
    runPlan(
      fixture.databasePath,
      fixture.dataDir,
      TEST_MIGRATION_PLAN_4,
      {
        leaseMs: 10,
        now: () => times[Math.min(timeIndex++, times.length - 1)]!,
        faultInjector(point, context) {
          if (point === "after_later_applying_persisted" && context) {
            applyingGenerations.push(context.leaseGeneration);
          }
        }
      }
    );
    expect(applyingGenerations).toEqual([2, 4]);
    const db = new DatabaseSync(fixture.databasePath);
    expect(
      db.prepare(`
        SELECT lease_generation, lease_expires_at, status, next_sequence
        FROM migration_attempts WHERE target_manifest_hash = ?
      `).get(TEST_SEQUENCE_4_MANIFEST_HASH)
    ).toEqual({
      lease_generation: 5,
      lease_expires_at: Date.parse("2026-07-24T00:00:00.040Z"),
      status: "completed",
      next_sequence: 5
    });
    expect(db.prepare("PRAGMA user_version").get()).toEqual({
      user_version: 4
    });
    db.close();
  });

  it("rotates the complete owner fence on every renewal", () => {
    const fixture = storageFixture("existing");
    const times = [
      "2026-07-24T00:00:00.000Z",
      "2026-07-24T00:00:00.001Z",
      "2026-07-24T00:00:00.002Z"
    ];
    let timeIndex = 0;
    const fences: Array<{
      owner_token: string;
      lease_generation: number;
      lease_expires_at: number;
    }> = [];
    const db = new DatabaseSync(fixture.databasePath);
    try {
      __runStorageMigrationsWithPlanForTests(
        db,
        fixture.dataDir,
        {
          now: () => times[Math.min(timeIndex++, times.length - 1)]!,
          busyTimeoutMs: 30_000,
          leaseMs: 10,
          ownerTokenFactory: () => "constant_owner",
          faultInjector(point, context) {
            if (
              !context ||
              (point !== "after_later_attempt_reserved" &&
                point !== "after_later_applying_persisted" &&
                point !== "before_later_migration_commit")
            ) {
              return;
            }
            fences.push(
              db.prepare(`
                SELECT owner_token, lease_generation, lease_expires_at
                FROM migration_attempts WHERE attempt_id = ?
              `).get(context.attemptId) as {
                owner_token: string;
                lease_generation: number;
                lease_expires_at: number;
              }
            );
          }
        },
        TEST_MIGRATION_PLAN_3
      );
    } finally {
      db.close();
    }
    expect(fences.map((fence) => fence.lease_generation)).toEqual([1, 2, 3]);
    expect(fences.map((fence) => fence.lease_expires_at)).toEqual([
      Date.parse("2026-07-24T00:00:00.010Z"),
      Date.parse("2026-07-24T00:00:00.011Z"),
      Date.parse("2026-07-24T00:00:00.012Z")
    ]);
    expect(fences[1]!.owner_token).not.toBe(fences[0]!.owner_token);
    expect(fences[2]!.owner_token).not.toBe(fences[1]!.owner_token);
  });

  it.each(["precondition", "sql", "postcondition"] as const)(
    "durably blocks a permanent %s failure after its prior lease expires",
    (failureKind) => {
      const fixture = storageFixture("existing");
      const plan =
        failureKind === "sql"
          ? TEST_MIGRATION_PLAN_SQL_FAILURE
          : failureKind === "postcondition"
            ? TEST_MIGRATION_PLAN_POSTCONDITION_FAILURE
            : TEST_MIGRATION_PLAN_3;
      const times =
        failureKind === "precondition"
          ? [
              "2026-07-24T02:00:00.000Z",
              "2026-07-24T02:00:00.000Z",
              "2026-07-24T02:00:00.010Z"
            ]
          : [
              "2026-07-24T02:00:00.000Z",
              "2026-07-24T02:00:00.000Z",
              "2026-07-24T02:00:00.000Z",
              "2026-07-24T02:00:00.010Z"
            ];
      let timeIndex = 0;
      const db = new DatabaseSync(fixture.databasePath);
      expect(() =>
        __runStorageMigrationsWithPlanForTests(
          db,
          fixture.dataDir,
          {
            now: () => times[Math.min(timeIndex++, times.length - 1)]!,
            busyTimeoutMs: 30_000,
            leaseMs: failureKind === "precondition" ? 0 : 1,
            faultInjector(point) {
              if (
                failureKind === "precondition" &&
                point === "after_later_applying_persisted"
              ) {
                db.exec(
                  "CREATE TABLE permanent_precondition_drift(id TEXT PRIMARY KEY);"
                );
              }
            }
          },
          plan
        )
      ).toThrow(/MIGRATION_BLOCKED/);
      const blockedAttempt = db.prepare(`
        SELECT attempt_id, owner_token, lease_generation, lease_expires_at,
               next_sequence, status
        FROM migration_attempts
        WHERE target_manifest_hash = ?
      `).get(plan.manifest.manifestHash);
      expect(blockedAttempt).toMatchObject({
        next_sequence: 3,
        status: "blocked"
      });
      expect(
        Number(
          (blockedAttempt as Record<string, unknown>).lease_expires_at
        )
      ).toBeGreaterThan(Date.parse("2026-07-24T02:00:00.010Z"));
      expect(
        db.prepare(
          "SELECT status, blocked_reason FROM migration_state"
        ).get()
      ).toEqual({
        status: "blocked",
        blocked_reason:
          failureKind === "precondition"
            ? "precondition_failed"
            : "postcondition_failed"
      });
      const beforeCounts = migrationEvidenceCounts(fixture.databasePath);
      db.close();

      expect(() =>
        runPlan(fixture.databasePath, fixture.dataDir, plan, {
          now: () => "2026-07-24T03:00:00.000Z",
          leaseMs: 0
        })
      ).toThrow(/MIGRATION_BLOCKED/);
      const reopened = new DatabaseSync(fixture.databasePath);
      expect(
        reopened.prepare(`
          SELECT attempt_id, owner_token, lease_generation, lease_expires_at,
                 next_sequence, status
          FROM migration_attempts
          WHERE target_manifest_hash = ?
        `).get(plan.manifest.manifestHash)
      ).toEqual(blockedAttempt);
      reopened.close();
      expect(migrationEvidenceCounts(fixture.databasePath)).toEqual(
        beforeCounts
      );
    }
  );

  it("persists only applied_prefix_mismatch for ambiguous application evidence", () => {
    const fixture = storageFixture("existing");
    const db = new DatabaseSync(fixture.databasePath);
    const failure = captureError(() =>
      __runStorageMigrationsWithPlanForTests(
        db,
        fixture.dataDir,
        {
          now: () => "2026-07-24T02:30:00.000Z",
          busyTimeoutMs: 30_000,
          leaseMs: 30_000,
          faultInjector(point) {
            if (point !== "after_later_applying_persisted") return;
            const state = db.prepare(
              "SELECT database_id FROM migration_state"
            ).get() as { database_id: string };
            db.prepare(`
              INSERT INTO applied_migrations
              (sequence, schema_version, database_id, migration_id,
               sql_checksum, from_user_version, to_user_version,
               precondition_schema_hash, postcondition_schema_hash,
               manifest_hash, application_id, applied_at)
              VALUES (?, 'applied_migration.v1', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              TEST_SEQUENCE_3_ENTRY.sequence,
              state.database_id,
              TEST_SEQUENCE_3_ENTRY.migrationId,
              TEST_SEQUENCE_3_ENTRY.expectedChecksum,
              TEST_SEQUENCE_3_ENTRY.fromUserVersion,
              TEST_SEQUENCE_3_ENTRY.toUserVersion,
              TEST_SEQUENCE_3_ENTRY.preconditionSchemaHash,
              TEST_SEQUENCE_3_ENTRY.postconditionSchemaHash,
              TEST_SEQUENCE_3_MANIFEST_HASH,
              "ambiguous_application_test",
              Date.parse("2026-07-24T02:30:00.000Z")
            );
          }
        },
        TEST_MIGRATION_PLAN_3
      )
    );

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain(
      "already has ambiguous application evidence"
    );
    expect(
      db.prepare(
        "SELECT status, blocked_reason FROM migration_state"
      ).get()
    ).toEqual({
      status: "blocked",
      blocked_reason: "applied_prefix_mismatch"
    });
    expect(
      db.prepare(`
        SELECT status FROM migration_attempts
        WHERE target_manifest_hash = ?
      `).get(TEST_SEQUENCE_3_MANIFEST_HASH)
    ).toEqual({ status: "blocked" });
    db.close();
  });

  it("never replaces a durably blocked later attempt", () => {
    const fixture = storageFixture("existing");
    expect(() =>
      runPlan(
        fixture.databasePath,
        fixture.dataDir,
        TEST_MIGRATION_PLAN_3,
        {
          leaseMs: 0,
          faultInjector(point) {
            if (point === "after_later_attempt_reserved") {
              throw new Error("stop-before-block");
            }
          }
        }
      )
    ).toThrow("stop-before-block");
    const db = new DatabaseSync(fixture.databasePath);
    db.prepare(`
      UPDATE migration_attempts
      SET status = 'blocked'
      WHERE target_manifest_hash = ?
    `).run(TEST_SEQUENCE_3_MANIFEST_HASH);
    db.close();
    expect(() =>
      runPlan(fixture.databasePath, fixture.dataDir, TEST_MIGRATION_PLAN_3, {
        leaseMs: 0
      })
    ).toThrow(/durably blocked/);
    expect(migrationEvidenceCounts(fixture.databasePath)).toMatchObject({
      applications: 2,
      backups: 2,
      attempts: 2
    });
  });

  it("prevents a stale owner from committing after its fence changes", () => {
    const fixture = storageFixture("existing");
    const db = new DatabaseSync(fixture.databasePath);
    expect(() =>
      __runStorageMigrationsWithPlanForTests(
        db,
        fixture.dataDir,
        migrationOptions({
          now: () => "2026-07-24T01:00:00.000Z",
          leaseMs: 30_000,
          faultInjector(point, context) {
            if (point !== "after_later_applying_persisted" || !context) return;
            db.prepare(`
              UPDATE migration_attempts
              SET lease_expires_at = lease_expires_at + 1
              WHERE attempt_id = ?
            `).run(context.attemptId);
          }
        }),
        TEST_MIGRATION_PLAN_3
      )
    ).toThrow(VdtStorageError);
    expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 2 });
    expect(
      db.prepare(
        "SELECT COUNT(*) AS count FROM sqlite_schema WHERE name = 'migration_fixture_three'"
      ).get()
    ).toEqual({ count: 0 });
    db.close();
    runPlan(
      fixture.databasePath,
      fixture.dataDir,
      TEST_MIGRATION_PLAN_3,
      {
        now: () => "2026-07-24T01:00:30.001Z",
        leaseMs: 30_000
      }
    );
    const verified = new DatabaseSync(fixture.databasePath);
    expect(verified.prepare("PRAGMA user_version").get()).toEqual({
      user_version: 3
    });
    expect(
      verified.prepare(
        "SELECT lease_generation FROM migration_attempts WHERE target_manifest_hash = ?"
      ).get(TEST_SEQUENCE_3_MANIFEST_HASH)
    ).toEqual({ lease_generation: 5 });
    verified.close();
  });

  it.each([
    ["after_later_backup_owner_fsynced", 3, 2],
    ["after_later_backup_fsynced", 3, 2],
    ["after_later_attempt_reserved", 3, 2],
    ["after_later_applying_persisted", 3, 2],
    ["before_later_migration_commit", 3, 2],
    ["after_later_migration_committed", 3, 3],
    ["after_later_applying_persisted", 4, 3],
    ["before_later_migration_commit", 4, 3],
    ["after_later_migration_committed", 4, 4]
  ] as const)(
    "recovers after SIGKILL at %s for sequence %s",
    async (faultPoint, sequence, durableVersion) => {
      const fixture = storageFixture("existing");
      const helper = fileURLToPath(
        new URL("./migration-later-crash-child.ts", import.meta.url)
      );
      await runCrashChild(
        helper,
        [
          fixture.databasePath,
          fixture.dataDir,
          faultPoint,
          String(sequence)
        ],
        `later migration crash ${faultPoint}:${sequence}`
      );
      const interrupted = new DatabaseSync(fixture.databasePath);
      expect(interrupted.prepare("PRAGMA user_version").get()).toEqual({
        user_version: durableVersion
      });
      expect(
        interrupted.prepare(
          "SELECT current_user_version, last_applied_sequence FROM migration_state"
        ).get()
      ).toEqual({
        current_user_version: durableVersion,
        last_applied_sequence: durableVersion
      });
      interrupted.close();

      runPlan(
        fixture.databasePath,
        fixture.dataDir,
        TEST_MIGRATION_PLAN_4,
        { leaseMs: 0 }
      );
      const recovered = new DatabaseSync(fixture.databasePath);
      expect(recovered.prepare("PRAGMA user_version").get()).toEqual({
        user_version: 4
      });
      expect(computeSchemaHash(recovered, 4)).toBe(
        TEST_SEQUENCE_4_SCHEMA_HASH
      );
      expect(
        recovered.prepare(
          "SELECT COUNT(*) AS count FROM migration_attempts WHERE target_manifest_hash = ?"
        ).get(TEST_SEQUENCE_4_MANIFEST_HASH)
      ).toEqual({ count: 1 });
      expect(
        recovered.prepare(
          "SELECT COUNT(*) AS count FROM migration_backup_evidence WHERE manifest_hash = ?"
        ).get(TEST_SEQUENCE_4_MANIFEST_HASH)
      ).toEqual({ count: 1 });
      const activeBackup = recovered.prepare(`
        SELECT backup_relative_path
        FROM migration_backup_evidence
        WHERE manifest_hash = ?
      `).get(TEST_SEQUENCE_4_MANIFEST_HASH) as Record<string, unknown>;
      expect(
        fs.existsSync(
          path.join(
            fixture.dataDir,
            String(activeBackup.backup_relative_path)
          )
        )
      ).toBe(true);
      recovered.close();
    },
    30_000
  );

  it("recovers the retained main migration fence after a real SIGKILL", async () => {
    const fixture = storageFixture("existing");
    const helper = fileURLToPath(
      new URL("./migration-later-crash-child.ts", import.meta.url)
    );
    await runCrashChild(
      helper,
      [
        fixture.databasePath,
        fixture.dataDir,
        "after_admission_fence_acquired",
        "0"
      ],
      "later migration admission SIGKILL"
    );
    expect(
      fs.existsSync(
        path.join(fixture.dataDir, ".migration-admission.sqlite")
      )
    ).toBe(false);
    expect(
      fs.existsSync(path.join(fixture.dataDir, ".migration-admission.lock"))
    ).toBe(false);

    runPlan(
      fixture.databasePath,
      fixture.dataDir,
      TEST_MIGRATION_PLAN_3,
      { leaseMs: 0 }
    );
    const recovered = new DatabaseSync(fixture.databasePath);
    expect(recovered.prepare("PRAGMA user_version").get()).toEqual({
      user_version: 3
    });
    expect(
      recovered.prepare(`
        SELECT COUNT(*) AS count
        FROM migration_backup_evidence
        WHERE manifest_hash = ?
      `).get(TEST_SEQUENCE_3_MANIFEST_HASH)
    ).toEqual({ count: 1 });
    expect(
      recovered.prepare(`
        SELECT COUNT(*) AS count
        FROM migration_attempts
        WHERE target_manifest_hash = ?
      `).get(TEST_SEQUENCE_3_MANIFEST_HASH)
    ).toEqual({ count: 1 });
    expect(
      recovered.prepare(`
        SELECT COUNT(*) AS count
        FROM applied_migrations
        WHERE sequence = 3 AND manifest_hash = ?
      `).get(TEST_SEQUENCE_3_MANIFEST_HASH)
    ).toEqual({ count: 1 });
    recovered.close();
  });

  it("quarantines only a proven crash orphan and preserves unrelated matching paths", async () => {
    const fixture = storageFixture("existing");
    const backupDir = path.join(
      fixture.dataDir,
      "migrations",
      "backups"
    );
    const unrelatedFile = path.join(
      backupDir,
      "later-migration_attempt_unrelated.sqlite"
    );
    const unrelatedBytes = Buffer.from("unrelated-flat-backup");
    fs.writeFileSync(unrelatedFile, unrelatedBytes);
    const unrelatedDirectory = path.join(
      backupDir,
      "later-migration_attempt_unrelated-directory.sqlite"
    );
    fs.mkdirSync(unrelatedDirectory);
    fs.writeFileSync(
      path.join(unrelatedDirectory, "payload.bin"),
      "unrelated-directory"
    );
    const unrelatedLink = path.join(
      backupDir,
      "later-migration_attempt_unrelated-link.sqlite"
    );
    fs.symlinkSync(path.basename(unrelatedFile), unrelatedLink);
    const invalidOwnedDirectory = path.join(
      backupDir,
      ".later-owned-migration_attempt_unrelated"
    );
    fs.mkdirSync(invalidOwnedDirectory);
    const invalidOwnerBytes = Buffer.from('{"schemaVersion":"not-ours"}');
    fs.writeFileSync(
      path.join(invalidOwnedDirectory, "owner.json"),
      invalidOwnerBytes
    );

    const helper = fileURLToPath(
      new URL("./migration-later-crash-child.ts", import.meta.url)
    );
    await runCrashChild(
      helper,
      [
        fixture.databasePath,
        fixture.dataDir,
        "after_later_backup_fsynced",
        "3"
      ],
      "owned later backup orphan setup"
    );
    runPlan(
      fixture.databasePath,
      fixture.dataDir,
      TEST_MIGRATION_PLAN_4,
      { leaseMs: 0 }
    );

    expect(fs.readFileSync(unrelatedFile)).toEqual(unrelatedBytes);
    expect(fs.lstatSync(unrelatedDirectory).isDirectory()).toBe(true);
    expect(
      fs.readFileSync(
        path.join(unrelatedDirectory, "payload.bin"),
        "utf8"
      )
    ).toBe("unrelated-directory");
    expect(fs.lstatSync(unrelatedLink).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(unrelatedLink)).toBe(path.basename(unrelatedFile));
    expect(
      fs.readFileSync(
        path.join(invalidOwnedDirectory, "owner.json")
      )
    ).toEqual(invalidOwnerBytes);

    const quarantineDir = path.join(
      fixture.dataDir,
      "migrations",
      "orphaned-backups"
    );
    const quarantined = fs
      .readdirSync(quarantineDir)
      .filter((name) => name.startsWith(".later-owned-migration_attempt_"));
    expect(quarantined).toHaveLength(1);
    expect(
      fs.existsSync(
        path.join(quarantineDir, quarantined[0]!, "backup.sqlite")
      )
    ).toBe(true);
    const db = new DatabaseSync(fixture.databasePath);
    const active = db.prepare(`
      SELECT backup_relative_path
      FROM migration_backup_evidence
      WHERE manifest_hash = ?
    `).get(TEST_SEQUENCE_4_MANIFEST_HASH) as Record<string, unknown>;
    db.close();
    expect(
      fs.existsSync(
        path.join(fixture.dataDir, String(active.backup_relative_path))
      )
    ).toBe(true);
  });

  it("normalizes a preliminary SQLite lock and succeeds after close/reopen", () => {
    const fixture = storageFixture("existing");
    const blocker = new DatabaseSync(fixture.databasePath, { timeout: 0 });
    blocker.exec("PRAGMA journal_mode = DELETE;");
    blocker.exec("BEGIN EXCLUSIVE;");
    const contender = new DatabaseSync(fixture.databasePath, { timeout: 0 });
    try {
      let caught: unknown;
      try {
        __runStorageMigrationsWithPlanForTests(
          contender,
          fixture.dataDir,
          migrationOptions({ busyTimeoutMs: 0 }),
          TEST_MIGRATION_PLAN_4
        );
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(VdtStorageError);
      expect(caught).toMatchObject({
        code: "MIGRATION_IN_PROGRESS",
        retryable: true
      });
    } finally {
      contender.close();
      blocker.exec("ROLLBACK;");
      blocker.close();
    }
    runPlan(fixture.databasePath, fixture.dataDir, TEST_MIGRATION_PLAN_4, {
      busyTimeoutMs: 100
    });
    expect(migrationEvidenceCounts(fixture.databasePath)).toMatchObject({
      applications: 4,
      backups: 2,
      attempts: 2
    });
  });

  it(
    "repeatedly serializes two independent processes to one later backup and attempt",
    async () => {
      const helper = fileURLToPath(
        new URL("./migration-later-concurrency-child.ts", import.meta.url)
      );
      for (let round = 0; round < 5; round += 1) {
        const fixture = storageFixture("existing");
        const startAt = Date.now() + 250;
        await Promise.all(
          Array.from({ length: 2 }, (_, worker) =>
            runRawChild(
              helper,
              [
                fixture.databasePath,
                fixture.dataDir,
                String(startAt)
              ],
              `later migration contention round ${round} child ${worker}`
            )
          )
        );
        const db = new DatabaseSync(fixture.databasePath);
        expect(db.prepare("PRAGMA user_version").get()).toEqual({
          user_version: 4
        });
        expect(
          db.prepare(
            "SELECT COUNT(*) AS count FROM migration_backup_evidence WHERE manifest_hash = ?"
          ).get(TEST_SEQUENCE_4_MANIFEST_HASH)
        ).toEqual({ count: 1 });
        expect(
          db.prepare(
            "SELECT COUNT(*) AS count FROM migration_attempts WHERE target_manifest_hash = ?"
          ).get(TEST_SEQUENCE_4_MANIFEST_HASH)
        ).toEqual({ count: 1 });
        expect(
          db.prepare(
            "SELECT COUNT(*) AS count FROM applied_migrations WHERE sequence >= 3"
          ).get()
        ).toEqual({ count: 2 });
        db.close();
      }
    },
    60_000
  );

  it("blocks a committed-row mismatch instead of replaying it", async () => {
    const fixture = storageFixture("existing");
    const helper = fileURLToPath(
      new URL("./migration-later-crash-child.ts", import.meta.url)
    );
    await runCrashChild(
      helper,
      [
        fixture.databasePath,
        fixture.dataDir,
        "after_later_migration_committed",
        "3"
      ],
      "later committed-row mismatch setup"
    );
    const db = new DatabaseSync(fixture.databasePath);
    db.prepare(
      "UPDATE applied_migrations SET sql_checksum = ? WHERE sequence = 3"
    ).run(
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    );
    db.close();
    expect(() =>
      runPlan(
        fixture.databasePath,
        fixture.dataDir,
        TEST_MIGRATION_PLAN_4,
        { leaseMs: 0 }
      )
    ).toThrow(/MIGRATION_BLOCKED/);
  });
});

function singleEntryPlan(input: {
  migrationId: string;
  sqlBytes: Buffer;
  postconditionSchemaHash: Sha256;
}): StorageMigrationTestPlan {
  const metadata = {
    sequence: 3,
    migrationId: input.migrationId,
    fromUserVersion: 2,
    toUserVersion: 3,
    preconditionSchemaHash: ATOMIC_REVISION_SCHEMA_HASH,
    postconditionSchemaHash: input.postconditionSchemaHash
  };
  const expectedChecksum = hashFramed(
    "vdt-studio/sql-migration",
    "sql_migration_hash.v1",
    metadata,
    input.sqlBytes
  );
  const manifestEntry = {
    ...metadata,
    sqlByteLength: input.sqlBytes.byteLength,
    sqlChecksum: expectedChecksum,
    transactional: true as const
  };
  const expectedManifestHash = hashFramed(
    "vdt-studio/migration-manifest",
    "migration_manifest_hash.v1",
    {
      schemaVersion: "migration_manifest.v1",
      manifestVersion: 1,
      entries: [...STORAGE_MIGRATION_MANIFEST.entries, manifestEntry]
    } as unknown as JsonValue
  );
  return __createStorageMigrationPlanForTests({
    entries: [
      {
        ...metadata,
        sqlBytes: input.sqlBytes,
        expectedChecksum
      }
    ],
    expectedManifestHash
  });
}

function storageFixture(
  mode: "fresh" | "legacy" | "existing"
): { root: string; dataDir: string; databasePath: string } {
  const root = tempRoot();
  const dataDir = path.join(root, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const databasePath = path.join(dataDir, "app.sqlite");
  if (mode === "legacy") {
    const db = new DatabaseSync(databasePath);
    db.exec(LEGACY_SQL);
    db.prepare(
      "INSERT INTO schema_migrations(version, applied_at) VALUES(1, 1)"
    ).run();
    db.exec("PRAGMA user_version = 1;");
    db.close();
  } else if (mode === "existing") {
    const opened = openVdtDatabase(root, { dataDir });
    opened.close();
  }
  return { root, dataDir, databasePath };
}

function runPlan(
  databasePath: string,
  dataDir: string,
  plan: StorageMigrationTestPlan,
  overrides: Partial<{
    now: () => string;
    busyTimeoutMs: number;
    leaseMs: number;
    faultInjector: (
      point: StorageMigrationFaultPoint,
      context?: StorageMigrationFaultContext
    ) => void;
  }> = {}
): void {
  const db = new DatabaseSync(databasePath, { timeout: 30_000 });
  try {
    __runStorageMigrationsWithPlanForTests(
      db,
      dataDir,
      migrationOptions(overrides),
      plan
    );
  } finally {
    db.close();
  }
}

function migrationOptions(
  overrides: Partial<{
    now: () => string;
    busyTimeoutMs: number;
    leaseMs: number;
    faultInjector: (
      point: StorageMigrationFaultPoint,
      context?: StorageMigrationFaultContext
    ) => void;
  }> = {}
) {
  return {
    now: () => new Date().toISOString(),
    busyTimeoutMs: 30_000,
    leaseMs: 30_000,
    ...overrides
  };
}

function migrationEvidenceCounts(databasePath: string) {
  const db = new DatabaseSync(databasePath);
  try {
    return db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM applied_migrations) AS applications,
        (SELECT COUNT(*) FROM migration_backup_evidence) AS backups,
        (SELECT COUNT(*) FROM migration_attempts) AS attempts
    `).get();
  } finally {
    db.close();
  }
}

function writeTestForeignKeyEvidencePair(
  dataDir: string,
  identity: {
    schemaVersion: "migration_foreign_key_check_identity.v1";
    databaseId: string;
    attemptId: string;
    fenceOwnerToken: string;
    fenceLeaseGeneration: number;
    targetManifestHash: Sha256;
    sequence: number;
    migrationId: string;
  }
): void {
  const identityHash = hashFramed(
    "vdt-studio/migration-foreign-key-check-identity",
    "migration_foreign_key_check_identity_hash.v1",
    {},
    Buffer.from(canonicalizeJson(identity as unknown as JsonValue), "utf8")
  );
  const pendingBody = {
    schemaVersion: "migration_foreign_key_pending_latch.v1",
    identity,
    identityHash,
    createdAt: "2026-07-24T00:00:00.000Z"
  };
  const pendingLatchHash = hashFramed(
    "vdt-studio/migration-foreign-key-pending-latch",
    "migration_foreign_key_pending_latch_hash.v1",
    {},
    Buffer.from(
      canonicalizeJson(pendingBody as unknown as JsonValue),
      "utf8"
    )
  );
  const pending = { ...pendingBody, pendingLatchHash };
  const evidenceBody = {
    schemaVersion: "migration_foreign_key_check_evidence.v1",
    identity,
    identityHash,
    pendingLatchHash,
    violationCount: 1,
    violations: [
      {
        table: "migration_fk_child",
        rowIdDecimal: "1",
        parent: "migration_fk_parent",
        foreignKeyIndex: 0
      }
    ],
    truncated: false,
    createdAt: "2026-07-24T00:00:00.001Z"
  };
  const evidenceHash = hashFramed(
    "vdt-studio/migration-foreign-key-check",
    "migration_foreign_key_check_evidence_hash.v1",
    {},
    Buffer.from(
      canonicalizeJson(evidenceBody as unknown as JsonValue),
      "utf8"
    )
  );
  const evidence = { ...evidenceBody, evidenceHash };
  const identityHex = identityHash.slice("sha256:".length);
  const blockDir = path.join(dataDir, "migrations", "migration-blocks");
  fs.writeFileSync(
    path.join(blockDir, `${identityHex}.pending.json`),
    canonicalizeJson(pending as unknown as JsonValue),
    { flag: "wx", mode: 0o600 }
  );
  fs.writeFileSync(
    path.join(blockDir, `${identityHex}.evidence.json`),
    canonicalizeJson(evidence as unknown as JsonValue),
    { flag: "wx", mode: 0o600 }
  );
}

function captureError(fn: () => void): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("Expected operation to throw.");
}

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vdt-later-migration-"));
  tempDirs.push(root);
  return root;
}

function runRawChild(
  helper: string,
  args: string[],
  label: string
): Promise<void> {
  return runChild(helper, args, label, false);
}

function runCrashChild(
  helper: string,
  args: string[],
  label: string
): Promise<void> {
  return runChild(helper, args, label, true);
}

function runChild(
  helper: string,
  args: string[],
  label: string,
  expectCrash: boolean
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", helper, ...args],
      {
        cwd: path.resolve(fileURLToPath(new URL("../../..", import.meta.url))),
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (
        (!expectCrash && code === 0) ||
        (expectCrash && code === null && signal === "SIGKILL")
      ) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${label} exited unexpectedly (code=${String(code)}, signal=${String(
            signal
          )}): ${stderr || stdout}`
        )
      );
    });
  });
}
