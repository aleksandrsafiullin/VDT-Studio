import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const args = process.argv.slice(2);
if (args.length !== 1 || args[0] !== "--verify") {
  throw new Error("usage: verify-sequence-3-artifact-freeze.mjs --verify");
}

const EXPECTED_NODE_VERSION = "24.15.0";
if (process.versions.node !== EXPECTED_NODE_VERSION) {
  throw new Error(
    `Node ${EXPECTED_NODE_VERSION} is required; received ${process.versions.node}`
  );
}

const ROOT = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../.."));
const FREEZE_RECORD_PATH =
  "packages/vdt-storage/src/migrations/sequence-3-artifact-freeze.v1.json";
const QUERY =
  "SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name, tbl_name";
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const EMPTY = Buffer.alloc(0);
const TRANSFORM_METADATA = Object.freeze({
  transformId: "legacy-agent-run-adoption-v1",
  transformVersion: 1,
  artifactFormat: "wasm32-no-imports-v1",
  abiVersion: "legacy-agent-run-adoption-abi.v1"
});
const APPLICATION_IDENTITY_INPUT = Object.freeze({
  schemaVersion: "migration_application_identity.v1",
  databaseId: "db_test",
  attemptId: "migration_attempt_test",
  backupEvidenceId: "migration_backup_test",
  fenceOwnerToken: "owner_test",
  fenceLeaseGeneration: 1,
  targetManifestHash:
    "sha256:1111111111111111111111111111111111111111111111111111111111111111",
  sequence: 3,
  migrationId: "003-durable-agent-run-coordination",
  sqlChecksum:
    "sha256:2222222222222222222222222222222222222222222222222222222222222222",
  transformId: "legacy-agent-run-adoption-v1",
  transformVersion: 1,
  moduleChecksum:
    "sha256:3333333333333333333333333333333333333333333333333333333333333333",
  contractChecksum:
    "sha256:4444444444444444444444444444444444444444444444444444444444444444",
  goldenVectorsChecksum:
    "sha256:5555555555555555555555555555555555555555555555555555555555555555"
});
const EXPECTED_APPLICATION_ID =
  "migration_application_38822d88a1e56cbdca49f97f2e61813a91f766b8139a055b2a89df5dcf592253";

const HISTORICAL_SQL = Object.freeze([
  {
    path: "packages/vdt-storage/src/migrations/001-legacy-v1-bootstrap.sql",
    sequence: 1,
    migrationId: "001-legacy-v1-bootstrap",
    fromUserVersion: 0,
    toUserVersion: 1,
    byteLength: 4304,
    rawSha256: "sha256:285a037c50be8fa260e73b8fb5ced7788aa36f8d95e21617cc629e02c79a543f",
    sqlChecksum: "sha256:eed70d7619cdccb8aa6137d215704863e8419191e809ef94153b593e9f8b6df2",
    preconditionSchemaHash:
      "sha256:c0e1e0f6e95438816ce50759cd743dde638aef811801cedbc327ad50e2b8fa5b",
    postconditionSchemaHash:
      "sha256:69e76d8d69bd6e84aaf1eaa086c5e03e865fc3698cf234a905bb14e844828748"
  },
  {
    path: "packages/vdt-storage/src/migrations/002-atomic-revisions.sql",
    sequence: 2,
    migrationId: "002-atomic-revisions",
    fromUserVersion: 1,
    toUserVersion: 2,
    byteLength: 6972,
    rawSha256: "sha256:4e677b0310c703a82054826c97c1d16678059a6254cc9234d2a280872309c171",
    sqlChecksum: "sha256:581d35e2d660d40d51a1405997c11aac0337ca77dbeccabaf40deb8aa6098eea",
    preconditionSchemaHash:
      "sha256:69e76d8d69bd6e84aaf1eaa086c5e03e865fc3698cf234a905bb14e844828748",
    postconditionSchemaHash:
      "sha256:b3eda62829523baced9238894eaabbb3cad30721b75bf02a59166bf4d759bb02"
  }
]);
const HISTORICAL_PREFIX_HASH =
  "sha256:f36158d9e2783a8cd1a9bd41f7d22da1d425a296dec95c8d272bb8fd789686ad";
const PRECONDITION_SCHEMA_HASH =
  "sha256:b3eda62829523baced9238894eaabbb3cad30721b75bf02a59166bf4d759bb02";

const FROZEN_PATHS = Object.freeze({
  sql: "packages/vdt-storage/src/migrations/003-durable-agent-run-coordination.sql",
  module:
    "packages/vdt-storage/src/migrations/transforms/legacy-agent-run-adoption-v1.wasm",
  abiContract:
    "packages/vdt-storage/src/migrations/transforms/legacy-agent-run-adoption-abi.v1.json",
  goldenVectors:
    "packages/vdt-storage/src/migrations/transforms/legacy-agent-run-adoption-v1.golden-vectors.json",
  wasmBuilder: "packages/vdt-storage/scripts/build-legacy-agent-run-adoption-v1.mjs",
  schemaIntrospectionGenerator:
    "packages/vdt-storage/scripts/generate-sequence-3-schema-introspection.mjs",
  faultSpecGenerator:
    "packages/vdt-storage/scripts/generate-sequence-3-fault-vectors.mjs",
  manifestGenerator: "packages/vdt-storage/scripts/generate-migration-manifest-v2.mjs",
  freezeVerifier: "packages/vdt-storage/scripts/verify-sequence-3-artifact-freeze.mjs",
  manifest: "packages/vdt-storage/src/migrations/migration-manifest-v2.json",
  schemaIntrospection:
    "packages/vdt-storage/src/migrations/sequence-3-schema-introspection.v1.json",
  faultVectors: "packages/vdt-storage/src/migrations/sequence-3-fault-vectors.v1.json",
  sqlContract: "docs/architecture/SEQUENCE_3_SQL_FREEZE_CONTRACT.md",
  transformContract:
    "docs/architecture/LEGACY_AGENT_RUN_ADOPTION_TRANSFORM_CONTRACT.md",
  manifestPackagingFaultContract:
    "docs/architecture/SEQUENCE_3_MANIFEST_PACKAGING_AND_FAULT_CONTRACT.md"
});

const AUTHORITY_BEFORE = Object.freeze([
  [
    "apps/desktop/src-tauri/sidecars/vdt-local-runtime.manifest.json",
    584,
    "sha256:3829747cb105d133ad9fcf648342fd182b17c4b2fa2a9660a994fa7a4404b039"
  ],
  [
    "apps/desktop/src-tauri/sidecars/vdt-local-runtime.mjs",
    270857,
    "sha256:bc78eaaa80130493f516010d94146c3f90aec78aad2ab7fa22b7a4173267dd5b"
  ],
  [
    "apps/desktop/src-tauri/tauri.conf.json",
    1258,
    "sha256:b07513aa5f101d26fab489aec91046d35696266b7f9c427f2401a877d46843b1"
  ],
  [
    "apps/web/next.config.mjs",
    606,
    "sha256:89a1577642a019a45ab827eb337abf9376fc6e6658ba943b62870dcd35f42fd2"
  ],
  [
    "apps/web/package.json",
    1155,
    "sha256:5cfc66b2f28e5804010409bebc933e37b877f5a9bea66c10c58cf9faff453b02"
  ],
  [
    "package.json",
    3600,
    "sha256:1103e95731daf383917182362872b0b64a37e83850adc0ef11a7c5a25fb2da6f"
  ],
  [
    "packages/vdt-storage/package.json",
    326,
    "sha256:2294ad26b2cdffe7475d3f4bcc84a3c6bb1836ad445985ef80a7c63b2fb14612"
  ],
  [
    "packages/vdt-storage/src/index.ts",
    393,
    "sha256:abdc876e42dc8ccdf6452a6aedf3186fea78e790c520c610185cb351533ca10a"
  ],
  [
    "packages/vdt-storage/src/migrations.ts",
    168407,
    "sha256:46313036348ea8dd5ad8f3d828cc95ce7534e8b23434bde28507d77b6d163bb6"
  ],
  [
    "pnpm-lock.yaml",
    183756,
    "sha256:9b201c19821274074709005b7e78be1b39e0612e9c30a7514807f36bfb8cf847"
  ],
  [
    "scripts/prepare-desktop-sidecar.mjs",
    4656,
    "sha256:5bc0e4b207e7294df2e38f849bd6c320b126667e8f16190f9507c74da95e642d"
  ]
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function rawSha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function canonicalRawSha256(value) {
  const hash = createHash("sha256");
  const update = (item) => {
    if (item === null) {
      hash.update("null");
    } else if (
      typeof item === "boolean" ||
      typeof item === "string" ||
      typeof item === "number"
    ) {
      hash.update(JSON.stringify(item), "utf8");
    } else if (Array.isArray(item)) {
      hash.update("[");
      item.forEach((entry, index) => {
        if (index > 0) hash.update(",");
        update(entry);
      });
      hash.update("]");
    } else {
      assert(item !== undefined && typeof item === "object", "invalid canonical JSON value");
      hash.update("{");
      Object.keys(item)
        .sort()
        .forEach((key, index) => {
          if (index > 0) hash.update(",");
          hash.update(JSON.stringify(key), "utf8");
          hash.update(":");
          update(item[key]);
        });
      hash.update("}");
    }
  };
  update(value);
  return `sha256:${hash.digest("hex")}`;
}

function frame(bytes) {
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(bytes.byteLength));
  return Buffer.concat([length, bytes]);
}

function canonicalize(value) {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    assert(Number.isFinite(value), "canonical JSON contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  assert(value !== undefined && typeof value === "object", "invalid canonical JSON value");
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
    .join(",")}}`;
}

function hashFramed(domain, schema, metadata, body = EMPTY) {
  return `sha256:${createHash("sha256")
    .update(frame(Buffer.from(domain, "utf8")))
    .update(frame(Buffer.from(schema, "utf8")))
    .update(frame(Buffer.from(canonicalize(metadata), "utf8")))
    .update(frame(Buffer.from(body)))
    .digest("hex")}`;
}

function decodeUtf8(bytes, label) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} is not valid UTF-8`);
  }
  assert(Buffer.from(text, "utf8").equals(bytes), `${label} failed UTF-8 round-trip`);
  return text;
}

function parseStrictJson(text, label) {
  let index = 0;
  const fail = (message) => {
    throw new Error(`${label}: ${message} at byte ${index}`);
  };
  const whitespace = () => {
    while (index < text.length && /[\u0009\u000a\u000d\u0020]/.test(text[index])) index += 1;
  };
  const string = () => {
    const start = index;
    assert(text[index] === '"', `${label}: expected string`);
    index += 1;
    let escaped = false;
    while (index < text.length) {
      const code = text.charCodeAt(index);
      if (!escaped && code === 0x22) {
        index += 1;
        const raw = text.slice(start, index);
        let value;
        try {
          value = JSON.parse(raw);
        } catch {
          fail("invalid JSON string");
        }
        for (let cursor = 0; cursor < value.length; cursor += 1) {
          const unit = value.charCodeAt(cursor);
          if (unit >= 0xd800 && unit <= 0xdbff) {
            const next = value.charCodeAt(cursor + 1);
            if (!(next >= 0xdc00 && next <= 0xdfff)) fail("lone high surrogate");
            cursor += 1;
          } else if (unit >= 0xdc00 && unit <= 0xdfff) {
            fail("lone low surrogate");
          }
        }
        return value;
      }
      if (!escaped && code === 0x5c) {
        escaped = true;
        index += 1;
        continue;
      }
      if (!escaped && code < 0x20) fail("unescaped control character");
      escaped = false;
      index += 1;
    }
    fail("unterminated string");
  };
  const value = () => {
    whitespace();
    if (text[index] === '"') return string();
    if (text[index] === "{") {
      index += 1;
      whitespace();
      const object = {};
      const keys = new Set();
      if (text[index] === "}") {
        index += 1;
        return object;
      }
      while (true) {
        whitespace();
        if (text[index] !== '"') fail("expected object key");
        const key = string();
        if (keys.has(key)) fail(`duplicate key ${JSON.stringify(key)}`);
        keys.add(key);
        whitespace();
        if (text[index] !== ":") fail("expected colon");
        index += 1;
        object[key] = value();
        whitespace();
        if (text[index] === "}") {
          index += 1;
          return object;
        }
        if (text[index] !== ",") fail("expected comma");
        index += 1;
      }
    }
    if (text[index] === "[") {
      index += 1;
      whitespace();
      const array = [];
      if (text[index] === "]") {
        index += 1;
        return array;
      }
      while (true) {
        array.push(value());
        whitespace();
        if (text[index] === "]") {
          index += 1;
          return array;
        }
        if (text[index] !== ",") fail("expected comma");
        index += 1;
      }
    }
    for (const [literal, parsed] of [
      ["true", true],
      ["false", false],
      ["null", null]
    ]) {
      if (text.startsWith(literal, index)) {
        index += literal.length;
        return parsed;
      }
    }
    const match = text
      .slice(index)
      .match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);
    if (!match) fail("invalid JSON value");
    const raw = match[0];
    index += raw.length;
    const parsed = Number(raw);
    assert(Number.isFinite(parsed), `${label}: non-finite number`);
    if (Number.isInteger(parsed)) assert(Number.isSafeInteger(parsed), `${label}: unsafe integer`);
    return parsed;
  };
  const parsed = value();
  whitespace();
  assert(index === text.length, `${label}: trailing JSON content`);
  return parsed;
}

function exactKeys(value, keys, label) {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `${label} object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  assert(
    actual.length === expected.length && actual.every((key, index) => key === expected[index]),
    `${label} keys mismatch`
  );
}

function exactValue(actual, expected, label) {
  assert(canonicalize(actual) === canonicalize(expected), `${label} mismatch`);
}

function safeInteger(value, label, { positive = false } = {}) {
  assert(Number.isSafeInteger(value), `${label} must be a safe integer`);
  assert(value >= (positive ? 1 : 0), `${label} is out of range`);
}

function sha256(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a SHA-256`);
}

function utf8Compare(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function resolveClosedPath(relativePath) {
  assert(typeof relativePath === "string" && !isAbsolute(relativePath), "closed path invalid");
  const absolutePath = resolve(ROOT, relativePath);
  const back = relative(ROOT, absolutePath);
  assert(back !== "" && back !== ".." && !back.startsWith(`..${sep}`), "path escapes repository");
  return absolutePath;
}

function sameIdentity(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

const retained = new Map();
const identities = new Set();
function readOnce(relativePath, maximumBytes = 16 * 1024 * 1024) {
  assert(!retained.has(relativePath), `${relativePath} was read more than once`);
  const absolutePath = resolveClosedPath(relativePath);
  const listed = lstatSync(absolutePath, { bigint: true });
  assert(listed.isFile() && !listed.isSymbolicLink(), `${relativePath} is not a regular file`);
  assert(listed.nlink === 1n, `${relativePath} must have one hard link`);
  assert(realpathSync(absolutePath) === absolutePath, `${relativePath} traverses a symlink`);
  assert(listed.size >= 0n && listed.size <= BigInt(maximumBytes), `${relativePath} is too large`);
  const identityKey = `${listed.dev}:${listed.ino}`;
  assert(!identities.has(identityKey), `${relativePath} duplicates an input inode`);
  identities.add(identityKey);
  const descriptor = openSync(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(descriptor, { bigint: true });
    assert(sameIdentity(listed, before), `${relativePath} changed before read`);
    const buffer = Buffer.alloc(Number(before.size) + 1);
    const bytesRead = readSync(descriptor, buffer, 0, buffer.byteLength, 0);
    assert(bytesRead === Number(before.size), `${relativePath} produced a short or long read`);
    const after = fstatSync(descriptor, { bigint: true });
    assert(sameIdentity(before, after), `${relativePath} changed during read`);
    const bytes = buffer.subarray(0, bytesRead);
    retained.set(relativePath, bytes);
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}

function parseCanonicalJsonBytes(bytes, label, finalLf) {
  const text = decodeUtf8(bytes, label);
  if (finalLf) {
    assert(text.endsWith("\n") && !text.endsWith("\n\n"), `${label} final LF policy`);
  } else {
    assert(!text.endsWith("\n"), `${label} must not have a final LF`);
  }
  const jsonText = finalLf ? text.slice(0, -1) : text;
  const parsed = parseStrictJson(jsonText, label);
  assert(canonicalize(parsed) === jsonText, `${label} is not RFC 8785 canonical JSON`);
  return parsed;
}

function validateFrozenFile(value, path, label) {
  assert(value.path === path, `${label}.path mismatch`);
  safeInteger(value.byteLength, `${label}.byteLength`, { positive: true });
  sha256(value.rawSha256, `${label}.rawSha256`);
}

function validateFreezeRecord(record) {
  exactKeys(
    record,
    [
      "schemaVersion",
      "migrationSequence",
      "migrationId",
      "fromUserVersion",
      "toUserVersion",
      "transformId",
      "transformVersion",
      "artifactFormat",
      "abiVersion",
      "builderNodeMajor",
      "builderNodeVersion",
      "historicalPrefixManifestHash",
      "preconditionSchemaHash",
      "postconditionSchemaHash",
      "sql",
      "module",
      "abiContract",
      "goldenVectors",
      "wasmBuilder",
      "schemaIntrospectionGenerator",
      "faultSpecGenerator",
      "manifestGenerator",
      "freezeVerifier",
      "manifest",
      "schemaIntrospection",
      "faultVectors",
      "sqlContract",
      "transformContract",
      "manifestPackagingFaultContract",
      "applicationIdentityKnownAnswer",
      "transformResultKnownAnswers",
      "noWiringAuthorityFiles",
      "freezeRecordHash"
    ],
    "freeze record"
  );
  exactValue(
    {
      schemaVersion: record.schemaVersion,
      migrationSequence: record.migrationSequence,
      migrationId: record.migrationId,
      fromUserVersion: record.fromUserVersion,
      toUserVersion: record.toUserVersion,
      transformId: record.transformId,
      transformVersion: record.transformVersion,
      artifactFormat: record.artifactFormat,
      abiVersion: record.abiVersion,
      builderNodeMajor: record.builderNodeMajor,
      builderNodeVersion: record.builderNodeVersion,
      historicalPrefixManifestHash: record.historicalPrefixManifestHash,
      preconditionSchemaHash: record.preconditionSchemaHash
    },
    {
      schemaVersion: "sequence_3_artifact_freeze.v1",
      migrationSequence: 3,
      migrationId: "003-durable-agent-run-coordination",
      fromUserVersion: 2,
      toUserVersion: 3,
      transformId: "legacy-agent-run-adoption-v1",
      transformVersion: 1,
      artifactFormat: "wasm32-no-imports-v1",
      abiVersion: "legacy-agent-run-adoption-abi.v1",
      builderNodeMajor: 24,
      builderNodeVersion: EXPECTED_NODE_VERSION,
      historicalPrefixManifestHash: HISTORICAL_PREFIX_HASH,
      preconditionSchemaHash: PRECONDITION_SCHEMA_HASH
    },
    "freeze identity"
  );
  sha256(record.postconditionSchemaHash, "postconditionSchemaHash");
  sha256(record.freezeRecordHash, "freezeRecordHash");

  const fileExtraKeys = {
    sql: ["sqlChecksum"],
    module: ["moduleChecksum"],
    abiContract: ["contractChecksum"],
    goldenVectors: [
      "goldenVectorsChecksum",
      "abiVectorCount",
      "hostAcceptedVectorCount",
      "hostBlockedVectorCount",
      "hostVectorCount",
      "vectorCount",
      "vectorSetHash",
      "vectorResultSetHash"
    ],
    manifest: ["manifestHash"],
    schemaIntrospection: ["evidenceHash", "preconditionRowsHash", "postconditionRowsHash"],
    faultVectors: ["faultVectorsHash", "expectedCaseCount"]
  };
  for (const [field, path] of Object.entries(FROZEN_PATHS)) {
    exactKeys(record[field], ["path", "byteLength", "rawSha256", ...(fileExtraKeys[field] ?? [])], field);
    validateFrozenFile(record[field], path, field);
  }
  for (const [field, keys] of Object.entries(fileExtraKeys)) {
    for (const key of keys.filter((key) => key.toLowerCase().includes("hash") || key.endsWith("Checksum"))) {
      sha256(record[field][key], `${field}.${key}`);
    }
  }
  exactValue(
    {
      abiVectorCount: record.goldenVectors.abiVectorCount,
      hostAcceptedVectorCount: record.goldenVectors.hostAcceptedVectorCount,
      hostBlockedVectorCount: record.goldenVectors.hostBlockedVectorCount,
      hostVectorCount: record.goldenVectors.hostVectorCount,
      vectorCount: record.goldenVectors.vectorCount
    },
    {
      abiVectorCount: 55,
      hostAcceptedVectorCount: 36,
      hostBlockedVectorCount: 168,
      hostVectorCount: 204,
      vectorCount: 259
    },
    "golden vector counts"
  );
  assert(record.faultVectors.expectedCaseCount === 65, "fault expectedCaseCount");

  exactKeys(
    record.applicationIdentityKnownAnswer,
    ["input", "expectedMigrationApplicationId"],
    "applicationIdentityKnownAnswer"
  );
  exactValue(
    record.applicationIdentityKnownAnswer,
    {
      input: APPLICATION_IDENTITY_INPUT,
      expectedMigrationApplicationId: EXPECTED_APPLICATION_ID
    },
    "application identity known answer"
  );
  assert(
    Array.isArray(record.transformResultKnownAnswers) &&
      record.transformResultKnownAnswers.length === 4,
    "transformResultKnownAnswers cardinality"
  );
  const expectedKnownAnswers = [
    ["host.valid.baseline", 1, 1],
    ["host.valid.empty_input", 0, 0],
    ["host.valid.row_order_utf8_prefix", 3, 3],
    ["host.valid.status.running", 1, 1]
  ];
  record.transformResultKnownAnswers.forEach((answer, index) => {
    exactKeys(
      answer,
      ["vectorId", "inputLegacyRunCount", "insertedAdoptionCount", "transformResultHash"],
      `transformResultKnownAnswers[${index}]`
    );
    const [vectorId, inputCount, insertedCount] = expectedKnownAnswers[index];
    assert(answer.vectorId === vectorId, `transformResultKnownAnswers[${index}].vectorId`);
    assert(answer.inputLegacyRunCount === inputCount, `${vectorId} input count`);
    assert(answer.insertedAdoptionCount === insertedCount, `${vectorId} inserted count`);
    sha256(answer.transformResultHash, `${vectorId}.transformResultHash`);
  });

  assert(
    Array.isArray(record.noWiringAuthorityFiles) &&
      record.noWiringAuthorityFiles.length === AUTHORITY_BEFORE.length,
    "noWiringAuthorityFiles cardinality"
  );
  record.noWiringAuthorityFiles.forEach((file, index) => {
    exactKeys(
      file,
      [
        "path",
        "beforeByteLength",
        "beforeRawSha256",
        "afterByteLength",
        "afterRawSha256"
      ],
      `noWiringAuthorityFiles[${index}]`
    );
    const [path, beforeByteLength, beforeRawSha256] = AUTHORITY_BEFORE[index];
    assert(file.path === path, `noWiringAuthorityFiles[${index}].path`);
    safeInteger(file.beforeByteLength, `${path}.beforeByteLength`);
    safeInteger(file.afterByteLength, `${path}.afterByteLength`);
    sha256(file.beforeRawSha256, `${path}.beforeRawSha256`);
    sha256(file.afterRawSha256, `${path}.afterRawSha256`);
    assert(file.beforeByteLength === beforeByteLength, `${path} captured before length mismatch`);
    assert(file.beforeRawSha256 === beforeRawSha256, `${path} captured before hash mismatch`);
    assert(file.afterByteLength === file.beforeByteLength, `${path} before/after length changed`);
    assert(file.afterRawSha256 === file.beforeRawSha256, `${path} before/after hash changed`);
  });
}

const freezeBytes = readOnce(FREEZE_RECORD_PATH, 1024 * 1024);
const freeze = parseCanonicalJsonBytes(freezeBytes, FREEZE_RECORD_PATH, true);
validateFreezeRecord(freeze);

function validateRecordedFile(field, bytes) {
  const recorded = freeze[field];
  assert(bytes.byteLength === recorded.byteLength, `${field} byte length mismatch`);
  assert(rawSha256(bytes) === recorded.rawSha256, `${field} raw SHA-256 mismatch`);
}

function validateSqlSource(bytes, expected, label) {
  assert(bytes.byteLength === expected.byteLength, `${label} byte length mismatch`);
  assert(rawSha256(bytes) === expected.rawSha256, `${label} raw SHA-256 mismatch`);
  const text = decodeUtf8(bytes, label);
  assert(!bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), `${label} BOM`);
  assert(!text.includes("\r") && !text.includes("\t") && !text.includes("\u0000"), `${label} byte policy`);
  assert(text.endsWith("\n") && !text.endsWith("\n\n"), `${label} final LF policy`);
  assert(!/[ \t]+$/m.test(text), `${label} trailing whitespace`);
  return text;
}

function historicalEntry(item) {
  return {
    sequence: item.sequence,
    migrationId: item.migrationId,
    fromUserVersion: item.fromUserVersion,
    toUserVersion: item.toUserVersion,
    sqlByteLength: item.byteLength,
    sqlChecksum: item.sqlChecksum,
    preconditionSchemaHash: item.preconditionSchemaHash,
    postconditionSchemaHash: item.postconditionSchemaHash,
    transactional: true
  };
}

const historicalBuffers = HISTORICAL_SQL.map((item) => {
  const bytes = readOnce(item.path, 1024 * 1024);
  validateSqlSource(bytes, item, item.path);
  const checksum = hashFramed(
    "vdt-studio/sql-migration",
    "sql_migration_hash.v1",
    {
      sequence: item.sequence,
      migrationId: item.migrationId,
      fromUserVersion: item.fromUserVersion,
      toUserVersion: item.toUserVersion,
      preconditionSchemaHash: item.preconditionSchemaHash,
      postconditionSchemaHash: item.postconditionSchemaHash
    },
    bytes
  );
  assert(checksum === item.sqlChecksum, `${item.path} framed checksum mismatch`);
  return bytes;
});
const historicalManifestWithoutHash = {
  schemaVersion: "migration_manifest.v1",
  manifestVersion: 1,
  entries: HISTORICAL_SQL.map(historicalEntry)
};
assert(
  hashFramed(
    "vdt-studio/migration-manifest",
    "migration_manifest_hash.v1",
    historicalManifestWithoutHash,
    EMPTY
  ) === HISTORICAL_PREFIX_HASH,
  "historical prefix manifest hash mismatch"
);

const frozenBuffers = new Map();
for (const [field, path] of Object.entries(FROZEN_PATHS)) {
  const maximumBytes =
    field === "goldenVectors"
      ? 192 * 1024 * 1024
      : field === "schemaIntrospection"
        ? 32 * 1024 * 1024
      : 8 * 1024 * 1024;
  const bytes = readOnce(path, maximumBytes);
  validateRecordedFile(field, bytes);
  frozenBuffers.set(field, bytes);
}

const authorityBuffers = new Map();
freeze.noWiringAuthorityFiles.forEach((recorded, index) => {
  const bytes = readOnce(recorded.path, 8 * 1024 * 1024);
  const afterLength = bytes.byteLength;
  const afterHash = rawSha256(bytes);
  assert(afterLength === recorded.afterByteLength, `${recorded.path} after length mismatch`);
  assert(afterHash === recorded.afterRawSha256, `${recorded.path} after hash mismatch`);
  const [expectedPath, expectedLength, expectedHash] = AUTHORITY_BEFORE[index];
  assert(recorded.path === expectedPath, `${recorded.path} authority order mismatch`);
  assert(afterLength === expectedLength, `${recorded.path} changed since before snapshot`);
  assert(afterHash === expectedHash, `${recorded.path} changed since before snapshot`);
  authorityBuffers.set(recorded.path, bytes);
});

function snapshot(db, userVersion) {
  const rows = db.prepare(QUERY).all().map((row, index) => {
    exactKeys(row, ["type", "name", "tbl_name", "sql"], `schema row ${index}`);
    assert(["index", "table", "trigger", "view"].includes(row.type), `schema row ${index} type`);
    for (const key of ["type", "name", "tbl_name", "sql"]) {
      assert(
        typeof row[key] === "string" && row[key].length > 0 && !row[key].includes("\u0000"),
        `schema row ${index}.${key}`
      );
    }
    return { type: row.type, name: row.name, tbl_name: row.tbl_name, sql: row.sql };
  });
  for (let index = 1; index < rows.length; index += 1) {
    const before = rows[index - 1];
    const after = rows[index];
    const comparison =
      utf8Compare(before.type, after.type) ||
      utf8Compare(before.name, after.name) ||
      utf8Compare(before.tbl_name, after.tbl_name);
    assert(comparison < 0, `schema row order/identity mismatch at ${index}`);
  }
  const rowBytes = Buffer.from(canonicalize(rows), "utf8");
  return {
    userVersion,
    rowCount: rows.length,
    canonicalRowsByteLength: rowBytes.byteLength,
    canonicalRowsRawSha256: rawSha256(rowBytes),
    semanticSchemaHash: hashFramed(
      "vdt-studio/sqlite-schema",
      "sqlite_schema_hash.v1",
      { userVersion },
      rowBytes
    ),
    rows
  };
}

function validateSchemaEvidence(value, bytes) {
  exactKeys(
    value,
    [
      "schemaVersion",
      "migrationSequence",
      "migrationId",
      "query",
      "toolchain",
      "precondition",
      "postcondition"
    ],
    "schema introspection"
  );
  exactValue(
    {
      schemaVersion: value.schemaVersion,
      migrationSequence: value.migrationSequence,
      migrationId: value.migrationId,
      query: value.query
    },
    {
      schemaVersion: "sequence_3_schema_introspection.v1",
      migrationSequence: 3,
      migrationId: "003-durable-agent-run-coordination",
      query: QUERY
    },
    "schema introspection identity"
  );
  exactKeys(
    value.toolchain,
    [
      "nodeVersion",
      "nodeReportedSqliteVersion",
      "sqliteVersion",
      "sqliteSourceId",
      "pragmaEncoding",
      "pragmaForeignKeys",
      "compileOptionsCount",
      "compileOptionsCanonicalByteLength",
      "compileOptionsRawSha256",
      "compileOptions"
    ],
    "schema toolchain"
  );
  assert(value.toolchain.nodeVersion === EXPECTED_NODE_VERSION, "schema toolchain Node version");
  assert(value.toolchain.nodeReportedSqliteVersion === process.versions.sqlite, "Node SQLite version");
  assert(value.toolchain.sqliteVersion === "3.53.2", "SQLite version");
  assert(
    value.toolchain.sqliteSourceId ===
      "2026-06-03 19:12:13 d6e03d8c777cfa2d35e3b60d8ec3e0187f3e9f99d8e2ee9cac695fd6fcdf1a24",
    "SQLite source ID"
  );
  assert(value.toolchain.pragmaEncoding === "UTF-8", "SQLite encoding");
  assert(value.toolchain.pragmaForeignKeys === 1, "SQLite foreign keys");
  assert(Array.isArray(value.toolchain.compileOptions), "compileOptions array");
  const compileOptionsBytes = Buffer.from(canonicalize(value.toolchain.compileOptions), "utf8");
  assert(value.toolchain.compileOptionsCount === 53, "compileOptions count");
  assert(value.toolchain.compileOptionsCanonicalByteLength === 1215, "compileOptions length");
  assert(
    value.toolchain.compileOptionsRawSha256 ===
      "sha256:99d80fee03818112b412ae76c1b334602ab6b6de6899610155a90a043ed5bbbc",
    "compileOptions recorded hash"
  );
  assert(compileOptionsBytes.byteLength === 1215, "compileOptions recomputed length");
  assert(
    rawSha256(compileOptionsBytes) === value.toolchain.compileOptionsRawSha256,
    "compileOptions recomputed hash"
  );
  for (const [label, expectedVersion] of [
    ["precondition", 2],
    ["postcondition", 3]
  ]) {
    const entry = value[label];
    exactKeys(
      entry,
      [
        "userVersion",
        "rowCount",
        "canonicalRowsByteLength",
        "canonicalRowsRawSha256",
        "semanticSchemaHash",
        "rows"
      ],
      `schema ${label}`
    );
    assert(entry.userVersion === expectedVersion, `schema ${label} user version`);
    assert(Array.isArray(entry.rows), `schema ${label} rows`);
    entry.rows.forEach((row, index) =>
      exactKeys(row, ["type", "name", "tbl_name", "sql"], `${label}.rows[${index}]`)
    );
    const rowBytes = Buffer.from(canonicalize(entry.rows), "utf8");
    assert(entry.rowCount === entry.rows.length, `schema ${label} row count`);
    assert(entry.canonicalRowsByteLength === rowBytes.byteLength, `schema ${label} row length`);
    assert(entry.canonicalRowsRawSha256 === rawSha256(rowBytes), `schema ${label} row hash`);
    assert(
      entry.semanticSchemaHash ===
        hashFramed(
          "vdt-studio/sqlite-schema",
          "sqlite_schema_hash.v1",
          { userVersion: expectedVersion },
          rowBytes
        ),
      `schema ${label} semantic hash`
    );
  }
  assert(
    freeze.schemaIntrospection.evidenceHash ===
      hashFramed(
        "vdt-studio/migration-schema-introspection",
        "migration_schema_introspection_hash.v1",
        {
          migrationSequence: 3,
          migrationId: "003-durable-agent-run-coordination",
          fromUserVersion: 2,
          toUserVersion: 3
        },
        bytes
      ),
    "schema evidence framed hash mismatch"
  );
  assert(
    freeze.schemaIntrospection.preconditionRowsHash ===
      value.precondition.canonicalRowsRawSha256,
    "freeze preconditionRowsHash mismatch"
  );
  assert(
    freeze.schemaIntrospection.postconditionRowsHash ===
      value.postcondition.canonicalRowsRawSha256,
    "freeze postconditionRowsHash mismatch"
  );
}

const schemaBytes = frozenBuffers.get("schemaIntrospection");
const schemaEvidence = parseCanonicalJsonBytes(
  schemaBytes,
  FROZEN_PATHS.schemaIntrospection,
  true
);
validateSchemaEvidence(schemaEvidence, schemaBytes);

const db = new DatabaseSync(":memory:");
let transactionOpen = false;
let recomputedPrecondition;
let recomputedPostcondition;
try {
  db.exec("PRAGMA foreign_keys=ON");
  assert(db.prepare("PRAGMA foreign_keys").get().foreign_keys === 1, "foreign keys unavailable");
  db.exec(decodeUtf8(historicalBuffers[0], HISTORICAL_SQL[0].path));
  db.exec("PRAGMA user_version=1");
  db.exec(decodeUtf8(historicalBuffers[1], HISTORICAL_SQL[1].path));
  db.exec("PRAGMA user_version=2");
  recomputedPrecondition = snapshot(db, 2);
  db.exec("BEGIN IMMEDIATE");
  transactionOpen = true;
  db.exec(decodeUtf8(frozenBuffers.get("sql"), FROZEN_PATHS.sql));
  db.exec("PRAGMA user_version=3");
  recomputedPostcondition = snapshot(db, 3);
  assert(db.prepare("PRAGMA integrity_check").get().integrity_check === "ok", "integrity check");
  assert(db.prepare("PRAGMA foreign_key_check").all().length === 0, "foreign-key check");
  db.exec("ROLLBACK");
  transactionOpen = false;
} finally {
  if (transactionOpen) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Preserve the primary validation failure.
    }
  }
  db.close();
}
exactValue(recomputedPrecondition, schemaEvidence.precondition, "recomputed precondition");
exactValue(recomputedPostcondition, schemaEvidence.postcondition, "recomputed postcondition");
assert(
  recomputedPrecondition.semanticSchemaHash === PRECONDITION_SCHEMA_HASH,
  "precondition schema known answer"
);
assert(
  recomputedPostcondition.semanticSchemaHash === freeze.postconditionSchemaHash,
  "postcondition schema freeze mismatch"
);

const sqlBytes = frozenBuffers.get("sql");
const sqlChecksum = hashFramed(
  "vdt-studio/sql-migration",
  "sql_migration_hash.v1",
  {
    sequence: 3,
    migrationId: "003-durable-agent-run-coordination",
    fromUserVersion: 2,
    toUserVersion: 3,
    preconditionSchemaHash: PRECONDITION_SCHEMA_HASH,
    postconditionSchemaHash: freeze.postconditionSchemaHash
  },
  sqlBytes
);
assert(sqlChecksum === freeze.sql.sqlChecksum, "Sequence 3 SQL checksum mismatch");

const moduleBytes = frozenBuffers.get("module");
const abiBytes = frozenBuffers.get("abiContract");
const vectorBytes = frozenBuffers.get("goldenVectors");
const moduleChecksum = hashFramed(
  "vdt-studio/migration-transform-module",
  "migration_transform_module_hash.v1",
  TRANSFORM_METADATA,
  moduleBytes
);
const contractChecksum = hashFramed(
  "vdt-studio/migration-transform-contract",
  "migration_transform_contract_hash.v1",
  TRANSFORM_METADATA,
  abiBytes
);
const goldenVectorsChecksum = hashFramed(
  "vdt-studio/migration-transform-golden-vectors",
  "migration_transform_golden_vectors_hash.v1",
  TRANSFORM_METADATA,
  vectorBytes
);
assert(moduleChecksum === freeze.module.moduleChecksum, "module checksum mismatch");
assert(contractChecksum === freeze.abiContract.contractChecksum, "contract checksum mismatch");
assert(
  goldenVectorsChecksum === freeze.goldenVectors.goldenVectorsChecksum,
  "golden-vectors checksum mismatch"
);

const abiContract = parseCanonicalJsonBytes(abiBytes, FROZEN_PATHS.abiContract, false);
exactKeys(
  abiContract,
  [
    "schemaVersion",
    "transformId",
    "transformVersion",
    "artifactFormat",
    "abiVersion",
    "phase",
    "migrationSequence",
    "migrationId",
    "memory",
    "exports",
    "inputRecord",
    "outputRecord",
    "limits",
    "statuses",
    "phases",
    "returnCodes",
    "validationOrder",
    "staticProfile",
    "hostPolicy",
    "ordering",
    "applicationIdentitySchema",
    "applicationIdentityHashSchema",
    "applicationIdentityHashDomain",
    "rowHashSchema",
    "rowHashDomain",
    "resultHashSchema",
    "resultHashDomain",
    "goldenVectorsSchema"
  ],
  "ABI contract"
);
exactValue(
  {
    schemaVersion: abiContract.schemaVersion,
    transformId: abiContract.transformId,
    transformVersion: abiContract.transformVersion,
    artifactFormat: abiContract.artifactFormat,
    abiVersion: abiContract.abiVersion,
    phase: abiContract.phase,
    migrationSequence: abiContract.migrationSequence,
    migrationId: abiContract.migrationId,
    memory: abiContract.memory,
    exports: abiContract.exports,
    ordering: abiContract.ordering,
    applicationIdentitySchema: abiContract.applicationIdentitySchema,
    applicationIdentityHashSchema: abiContract.applicationIdentityHashSchema,
    applicationIdentityHashDomain: abiContract.applicationIdentityHashDomain,
    rowHashSchema: abiContract.rowHashSchema,
    rowHashDomain: abiContract.rowHashDomain,
    resultHashSchema: abiContract.resultHashSchema,
    resultHashDomain: abiContract.resultHashDomain,
    goldenVectorsSchema: abiContract.goldenVectorsSchema
  },
  {
    schemaVersion: "legacy_agent_run_adoption_abi_contract.v1",
    ...TRANSFORM_METADATA,
    phase: "after_sql_before_application_record",
    migrationSequence: 3,
    migrationId: "003-durable-agent-run-coordination",
    memory: { pages: 1, byteLength: 65536, shared: false },
    exports: [
      { name: "memory", kind: "memory", index: 0 },
      {
        name: "transform_row",
        kind: "function",
        index: 0,
        params: ["i32", "i32", "i32", "i32"],
        results: ["i32"]
      }
    ],
    ordering: "unsigned_lexicographic_utf8",
    applicationIdentitySchema: "migration_application_identity.v1",
    applicationIdentityHashSchema: "migration_application_identity_hash.v1",
    applicationIdentityHashDomain: "vdt-studio/migration-application-identity",
    rowHashSchema: "legacy_agent_run_adoption_hash.v1",
    rowHashDomain: "vdt-studio/legacy-agent-run-adoption",
    resultHashSchema: "migration_transform_result_hash.v1",
    resultHashDomain: "vdt-studio/migration-transform-result",
    goldenVectorsSchema: "legacy_agent_run_adoption_golden_vectors.v1"
  },
  "ABI contract identity"
);
exactKeys(abiContract.staticProfile, [
  "sectionIds",
  "functionCount",
  "maximumI32Locals",
  "maximumI64Locals",
  "permittedOpcodes",
  "forbiddenSectionIds",
  "unknownSectionIds",
  "canonicalLeb128",
  "calls",
  "loops",
  "dataSegments",
  "imports"
], "ABI static profile");
exactValue(
  {
    sectionIds: abiContract.staticProfile.sectionIds,
    functionCount: abiContract.staticProfile.functionCount,
    forbiddenSectionIds: abiContract.staticProfile.forbiddenSectionIds,
    unknownSectionIds: abiContract.staticProfile.unknownSectionIds,
    canonicalLeb128: abiContract.staticProfile.canonicalLeb128,
    calls: abiContract.staticProfile.calls,
    loops: abiContract.staticProfile.loops,
    dataSegments: abiContract.staticProfile.dataSegments,
    imports: abiContract.staticProfile.imports
  },
  {
    sectionIds: [1, 3, 5, 7, 10],
    functionCount: 1,
    forbiddenSectionIds: [0, 2, 4, 6, 8, 9, 11, 12, 13],
    unknownSectionIds: "reject",
    canonicalLeb128: true,
    calls: 0,
    loops: 0,
    dataSegments: 0,
    imports: 0
  },
  "ABI static profile identity"
);

let wasmModule;
let wasmInstance;
try {
  wasmModule = new WebAssembly.Module(moduleBytes);
  assert(WebAssembly.Module.imports(wasmModule).length === 0, "WASM imports");
  exactValue(
    WebAssembly.Module.exports(wasmModule),
    [
      { name: "memory", kind: "memory" },
      { name: "transform_row", kind: "function" }
    ],
    "WASM exports"
  );
  wasmInstance = new WebAssembly.Instance(wasmModule);
} catch (error) {
  throw new Error(`WASM static profile invalid: ${error instanceof Error ? error.message : error}`);
}
assert(wasmInstance.exports.memory instanceof WebAssembly.Memory, "WASM memory export");
assert(typeof wasmInstance.exports.transform_row === "function", "WASM function export");
assert(wasmInstance.exports.memory.buffer.byteLength === 65536, "WASM memory minimum");
let memoryGrowRejected = false;
try {
  wasmInstance.exports.memory.grow(1);
} catch {
  memoryGrowRejected = true;
}
assert(memoryGrowRejected, "WASM memory maximum is not one page");

function hexBytes(value, label, { nonEmpty = false } = {}) {
  assert(typeof value === "string" && /^(?:[0-9a-f]{2})*$/.test(value), `${label} hex`);
  assert(!nonEmpty || value.length > 0, `${label} empty hex`);
  return Buffer.from(value, "hex");
}

function validateMemoryPatches(patches, label) {
  assert(Array.isArray(patches), `${label} array`);
  let previousEnd = 0;
  patches.forEach((patch, index) => {
    exactKeys(patch, ["offset", "bytesHex"], `${label}[${index}]`);
    safeInteger(patch.offset, `${label}[${index}].offset`);
    const bytes = hexBytes(patch.bytesHex, `${label}[${index}].bytesHex`, { nonEmpty: true });
    assert(patch.offset >= previousEnd, `${label}[${index}] overlap/order`);
    assert(patch.offset + bytes.byteLength <= 65536, `${label}[${index}] bounds`);
    previousEnd = patch.offset + bytes.byteLength;
  });
}

function validateSqlValue(value, label) {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `${label} object`);
  if (value.storageClass === "null") {
    exactKeys(value, ["storageClass"], label);
  } else if (value.storageClass === "integer") {
    exactKeys(value, ["storageClass", "integerDecimal"], label);
    assert(typeof value.integerDecimal === "string", `${label}.integerDecimal`);
  } else if (value.storageClass === "real") {
    exactKeys(value, ["storageClass", "realCanonical"], label);
    assert(typeof value.realCanonical === "string", `${label}.realCanonical`);
  } else {
    assert(value.storageClass === "text" || value.storageClass === "blob", `${label}.storageClass`);
    exactKeys(value, ["storageClass", "bytes"], label);
    validateHostBytes(value.bytes, `${label}.bytes`);
  }
}

function validateHostBytes(value, label) {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `${label} object`);
  if (value.kind === "hex") {
    exactKeys(value, ["kind", "hex"], label);
    hexBytes(value.hex, `${label}.hex`);
  } else if (value.kind === "repeat") {
    exactKeys(value, ["kind", "prefixHex", "unitHex", "repeatCount", "suffixHex"], label);
    hexBytes(value.prefixHex, `${label}.prefixHex`);
    hexBytes(value.unitHex, `${label}.unitHex`, { nonEmpty: true });
    safeInteger(value.repeatCount, `${label}.repeatCount`);
    hexBytes(value.suffixHex, `${label}.suffixHex`);
  } else if (value.kind === "nested_object") {
    exactKeys(value, ["kind", "objectDepth", "keyAscii", "leafAscii"], label);
    safeInteger(value.objectDepth, `${label}.objectDepth`, { positive: true });
    assert(value.keyAscii === "x" && value.leafAscii === "0", `${label} nested literals`);
  } else {
    assert(value.kind === "integer_array_object", `${label}.kind`);
    exactKeys(value, ["kind", "elementCount", "keyAscii", "integerLiteral"], label);
    safeInteger(value.elementCount, `${label}.elementCount`);
    assert(value.keyAscii === "x" && value.integerLiteral === "0", `${label} array literals`);
  }
}

function expandHostBytes(value) {
  if (value.kind === "hex") return value.hex;
  if (value.kind === "repeat") {
    return `${value.prefixHex}${value.unitHex.repeat(value.repeatCount)}${value.suffixHex}`;
  }
  if (value.kind === "nested_object") {
    return Buffer.from(
      `${'{"x":'.repeat(value.objectDepth)}0${"}".repeat(value.objectDepth)}`,
      "ascii"
    ).toString("hex");
  }
  return Buffer.from(
    `{"x":[${Array(value.elementCount).fill("0").join(",")}]}`,
    "ascii"
  ).toString("hex");
}

const HOST_ROW_KEYS = [
  "id",
  "project_id",
  "vdt_id",
  "conversation_id",
  "status",
  "phase",
  "request_json",
  "public_snapshot_json",
  "internal_state_json",
  "created_at",
  "updated_at",
  "completed_at"
];

function validateHostRow(row, label) {
  exactKeys(row, HOST_ROW_KEYS, label);
  HOST_ROW_KEYS.forEach((key) => validateSqlValue(row[key], `${label}.${key}`));
}

function expandSqlValue(value) {
  if (value.storageClass === "text" || value.storageClass === "blob") {
    return { storageClass: value.storageClass, bytesHex: expandHostBytes(value.bytes) };
  }
  return { ...value };
}

function expandHostRow(row) {
  return Object.fromEntries(HOST_ROW_KEYS.map((key) => [key, expandSqlValue(row[key])]));
}

function validateStreamBehavior(value, label) {
  if (value.kind === "normal") exactKeys(value, ["kind"], label);
  else if (value.kind === "scripted") {
    exactKeys(value, ["kind", "reportedCount", "yieldedExpandedRowIndexes"], label);
    safeInteger(value.reportedCount, `${label}.reportedCount`);
    assert(Array.isArray(value.yieldedExpandedRowIndexes), `${label}.indexes`);
    value.yieldedExpandedRowIndexes.forEach((item, index) =>
      safeInteger(item, `${label}.indexes[${index}]`)
    );
  } else {
    assert(value.kind === "count_only", `${label}.kind`);
    exactKeys(value, ["kind", "reportedCount"], label);
    safeInteger(value.reportedCount, `${label}.reportedCount`);
  }
}

function validateWasmBehavior(value, label) {
  if (value.kind === "exact_frozen_module") exactKeys(value, ["kind"], label);
  else {
    assert(value.kind === "isolated_test_double", `${label}.kind`);
    exactKeys(value, ["kind", "returnValue", "memoryWrites"], label);
    assert(Number.isSafeInteger(value.returnValue), `${label}.returnValue`);
    validateMemoryPatches(value.memoryWrites, `${label}.memoryWrites`);
  }
}

function expandRowSet(value, label) {
  if (value.kind === "literal") {
    exactKeys(value, ["kind", "rows"], label);
    assert(Array.isArray(value.rows), `${label}.rows`);
    value.rows.forEach((row, index) => validateHostRow(row, `${label}.rows[${index}]`));
    return value.rows.map(expandHostRow);
  }
  assert(value.kind === "series", `${label}.kind`);
  exactKeys(value, ["kind", "segments"], label);
  assert(Array.isArray(value.segments), `${label}.segments`);
  const expanded = [];
  let previousLast = -1;
  value.segments.forEach((segment, index) => {
    exactKeys(
      segment,
      ["count", "firstIndex", "decimalWidth", "runIdPrefix", "template"],
      `${label}.segments[${index}]`
    );
    safeInteger(segment.count, `${label}.segments[${index}].count`);
    safeInteger(segment.firstIndex, `${label}.segments[${index}].firstIndex`);
    assert(segment.decimalWidth === 6, `${label}.segments[${index}].decimalWidth`);
    assert(segment.runIdPrefix === "run_", `${label}.segments[${index}].runIdPrefix`);
    validateHostRow(segment.template, `${label}.segments[${index}].template`);
    const last = segment.firstIndex + segment.count - 1;
    assert(segment.count === 0 || segment.firstIndex > previousLast, `${label} segment overlap`);
    assert(last <= 999999, `${label} segment index range`);
    for (let offset = 0; offset < segment.count; offset += 1) {
      const row = structuredClone(segment.template);
      row.id = {
        storageClass: "text",
        bytes: {
          kind: "hex",
          hex: Buffer.from(
            `run_${String(segment.firstIndex + offset).padStart(6, "0")}`,
            "ascii"
          ).toString("hex")
        }
      };
      expanded.push(expandHostRow(row));
    }
    if (segment.count > 0) previousLast = last;
  });
  return expanded;
}

function validateAbiVector(vector, index) {
  exactKeys(
    vector,
    ["vectorId", "initialMemoryPatches", "initialMemoryRawSha256", "invocation", "expected"],
    `abiVectors[${index}]`
  );
  assert(typeof vector.vectorId === "string" && vector.vectorId.length > 0, `abi vector ${index} ID`);
  validateMemoryPatches(vector.initialMemoryPatches, `${vector.vectorId}.initialMemoryPatches`);
  sha256(vector.initialMemoryRawSha256, `${vector.vectorId}.initialMemoryRawSha256`);
  exactKeys(
    vector.invocation,
    ["inputPtr", "inputLen", "outputPtr", "outputCap"],
    `${vector.vectorId}.invocation`
  );
  for (const key of ["inputPtr", "inputLen", "outputPtr", "outputCap"]) {
    safeInteger(vector.invocation[key], `${vector.vectorId}.invocation.${key}`);
    assert(vector.invocation[key] <= 0xffffffff, `${vector.vectorId}.invocation.${key} u32`);
  }
  if (vector.expected.outcome === "success") {
    exactKeys(
      vector.expected,
      [
        "outcome",
        "returnValue",
        "outputHex",
        "outputRawSha256",
        "inputUnchanged",
        "finalMemoryRawSha256"
      ],
      `${vector.vectorId}.expected`
    );
    assert(vector.expected.returnValue === 16, `${vector.vectorId} success return`);
    assert(
      hexBytes(vector.expected.outputHex, `${vector.vectorId}.outputHex`).byteLength === 16,
      `${vector.vectorId} output length`
    );
    sha256(vector.expected.outputRawSha256, `${vector.vectorId}.outputRawSha256`);
    assert(vector.expected.inputUnchanged === true, `${vector.vectorId}.inputUnchanged`);
  } else {
    assert(vector.expected.outcome === "error", `${vector.vectorId} outcome`);
    exactKeys(
      vector.expected,
      ["outcome", "returnValue", "memoryUnchanged", "finalMemoryRawSha256"],
      `${vector.vectorId}.expected`
    );
    assert(
      Number.isInteger(vector.expected.returnValue) &&
        vector.expected.returnValue >= -16 &&
        vector.expected.returnValue <= -1,
      `${vector.vectorId} error return`
    );
    assert(vector.expected.memoryUnchanged === true, `${vector.vectorId}.memoryUnchanged`);
  }
  sha256(vector.expected.finalMemoryRawSha256, `${vector.vectorId}.finalMemoryRawSha256`);
}

function validateHostVector(vector, index) {
  exactKeys(vector, ["vectorId", "input", "expected"], `hostVectors[${index}]`);
  assert(typeof vector.vectorId === "string" && vector.vectorId.length > 0, `host vector ${index} ID`);
  exactKeys(
    vector.input,
    [
      "rowSet",
      "streamBehavior",
      "wasmBehavior",
      "expandedRowCount",
      "expandedInputRawSha256"
    ],
    `${vector.vectorId}.input`
  );
  const rows = expandRowSet(vector.input.rowSet, `${vector.vectorId}.rowSet`);
  validateStreamBehavior(vector.input.streamBehavior, `${vector.vectorId}.streamBehavior`);
  validateWasmBehavior(vector.input.wasmBehavior, `${vector.vectorId}.wasmBehavior`);
  safeInteger(vector.input.expandedRowCount, `${vector.vectorId}.expandedRowCount`);
  sha256(vector.input.expandedInputRawSha256, `${vector.vectorId}.expandedInputRawSha256`);
  assert(vector.input.expandedRowCount === rows.length, `${vector.vectorId} expanded row count`);
  assert(
    canonicalRawSha256({
      rows,
      streamBehavior: vector.input.streamBehavior,
      wasmBehavior: vector.input.wasmBehavior
    }) === vector.input.expandedInputRawSha256,
    `${vector.vectorId} expanded input hash`
  );
  if (vector.expected.outcome === "accepted") {
    exactKeys(
      vector.expected,
      [
        "outcome",
        "migrationApplicationId",
        "adoptionCanonicalJson",
        "legacyRowHashes",
        "transformResultHash",
        "persistedBlockedReason"
      ],
      `${vector.vectorId}.expected`
    );
    assert(
      vector.expected.migrationApplicationId === EXPECTED_APPLICATION_ID,
      `${vector.vectorId}.migrationApplicationId`
    );
    assert(Array.isArray(vector.expected.adoptionCanonicalJson), `${vector.vectorId} adoptions`);
    assert(Array.isArray(vector.expected.legacyRowHashes), `${vector.vectorId} row hashes`);
    assert(
      vector.expected.adoptionCanonicalJson.length === vector.expected.legacyRowHashes.length,
      `${vector.vectorId} adoption/hash counts`
    );
    vector.expected.legacyRowHashes.forEach((hash, hashIndex) =>
      sha256(hash, `${vector.vectorId}.legacyRowHashes[${hashIndex}]`)
    );
    sha256(vector.expected.transformResultHash, `${vector.vectorId}.transformResultHash`);
    assert(vector.expected.persistedBlockedReason === null, `${vector.vectorId} blocked reason`);
  } else {
    assert(vector.expected.outcome === "blocked", `${vector.vectorId} outcome`);
    exactKeys(
      vector.expected,
      ["outcome", "code", "failingRowIndex", "failingColumn", "persistedBlockedReason"],
      `${vector.vectorId}.expected`
    );
    assert(
      typeof vector.expected.code === "string" && vector.expected.code.startsWith("LAR_HOST_"),
      `${vector.vectorId}.code`
    );
    assert(
      vector.expected.failingRowIndex === null ||
        (Number.isSafeInteger(vector.expected.failingRowIndex) &&
          vector.expected.failingRowIndex >= 0),
      `${vector.vectorId}.failingRowIndex`
    );
    assert(
      vector.expected.failingColumn === null ||
        typeof vector.expected.failingColumn === "string",
      `${vector.vectorId}.failingColumn`
    );
    assert(
      vector.expected.persistedBlockedReason === "postcondition_failed",
      `${vector.vectorId}.persistedBlockedReason`
    );
  }
}

const vectors = parseCanonicalJsonBytes(vectorBytes, FROZEN_PATHS.goldenVectors, false);
exactKeys(
  vectors,
  [
    "schemaVersion",
    "transformId",
    "transformVersion",
    "artifactFormat",
    "abiVersion",
    "fixtureMigrationIdentity",
    "fixtureCommitTimestamp",
    "abiVectorCount",
    "hostAcceptedVectorCount",
    "hostBlockedVectorCount",
    "hostVectorCount",
    "vectorCount",
    "abiVectors",
    "hostVectors",
    "vectorSetHash",
    "vectorResultSetHash"
  ],
  "golden vectors"
);
exactValue(
  {
    schemaVersion: vectors.schemaVersion,
    transformId: vectors.transformId,
    transformVersion: vectors.transformVersion,
    artifactFormat: vectors.artifactFormat,
    abiVersion: vectors.abiVersion,
    fixtureMigrationIdentity: vectors.fixtureMigrationIdentity,
    fixtureCommitTimestamp: vectors.fixtureCommitTimestamp,
    abiVectorCount: vectors.abiVectorCount,
    hostAcceptedVectorCount: vectors.hostAcceptedVectorCount,
    hostBlockedVectorCount: vectors.hostBlockedVectorCount,
    hostVectorCount: vectors.hostVectorCount,
    vectorCount: vectors.vectorCount
  },
  {
    schemaVersion: "legacy_agent_run_adoption_golden_vectors.v1",
    ...TRANSFORM_METADATA,
    fixtureMigrationIdentity: APPLICATION_IDENTITY_INPUT,
    fixtureCommitTimestamp: "2026-07-24T00:00:00.000Z",
    abiVectorCount: 55,
    hostAcceptedVectorCount: 36,
    hostBlockedVectorCount: 168,
    hostVectorCount: 204,
    vectorCount: 259
  },
  "golden vector identity/counts"
);
assert(Array.isArray(vectors.abiVectors) && vectors.abiVectors.length === 55, "ABI vector count");
assert(Array.isArray(vectors.hostVectors) && vectors.hostVectors.length === 204, "host vector count");
sha256(vectors.vectorSetHash, "vectorSetHash");
sha256(vectors.vectorResultSetHash, "vectorResultSetHash");
vectors.abiVectors.forEach(validateAbiVector);
vectors.hostVectors.forEach(validateHostVector);

for (const [label, list] of [
  ["ABI", vectors.abiVectors],
  ["host", vectors.hostVectors]
]) {
  for (let index = 1; index < list.length; index += 1) {
    assert(
      utf8Compare(list[index - 1].vectorId, list[index].vectorId) < 0,
      `${label} vector ordering/duplicate at ${index}`
    );
  }
}
const allIds = [...vectors.abiVectors, ...vectors.hostVectors]
  .map((vector) => vector.vectorId)
  .sort(utf8Compare);
assert(new Set(allIds).size === 259, "global vector ID uniqueness");

const inputProjection = [
  ...vectors.abiVectors.map((vector) => ({
    vectorKind: "abi",
    vectorId: vector.vectorId,
    input: {
      initialMemoryPatches: vector.initialMemoryPatches,
      initialMemoryRawSha256: vector.initialMemoryRawSha256,
      invocation: vector.invocation
    }
  })),
  ...vectors.hostVectors.map((vector) => ({
    vectorKind: "host",
    vectorId: vector.vectorId,
    input: vector.input
  }))
].sort((left, right) => utf8Compare(left.vectorId, right.vectorId));
const resultProjection = [
  ...vectors.abiVectors.map((vector) => ({
    vectorKind: "abi",
    vectorId: vector.vectorId,
    expected: vector.expected
  })),
  ...vectors.hostVectors.map((vector) => ({
    vectorKind: "host",
    vectorId: vector.vectorId,
    expected: vector.expected
  }))
].sort((left, right) => utf8Compare(left.vectorId, right.vectorId));
const vectorSetHash = hashFramed(
  "vdt-studio/migration-transform-vector-set",
  "migration_transform_vector_set_hash.v1",
  TRANSFORM_METADATA,
  Buffer.from(canonicalize(inputProjection), "utf8")
);
const vectorResultSetHash = hashFramed(
  "vdt-studio/migration-transform-vector-results",
  "migration_transform_vector_results_hash.v1",
  TRANSFORM_METADATA,
  Buffer.from(canonicalize(resultProjection), "utf8")
);
assert(vectorSetHash === vectors.vectorSetHash, "vectorSetHash mismatch");
assert(vectorResultSetHash === vectors.vectorResultSetHash, "vectorResultSetHash mismatch");
assert(vectorSetHash === freeze.goldenVectors.vectorSetHash, "freeze vectorSetHash mismatch");
assert(
  vectorResultSetHash === freeze.goldenVectors.vectorResultSetHash,
  "freeze vectorResultSetHash mismatch"
);

const abiMemory = new Uint8Array(wasmInstance.exports.memory.buffer);
for (const vector of vectors.abiVectors) {
  abiMemory.fill(0);
  for (const patch of vector.initialMemoryPatches) {
    abiMemory.set(Buffer.from(patch.bytesHex, "hex"), patch.offset);
  }
  assert(rawSha256(abiMemory) === vector.initialMemoryRawSha256, `${vector.vectorId} initial memory`);
  const before = Buffer.from(abiMemory);
  const invocation = vector.invocation;
  const returnValue = wasmInstance.exports.transform_row(
    invocation.inputPtr,
    invocation.inputLen,
    invocation.outputPtr,
    invocation.outputCap
  );
  assert(returnValue === vector.expected.returnValue, `${vector.vectorId} return value`);
  if (vector.expected.outcome === "error") {
    assert(Buffer.from(abiMemory).equals(before), `${vector.vectorId} memory changed on error`);
  } else {
    const output = Buffer.from(
      abiMemory.subarray(invocation.outputPtr, invocation.outputPtr + 16)
    );
    assert(output.toString("hex") === vector.expected.outputHex, `${vector.vectorId} output bytes`);
    assert(rawSha256(output) === vector.expected.outputRawSha256, `${vector.vectorId} output hash`);
    assert(
      Buffer.from(
        abiMemory.subarray(invocation.inputPtr, invocation.inputPtr + invocation.inputLen)
      ).equals(before.subarray(invocation.inputPtr, invocation.inputPtr + invocation.inputLen)),
      `${vector.vectorId} input changed`
    );
  }
  assert(rawSha256(abiMemory) === vector.expected.finalMemoryRawSha256, `${vector.vectorId} final memory`);
}

const applicationHash = hashFramed(
  "vdt-studio/migration-application-identity",
  "migration_application_identity_hash.v1",
  APPLICATION_IDENTITY_INPUT,
  EMPTY
);
assert(
  `migration_application_${applicationHash.slice("sha256:".length)}` ===
    EXPECTED_APPLICATION_ID,
  "application identity known answer mismatch"
);

for (const answer of freeze.transformResultKnownAnswers) {
  const vector = vectors.hostVectors.find((candidate) => candidate.vectorId === answer.vectorId);
  assert(vector, `${answer.vectorId} missing from host vectors`);
  assert(vector.expected.outcome === "accepted", `${answer.vectorId} is not accepted`);
  assert(
    vector.expected.transformResultHash === answer.transformResultHash,
    `${answer.vectorId} freeze result hash mismatch`
  );
  assert(
    vector.expected.adoptionCanonicalJson.length === answer.insertedAdoptionCount,
    `${answer.vectorId} inserted count mismatch`
  );
  const sortedAdoptions = vector.expected.adoptionCanonicalJson.map((source, index) => {
    const adoption = parseStrictJson(source, `${answer.vectorId}.adoption[${index}]`);
    assert(canonicalize(adoption) === source, `${answer.vectorId}.adoption[${index}] canonical JSON`);
    assert(adoption.legacyRowHash === vector.expected.legacyRowHashes[index], `${answer.vectorId} row hash`);
    return { runId: adoption.runId, legacyRowHash: adoption.legacyRowHash };
  });
  for (let index = 1; index < sortedAdoptions.length; index += 1) {
    assert(
      utf8Compare(sortedAdoptions[index - 1].runId, sortedAdoptions[index].runId) < 0,
      `${answer.vectorId} adoption order`
    );
  }
  const recomputed = hashFramed(
    "vdt-studio/migration-transform-result",
    "migration_transform_result_hash.v1",
    {
      databaseId: APPLICATION_IDENTITY_INPUT.databaseId,
      migrationApplicationId: EXPECTED_APPLICATION_ID,
      sequence: 3,
      ...TRANSFORM_METADATA,
      moduleChecksum: APPLICATION_IDENTITY_INPUT.moduleChecksum,
      contractChecksum: APPLICATION_IDENTITY_INPUT.contractChecksum,
      goldenVectorsChecksum: APPLICATION_IDENTITY_INPUT.goldenVectorsChecksum,
      inputLegacyRunCount: answer.inputLegacyRunCount,
      insertedAdoptionCount: answer.insertedAdoptionCount,
      sortedAdoptions
    },
    EMPTY
  );
  assert(recomputed === answer.transformResultHash, `${answer.vectorId} result hash recomputation`);
}

function validateManifestEntry(entry, expected, label) {
  exactKeys(
    entry,
    [
      "sequence",
      "migrationId",
      "fromUserVersion",
      "toUserVersion",
      "sqlByteLength",
      "sqlChecksum",
      "preconditionSchemaHash",
      "postconditionSchemaHash",
      "transactional"
    ],
    label
  );
  exactValue(entry, expected, label);
}

const manifestBytes = frozenBuffers.get("manifest");
const manifest = parseCanonicalJsonBytes(manifestBytes, FROZEN_PATHS.manifest, true);
exactKeys(
  manifest,
  ["schemaVersion", "manifestVersion", "historicalPrefixManifestHash", "manifestHash", "entries"],
  "V2 manifest"
);
assert(manifest.schemaVersion === "migration_manifest.v2", "V2 manifest schemaVersion");
assert(manifest.manifestVersion === 2, "V2 manifest version");
assert(
  manifest.historicalPrefixManifestHash === HISTORICAL_PREFIX_HASH,
  "V2 historical prefix hash"
);
sha256(manifest.manifestHash, "V2 manifestHash");
assert(Array.isArray(manifest.entries) && manifest.entries.length === 3, "V2 manifest entries");
for (let index = 0; index < 2; index += 1) {
  const wrapped = manifest.entries[index];
  exactKeys(wrapped, ["entryKind", "entry"], `manifest.entries[${index}]`);
  assert(wrapped.entryKind === "v1_entry_projection", `manifest.entries[${index}].entryKind`);
  validateManifestEntry(
    wrapped.entry,
    historicalEntry(HISTORICAL_SQL[index]),
    `manifest.entries[${index}].entry`
  );
}
const third = manifest.entries[2];
exactKeys(third, ["entryKind", "entry", "transform"], "manifest.entries[2]");
assert(third.entryKind === "transactional_transform_v1", "Sequence 3 entry kind");
validateManifestEntry(
  third.entry,
  {
    sequence: 3,
    migrationId: "003-durable-agent-run-coordination",
    fromUserVersion: 2,
    toUserVersion: 3,
    sqlByteLength: sqlBytes.byteLength,
    sqlChecksum,
    preconditionSchemaHash: PRECONDITION_SCHEMA_HASH,
    postconditionSchemaHash: freeze.postconditionSchemaHash,
    transactional: true
  },
  "manifest.entries[2].entry"
);
exactKeys(
  third.transform,
  [
    "schemaVersion",
    "transformId",
    "transformVersion",
    "artifactFormat",
    "abiVersion",
    "phase",
    "moduleByteLength",
    "moduleChecksum",
    "contractByteLength",
    "contractChecksum",
    "goldenVectorsByteLength",
    "goldenVectorsChecksum"
  ],
  "manifest.entries[2].transform"
);
exactValue(
  third.transform,
  {
    schemaVersion: "migration_transactional_transform_binding.v1",
    ...TRANSFORM_METADATA,
    phase: "after_sql_before_application_record",
    moduleByteLength: moduleBytes.byteLength,
    moduleChecksum,
    contractByteLength: abiBytes.byteLength,
    contractChecksum,
    goldenVectorsByteLength: vectorBytes.byteLength,
    goldenVectorsChecksum
  },
  "manifest transform binding"
);
const manifestWithoutHash = { ...manifest };
delete manifestWithoutHash.manifestHash;
const manifestHash = hashFramed(
  "vdt-studio/migration-manifest",
  "migration_manifest_hash.v2",
  {},
  Buffer.from(canonicalize(manifestWithoutHash), "utf8")
);
assert(manifestHash === manifest.manifestHash, "V2 manifest hash recomputation");
assert(manifestHash === freeze.manifest.manifestHash, "freeze manifestHash mismatch");

const faultBytes = frozenBuffers.get("faultVectors");
const faultVectors = parseCanonicalJsonBytes(faultBytes, FROZEN_PATHS.faultVectors, true);
exactKeys(
  faultVectors,
  ["schemaVersion", "migrationSequence", "migrationId", "expectedCaseCount", "cases"],
  "fault vectors"
);
exactValue(
  {
    schemaVersion: faultVectors.schemaVersion,
    migrationSequence: faultVectors.migrationSequence,
    migrationId: faultVectors.migrationId,
    expectedCaseCount: faultVectors.expectedCaseCount
  },
  {
    schemaVersion: "sequence_3_fault_vectors.v1",
    migrationSequence: 3,
    migrationId: "003-durable-agent-run-coordination",
    expectedCaseCount: 65
  },
  "fault vector identity"
);
assert(Array.isArray(faultVectors.cases) && faultVectors.cases.length === 65, "fault case count");
const faultIds = new Set();
faultVectors.cases.forEach((faultCase, index) => {
  exactKeys(
    faultCase,
    [
      "adoptionIndex",
      "caseId",
      "expectedProcessResult",
      "expectedRestart",
      "faultPoint",
      "fixture",
      "kind"
    ],
    `fault cases[${index}]`
  );
  assert(typeof faultCase.caseId === "string" && faultCase.caseId.length > 0, `fault case ${index} ID`);
  assert(!faultIds.has(faultCase.caseId), `fault case duplicate ${faultCase.caseId}`);
  faultIds.add(faultCase.caseId);
  if (index > 0) {
    assert(
      utf8Compare(faultVectors.cases[index - 1].caseId, faultCase.caseId) < 0,
      `fault case ordering at ${index}`
    );
  }
  assert(
    faultCase.adoptionIndex === null ||
      (Number.isSafeInteger(faultCase.adoptionIndex) && faultCase.adoptionIndex >= 0),
    `${faultCase.caseId}.adoptionIndex`
  );
  assert(
    faultCase.faultPoint === null || typeof faultCase.faultPoint === "string",
    `${faultCase.caseId}.faultPoint`
  );
  assert(typeof faultCase.fixture === "string" && faultCase.fixture.length > 0, `${faultCase.caseId}.fixture`);
  assert(typeof faultCase.kind === "string" && faultCase.kind.length > 0, `${faultCase.caseId}.kind`);
  assert(
    typeof faultCase.expectedProcessResult === "string" &&
      faultCase.expectedProcessResult.length > 0,
    `${faultCase.caseId}.expectedProcessResult`
  );
  assert(
    faultCase.expectedRestart !== null &&
      typeof faultCase.expectedRestart === "object" &&
      !Array.isArray(faultCase.expectedRestart),
    `${faultCase.caseId}.expectedRestart`
  );
});
const faultVectorsHash = hashFramed(
  "vdt-studio/migration-fault-vectors",
  "migration_fault_vectors_hash.v1",
  {
    migrationSequence: 3,
    migrationId: "003-durable-agent-run-coordination"
  },
  faultBytes
);
assert(faultVectorsHash === freeze.faultVectors.faultVectorsHash, "faultVectorsHash mismatch");

const forbiddenNeedles = [
  "003-durable-agent-run-coordination",
  "legacy-agent-run-adoption-v1",
  "migration_manifest.v2",
  "migration-manifest-v2.json",
  ...[
    "sql",
    "module",
    "abiContract",
    "goldenVectors",
    "manifest",
    "schemaIntrospection",
    "faultVectors"
  ].flatMap((field) => [
    FROZEN_PATHS[field].split("/").at(-1),
    freeze[field].rawSha256,
    freeze[field].rawSha256.slice("sha256:".length)
  ])
];
for (const [path, bytes] of authorityBuffers) {
  const text = decodeUtf8(bytes, path);
  for (const needle of forbiddenNeedles) {
    assert(!text.includes(needle), `${path} contains forbidden Sequence 3 authority ${needle}`);
  }
}
const migrationsSource = decodeUtf8(
  authorityBuffers.get("packages/vdt-storage/src/migrations.ts"),
  "packages/vdt-storage/src/migrations.ts"
);
assert(
  migrationsSource.includes('migrationId: "001-legacy-v1-bootstrap"') &&
    migrationsSource.includes('migrationId: "002-atomic-revisions"'),
  "production migration manifest historical entries missing"
);
assert(
  (migrationsSource.match(/migrationId: "00[12]-/g) ?? []).length === 2,
  "production migration manifest does not remain exactly Sequence 1/2"
);
const storageIndex = decodeUtf8(
  authorityBuffers.get("packages/vdt-storage/src/index.ts"),
  "packages/vdt-storage/src/index.ts"
);
for (const needle of ["manifest-v2", "transform", "freeze", "artifact-freeze"]) {
  assert(!storageIndex.toLowerCase().includes(needle), `storage index exports ${needle}`);
}

const packageManifestPaths = [
  "package.json",
  "apps/web/package.json",
  "packages/vdt-storage/package.json"
];
for (const path of packageManifestPaths) {
  const value = parseStrictJson(decodeUtf8(authorityBuffers.get(path), path), path);
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `${path} object`);
}

const freezeWithoutHash = { ...freeze };
delete freezeWithoutHash.freezeRecordHash;
const freezeRecordHash = hashFramed(
  "vdt-studio/sequence-3-artifact-freeze",
  "sequence_3_artifact_freeze_hash.v1",
  {},
  Buffer.from(canonicalize(freezeWithoutHash), "utf8")
);
assert(freezeRecordHash === freeze.freezeRecordHash, "freezeRecordHash mismatch");

process.stdout.write(
  `${canonicalize({
    schemaVersion: "sequence_3_artifact_freeze_verification.v1",
    migrationSequence: 3,
    migrationId: "003-durable-agent-run-coordination",
    freezeRecordHash,
    manifestHash,
    sqlChecksum,
    moduleChecksum,
    contractChecksum,
    goldenVectorsChecksum,
    vectorSetHash,
    vectorResultSetHash,
    faultVectorsHash,
    noWiringAuthorityFileCount: freeze.noWiringAuthorityFiles.length,
    verified: true
  })}\n`
);
