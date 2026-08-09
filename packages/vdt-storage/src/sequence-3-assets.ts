import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalizeJson, hashFramed, hashRawBytes } from "./canonical";
import type { JsonValue, Sha256 } from "./types";

const ASSET_URLS = Object.freeze({
  manifest: new URL("./migrations/migration-manifest-v2.json", import.meta.url),
  sql: new URL("./migrations/003-durable-agent-run-coordination.sql", import.meta.url),
  module: new URL(
    "./migrations/transforms/legacy-agent-run-adoption-v1.wasm",
    import.meta.url
  ),
  abi: new URL(
    "./migrations/transforms/legacy-agent-run-adoption-abi.v1.json",
    import.meta.url
  ),
  vectors: new URL(
    "./migrations/transforms/legacy-agent-run-adoption-v1.golden-vectors.json",
    import.meta.url
  )
});

const EXPECTED = Object.freeze({
  manifest: {
    basename: "migration-manifest-v2.json",
    length: 2_328,
    raw: "sha256:057b285989edc872ff5a91bc3f8aa3af42994fd772665fe4ef675bb15f060eb7"
  },
  sql: {
    basename: "003-durable-agent-run-coordination.sql",
    length: 158_462,
    raw: "sha256:2bb4eacb0f2565975a1318f5d6a917a325e69337677651a87c21710c6451bbda"
  },
  module: {
    basename: "legacy-agent-run-adoption-v1.wasm",
    length: 1_883,
    raw: "sha256:7c108b454c4bd87181be44ef856aa9d3fdc38d67bd5cb91a98eb169592f2f4dc"
  },
  abi: {
    basename: "legacy-agent-run-adoption-abi.v1.json",
    length: 8_203,
    raw: "sha256:135d5e068534d3b70faaa1a64fffe1462b2b406c4cbdba33b67901b436b1f7c5"
  },
  vectors: {
    basename: "legacy-agent-run-adoption-v1.golden-vectors.json",
    length: 121_310_783,
    raw: "sha256:0cea8ae8156c3885219d11d496b686ab1a5420e01f3ebc74fa579be8eabe6467"
  }
} as const);

const TRANSFORM_IDENTITY = Object.freeze({
  transformId: "legacy-agent-run-adoption-v1",
  transformVersion: 1,
  artifactFormat: "wasm32-no-imports-v1",
  abiVersion: "legacy-agent-run-adoption-abi.v1"
});

export interface Sequence3TransformIdentity {
  readonly transformId: "legacy-agent-run-adoption-v1";
  readonly transformVersion: 1;
  readonly artifactFormat: "wasm32-no-imports-v1";
  readonly abiVersion: "legacy-agent-run-adoption-abi.v1";
}

export interface VerifiedSequence3Assets {
  readonly identity: Sequence3TransformIdentity;
  readonly sqlText: string;
  readonly module: WebAssembly.Module;
  readonly manifestHash: Sha256;
  readonly sqlChecksum: Sha256;
  readonly moduleChecksum: Sha256;
  readonly contractChecksum: Sha256;
  readonly goldenVectorsChecksum: Sha256;
  readonly postconditionSchemaHash: Sha256;
}

export interface Sequence3GoldenVectorRegistry {
  readonly fixtureMigrationIdentity: Readonly<Record<string, JsonValue>>;
  readonly fixtureCommitTimestamp: string;
  readonly abiVectors: readonly Record<string, JsonValue>[];
  readonly hostVectors: readonly Record<string, JsonValue>[];
  readonly vectorSetHash: Sha256;
  readonly vectorResultSetHash: Sha256;
}

interface RetainedAssets {
  readonly public: VerifiedSequence3Assets;
  readonly vectors: Sequence3GoldenVectorRegistry;
}

let retained: RetainedAssets | undefined;

export function loadVerifiedSequence3Assets(): VerifiedSequence3Assets {
  return loadRetained().public;
}

/**
 * Production preflight input. The transform host consumes every retained host
 * vector before a runner may proceed to backup or DDL.
 */
export function loadSequence3TransformPreflightRegistry(): Sequence3GoldenVectorRegistry {
  return loadRetained().vectors;
}

/** Test-only seam. It is intentionally absent from the package entrypoint. */
export function __loadSequence3GoldenVectorsForTests(): Sequence3GoldenVectorRegistry {
  return loadSequence3TransformPreflightRegistry();
}

function loadRetained(): RetainedAssets {
  if (retained) return retained;
  const manifestBytes = readExact("manifest");
  const sqlBytes = readExact("sql");
  const moduleBytes = readExact("module");
  const abiBytes = readExact("abi");
  const vectorBytes = readExact("vectors");

  const manifest = parseCanonicalJson(manifestBytes, true, "manifest");
  const abi = parseCanonicalJson(abiBytes, false, "ABI contract");
  const vectors = parseCanonicalJson(vectorBytes, false, "golden vectors");
  validateManifest(manifest, sqlBytes, moduleBytes, abiBytes, vectorBytes);
  validateAbiIdentity(abi);
  const registry = validateVectorRegistry(vectors);
  const compiled = validateStaticModule(moduleBytes);
  executeAbiVectors(compiled, registry.abiVectors);

  const sequence3 = asRecord(asArray(manifest.entries, "manifest.entries")[2], "entry");
  const entry = asRecord(sequence3.entry, "entry.entry");
  const transform = asRecord(sequence3.transform, "entry.transform");
  const sqlText = new TextDecoder("utf-8", { fatal: true }).decode(sqlBytes);
  retained = Object.freeze({
    public: Object.freeze({
      identity: TRANSFORM_IDENTITY,
      sqlText,
      module: compiled,
      manifestHash: manifest.manifestHash as Sha256,
      sqlChecksum: entry.sqlChecksum as Sha256,
      moduleChecksum: transform.moduleChecksum as Sha256,
      contractChecksum: transform.contractChecksum as Sha256,
      goldenVectorsChecksum: transform.goldenVectorsChecksum as Sha256,
      postconditionSchemaHash: entry.postconditionSchemaHash as Sha256
    }),
    vectors: registry
  });
  return retained;
}

function bundledAssetNamePattern(expectedBasename: string): RegExp {
  const extension = path.extname(expectedBasename);
  const stem = expectedBasename.slice(0, -extension.length);
  const escapedStem = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedExtension = extension.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escapedStem}(?:[.-][0-9a-f]+)?${escapedExtension}$`);
}

function resolveSequence3AssetPath(
  kind: keyof typeof ASSET_URLS,
  url: { toString(): string },
  expectedBasename: string
): string {
  const serialized = String(url);
  const bundledName = bundledAssetNamePattern(expectedBasename);

  if (serialized.startsWith("file:")) {
    const filePath = fileURLToPath(serialized);
    const moduleDirectory = fs.realpathSync.native(
      path.dirname(fileURLToPath(import.meta.url))
    );
    const resolvedPath = fs.realpathSync.native(filePath);
    const relativePath = path.relative(moduleDirectory, resolvedPath);
    if (
      relativePath === "" ||
      relativePath === ".." ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath) ||
      !bundledName.test(path.basename(resolvedPath))
    ) {
      throw new Error(`sequence3_asset_path_invalid:${kind}`);
    }
    return resolvedPath;
  }

  // Next/Webpack emits RelativeURL("/_next/static/media/<stem>.<hash><ext>")
  // while App Router modules live deeper under `.next/server/app/...`.
  const assetName = path.basename(serialized.replace(/[?#].*$/, ""));
  if (!bundledName.test(assetName)) {
    throw new Error(`sequence3_asset_path_invalid:${kind}`);
  }
  const startDirectory =
    typeof __dirname === "string"
      ? __dirname
      : path.dirname(fileURLToPath(import.meta.url));
  let current = startDirectory;
  for (;;) {
    const candidate = path.join(current, "static", "media", assetName);
    if (fs.existsSync(candidate)) {
      const resolvedPath = fs.realpathSync.native(candidate);
      const mediaDir = path.dirname(resolvedPath);
      if (
        path.basename(mediaDir) !== "media" ||
        path.basename(path.dirname(mediaDir)) !== "static" ||
        !bundledName.test(path.basename(resolvedPath))
      ) {
        throw new Error(`sequence3_asset_path_invalid:${kind}`);
      }
      return resolvedPath;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  throw new Error(`sequence3_asset_path_invalid:${kind}`);
}

function readExact(kind: keyof typeof ASSET_URLS): Buffer {
  const url = ASSET_URLS[kind];
  const expected = EXPECTED[kind];
  const resolvedPath = resolveSequence3AssetPath(kind, url, expected.basename);
  const listed = fs.lstatSync(resolvedPath);
  if (!listed.isFile() || listed.isSymbolicLink() || listed.nlink !== 1) {
    throw new Error(`sequence3_asset_path_invalid:${kind}`);
  }
  const before = fs.lstatSync(resolvedPath);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.dev !== listed.dev ||
    before.ino !== listed.ino ||
    before.nlink !== 1
  ) {
    throw new Error(`sequence3_asset_path_invalid:${kind}`);
  }
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(
      resolvedPath,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)
    );
    const opened = fs.fstatSync(descriptor);
    if (
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.nlink !== 1 ||
      opened.size !== expected.length ||
      opened.mtimeMs !== before.mtimeMs ||
      opened.ctimeMs !== before.ctimeMs
    ) {
      throw new Error(`sequence3_asset_identity_invalid:${kind}`);
    }
    const bytes = Buffer.allocUnsafe(opened.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (count === 0) throw new Error(`sequence3_asset_short_read:${kind}`);
      offset += count;
    }
    if (fs.readSync(descriptor, Buffer.alloc(1), 0, 1, bytes.length) !== 0) {
      throw new Error(`sequence3_asset_long_read:${kind}`);
    }
    const after = fs.fstatSync(descriptor);
    if (
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      after.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs ||
      after.ctimeMs !== opened.ctimeMs
    ) {
      throw new Error(`sequence3_asset_changed:${kind}`);
    }
    if (hashRawBytes(bytes) !== expected.raw) {
      throw new Error(`sequence3_asset_hash_invalid:${kind}`);
    }
    return bytes;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function parseCanonicalJson(bytes: Buffer, finalLf: boolean, label: string): Record<string, JsonValue> {
  const value = parseStrictJson(bytes, label);
  const expected = Buffer.from(
    canonicalizeJson(value as JsonValue) + (finalLf ? "\n" : ""),
    "utf8"
  );
  if (!bytes.equals(expected)) throw new Error(`sequence3_json_noncanonical:${label}`);
  return asRecord(value, label);
}

function parseStrictJson(bytes: Buffer, label: string): JsonValue {
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`sequence3_json_utf8:${label}`);
  }
  let cursor = 0;
  const ws = () => {
    while (" \n\r\t".includes(source[cursor] ?? "\u0000")) cursor += 1;
  };
  const string = (): string => {
    const start = cursor++;
    while (cursor < source.length) {
      const code = source.charCodeAt(cursor);
      if (code === 0x22) {
        cursor += 1;
        return JSON.parse(source.slice(start, cursor)) as string;
      }
      if (code < 0x20) throw new Error(`sequence3_json_syntax:${label}`);
      cursor += code === 0x5c ? 2 : 1;
    }
    throw new Error(`sequence3_json_syntax:${label}`);
  };
  const value = (): JsonValue => {
    ws();
    const token = source[cursor];
    if (token === "{") {
      cursor += 1;
      const result: Record<string, JsonValue> = Object.create(null);
      const keys = new Set<string>();
      ws();
      if (source[cursor] === "}") {
        cursor += 1;
        return result;
      }
      while (true) {
        ws();
        if (source[cursor] !== '"') throw new Error(`sequence3_json_syntax:${label}`);
        const key = string();
        if (keys.has(key)) throw new Error(`sequence3_json_duplicate_key:${label}`);
        keys.add(key);
        ws();
        if (source[cursor++] !== ":") throw new Error(`sequence3_json_syntax:${label}`);
        result[key] = value();
        ws();
        if (source[cursor] === "}") {
          cursor += 1;
          return result;
        }
        if (source[cursor++] !== ",") throw new Error(`sequence3_json_syntax:${label}`);
      }
    }
    if (token === "[") {
      cursor += 1;
      const result: JsonValue[] = [];
      ws();
      if (source[cursor] === "]") {
        cursor += 1;
        return result;
      }
      while (true) {
        result.push(value());
        ws();
        if (source[cursor] === "]") {
          cursor += 1;
          return result;
        }
        if (source[cursor++] !== ",") throw new Error(`sequence3_json_syntax:${label}`);
      }
    }
    if (token === '"') return string();
    for (const [literal, parsed] of [["true", true], ["false", false], ["null", null]] as const) {
      if (source.startsWith(literal, cursor)) {
        cursor += literal.length;
        return parsed;
      }
    }
    const match = source.slice(cursor).match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);
    if (!match) throw new Error(`sequence3_json_syntax:${label}`);
    cursor += match[0].length;
    const parsed = Number(match[0]);
    if (!Number.isFinite(parsed)) throw new Error(`sequence3_json_number:${label}`);
    return parsed;
  };
  const parsed = value();
  ws();
  if (cursor !== source.length) throw new Error(`sequence3_json_syntax:${label}`);
  return parsed;
}

function validateManifest(
  manifest: Record<string, JsonValue>,
  sql: Buffer,
  module: Buffer,
  abi: Buffer,
  vectors: Buffer
): void {
  const historicalEntries = [
    {
      sequence: 1,
      migrationId: "001-legacy-v1-bootstrap",
      fromUserVersion: 0,
      toUserVersion: 1,
      sqlByteLength: 4_304,
      sqlChecksum: "sha256:eed70d7619cdccb8aa6137d215704863e8419191e809ef94153b593e9f8b6df2",
      preconditionSchemaHash: "sha256:c0e1e0f6e95438816ce50759cd743dde638aef811801cedbc327ad50e2b8fa5b",
      postconditionSchemaHash: "sha256:69e76d8d69bd6e84aaf1eaa086c5e03e865fc3698cf234a905bb14e844828748",
      transactional: true
    },
    {
      sequence: 2,
      migrationId: "002-atomic-revisions",
      fromUserVersion: 1,
      toUserVersion: 2,
      sqlByteLength: 6_972,
      sqlChecksum: "sha256:581d35e2d660d40d51a1405997c11aac0337ca77dbeccabaf40deb8aa6098eea",
      preconditionSchemaHash: "sha256:69e76d8d69bd6e84aaf1eaa086c5e03e865fc3698cf234a905bb14e844828748",
      postconditionSchemaHash: "sha256:b3eda62829523baced9238894eaabbb3cad30721b75bf02a59166bf4d759bb02",
      transactional: true
    }
  ] as const;
  exactKeys(manifest, [
    "schemaVersion", "manifestVersion", "historicalPrefixManifestHash",
    "manifestHash", "entries"
  ], "manifest");
  if (
    manifest.schemaVersion !== "migration_manifest.v2" ||
    manifest.manifestVersion !== 2 ||
    manifest.historicalPrefixManifestHash !==
      "sha256:f36158d9e2783a8cd1a9bd41f7d22da1d425a296dec95c8d272bb8fd789686ad"
  ) throw new Error("sequence3_manifest_identity_invalid");
  const withoutHash = { ...manifest };
  delete withoutHash.manifestHash;
  const computed = hashFramed(
    "vdt-studio/migration-manifest",
    "migration_manifest_hash.v2",
    {},
    Buffer.from(canonicalizeJson(withoutHash as JsonValue))
  );
  if (
    manifest.manifestHash !== computed ||
    manifest.manifestHash !==
      "sha256:791fc7c7cce9abd11b2509ddaa6ba9e92e469178a3d1add6803b083295c849e8"
  ) throw new Error("sequence3_manifest_hash_invalid");
  const entries = asArray(manifest.entries, "manifest.entries");
  if (entries.length !== 3) throw new Error("sequence3_manifest_entries_invalid");
  for (let index = 0; index < historicalEntries.length; index += 1) {
    const wrapper = asRecord(entries[index], `manifest.entries[${index}]`);
    exactKeys(wrapper, ["entryKind", "entry"], `manifest.entries[${index}]`);
    if (
      wrapper.entryKind !== "v1_entry_projection" ||
      canonicalizeJson(asRecord(wrapper.entry, `manifest.entries[${index}].entry`)) !==
        canonicalizeJson(historicalEntries[index] as unknown as JsonValue)
    ) {
      throw new Error("sequence3_manifest_historical_entry_invalid");
    }
  }
  const historicalManifestHash = hashFramed(
    "vdt-studio/migration-manifest",
    "migration_manifest_hash.v1",
    {
      schemaVersion: "migration_manifest.v1",
      manifestVersion: 1,
      entries: historicalEntries
    } as unknown as JsonValue
  );
  if (manifest.historicalPrefixManifestHash !== historicalManifestHash) {
    throw new Error("sequence3_manifest_historical_hash_invalid");
  }
  const third = asRecord(entries[2], "manifest.entries[2]");
  exactKeys(third, ["entryKind", "entry", "transform"], "manifest.entries[2]");
  const entry = asRecord(third.entry, "manifest.entries[2].entry");
  exactKeys(entry, [
    "sequence", "migrationId", "fromUserVersion", "toUserVersion",
    "sqlByteLength", "sqlChecksum", "preconditionSchemaHash",
    "postconditionSchemaHash", "transactional"
  ], "manifest.entries[2].entry");
  const transform = asRecord(third.transform, "manifest.entries[2].transform");
  exactKeys(transform, [
    "schemaVersion", "transformId", "transformVersion", "artifactFormat",
    "abiVersion", "phase", "moduleByteLength", "moduleChecksum",
    "contractByteLength", "contractChecksum", "goldenVectorsByteLength",
    "goldenVectorsChecksum"
  ], "manifest.entries[2].transform");
  if (
    third.entryKind !== "transactional_transform_v1" ||
    entry.sequence !== 3 ||
    entry.migrationId !== "003-durable-agent-run-coordination" ||
    entry.fromUserVersion !== 2 ||
    entry.toUserVersion !== 3 ||
    entry.preconditionSchemaHash !==
      "sha256:b3eda62829523baced9238894eaabbb3cad30721b75bf02a59166bf4d759bb02" ||
    entry.postconditionSchemaHash !==
      "sha256:c4206299c5399b4ee113c920f02af650aa39ad6af452f5c46330dcec10adbb5a" ||
    entry.sqlByteLength !== sql.length ||
    entry.transactional !== true ||
    transform.schemaVersion !== "migration_transactional_transform_binding.v1" ||
    transform.transformId !== TRANSFORM_IDENTITY.transformId ||
    transform.transformVersion !== TRANSFORM_IDENTITY.transformVersion ||
    transform.artifactFormat !== TRANSFORM_IDENTITY.artifactFormat ||
    transform.abiVersion !== TRANSFORM_IDENTITY.abiVersion ||
    transform.phase !== "after_sql_before_application_record" ||
    transform.moduleByteLength !== module.length ||
    transform.contractByteLength !== abi.length ||
    transform.goldenVectorsByteLength !== vectors.length
  ) throw new Error("sequence3_manifest_graph_invalid");
  const sqlChecksum = hashFramed(
    "vdt-studio/sql-migration",
    "sql_migration_hash.v1",
    {
      sequence: 3,
      migrationId: entry.migrationId,
      fromUserVersion: 2,
      toUserVersion: 3,
      preconditionSchemaHash: entry.preconditionSchemaHash,
      postconditionSchemaHash: entry.postconditionSchemaHash
    } as JsonValue,
    sql
  );
  for (const [actual, domain, schema, body] of [
    [transform.moduleChecksum, "vdt-studio/migration-transform-module", "migration_transform_module_hash.v1", module],
    [transform.contractChecksum, "vdt-studio/migration-transform-contract", "migration_transform_contract_hash.v1", abi],
    [transform.goldenVectorsChecksum, "vdt-studio/migration-transform-golden-vectors", "migration_transform_golden_vectors_hash.v1", vectors]
  ] as const) {
    if (actual !== hashFramed(domain, schema, TRANSFORM_IDENTITY as unknown as JsonValue, body)) {
      throw new Error("sequence3_manifest_asset_checksum_invalid");
    }
  }
  if (entry.sqlChecksum !== sqlChecksum) throw new Error("sequence3_manifest_sql_checksum_invalid");
}

function validateAbiIdentity(value: Record<string, JsonValue>): void {
  if (
    value.schemaVersion !== "legacy_agent_run_adoption_abi_contract.v1" ||
    value.transformId !== TRANSFORM_IDENTITY.transformId ||
    value.transformVersion !== 1 ||
    value.artifactFormat !== TRANSFORM_IDENTITY.artifactFormat ||
    value.abiVersion !== TRANSFORM_IDENTITY.abiVersion ||
    value.phase !== "after_sql_before_application_record"
  ) throw new Error("sequence3_abi_identity_invalid");
}

function validateVectorRegistry(value: Record<string, JsonValue>): Sequence3GoldenVectorRegistry {
  exactKeys(value, [
    "schemaVersion", "transformId", "transformVersion", "artifactFormat",
    "abiVersion", "fixtureMigrationIdentity", "fixtureCommitTimestamp",
    "abiVectorCount", "hostAcceptedVectorCount", "hostBlockedVectorCount",
    "hostVectorCount", "vectorCount", "abiVectors", "hostVectors",
    "vectorSetHash", "vectorResultSetHash"
  ], "vectors");
  const abiVectors = asArray(value.abiVectors, "vectors.abiVectors").map(
    (entry, index) => asRecord(entry, `abiVectors[${index}]`)
  );
  const hostVectors = asArray(value.hostVectors, "vectors.hostVectors").map(
    (entry, index) => asRecord(entry, `hostVectors[${index}]`)
  );
  const fixtureMigrationIdentity = asRecord(
    value.fixtureMigrationIdentity,
    "fixtureMigrationIdentity"
  );
  exactKeys(fixtureMigrationIdentity, [
    "schemaVersion", "databaseId", "attemptId", "backupEvidenceId",
    "fenceOwnerToken", "fenceLeaseGeneration", "targetManifestHash", "sequence",
    "migrationId", "sqlChecksum", "transformId", "transformVersion",
    "moduleChecksum", "contractChecksum", "goldenVectorsChecksum"
  ], "fixtureMigrationIdentity");
  if (
    value.schemaVersion !== "legacy_agent_run_adoption_golden_vectors.v1" ||
    value.transformId !== TRANSFORM_IDENTITY.transformId ||
    value.transformVersion !== TRANSFORM_IDENTITY.transformVersion ||
    value.artifactFormat !== TRANSFORM_IDENTITY.artifactFormat ||
    value.abiVersion !== TRANSFORM_IDENTITY.abiVersion ||
    value.fixtureCommitTimestamp !== "2026-07-24T00:00:00.000Z" ||
    fixtureMigrationIdentity.schemaVersion !== "migration_application_identity.v1" ||
    fixtureMigrationIdentity.databaseId !== "db_test" ||
    fixtureMigrationIdentity.attemptId !== "migration_attempt_test" ||
    fixtureMigrationIdentity.backupEvidenceId !== "migration_backup_test" ||
    fixtureMigrationIdentity.fenceOwnerToken !== "owner_test" ||
    fixtureMigrationIdentity.fenceLeaseGeneration !== 1 ||
    fixtureMigrationIdentity.targetManifestHash !==
      "sha256:1111111111111111111111111111111111111111111111111111111111111111" ||
    fixtureMigrationIdentity.sequence !== 3 ||
    fixtureMigrationIdentity.migrationId !== "003-durable-agent-run-coordination" ||
    fixtureMigrationIdentity.sqlChecksum !==
      "sha256:2222222222222222222222222222222222222222222222222222222222222222" ||
    fixtureMigrationIdentity.transformId !== TRANSFORM_IDENTITY.transformId ||
    fixtureMigrationIdentity.transformVersion !== TRANSFORM_IDENTITY.transformVersion ||
    fixtureMigrationIdentity.moduleChecksum !==
      "sha256:3333333333333333333333333333333333333333333333333333333333333333" ||
    fixtureMigrationIdentity.contractChecksum !==
      "sha256:4444444444444444444444444444444444444444444444444444444444444444" ||
    fixtureMigrationIdentity.goldenVectorsChecksum !==
      "sha256:5555555555555555555555555555555555555555555555555555555555555555" ||
    value.abiVectorCount !== 55 ||
    value.hostAcceptedVectorCount !== 36 ||
    value.hostBlockedVectorCount !== 168 ||
    value.hostVectorCount !== 204 ||
    value.vectorCount !== 259 ||
    abiVectors.length !== 55 ||
    hostVectors.length !== 204
  ) throw new Error("sequence3_vector_count_invalid");
  const ids = [...abiVectors, ...hostVectors].map((entry) => String(entry.vectorId));
  if (new Set(ids).size !== 259) throw new Error("sequence3_vector_id_invalid");
  for (const list of [abiVectors, hostVectors]) {
    for (let index = 1; index < list.length; index += 1) {
      if (Buffer.compare(Buffer.from(String(list[index - 1]!.vectorId)), Buffer.from(String(list[index]!.vectorId))) >= 0) {
        throw new Error("sequence3_vector_order_invalid");
      }
    }
  }
  const allVectors = [
    ...abiVectors.map((vector) => ({ vectorKind: "abi" as const, vector })),
    ...hostVectors.map((vector) => ({ vectorKind: "host" as const, vector }))
  ];
  const byVectorId = (
    left: { vectorId: JsonValue | undefined },
    right: { vectorId: JsonValue | undefined }
  ) => Buffer.compare(Buffer.from(String(left.vectorId)), Buffer.from(String(right.vectorId)));
  const inputProjection = allVectors
    .map(({ vectorKind, vector }) =>
      vectorKind === "abi"
        ? {
            vectorKind,
            vectorId: vector.vectorId,
            input: {
              initialMemoryPatches: vector.initialMemoryPatches,
              initialMemoryRawSha256: vector.initialMemoryRawSha256,
              invocation: vector.invocation
            }
          }
        : { vectorKind, vectorId: vector.vectorId, input: vector.input }
    )
    .sort(byVectorId);
  const resultProjection = allVectors
    .map(({ vectorKind, vector }) => ({
      vectorKind,
      vectorId: vector.vectorId,
      expected: vector.expected
    }))
    .sort(byVectorId);
  const projectionMetadata = TRANSFORM_IDENTITY as unknown as JsonValue;
  const vectorSetHash = hashFramed(
    "vdt-studio/migration-transform-vector-set",
    "migration_transform_vector_set_hash.v1",
    projectionMetadata,
    Buffer.from(canonicalizeJson(inputProjection as unknown as JsonValue), "utf8")
  );
  const vectorResultSetHash = hashFramed(
    "vdt-studio/migration-transform-vector-results",
    "migration_transform_vector_results_hash.v1",
    projectionMetadata,
    Buffer.from(canonicalizeJson(resultProjection as unknown as JsonValue), "utf8")
  );
  if (
    value.vectorSetHash !== vectorSetHash ||
    value.vectorSetHash !==
      "sha256:ed66c27225bf411b8369772cb646f1481a58c6c2e89b3a3adc08c8ace35fab0e" ||
    value.vectorResultSetHash !== vectorResultSetHash ||
    value.vectorResultSetHash !==
      "sha256:494c7fc1ba5d730e30de733c620554ee6badad9db42a5a33aa1b06c36dfac3d1"
  ) {
    throw new Error("sequence3_vector_projection_hash_invalid");
  }
  return Object.freeze({
    fixtureMigrationIdentity: Object.freeze(fixtureMigrationIdentity),
    fixtureCommitTimestamp: String(value.fixtureCommitTimestamp),
    abiVectors: Object.freeze(abiVectors),
    hostVectors: Object.freeze(hostVectors),
    vectorSetHash,
    vectorResultSetHash
  });
}

function validateStaticModule(bytes: Buffer): WebAssembly.Module {
  const moduleBytes = Uint8Array.from(bytes);
  if (
    !bytes.subarray(0, 8).equals(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0])) ||
    !WebAssembly.validate(moduleBytes)
  ) throw new Error("sequence3_wasm_invalid");
  validateStaticProfile(bytes);
  const compiled = new WebAssembly.Module(moduleBytes);
  if (WebAssembly.Module.imports(compiled).length !== 0) {
    throw new Error("sequence3_wasm_imports_forbidden");
  }
  const exports = WebAssembly.Module.exports(compiled);
  if (
    canonicalizeJson(exports as unknown as JsonValue) !==
      canonicalizeJson([
        { name: "memory", kind: "memory" },
        { name: "transform_row", kind: "function" }
      ])
  ) throw new Error("sequence3_wasm_exports_invalid");
  return compiled;
}

const WASM_OPCODE = Object.freeze({
  block: 0x02,
  if: 0x04,
  else: 0x05,
  end: 0x0b,
  br: 0x0c,
  brIf: 0x0d,
  return: 0x0f,
  localGet: 0x20,
  localSet: 0x21,
  localTee: 0x22,
  i32Load: 0x28,
  i64Load: 0x29,
  i32Load8U: 0x2d,
  i32Load16U: 0x2f,
  i32Store: 0x36,
  i32Store8: 0x3a,
  i32Store16: 0x3b,
  i32Const: 0x41,
  i64Const: 0x42,
  i32Eqz: 0x45,
  i32Eq: 0x46,
  i32Ne: 0x47,
  i32LtU: 0x49,
  i32GtU: 0x4b,
  i32LeU: 0x4d,
  i32GeU: 0x4f,
  i64Eq: 0x51,
  i64Ne: 0x52,
  i64LtU: 0x54,
  i64GtU: 0x56,
  i64LeU: 0x58,
  i64GeU: 0x5a,
  i32Add: 0x6a,
  i32Sub: 0x6b,
  i32And: 0x71,
  i32Or: 0x72
});

class WasmCursor {
  offset = 0;

  constructor(readonly bytes: Buffer) {}

  byte(): number {
    if (this.offset >= this.bytes.length) throw new Error("sequence3_wasm_profile_invalid");
    return this.bytes[this.offset++]!;
  }

  bytesExact(length: number): Buffer {
    if (!Number.isSafeInteger(length) || length < 0 || this.offset + length > this.bytes.length) {
      throw new Error("sequence3_wasm_profile_invalid");
    }
    const value = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  unsigned(): number {
    const start = this.offset;
    let value = 0;
    let shift = 0;
    for (let count = 0; count < 5; count += 1) {
      const byte = this.byte();
      value += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) {
        const encoded = encodeUnsignedLeb(value);
        if (!encoded.equals(this.bytes.subarray(start, this.offset))) {
          throw new Error("sequence3_wasm_profile_invalid");
        }
        return value;
      }
      shift += 7;
    }
    throw new Error("sequence3_wasm_profile_invalid");
  }

  signed(bits: 32 | 64): bigint {
    const start = this.offset;
    let value = 0n;
    let shift = 0n;
    const maximumBytes = bits === 32 ? 5 : 10;
    for (let count = 0; count < maximumBytes; count += 1) {
      const byte = this.byte();
      value |= BigInt(byte & 0x7f) << shift;
      shift += 7n;
      if ((byte & 0x80) === 0) {
        if ((byte & 0x40) !== 0) value |= -1n << shift;
        const encoded = encodeSignedLeb(BigInt.asIntN(bits, value), bits);
        if (!encoded.equals(this.bytes.subarray(start, this.offset))) {
          throw new Error("sequence3_wasm_profile_invalid");
        }
        return value;
      }
    }
    throw new Error("sequence3_wasm_profile_invalid");
  }
}

function encodeUnsignedLeb(input: number): Buffer {
  if (!Number.isInteger(input) || input < 0 || input > 0xffff_ffff) {
    throw new Error("sequence3_wasm_profile_invalid");
  }
  let value = input;
  const bytes: number[] = [];
  do {
    let byte = value % 128;
    value = Math.floor(value / 128);
    if (value !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (value !== 0);
  return Buffer.from(bytes);
}

function encodeSignedLeb(input: bigint, bits: 32 | 64): Buffer {
  const minimum = -(1n << BigInt(bits - 1));
  const maximum = (1n << BigInt(bits - 1)) - 1n;
  if (input < minimum || input > maximum) {
    throw new Error("sequence3_wasm_profile_invalid");
  }
  let value = input;
  const bytes: number[] = [];
  while (true) {
    let byte = Number(value & 0x7fn);
    value >>= 7n;
    const done =
      (value === 0n && (byte & 0x40) === 0) ||
      (value === -1n && (byte & 0x40) !== 0);
    if (!done) byte |= 0x80;
    bytes.push(byte);
    if (done) return Buffer.from(bytes);
  }
}

function validateStaticProfile(bytes: Buffer): void {
  const cursor = new WasmCursor(bytes);
  if (!cursor.bytesExact(8).equals(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]))) {
    throw new Error("sequence3_wasm_profile_invalid");
  }
  const sections: { id: number; body: Buffer }[] = [];
  while (cursor.offset < bytes.length) {
    const id = cursor.byte();
    const length = cursor.unsigned();
    sections.push({ id, body: cursor.bytesExact(length) });
  }
  if (sections.map(({ id }) => id).join(",") !== "1,3,5,7,10") {
    throw new Error("sequence3_wasm_profile_invalid");
  }

  const type = new WasmCursor(sections[0]!.body);
  if (type.unsigned() !== 1 || type.byte() !== 0x60 || type.unsigned() !== 4) {
    throw new Error("sequence3_wasm_profile_invalid");
  }
  for (let index = 0; index < 4; index += 1) {
    if (type.byte() !== 0x7f) throw new Error("sequence3_wasm_profile_invalid");
  }
  if (
    type.unsigned() !== 1 ||
    type.byte() !== 0x7f ||
    type.offset !== type.bytes.length
  ) {
    throw new Error("sequence3_wasm_profile_invalid");
  }

  const functions = new WasmCursor(sections[1]!.body);
  if (
    functions.unsigned() !== 1 ||
    functions.unsigned() !== 0 ||
    functions.offset !== functions.bytes.length
  ) {
    throw new Error("sequence3_wasm_profile_invalid");
  }

  const memories = new WasmCursor(sections[2]!.body);
  if (
    memories.unsigned() !== 1 ||
    memories.unsigned() !== 1 ||
    memories.unsigned() !== 1 ||
    memories.unsigned() !== 1 ||
    memories.offset !== memories.bytes.length
  ) {
    throw new Error("sequence3_wasm_profile_invalid");
  }

  const exports = new WasmCursor(sections[3]!.body);
  if (exports.unsigned() !== 2) throw new Error("sequence3_wasm_profile_invalid");
  const readName = (): string => {
    const encoded = exports.bytesExact(exports.unsigned());
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(encoded);
    if (!Buffer.from(decoded, "utf8").equals(encoded)) {
      throw new Error("sequence3_wasm_profile_invalid");
    }
    return decoded;
  };
  if (
    readName() !== "memory" ||
    exports.byte() !== 2 ||
    exports.unsigned() !== 0 ||
    readName() !== "transform_row" ||
    exports.byte() !== 0 ||
    exports.unsigned() !== 0 ||
    exports.offset !== exports.bytes.length
  ) {
    throw new Error("sequence3_wasm_profile_invalid");
  }

  const code = new WasmCursor(sections[4]!.body);
  if (code.unsigned() !== 1) throw new Error("sequence3_wasm_profile_invalid");
  const body = new WasmCursor(code.bytesExact(code.unsigned()));
  if (code.offset !== code.bytes.length) throw new Error("sequence3_wasm_profile_invalid");
  const localGroups = body.unsigned();
  let localCount = 0;
  let i32Locals = 0;
  let i64Locals = 0;
  for (let index = 0; index < localGroups; index += 1) {
    const count = body.unsigned();
    const typeCode = body.byte();
    if (typeCode !== 0x7f && typeCode !== 0x7e) {
      throw new Error("sequence3_wasm_profile_invalid");
    }
    localCount += count;
    if (typeCode === 0x7f) i32Locals += count;
    else i64Locals += count;
  }
  if (i32Locals > 16 || i64Locals > 4) {
    throw new Error("sequence3_wasm_profile_invalid");
  }

  const allowed = new Set<number>(Object.values(WASM_OPCODE));
  const controls: { kind: "function" | "block" | "if"; elseSeen: boolean }[] = [
    { kind: "function", elseSeen: false }
  ];
  while (controls.length > 0) {
    const opcode = body.byte();
    if (!allowed.has(opcode)) throw new Error("sequence3_wasm_profile_invalid");
    if (opcode === WASM_OPCODE.block || opcode === WASM_OPCODE.if) {
      if (body.byte() !== 0x40) throw new Error("sequence3_wasm_profile_invalid");
      controls.push({
        kind: opcode === WASM_OPCODE.if ? "if" : "block",
        elseSeen: false
      });
    } else if (opcode === WASM_OPCODE.else) {
      const top = controls[controls.length - 1];
      if (!top || top.kind !== "if" || top.elseSeen) {
        throw new Error("sequence3_wasm_profile_invalid");
      }
      top.elseSeen = true;
    } else if (opcode === WASM_OPCODE.end) {
      controls.pop();
    } else if (opcode === WASM_OPCODE.br || opcode === WASM_OPCODE.brIf) {
      if (body.unsigned() >= controls.length) {
        throw new Error("sequence3_wasm_profile_invalid");
      }
    } else if (
      opcode === WASM_OPCODE.localGet ||
      opcode === WASM_OPCODE.localSet ||
      opcode === WASM_OPCODE.localTee
    ) {
      if (body.unsigned() >= 4 + localCount) {
        throw new Error("sequence3_wasm_profile_invalid");
      }
    } else if (
      opcode === WASM_OPCODE.i32Load ||
      opcode === WASM_OPCODE.i64Load ||
      opcode === WASM_OPCODE.i32Load8U ||
      opcode === WASM_OPCODE.i32Load16U ||
      opcode === WASM_OPCODE.i32Store ||
      opcode === WASM_OPCODE.i32Store8 ||
      opcode === WASM_OPCODE.i32Store16
    ) {
      const alignment = body.unsigned();
      const offset = body.unsigned();
      const naturalAlignment = new Map<number, number>([
        [WASM_OPCODE.i32Load, 2],
        [WASM_OPCODE.i64Load, 3],
        [WASM_OPCODE.i32Load8U, 0],
        [WASM_OPCODE.i32Load16U, 1],
        [WASM_OPCODE.i32Store, 2],
        [WASM_OPCODE.i32Store8, 0],
        [WASM_OPCODE.i32Store16, 1]
      ]).get(opcode);
      if (
        naturalAlignment === undefined ||
        alignment > naturalAlignment ||
        offset > 65_535
      ) {
        throw new Error("sequence3_wasm_profile_invalid");
      }
    } else if (opcode === WASM_OPCODE.i32Const) {
      body.signed(32);
    } else if (opcode === WASM_OPCODE.i64Const) {
      body.signed(64);
    }
  }
  if (body.offset !== body.bytes.length) {
    throw new Error("sequence3_wasm_profile_invalid");
  }
}

function executeAbiVectors(module: WebAssembly.Module, vectors: readonly Record<string, JsonValue>[]): void {
  for (const vector of vectors) {
    const instance = new WebAssembly.Instance(module);
    const exports = instance.exports as {
      memory: WebAssembly.Memory;
      transform_row: (a: number, b: number, c: number, d: number) => number;
    };
    const memory = new Uint8Array(exports.memory.buffer);
    for (const patchValue of asArray(vector.initialMemoryPatches, "patches")) {
      const patch = asRecord(patchValue, "patch");
      memory.set(Buffer.from(String(patch.bytesHex), "hex"), Number(patch.offset));
    }
    const invocation = asRecord(vector.invocation, "invocation");
    const result = exports.transform_row(
      Number(invocation.inputPtr),
      Number(invocation.inputLen),
      Number(invocation.outputPtr),
      Number(invocation.outputCap)
    );
    const expected = asRecord(vector.expected, "expected");
    if (result !== expected.returnValue || hashRawBytes(memory) !== expected.finalMemoryRawSha256) {
      throw new Error(`sequence3_abi_vector_mismatch:${String(vector.vectorId)}`);
    }
    if (expected.outcome === "success") {
      const output = memory.subarray(Number(invocation.outputPtr), Number(invocation.outputPtr) + 16);
      if (Buffer.from(output).toString("hex") !== expected.outputHex) {
        throw new Error(`sequence3_abi_vector_mismatch:${String(vector.vectorId)}`);
      }
    }
  }
}

function asRecord(value: unknown, label: string): Record<string, JsonValue> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`sequence3_schema_invalid:${label}`);
  }
  return value as Record<string, JsonValue>;
}
function asArray(value: unknown, label: string): JsonValue[] {
  if (!Array.isArray(value)) throw new Error(`sequence3_schema_invalid:${label}`);
  return value;
}
function exactKeys(value: Record<string, JsonValue>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value);
  if (actual.length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) {
    throw new Error(`sequence3_schema_invalid:${label}`);
  }
}
