import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertExactKeys,
  assertSha256,
  canonicalizeJson,
  hashFramed,
  hashRawBytes,
  isPlainRecord
} from "./canonical";
import type { JsonValue, Sha256, StorageMigrationManifestEntryV1 } from "./types";

const SEQUENCE_3_MANIFEST_HASH =
  "sha256:791fc7c7cce9abd11b2509ddaa6ba9e92e469178a3d1add6803b083295c849e8" as const;
const SEQUENCE_4_MANIFEST_HASH =
  "sha256:58440c19c409fb79229458d8448cafa900dd24f8e363c191dd4fbececa54b2d0" as const;
const SEQUENCE_4_SQL_CHECKSUM =
  "sha256:5783fea204fa540a7e3442c2e73bcefff4dec41cf6de97439b8c0dafaefbc8c4" as const;
const SEQUENCE_4_POSTCONDITION_SCHEMA_HASH =
  "sha256:77281710693b86a25722b3f6b14fcd0496fe22918cfc77cb39f1679ffed5dfb0" as const;

const ASSETS = Object.freeze({
  manifest: {
    url: new URL("./migrations/migration-manifest-v3.json", import.meta.url),
    basename: "migration-manifest-v3.json",
    byteLength: 903,
    rawHash:
      "sha256:c746167abd70b03523f251ca38081a50aba4023d26fb86a6df3aca2c4ddc2daf" as Sha256
  },
  sql: {
    url: new URL("./migrations/004-bounded-agent-execution.sql", import.meta.url),
    basename: "004-bounded-agent-execution.sql",
    byteLength: 29_824,
    rawHash:
      "sha256:ff676aedca87cb7582e26d3b879111eb54eb01eda70aa355039743b5c49760f2" as Sha256
  }
});

export interface VerifiedSequence4Assets {
  readonly manifestHash: Sha256;
  readonly historicalPrefixManifestHash: Sha256;
  readonly entry: StorageMigrationManifestEntryV1;
  readonly sqlBytes: Buffer;
}

let retainedAssets: VerifiedSequence4Assets | undefined;

/** Loads the additive Sequence 4 graph without reopening or rewriting any
 * frozen Sequence 3 artifact. The V3 extension binds the exact V2 manifest
 * hash, while the SQL remains independently raw- and framed-hash verified. */
export function loadVerifiedSequence4Assets(): VerifiedSequence4Assets {
  if (retainedAssets) return retainedAssets;
  const manifestBytes = readExactAsset("manifest");
  const sqlBytes = readExactAsset("sql");
  const manifest = parseCanonicalManifest(manifestBytes);
  assertExactKeys(
    manifest,
    [
      "entries",
      "historicalPrefixManifestHash",
      "manifestHash",
      "manifestVersion",
      "schemaVersion"
    ],
    "Sequence 4 manifest"
  );
  if (
    manifest.schemaVersion !== "migration_manifest.v3"
    || manifest.manifestVersion !== 3
    || manifest.historicalPrefixManifestHash !== SEQUENCE_3_MANIFEST_HASH
  ) {
    throw new Error("sequence4_manifest_identity_invalid");
  }
  assertSha256(manifest.manifestHash, "Sequence 4 manifest hash");
  const withoutHash = { ...manifest };
  delete withoutHash.manifestHash;
  const computedManifestHash = hashFramed(
    "vdt-studio/migration-manifest",
    "migration_manifest_hash.v3",
    {},
    Buffer.from(canonicalizeJson(withoutHash as JsonValue), "utf8")
  );
  if (
    manifest.manifestHash !== SEQUENCE_4_MANIFEST_HASH
    || computedManifestHash !== SEQUENCE_4_MANIFEST_HASH
  ) {
    throw new Error("sequence4_manifest_hash_invalid");
  }

  const entries = manifest.entries;
  if (!Array.isArray(entries) || entries.length !== 2) {
    throw new Error("sequence4_manifest_entries_invalid");
  }
  const prefix = requireRecord(entries[0], "Sequence 4 prefix projection");
  assertExactKeys(
    prefix,
    ["entryKind", "firstSequence", "lastSequence", "manifestHash"],
    "Sequence 4 prefix projection"
  );
  if (
    prefix.entryKind !== "v2_manifest_projection"
    || prefix.firstSequence !== 1
    || prefix.lastSequence !== 3
    || prefix.manifestHash !== SEQUENCE_3_MANIFEST_HASH
  ) {
    throw new Error("sequence4_manifest_prefix_invalid");
  }

  const wrapper = requireRecord(entries[1], "Sequence 4 entry wrapper");
  assertExactKeys(wrapper, ["entry", "entryKind"], "Sequence 4 entry wrapper");
  if (wrapper.entryKind !== "transactional_sql_v1") {
    throw new Error("sequence4_manifest_entry_kind_invalid");
  }
  const entry = requireRecord(wrapper.entry, "Sequence 4 entry");
  assertExactKeys(
    entry,
    [
      "fromUserVersion",
      "migrationId",
      "postconditionSchemaHash",
      "preconditionSchemaHash",
      "sequence",
      "sqlByteLength",
      "sqlChecksum",
      "toUserVersion",
      "transactional"
    ],
    "Sequence 4 entry"
  );
  if (
    entry.sequence !== 4
    || entry.migrationId !== "004-bounded-agent-execution"
    || entry.fromUserVersion !== 3
    || entry.toUserVersion !== 4
    || entry.preconditionSchemaHash !==
      "sha256:c4206299c5399b4ee113c920f02af650aa39ad6af452f5c46330dcec10adbb5a"
    || entry.postconditionSchemaHash !== SEQUENCE_4_POSTCONDITION_SCHEMA_HASH
    || entry.sqlByteLength !== sqlBytes.byteLength
    || entry.sqlChecksum !== SEQUENCE_4_SQL_CHECKSUM
    || entry.transactional !== true
  ) {
    throw new Error("sequence4_manifest_entry_invalid");
  }
  assertSha256(entry.preconditionSchemaHash, "Sequence 4 precondition hash");
  assertSha256(entry.postconditionSchemaHash, "Sequence 4 postcondition hash");
  assertSha256(entry.sqlChecksum, "Sequence 4 SQL checksum");
  const computedSqlChecksum = hashFramed(
    "vdt-studio/sql-migration",
    "sql_migration_hash.v1",
    {
      sequence: entry.sequence,
      migrationId: entry.migrationId,
      fromUserVersion: entry.fromUserVersion,
      toUserVersion: entry.toUserVersion,
      preconditionSchemaHash: entry.preconditionSchemaHash,
      postconditionSchemaHash: entry.postconditionSchemaHash
    } as JsonValue,
    sqlBytes
  );
  if (computedSqlChecksum !== SEQUENCE_4_SQL_CHECKSUM) {
    throw new Error("sequence4_manifest_sql_checksum_invalid");
  }

  retainedAssets = Object.freeze({
    manifestHash: SEQUENCE_4_MANIFEST_HASH,
    historicalPrefixManifestHash: SEQUENCE_3_MANIFEST_HASH,
    entry: Object.freeze({
      sequence: 4,
      migrationId: "004-bounded-agent-execution",
      fromUserVersion: 3,
      toUserVersion: 4,
      sqlByteLength: sqlBytes.byteLength,
      sqlChecksum: SEQUENCE_4_SQL_CHECKSUM,
      preconditionSchemaHash: entry.preconditionSchemaHash,
      postconditionSchemaHash: entry.postconditionSchemaHash,
      transactional: true
    }),
    sqlBytes: Buffer.from(sqlBytes)
  });
  return retainedAssets;
}

function readExactAsset(kind: keyof typeof ASSETS): Buffer {
  const expected = ASSETS[kind];
  const resolved = resolveAssetPath(expected.url, expected.basename);
  const listed = fs.lstatSync(resolved);
  if (!listed.isFile() || listed.isSymbolicLink() || listed.nlink !== 1) {
    throw new Error(`sequence4_asset_path_invalid:${kind}`);
  }
  const descriptor = fs.openSync(
    resolved,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)
  );
  try {
    const opened = fs.fstatSync(descriptor);
    if (
      !opened.isFile()
      || opened.dev !== listed.dev
      || opened.ino !== listed.ino
      || opened.nlink !== 1
      || opened.size !== expected.byteLength
    ) {
      throw new Error(`sequence4_asset_path_invalid:${kind}`);
    }
    const bytes = Buffer.allocUnsafe(expected.byteLength);
    let offset = 0;
    while (offset < bytes.length) {
      const read = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (read === 0) throw new Error(`sequence4_asset_read_invalid:${kind}`);
      offset += read;
    }
    if (hashRawBytes(bytes) !== expected.rawHash) {
      throw new Error(`sequence4_asset_checksum_invalid:${kind}`);
    }
    return bytes;
  } finally {
    fs.closeSync(descriptor);
  }
}

function resolveAssetPath(url: URL, expectedBasename: string): string {
  const serialized = String(url);
  const extension = path.extname(expectedBasename);
  const stem = expectedBasename.slice(0, -extension.length);
  const escapedStem = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedExtension = extension.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const acceptedName = new RegExp(
    `^${escapedStem}(?:[.-][0-9a-f]+)?${escapedExtension}$`
  );
  if (serialized.startsWith("file:")) {
    const candidate = fs.realpathSync.native(fileURLToPath(serialized));
    const moduleDirectory = fs.realpathSync.native(
      path.dirname(fileURLToPath(import.meta.url))
    );
    const relative = path.relative(moduleDirectory, candidate);
    if (
      relative === ""
      || relative === ".."
      || relative.startsWith(`..${path.sep}`)
      || path.isAbsolute(relative)
      || !acceptedName.test(path.basename(candidate))
    ) {
      throw new Error("sequence4_asset_path_invalid");
    }
    return candidate;
  }
  const assetName = path.basename(serialized.replace(/[?#].*$/, ""));
  if (!acceptedName.test(assetName)) throw new Error("sequence4_asset_path_invalid");
  const start =
    typeof __dirname === "string"
      ? __dirname
      : path.dirname(fileURLToPath(import.meta.url));
  let current = start;
  for (;;) {
    const candidate = path.join(current, "static", "media", assetName);
    if (fs.existsSync(candidate)) return fs.realpathSync.native(candidate);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error("sequence4_asset_path_invalid");
}

function parseCanonicalManifest(bytes: Buffer): Record<string, JsonValue> {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const parsed = JSON.parse(text) as unknown;
  const manifest = requireRecord(parsed, "Sequence 4 manifest");
  if (`${canonicalizeJson(manifest)}\n` !== text) {
    throw new Error("sequence4_manifest_not_canonical");
  }
  return manifest;
}

function requireRecord(value: unknown, label: string): Record<string, JsonValue> {
  if (!isPlainRecord(value)) throw new TypeError(`${label} must be an object.`);
  return value as Record<string, JsonValue>;
}
