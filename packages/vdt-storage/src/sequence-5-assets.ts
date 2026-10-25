import { canonicalizeJson, hashFramed } from "./canonical";
import { readVerifiedMigrationAsset } from "./sequence-4-assets";
import type { JsonValue, Sha256, StorageMigrationManifestEntryV1 } from "./types";

export const SEQUENCE_5_MANIFEST_HASH =
  "sha256:cf5a4b58d53d7ec97ca562a23c7e7ff2244eef14f56d517630cb674ccf05dafa" as const;
export const SEQUENCE_5_SCHEMA_HASH =
  "sha256:b6a5c0285057f11e3957673f51d2908697b9594291731005b3cdb5262742cc3d" as const;
const PREFIX_HASH = "sha256:58440c19c409fb79229458d8448cafa900dd24f8e363c191dd4fbececa54b2d0";
const ENTRY: StorageMigrationManifestEntryV1 = Object.freeze({
  sequence: 5,
  migrationId: "005-project-deletion",
  fromUserVersion: 4,
  toUserVersion: 5,
  preconditionSchemaHash: "sha256:77281710693b86a25722b3f6b14fcd0496fe22918cfc77cb39f1679ffed5dfb0",
  postconditionSchemaHash: SEQUENCE_5_SCHEMA_HASH,
  sqlByteLength: 13_469,
  sqlChecksum: "sha256:1fa5df00c82fcc8893920d0d95d83d5208cbb936071eb00796b152c0b3f1d434",
  transactional: true
});

export interface VerifiedSequence5Assets {
  readonly manifestHash: Sha256;
  readonly historicalPrefixManifestHash: Sha256;
  readonly entry: StorageMigrationManifestEntryV1;
  readonly sqlBytes: Buffer;
}

let retained: VerifiedSequence5Assets | undefined;

export function loadVerifiedSequence5Assets(): VerifiedSequence5Assets {
  if (retained) return retained;
  const sqlBytes = readVerifiedMigrationAsset({
    url: new URL("./migrations/005-project-deletion.sql", import.meta.url),
    basename: "005-project-deletion.sql",
    byteLength: ENTRY.sqlByteLength,
    rawHash: "sha256:65b81babf9e1d7fa977c4d5e015394f726f18e41708497a0ed6f98722e6574c1"
  });
  const manifestBytes = readVerifiedMigrationAsset({
    url: new URL("./migrations/migration-manifest-v4.json", import.meta.url),
    basename: "migration-manifest-v4.json",
    byteLength: 896,
    rawHash: "sha256:a17d8f2e804a0527040e2e07cbd5850a4c2ebb3613420d9d694d348ab2bef1c2"
  });
  const { sqlByteLength: _length, sqlChecksum, transactional: _transactional, ...identity } = ENTRY;
  if (hashFramed("vdt-studio/sql-migration", "sql_migration_hash.v1", identity, sqlBytes) !== sqlChecksum) {
    throw new Error("sequence5_sql_checksum_invalid");
  }
  const body = {
    schemaVersion: "migration_manifest.v4",
    manifestVersion: 4,
    historicalPrefixManifestHash: PREFIX_HASH,
    entries: [
      { entryKind: "v3_manifest_projection", firstSequence: 1, lastSequence: 4, manifestHash: PREFIX_HASH },
      { entryKind: "transactional_sql_v1", entry: ENTRY }
    ]
  };
  if (
    hashFramed("vdt-studio/migration-manifest", "migration_manifest_hash.v4", body as unknown as JsonValue) !== SEQUENCE_5_MANIFEST_HASH
    || manifestBytes.toString("utf8") !== `${canonicalizeJson({ ...body, manifestHash: SEQUENCE_5_MANIFEST_HASH } as unknown as JsonValue)}\n`
  ) throw new Error("sequence5_manifest_invalid");
  retained = Object.freeze({
    manifestHash: SEQUENCE_5_MANIFEST_HASH,
    historicalPrefixManifestHash: PREFIX_HASH,
    entry: ENTRY,
    sqlBytes
  });
  return retained;
}
