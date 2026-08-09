import {
  ATOMIC_REVISION_SCHEMA_HASH,
  STORAGE_MIGRATION_MANIFEST,
  __createStorageMigrationPlanForTests
} from "./migrations";
import { hashFramed } from "./canonical";
import type {
  StorageMigrationFixtureEntryV1,
  StorageMigrationTestPlan
} from "./migrations";
import type { JsonValue, Sha256 } from "./types";

export const TEST_SEQUENCE_3_SQL = Buffer.from(
  [
    "CREATE TABLE migration_fixture_three (",
    "  id TEXT PRIMARY KEY,",
    "  value TEXT NOT NULL",
    ");",
    ""
  ].join("\n"),
  "utf8"
);

export const TEST_SEQUENCE_4_SQL = Buffer.from(
  [
    "CREATE TABLE migration_fixture_four (",
    "  id TEXT PRIMARY KEY,",
    "  three_id TEXT NOT NULL,",
    "  FOREIGN KEY(three_id) REFERENCES migration_fixture_three(id) ON DELETE CASCADE",
    ");",
    "CREATE INDEX migration_fixture_four_by_three ON migration_fixture_four(three_id);",
    ""
  ].join("\n"),
  "utf8"
);

export const TEST_SEQUENCE_3_SCHEMA_HASH =
  "sha256:c58c7e98ffba82ef15d39ab8e8492b999e6a358e1baaee8b53b4a6aae561c4e4";
export const TEST_SEQUENCE_4_SCHEMA_HASH =
  "sha256:bec968909c4fbb3a1c6d150acccd996100808014123c118c15b9314b57360284";
export const TEST_SEQUENCE_3_MANIFEST_HASH =
  "sha256:5ef5aa393ff81c7fa149c2f6110ea57332ff2f2a74646d8f78f4e8b0803a9b62";
export const TEST_SEQUENCE_4_MANIFEST_HASH =
  "sha256:95d0d42b782605a81e2e33c180b00c2b8bbb8716d23c89c261a627a02a8f20b7";

export const TEST_SEQUENCE_3_ENTRY: StorageMigrationFixtureEntryV1 = {
  sequence: 3,
  migrationId: "003-test-fixture-three",
  fromUserVersion: 2,
  toUserVersion: 3,
  preconditionSchemaHash: ATOMIC_REVISION_SCHEMA_HASH,
  postconditionSchemaHash: TEST_SEQUENCE_3_SCHEMA_HASH,
  sqlBytes: TEST_SEQUENCE_3_SQL,
  expectedChecksum:
    "sha256:0c1308ba42fc7131453a49c268fc950be52ffea58ca092f732880fd47bec19b6"
};

export const TEST_SEQUENCE_4_ENTRY: StorageMigrationFixtureEntryV1 = {
  sequence: 4,
  migrationId: "004-test-fixture-four",
  fromUserVersion: 3,
  toUserVersion: 4,
  preconditionSchemaHash: TEST_SEQUENCE_3_SCHEMA_HASH,
  postconditionSchemaHash: TEST_SEQUENCE_4_SCHEMA_HASH,
  sqlBytes: TEST_SEQUENCE_4_SQL,
  expectedChecksum:
    "sha256:f9807a07546412ce682c7ffb13bd0fa1cec053bd95834a45620c9e9912b47239"
};

export const TEST_MIGRATION_PLAN_3: StorageMigrationTestPlan =
  __createStorageMigrationPlanForTests({
    entries: [TEST_SEQUENCE_3_ENTRY],
    expectedManifestHash: TEST_SEQUENCE_3_MANIFEST_HASH
  });

export const TEST_MIGRATION_PLAN_4: StorageMigrationTestPlan =
  __createStorageMigrationPlanForTests({
    entries: [TEST_SEQUENCE_3_ENTRY, TEST_SEQUENCE_4_ENTRY],
    expectedManifestHash: TEST_SEQUENCE_4_MANIFEST_HASH
  });

export const TEST_INVALID_DEFERRED_FK_SCHEMA_SQL = [
  "CREATE TABLE migration_fk_parent (id TEXT PRIMARY KEY);",
  "CREATE TABLE migration_fk_child (",
  "  id TEXT PRIMARY KEY,",
  "  parent_id TEXT NOT NULL,",
  "  FOREIGN KEY(parent_id) REFERENCES migration_fk_parent(id) DEFERRABLE INITIALLY DEFERRED",
  ");"
].join("\n");

export const TEST_INVALID_DEFERRED_FK_SCHEMA_HASH =
  "sha256:cdd9e0665cb7e1348ceeaed043e34b2de69ecd7d3e46241c0236a41b16b4b60b";

export const TEST_MIGRATION_PLAN_INVALID_DEFERRED_FK =
  testSingleEntryPlan({
    migrationId: "003-test-invalid-deferred-fk",
    sqlBytes: Buffer.from(
      [
        TEST_INVALID_DEFERRED_FK_SCHEMA_SQL,
        "INSERT INTO migration_fk_child(id, parent_id) VALUES ('child', 'missing');",
        ""
      ].join("\n"),
      "utf8"
    ),
    postconditionSchemaHash: TEST_INVALID_DEFERRED_FK_SCHEMA_HASH
  });

export const TEST_MIGRATION_PLAN_VALID_DEFERRED_FK =
  testSingleEntryPlan({
    migrationId: "003-test-valid-deferred-fk",
    sqlBytes: Buffer.from(
      [
        TEST_INVALID_DEFERRED_FK_SCHEMA_SQL,
        "INSERT INTO migration_fk_child(id, parent_id) VALUES ('child', 'parent');",
        "INSERT INTO migration_fk_parent(id) VALUES ('parent');",
        ""
      ].join("\n"),
      "utf8"
    ),
    postconditionSchemaHash: TEST_INVALID_DEFERRED_FK_SCHEMA_HASH
  });

function testSingleEntryPlan(input: {
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
    entries: [{ ...metadata, sqlBytes: input.sqlBytes, expectedChecksum }],
    expectedManifestHash
  });
}
