import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const REQUIRED_NODE_VERSION = "24.15.0";
const MIGRATION_ID = "003-durable-agent-run-coordination";
const PRECONDITION_SCHEMA_HASH =
  "sha256:b3eda62829523baced9238894eaabbb3cad30721b75bf02a59166bf4d759bb02";
const HISTORICAL_PREFIX_MANIFEST_HASH =
  "sha256:f36158d9e2783a8cd1a9bd41f7d22da1d425a296dec95c8d272bb8fd789686ad";
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const GOLDEN_VECTOR_TRANSPORT = Object.freeze({
  compressedByteLength: 8_755_503,
  compressedRawSha256:
    "sha256:62d65bbfa68bf5cc09ce21d73816971da313d0c1140338372fb1ae3c4c4a30d3",
  uncompressedByteLength: 121_310_783,
  uncompressedRawSha256:
    "sha256:0cea8ae8156c3885219d11d496b686ab1a5420e01f3ebc74fa579be8eabe6467"
});

const TRANSFORM_IDENTITY = Object.freeze({
  transformId: "legacy-agent-run-adoption-v1",
  transformVersion: 1,
  artifactFormat: "wasm32-no-imports-v1",
  abiVersion: "legacy-agent-run-adoption-abi.v1"
});

const FIXTURE_MIGRATION_IDENTITY = Object.freeze({
  schemaVersion: "migration_application_identity.v1",
  databaseId: "db_test",
  attemptId: "migration_attempt_test",
  backupEvidenceId: "migration_backup_test",
  fenceOwnerToken: "owner_test",
  fenceLeaseGeneration: 1,
  targetManifestHash:
    "sha256:1111111111111111111111111111111111111111111111111111111111111111",
  sequence: 3,
  migrationId: MIGRATION_ID,
  sqlChecksum:
    "sha256:2222222222222222222222222222222222222222222222222222222222222222",
  transformId: TRANSFORM_IDENTITY.transformId,
  transformVersion: TRANSFORM_IDENTITY.transformVersion,
  moduleChecksum:
    "sha256:3333333333333333333333333333333333333333333333333333333333333333",
  contractChecksum:
    "sha256:4444444444444444444444444444444444444444444444444444444444444444",
  goldenVectorsChecksum:
    "sha256:5555555555555555555555555555555555555555555555555555555555555555"
});

const INPUT_RECORD_FIELD_NAMES = Object.freeze([
  "magic",
  "version",
  "completedIsNull",
  "headerByteLength",
  "totalByteLength",
  "statusByteLength",
  "phaseByteLength",
  "reserved",
  "createdAtMillis",
  "updatedAtMillis",
  "completedAtMillis",
  "status",
  "phase"
]);

const OUTPUT_RECORD_FIELD_NAMES = Object.freeze([
  "magic",
  "version",
  "statusOrdinal",
  "phaseOrdinal",
  "disposition",
  "projectedStatus",
  "completedIsNull",
  "reserved",
  "totalByteLength"
]);

const HISTORICAL_ENTRIES = Object.freeze([
  Object.freeze({
    sequence: 1,
    migrationId: "001-legacy-v1-bootstrap",
    fromUserVersion: 0,
    toUserVersion: 1,
    sqlByteLength: 4304,
    sqlChecksum:
      "sha256:eed70d7619cdccb8aa6137d215704863e8419191e809ef94153b593e9f8b6df2",
    preconditionSchemaHash:
      "sha256:c0e1e0f6e95438816ce50759cd743dde638aef811801cedbc327ad50e2b8fa5b",
    postconditionSchemaHash:
      "sha256:69e76d8d69bd6e84aaf1eaa086c5e03e865fc3698cf234a905bb14e844828748",
    transactional: true
  }),
  Object.freeze({
    sequence: 2,
    migrationId: "002-atomic-revisions",
    fromUserVersion: 1,
    toUserVersion: 2,
    sqlByteLength: 6972,
    sqlChecksum:
      "sha256:581d35e2d660d40d51a1405997c11aac0337ca77dbeccabaf40deb8aa6098eea",
    preconditionSchemaHash:
      "sha256:69e76d8d69bd6e84aaf1eaa086c5e03e865fc3698cf234a905bb14e844828748",
    postconditionSchemaHash: PRECONDITION_SCHEMA_HASH,
    transactional: true
  })
]);

const INPUT_PATHS = Object.freeze([
  "packages/vdt-storage/src/migrations/001-legacy-v1-bootstrap.sql",
  "packages/vdt-storage/src/migrations/002-atomic-revisions.sql",
  "packages/vdt-storage/src/migrations/003-durable-agent-run-coordination.sql",
  "packages/vdt-storage/src/migrations/transforms/legacy-agent-run-adoption-v1.wasm",
  "packages/vdt-storage/src/migrations/transforms/legacy-agent-run-adoption-abi.v1.json",
  "packages/vdt-storage/src/migrations/transforms/legacy-agent-run-adoption-v1.golden-vectors.json.gz",
  "packages/vdt-storage/src/migrations/sequence-3-schema-introspection.v1.json"
]);

const OUTPUT_RELATIVE_PATH =
  "packages/vdt-storage/src/migrations/migration-manifest-v2.json";

class GeneratorFailure extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function buildManifest(inputBuffers) {
  const [sequence1Sql, sequence2Sql, sequence3Sql, moduleBytes, abiBytes, compressedVectorBytes, introspectionBytes] =
    inputBuffers;
  if (
    compressedVectorBytes.byteLength !==
      GOLDEN_VECTOR_TRANSPORT.compressedByteLength ||
    hashRaw(compressedVectorBytes) !==
      GOLDEN_VECTOR_TRANSPORT.compressedRawSha256
  ) {
    fail("vector_transport_invalid");
  }
  let vectorBytes;
  try {
    vectorBytes = gunzipSync(compressedVectorBytes, {
      maxOutputLength: GOLDEN_VECTOR_TRANSPORT.uncompressedByteLength
    });
  } catch {
    fail("vector_transport_invalid");
  }
  if (
    vectorBytes.byteLength !== GOLDEN_VECTOR_TRANSPORT.uncompressedByteLength ||
    hashRaw(vectorBytes) !== GOLDEN_VECTOR_TRANSPORT.uncompressedRawSha256
  ) {
    fail("vector_transport_invalid");
  }

  verifyHistoricalSql(sequence1Sql, HISTORICAL_ENTRIES[0]);
  verifyHistoricalSql(sequence2Sql, HISTORICAL_ENTRIES[1]);

  const historicalManifest = {
    schemaVersion: "migration_manifest.v1",
    manifestVersion: 1,
    entries: HISTORICAL_ENTRIES
  };
  const historicalHash = hashFramed(
    "vdt-studio/migration-manifest",
    "migration_manifest_hash.v1",
    historicalManifest,
    Buffer.alloc(0)
  );
  if (historicalHash !== HISTORICAL_PREFIX_MANIFEST_HASH) {
    fail("historical_prefix_invalid");
  }

  if (
    moduleBytes.byteLength === 0 ||
    !moduleBytes.subarray(0, 8).equals(
      Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00])
    ) ||
    !WebAssembly.validate(moduleBytes)
  ) {
    fail("module_invalid");
  }
  let compiledModule;
  try {
    compiledModule = new WebAssembly.Module(moduleBytes);
  } catch {
    fail("module_invalid");
  }
  const moduleImports = WebAssembly.Module.imports(compiledModule);
  const moduleExports = WebAssembly.Module.exports(compiledModule);
  if (
    moduleImports.length !== 0 ||
    canonicalize(moduleExports) !==
      canonicalize([
        { name: "memory", kind: "memory" },
        { name: "transform_row", kind: "function" }
      ])
  ) {
    fail("module_invalid");
  }

  const abiContract = decodeCanonicalJson(abiBytes, false);
  validateAbiContract(abiContract);
  const goldenVectors = decodeCanonicalJson(vectorBytes, false);
  validateGoldenVectors(goldenVectors);
  const introspection = decodeCanonicalJson(introspectionBytes, true);
  validateIntrospection(introspection);

  const postconditionSchemaHash = introspection.postcondition.semanticSchemaHash;
  const sequence3Entry = {
    sequence: 3,
    migrationId: MIGRATION_ID,
    fromUserVersion: 2,
    toUserVersion: 3,
    sqlByteLength: sequence3Sql.byteLength,
    sqlChecksum: hashFramed(
      "vdt-studio/sql-migration",
      "sql_migration_hash.v1",
      {
        sequence: 3,
        migrationId: MIGRATION_ID,
        fromUserVersion: 2,
        toUserVersion: 3,
        preconditionSchemaHash: PRECONDITION_SCHEMA_HASH,
        postconditionSchemaHash
      },
      sequence3Sql
    ),
    preconditionSchemaHash: PRECONDITION_SCHEMA_HASH,
    postconditionSchemaHash,
    transactional: true
  };

  const transform = {
    schemaVersion: "migration_transactional_transform_binding.v1",
    ...TRANSFORM_IDENTITY,
    phase: "after_sql_before_application_record",
    moduleByteLength: moduleBytes.byteLength,
    moduleChecksum: hashFramed(
      "vdt-studio/migration-transform-module",
      "migration_transform_module_hash.v1",
      TRANSFORM_IDENTITY,
      moduleBytes
    ),
    contractByteLength: abiBytes.byteLength,
    contractChecksum: hashFramed(
      "vdt-studio/migration-transform-contract",
      "migration_transform_contract_hash.v1",
      TRANSFORM_IDENTITY,
      abiBytes
    ),
    goldenVectorsByteLength: vectorBytes.byteLength,
    goldenVectorsChecksum: hashFramed(
      "vdt-studio/migration-transform-golden-vectors",
      "migration_transform_golden_vectors_hash.v1",
      TRANSFORM_IDENTITY,
      vectorBytes
    )
  };

  const withoutHash = {
    schemaVersion: "migration_manifest.v2",
    manifestVersion: 2,
    historicalPrefixManifestHash: HISTORICAL_PREFIX_MANIFEST_HASH,
    entries: [
      {
        entryKind: "v1_entry_projection",
        entry: HISTORICAL_ENTRIES[0]
      },
      {
        entryKind: "v1_entry_projection",
        entry: HISTORICAL_ENTRIES[1]
      },
      {
        entryKind: "transactional_transform_v1",
        entry: sequence3Entry,
        transform
      }
    ]
  };
  const manifestHash = hashFramed(
    "vdt-studio/migration-manifest",
    "migration_manifest_hash.v2",
    {},
    Buffer.from(canonicalize(withoutHash), "utf8")
  );
  const manifest = { ...withoutHash, manifestHash };
  validateManifest(manifest);
  return manifest;
}

function verifyHistoricalSql(bytes, entry) {
  if (bytes.byteLength !== entry.sqlByteLength) fail("historical_sql_invalid");
  const checksum = hashFramed(
    "vdt-studio/sql-migration",
    "sql_migration_hash.v1",
    {
      sequence: entry.sequence,
      migrationId: entry.migrationId,
      fromUserVersion: entry.fromUserVersion,
      toUserVersion: entry.toUserVersion,
      preconditionSchemaHash: entry.preconditionSchemaHash,
      postconditionSchemaHash: entry.postconditionSchemaHash
    },
    bytes
  );
  if (checksum !== entry.sqlChecksum) fail("historical_sql_invalid");
}

function validateManifest(value) {
  assertRecord(value);
  assertExactKeys(value, [
    "schemaVersion",
    "manifestVersion",
    "historicalPrefixManifestHash",
    "manifestHash",
    "entries"
  ]);
  assertEqual(value.schemaVersion, "migration_manifest.v2");
  assertEqual(value.manifestVersion, 2);
  assertEqual(
    value.historicalPrefixManifestHash,
    HISTORICAL_PREFIX_MANIFEST_HASH
  );
  assertSha256(value.manifestHash);
  if (!Array.isArray(value.entries) || value.entries.length !== 3) {
    fail("manifest_schema_invalid");
  }
  for (let index = 0; index < value.entries.length; index += 1) {
    const wrapped = value.entries[index];
    assertRecord(wrapped);
    if (index < 2) {
      assertExactKeys(wrapped, ["entryKind", "entry"]);
      assertEqual(wrapped.entryKind, "v1_entry_projection");
    } else {
      assertExactKeys(wrapped, ["entryKind", "entry", "transform"]);
      assertEqual(wrapped.entryKind, "transactional_transform_v1");
      validateTransformBinding(wrapped.transform);
    }
    validateManifestEntry(wrapped.entry);
  }
  if (
    canonicalize(value.entries[0].entry) !== canonicalize(HISTORICAL_ENTRIES[0]) ||
    canonicalize(value.entries[1].entry) !== canonicalize(HISTORICAL_ENTRIES[1])
  ) {
    fail("manifest_schema_invalid");
  }
}

function validateManifestEntry(value) {
  assertRecord(value);
  assertExactKeys(value, [
    "sequence",
    "migrationId",
    "fromUserVersion",
    "toUserVersion",
    "sqlByteLength",
    "sqlChecksum",
    "preconditionSchemaHash",
    "postconditionSchemaHash",
    "transactional"
  ]);
  for (const field of [
    "sequence",
    "fromUserVersion",
    "toUserVersion",
    "sqlByteLength"
  ]) {
    if (!Number.isSafeInteger(value[field]) || value[field] < 0) {
      fail("manifest_schema_invalid");
    }
  }
  if (value.sqlByteLength === 0) fail("manifest_schema_invalid");
  if (typeof value.migrationId !== "string" || value.migrationId.length === 0) {
    fail("manifest_schema_invalid");
  }
  assertSha256(value.sqlChecksum);
  assertSha256(value.preconditionSchemaHash);
  assertSha256(value.postconditionSchemaHash);
  assertEqual(value.transactional, true);
}

function validateTransformBinding(value) {
  assertRecord(value);
  assertExactKeys(value, [
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
  ]);
  assertEqual(
    value.schemaVersion,
    "migration_transactional_transform_binding.v1"
  );
  validateTransformIdentity(value);
  assertEqual(value.phase, "after_sql_before_application_record");
  for (const field of [
    "moduleByteLength",
    "contractByteLength",
    "goldenVectorsByteLength"
  ]) {
    if (!Number.isSafeInteger(value[field]) || value[field] <= 0) {
      fail("manifest_schema_invalid");
    }
  }
  assertSha256(value.moduleChecksum);
  assertSha256(value.contractChecksum);
  assertSha256(value.goldenVectorsChecksum);
}

function validateAbiContract(value) {
  assertRecord(value);
  assertExactKeys(value, [
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
  ]);
  assertEqual(
    value.schemaVersion,
    "legacy_agent_run_adoption_abi_contract.v1"
  );
  validateTransformIdentity(value);
  assertEqual(value.phase, "after_sql_before_application_record");
  assertEqual(value.migrationSequence, 3);
  assertEqual(value.migrationId, MIGRATION_ID);
  assertEqual(value.ordering, "unsigned_lexicographic_utf8");
  assertEqual(value.goldenVectorsSchema, "legacy_agent_run_adoption_golden_vectors.v1");
  assertEqual(
    value.applicationIdentitySchema,
    "migration_application_identity.v1"
  );
  assertEqual(
    value.applicationIdentityHashSchema,
    "migration_application_identity_hash.v1"
  );
  assertEqual(
    value.applicationIdentityHashDomain,
    "vdt-studio/migration-application-identity"
  );
  assertEqual(value.rowHashSchema, "legacy_agent_run_adoption_hash.v1");
  assertEqual(value.rowHashDomain, "vdt-studio/legacy-agent-run-adoption");
  assertEqual(value.resultHashSchema, "migration_transform_result_hash.v1");
  assertEqual(value.resultHashDomain, "vdt-studio/migration-transform-result");

  assertObjectWithKeys(value.memory, ["pages", "byteLength", "shared"]);
  assertEqual(value.memory.pages, 1);
  assertEqual(value.memory.byteLength, 65536);
  assertEqual(value.memory.shared, false);

  if (!Array.isArray(value.exports) || value.exports.length !== 2) {
    fail("abi_schema_invalid");
  }
  assertObjectWithKeys(value.exports[0], ["name", "kind", "index"]);
  assertObjectWithKeys(value.exports[1], [
    "name",
    "kind",
    "index",
    "params",
    "results"
  ]);
  assertEqual(value.exports[0].name, "memory");
  assertEqual(value.exports[0].kind, "memory");
  assertEqual(value.exports[0].index, 0);
  assertEqual(value.exports[1].name, "transform_row");
  assertEqual(value.exports[1].kind, "function");
  assertEqual(value.exports[1].index, 0);
  if (
    canonicalize(value.exports[1].params) !==
      canonicalize(["i32", "i32", "i32", "i32"]) ||
    canonicalize(value.exports[1].results) !== canonicalize(["i32"])
  ) {
    fail("abi_schema_invalid");
  }

  validateRecordDescription(value.inputRecord, "input");
  validateRecordDescription(value.outputRecord, "output");

  assertObjectWithKeys(value.limits, [
    "maxSafeInteger",
    "maxLegacyRows",
    "maxJsonFieldBytes",
    "maxJsonRowBytes",
    "maxJsonMigrationBytes",
    "maxJsonDepth",
    "maxJsonValues"
  ]);
  const expectedLimits = [
    ["maxSafeInteger", 9007199254740991],
    ["maxLegacyRows", 100000],
    ["maxJsonFieldBytes", 1048576],
    ["maxJsonRowBytes", 2097152],
    ["maxJsonMigrationBytes", 268435456],
    ["maxJsonDepth", 64],
    ["maxJsonValues", 100000]
  ];
  for (const [field, expected] of expectedLimits) {
    assertEqual(value.limits[field], expected);
  }
  validateObjectArray(value.statuses, [
    "ordinal",
    "literal",
    "disposition",
    "projectedStatus",
    "completedIsNull"
  ], 7);
  validateObjectArray(value.phases, ["ordinal", "literal"], 11);
  validateObjectArray(value.returnCodes, ["value", "symbol"], 17);
  validateStringArray(value.validationOrder, 17);

  assertObjectWithKeys(value.staticProfile, [
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
  ]);
  validateSafeIntegerArray(value.staticProfile.sectionIds);
  validateSafeIntegerArray(value.staticProfile.forbiddenSectionIds);
  validateObjectArray(value.staticProfile.permittedOpcodes, ["name", "hex"]);

  assertObjectWithKeys(value.hostPolicy, [
    "safeIdPattern",
    "sqliteStorageClasses",
    "utf8",
    "json",
    "rowRead",
    "rowComparator",
    "timestamp",
    "moduleResult"
  ]);
  assertObjectWithKeys(value.hostPolicy.sqliteStorageClasses, [
    "requiredText",
    "nullableText",
    "requiredInteger",
    "nullableInteger"
  ]);
  for (const field of [
    "requiredText",
    "nullableText",
    "requiredInteger",
    "nullableInteger"
  ]) {
    validateStringArray(value.hostPolicy.sqliteStorageClasses[field]);
  }
  assertObjectWithKeys(value.hostPolicy.json, [
    "grammar",
    "topLevel",
    "duplicateKeys",
    "unicode",
    "numbers",
    "rawAttestation"
  ]);
}

function validateRecordDescription(value, kind) {
  assertRecord(value);
  const expectedKeys =
    kind === "input"
      ? [
          "magicHex",
          "version",
          "headerByteLength",
          "minimumByteLength",
          "maximumByteLength",
          "byteOrder",
          "fields"
        ]
      : ["magicHex", "version", "byteLength", "byteOrder", "fields"];
  assertExactKeys(value, expectedKeys);
  if (kind === "input") {
    assertEqual(value.magicHex, "4c415231");
    assertEqual(value.version, 1);
    assertEqual(value.headerByteLength, 40);
    assertEqual(value.minimumByteLength, 40);
    assertEqual(value.maximumByteLength, 83);
    assertEqual(value.byteOrder, "little_endian");
  } else {
    assertEqual(value.magicHex, "4c414f31");
    assertEqual(value.version, 1);
    assertEqual(value.byteLength, 16);
    assertEqual(value.byteOrder, "little_endian");
  }
  const expectedFieldNames =
    kind === "input" ? INPUT_RECORD_FIELD_NAMES : OUTPUT_RECORD_FIELD_NAMES;
  if (
    !Array.isArray(value.fields) ||
    value.fields.length !== expectedFieldNames.length
  ) {
    fail("abi_schema_invalid");
  }
  for (let index = 0; index < value.fields.length; index += 1) {
    const field = value.fields[index];
    assertRecord(field);
    assertEqual(field.name, expectedFieldNames[index]);
    const allowedByName = {
      magic: ["name", "offset", "width", "encoding", "constantHex"],
      version: ["name", "offset", "width", "encoding", "constantDecimal"],
      completedIsNull: field.minimumDecimal === undefined
        ? ["name", "offset", "width", "encoding", "allowedDecimal"]
        : ["name", "offset", "width", "encoding", "minimumDecimal", "maximumDecimal"],
      headerByteLength: ["name", "offset", "width", "encoding", "constantDecimal"],
      totalByteLength: field.rule === undefined
        ? ["name", "offset", "width", "encoding", "constantDecimal"]
        : ["name", "offset", "width", "encoding", "rule"],
      statusByteLength: [
        "name",
        "offset",
        "width",
        "encoding",
        "minimumDecimal",
        "maximumDecimal"
      ],
      phaseByteLength: [
        "name",
        "offset",
        "width",
        "encoding",
        "minimumDecimal",
        "maximumDecimal"
      ],
      reserved: ["name", "offset", "width", "encoding", "constantDecimal"],
      createdAtMillis: [
        "name",
        "offset",
        "width",
        "encoding",
        "minimumDecimal",
        "maximumDecimal"
      ],
      updatedAtMillis: [
        "name",
        "offset",
        "width",
        "encoding",
        "minimumDecimal",
        "maximumDecimal"
      ],
      completedAtMillis: [
        "name",
        "offset",
        "width",
        "encoding",
        "minimumDecimal",
        "maximumDecimal"
      ],
      status: ["name", "offset", "width", "encoding"],
      phase: ["name", "offset", "width", "encoding"],
      statusOrdinal: [
        "name",
        "offset",
        "width",
        "encoding",
        "minimumDecimal",
        "maximumDecimal"
      ],
      phaseOrdinal: [
        "name",
        "offset",
        "width",
        "encoding",
        "minimumDecimal",
        "maximumDecimal"
      ],
      disposition: ["name", "offset", "width", "encoding", "allowedDecimal"],
      projectedStatus: ["name", "offset", "width", "encoding", "allowedDecimal"]
    };
    const keys = allowedByName[field.name];
    if (!keys) fail("abi_schema_invalid");
    assertExactKeys(field, keys);
  }
}

function validateGoldenVectors(value) {
  assertRecord(value);
  assertExactKeys(value, [
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
  ]);
  assertEqual(
    value.schemaVersion,
    "legacy_agent_run_adoption_golden_vectors.v1"
  );
  validateTransformIdentity(value);
  assertEqual(value.fixtureCommitTimestamp, "2026-07-24T00:00:00.000Z");
  assertEqual(value.abiVectorCount, 55);
  assertEqual(value.hostAcceptedVectorCount, 36);
  assertEqual(value.hostBlockedVectorCount, 168);
  assertEqual(value.hostVectorCount, 204);
  assertEqual(value.vectorCount, 259);
  assertSha256(value.vectorSetHash);
  assertSha256(value.vectorResultSetHash);
  validateFixtureIdentity(value.fixtureMigrationIdentity);

  if (!Array.isArray(value.abiVectors) || value.abiVectors.length !== 55) {
    fail("vectors_schema_invalid");
  }
  if (!Array.isArray(value.hostVectors) || value.hostVectors.length !== 204) {
    fail("vectors_schema_invalid");
  }
  const ids = new Set();
  validateSortedVectors(value.abiVectors, ids, validateAbiVector);
  validateSortedVectors(value.hostVectors, ids, validateHostVector);
  if (ids.size !== 259) fail("vectors_schema_invalid");
  const acceptedCount = value.hostVectors.filter(
    (vector) => vector.expected.outcome === "accepted"
  ).length;
  const blockedCount = value.hostVectors.length - acceptedCount;
  if (acceptedCount !== 36 || blockedCount !== 168) {
    fail("vectors_schema_invalid");
  }

  const inputProjection = [
    ...value.abiVectors.map((vector) => ({
      vectorKind: "abi",
      vectorId: vector.vectorId,
      input: {
        initialMemoryPatches: vector.initialMemoryPatches,
        initialMemoryRawSha256: vector.initialMemoryRawSha256,
        invocation: vector.invocation
      }
    })),
    ...value.hostVectors.map((vector) => ({
      vectorKind: "host",
      vectorId: vector.vectorId,
      input: vector.input
    }))
  ].sort((left, right) => compareUtf8(left.vectorId, right.vectorId));
  const resultProjection = [
    ...value.abiVectors.map((vector) => ({
      vectorKind: "abi",
      vectorId: vector.vectorId,
      expected: vector.expected
    })),
    ...value.hostVectors.map((vector) => ({
      vectorKind: "host",
      vectorId: vector.vectorId,
      expected: vector.expected
    }))
  ].sort((left, right) => compareUtf8(left.vectorId, right.vectorId));

  const setHash = hashFramed(
    "vdt-studio/migration-transform-vector-set",
    "migration_transform_vector_set_hash.v1",
    TRANSFORM_IDENTITY,
    Buffer.from(canonicalize(inputProjection), "utf8")
  );
  const resultHash = hashFramed(
    "vdt-studio/migration-transform-vector-results",
    "migration_transform_vector_results_hash.v1",
    TRANSFORM_IDENTITY,
    Buffer.from(canonicalize(resultProjection), "utf8")
  );
  if (setHash !== value.vectorSetHash || resultHash !== value.vectorResultSetHash) {
    fail("vectors_hash_invalid");
  }
}

function validateFixtureIdentity(value) {
  assertObjectWithKeys(value, [
    "schemaVersion",
    "databaseId",
    "attemptId",
    "backupEvidenceId",
    "fenceOwnerToken",
    "fenceLeaseGeneration",
    "targetManifestHash",
    "sequence",
    "migrationId",
    "sqlChecksum",
    "transformId",
    "transformVersion",
    "moduleChecksum",
    "contractChecksum",
    "goldenVectorsChecksum"
  ]);
  assertEqual(value.schemaVersion, "migration_application_identity.v1");
  assertEqual(value.transformId, TRANSFORM_IDENTITY.transformId);
  assertEqual(value.transformVersion, TRANSFORM_IDENTITY.transformVersion);
  for (const field of [
    "targetManifestHash",
    "sqlChecksum",
    "moduleChecksum",
    "contractChecksum",
    "goldenVectorsChecksum"
  ]) {
    assertSha256(value[field]);
  }
  if (canonicalize(value) !== canonicalize(FIXTURE_MIGRATION_IDENTITY)) {
    fail("vectors_schema_invalid");
  }
}

function validateSortedVectors(vectors, ids, validator) {
  let previous = null;
  for (const vector of vectors) {
    validator(vector);
    if (
      ids.has(vector.vectorId) ||
      (previous !== null && compareUtf8(previous, vector.vectorId) >= 0)
    ) {
      fail("vectors_schema_invalid");
    }
    ids.add(vector.vectorId);
    previous = vector.vectorId;
  }
}

function validateAbiVector(value) {
  assertObjectWithKeys(value, [
    "vectorId",
    "initialMemoryPatches",
    "initialMemoryRawSha256",
    "invocation",
    "expected"
  ]);
  assertVectorId(value.vectorId);
  assertSha256(value.initialMemoryRawSha256);
  if (!Array.isArray(value.initialMemoryPatches)) fail("vectors_schema_invalid");
  for (const patch of value.initialMemoryPatches) {
    assertObjectWithKeys(patch, ["offset", "bytesHex"]);
    assertIntegerInRange(patch.offset, 0, 65535);
    assertEvenLowerHex(patch.bytesHex, false);
    if (patch.offset + patch.bytesHex.length / 2 > 65536) {
      fail("vectors_schema_invalid");
    }
  }
  assertObjectWithKeys(value.invocation, [
    "inputPtr",
    "inputLen",
    "outputPtr",
    "outputCap"
  ]);
  for (const field of ["inputPtr", "inputLen", "outputPtr", "outputCap"]) {
    assertIntegerInRange(value.invocation[field], 0, 4294967295);
  }
  assertRecord(value.expected);
  if (value.expected.outcome === "success") {
    assertExactKeys(value.expected, [
      "outcome",
      "returnValue",
      "outputHex",
      "outputRawSha256",
      "inputUnchanged",
      "finalMemoryRawSha256"
    ]);
    assertEqual(value.expected.returnValue, 16);
    assertEvenLowerHex(value.expected.outputHex, false);
    if (
      value.expected.outputHex.length !== 32 ||
      value.expected.inputUnchanged !== true
    ) {
      fail("vectors_schema_invalid");
    }
    assertSha256(value.expected.outputRawSha256);
  } else if (value.expected.outcome === "error") {
    assertExactKeys(value.expected, [
      "outcome",
      "returnValue",
      "memoryUnchanged",
      "finalMemoryRawSha256"
    ]);
    if (
      !Number.isSafeInteger(value.expected.returnValue) ||
      value.expected.returnValue < -16 ||
      value.expected.returnValue > -1 ||
      value.expected.memoryUnchanged !== true
    ) {
      fail("vectors_schema_invalid");
    }
  } else {
    fail("vectors_schema_invalid");
  }
  assertSha256(value.expected.finalMemoryRawSha256);
}

function validateHostVector(value) {
  assertObjectWithKeys(value, ["vectorId", "input", "expected"]);
  assertVectorId(value.vectorId);
  assertObjectWithKeys(value.input, [
    "rowSet",
    "streamBehavior",
    "wasmBehavior",
    "expandedRowCount",
    "expandedInputRawSha256"
  ]);
  validateRowSet(value.input.rowSet);
  validateStreamBehavior(value.input.streamBehavior);
  validateWasmBehavior(value.input.wasmBehavior);
  assertIntegerInRange(value.input.expandedRowCount, 0, 9007199254740991);
  assertSha256(value.input.expandedInputRawSha256);
  assertRecord(value.expected);
  if (value.expected.outcome === "accepted") {
    assertExactKeys(value.expected, [
      "outcome",
      "migrationApplicationId",
      "adoptionCanonicalJson",
      "legacyRowHashes",
      "transformResultHash",
      "persistedBlockedReason"
    ]);
    validateStringArray(value.expected.adoptionCanonicalJson);
    if (!Array.isArray(value.expected.legacyRowHashes)) {
      fail("vectors_schema_invalid");
    }
    value.expected.legacyRowHashes.forEach(assertSha256);
    assertSha256(value.expected.transformResultHash);
    assertEqual(value.expected.persistedBlockedReason, null);
  } else if (value.expected.outcome === "blocked") {
    assertExactKeys(value.expected, [
      "outcome",
      "code",
      "failingRowIndex",
      "failingColumn",
      "persistedBlockedReason"
    ]);
    assertEqual(value.expected.persistedBlockedReason, "postcondition_failed");
  } else {
    fail("vectors_schema_invalid");
  }
}

function validateRowSet(value) {
  assertRecord(value);
  if (value.kind === "literal") {
    assertExactKeys(value, ["kind", "rows"]);
    if (!Array.isArray(value.rows)) fail("vectors_schema_invalid");
    value.rows.forEach(validateHostRow);
  } else if (value.kind === "series") {
    assertExactKeys(value, ["kind", "segments"]);
    if (!Array.isArray(value.segments)) fail("vectors_schema_invalid");
    for (const segment of value.segments) {
      assertObjectWithKeys(segment, [
        "count",
        "firstIndex",
        "decimalWidth",
        "runIdPrefix",
        "template"
      ]);
      assertIntegerInRange(segment.count, 0, 9007199254740991);
      assertIntegerInRange(segment.firstIndex, 0, 9007199254740991);
      assertEqual(segment.decimalWidth, 6);
      assertEqual(segment.runIdPrefix, "run_");
      validateHostRow(segment.template);
    }
  } else {
    fail("vectors_schema_invalid");
  }
}

function validateHostRow(value) {
  assertObjectWithKeys(value, [
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
  ]);
  Object.values(value).forEach(validateSqlValue);
}

function validateSqlValue(value) {
  assertRecord(value);
  if (value.storageClass === "null") {
    assertExactKeys(value, ["storageClass"]);
  } else if (value.storageClass === "integer") {
    assertExactKeys(value, ["storageClass", "integerDecimal"]);
    if (
      typeof value.integerDecimal !== "string" ||
      !/^-?(?:0|[1-9][0-9]*)$/.test(value.integerDecimal)
    ) {
      fail("vectors_schema_invalid");
    }
  } else if (value.storageClass === "real") {
    assertExactKeys(value, ["storageClass", "realCanonical"]);
    if (typeof value.realCanonical !== "string") {
      fail("vectors_schema_invalid");
    }
  } else if (value.storageClass === "text" || value.storageClass === "blob") {
    assertExactKeys(value, ["storageClass", "bytes"]);
    validateHostBytes(value.bytes);
  } else {
    fail("vectors_schema_invalid");
  }
}

function validateHostBytes(value) {
  assertRecord(value);
  if (value.kind === "hex") {
    assertExactKeys(value, ["kind", "hex"]);
    assertEvenLowerHex(value.hex, true);
  } else if (value.kind === "repeat") {
    assertExactKeys(value, [
      "kind",
      "prefixHex",
      "unitHex",
      "repeatCount",
      "suffixHex"
    ]);
    assertEvenLowerHex(value.prefixHex, true);
    assertEvenLowerHex(value.unitHex, false);
    assertEvenLowerHex(value.suffixHex, true);
    assertIntegerInRange(value.repeatCount, 0, 9007199254740991);
  } else if (value.kind === "nested_object") {
    assertExactKeys(value, ["kind", "objectDepth", "keyAscii", "leafAscii"]);
    assertIntegerInRange(value.objectDepth, 0, 9007199254740991);
    assertEqual(value.keyAscii, "x");
    assertEqual(value.leafAscii, "0");
  } else if (value.kind === "integer_array_object") {
    assertExactKeys(value, [
      "kind",
      "elementCount",
      "keyAscii",
      "integerLiteral"
    ]);
    assertIntegerInRange(value.elementCount, 0, 9007199254740991);
    assertEqual(value.keyAscii, "x");
    assertEqual(value.integerLiteral, "0");
  } else {
    fail("vectors_schema_invalid");
  }
}

function validateStreamBehavior(value) {
  assertRecord(value);
  if (value.kind === "normal") {
    assertExactKeys(value, ["kind"]);
  } else if (value.kind === "scripted") {
    assertExactKeys(value, [
      "kind",
      "reportedCount",
      "yieldedExpandedRowIndexes"
    ]);
    assertIntegerInRange(value.reportedCount, 0, 9007199254740991);
    validateSafeIntegerArray(value.yieldedExpandedRowIndexes);
    value.yieldedExpandedRowIndexes.forEach((index) =>
      assertIntegerInRange(index, 0, 9007199254740991)
    );
  } else if (value.kind === "count_only") {
    assertExactKeys(value, ["kind", "reportedCount"]);
    assertIntegerInRange(value.reportedCount, 0, 9007199254740991);
  } else {
    fail("vectors_schema_invalid");
  }
}

function validateWasmBehavior(value) {
  assertRecord(value);
  if (value.kind === "exact_frozen_module") {
    assertExactKeys(value, ["kind"]);
  } else if (value.kind === "isolated_test_double") {
    assertExactKeys(value, ["kind", "returnValue", "memoryWrites"]);
    if (!Number.isSafeInteger(value.returnValue)) {
      fail("vectors_schema_invalid");
    }
    if (!Array.isArray(value.memoryWrites)) fail("vectors_schema_invalid");
    for (const patch of value.memoryWrites) {
      assertObjectWithKeys(patch, ["offset", "bytesHex"]);
      assertIntegerInRange(patch.offset, 0, 65535);
      assertEvenLowerHex(patch.bytesHex, false);
      if (patch.offset + patch.bytesHex.length / 2 > 65536) {
        fail("vectors_schema_invalid");
      }
    }
  } else {
    fail("vectors_schema_invalid");
  }
}

function validateIntrospection(value) {
  assertRecord(value);
  assertExactKeys(value, [
    "schemaVersion",
    "migrationSequence",
    "migrationId",
    "query",
    "toolchain",
    "precondition",
    "postcondition"
  ]);
  assertEqual(value.schemaVersion, "sequence_3_schema_introspection.v1");
  assertEqual(value.migrationSequence, 3);
  assertEqual(value.migrationId, MIGRATION_ID);
  assertEqual(
    value.query,
    "SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name, tbl_name"
  );
  assertObjectWithKeys(value.toolchain, [
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
  ]);
  assertEqual(value.toolchain.nodeVersion, REQUIRED_NODE_VERSION);
  assertEqual(value.toolchain.nodeReportedSqliteVersion, "3.53.0");
  assertEqual(value.toolchain.sqliteVersion, "3.53.2");
  assertEqual(
    value.toolchain.sqliteSourceId,
    "2026-06-03 19:12:13 d6e03d8c777cfa2d35e3b60d8ec3e0187f3e9f99d8e2ee9cac695fd6fcdf1a24"
  );
  assertEqual(value.toolchain.pragmaEncoding, "UTF-8");
  assertEqual(value.toolchain.pragmaForeignKeys, 1);
  assertEqual(value.toolchain.compileOptionsCount, 53);
  assertEqual(value.toolchain.compileOptionsCanonicalByteLength, 1215);
  assertEqual(
    value.toolchain.compileOptionsRawSha256,
    "sha256:99d80fee03818112b412ae76c1b334602ab6b6de6899610155a90a043ed5bbbc"
  );
  validateStringArray(value.toolchain.compileOptions, 53);
  const compileBytes = Buffer.from(
    canonicalize(value.toolchain.compileOptions),
    "utf8"
  );
  if (
    compileBytes.byteLength !== 1215 ||
    hashRaw(compileBytes) !== value.toolchain.compileOptionsRawSha256
  ) {
    fail("introspection_invalid");
  }
  assertUtf8Sorted(value.toolchain.compileOptions);
  validateSnapshot(value.precondition, 2);
  validateSnapshot(value.postcondition, 3);
  assertEqual(
    value.precondition.semanticSchemaHash,
    PRECONDITION_SCHEMA_HASH
  );
}

function validateSnapshot(value, userVersion) {
  assertObjectWithKeys(value, [
    "userVersion",
    "rowCount",
    "canonicalRowsByteLength",
    "canonicalRowsRawSha256",
    "semanticSchemaHash",
    "rows"
  ]);
  assertEqual(value.userVersion, userVersion);
  if (!Array.isArray(value.rows)) fail("introspection_invalid");
  assertEqual(value.rowCount, value.rows.length);
  let previous = null;
  const seen = new Set();
  for (const row of value.rows) {
    assertObjectWithKeys(row, ["type", "name", "tbl_name", "sql"]);
    if (
      !["index", "table", "trigger", "view"].includes(row.type) ||
      ![row.name, row.tbl_name, row.sql].every(
        (field) =>
          typeof field === "string" &&
          field.length > 0 &&
          !field.includes("\u0000")
      )
    ) {
      fail("introspection_invalid");
    }
    const tuple = [row.type, row.name, row.tbl_name];
    const key = canonicalize(tuple);
    if (seen.has(key) || (previous !== null && compareTuple(previous, tuple) > 0)) {
      fail("introspection_invalid");
    }
    seen.add(key);
    previous = tuple;
  }
  const rowBytes = Buffer.from(canonicalize(value.rows), "utf8");
  assertEqual(value.canonicalRowsByteLength, rowBytes.byteLength);
  assertEqual(value.canonicalRowsRawSha256, hashRaw(rowBytes));
  assertEqual(
    value.semanticSchemaHash,
    hashFramed(
      "vdt-studio/sqlite-schema",
      "sqlite_schema_hash.v1",
      { userVersion },
      rowBytes
    )
  );
}

function validateTransformIdentity(value) {
  assertEqual(value.transformId, TRANSFORM_IDENTITY.transformId);
  assertEqual(value.transformVersion, TRANSFORM_IDENTITY.transformVersion);
  assertEqual(value.artifactFormat, TRANSFORM_IDENTITY.artifactFormat);
  assertEqual(value.abiVersion, TRANSFORM_IDENTITY.abiVersion);
}

function decodeCanonicalJson(bytes, finalLf) {
  const value = parseStrictJson(bytes);
  const expected = Buffer.from(
    `${canonicalize(value)}${finalLf ? "\n" : ""}`,
    "utf8"
  );
  if (!bytes.equals(expected)) fail("json_bytes_invalid");
  return value;
}

function canonicalize(value) {
  assertDenseJson(value);
  return canonicalizeValidated(value);
}

function canonicalizeValidated(value) {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeValidated).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort(compareUtf16)
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalizeValidated(value[key])}`
    )
    .join(",")}}`;
}

function assertDenseJson(value) {
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    assertNoLoneSurrogate(value);
    return;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) fail("json_schema_invalid");
    return;
  }
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      fail("json_schema_invalid");
    }
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) fail("json_schema_invalid");
      assertDenseJson(value[index]);
    }
    return;
  }
  assertRecord(value);
  for (const [key, child] of Object.entries(value)) {
    assertNoLoneSurrogate(key);
    assertDenseJson(child);
  }
}

function parseStrictJson(bytes) {
  let source;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("json_bytes_invalid");
  }
  let cursor = 0;

  function skipWhitespace() {
    while (
      source[cursor] === " " ||
      source[cursor] === "\n" ||
      source[cursor] === "\r" ||
      source[cursor] === "\t"
    ) {
      cursor += 1;
    }
  }

  function parseValue() {
    skipWhitespace();
    const token = source[cursor];
    if (token === "{") return parseObject();
    if (token === "[") return parseArray();
    if (token === '"') return parseString();
    if (token === "t") return parseLiteral("true", true);
    if (token === "f") return parseLiteral("false", false);
    if (token === "n") return parseLiteral("null", null);
    return parseNumber();
  }

  function parseObject() {
    cursor += 1;
    const result = Object.create(null);
    const keys = new Set();
    skipWhitespace();
    if (source[cursor] === "}") {
      cursor += 1;
      return result;
    }
    while (cursor < source.length) {
      skipWhitespace();
      if (source[cursor] !== '"') fail("json_bytes_invalid");
      const key = parseString();
      if (keys.has(key)) fail("json_duplicate_key");
      keys.add(key);
      skipWhitespace();
      if (source[cursor] !== ":") fail("json_bytes_invalid");
      cursor += 1;
      result[key] = parseValue();
      skipWhitespace();
      if (source[cursor] === "}") {
        cursor += 1;
        return result;
      }
      if (source[cursor] !== ",") fail("json_bytes_invalid");
      cursor += 1;
    }
    fail("json_bytes_invalid");
  }

  function parseArray() {
    cursor += 1;
    const result = [];
    skipWhitespace();
    if (source[cursor] === "]") {
      cursor += 1;
      return result;
    }
    while (cursor < source.length) {
      result.push(parseValue());
      skipWhitespace();
      if (source[cursor] === "]") {
        cursor += 1;
        return result;
      }
      if (source[cursor] !== ",") fail("json_bytes_invalid");
      cursor += 1;
    }
    fail("json_bytes_invalid");
  }

  function parseString() {
    const start = cursor;
    cursor += 1;
    while (cursor < source.length) {
      const code = source.charCodeAt(cursor);
      if (code === 0x22) {
        cursor += 1;
        let value;
        try {
          value = JSON.parse(source.slice(start, cursor));
        } catch {
          fail("json_bytes_invalid");
        }
        assertNoLoneSurrogate(value);
        return value;
      }
      if (code < 0x20) fail("json_bytes_invalid");
      cursor += code === 0x5c ? 2 : 1;
    }
    fail("json_bytes_invalid");
  }

  function parseLiteral(literal, value) {
    if (source.slice(cursor, cursor + literal.length) !== literal) {
      fail("json_bytes_invalid");
    }
    cursor += literal.length;
    return value;
  }

  function parseNumber() {
    const match = source
      .slice(cursor)
      .match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);
    if (!match) fail("json_bytes_invalid");
    cursor += match[0].length;
    const value = Number(match[0]);
    if (!Number.isSafeInteger(value)) fail("json_bytes_invalid");
    return value;
  }

  const result = parseValue();
  skipWhitespace();
  if (cursor !== source.length) fail("json_bytes_invalid");
  return result;
}

function hashRaw(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function hashFramed(domain, schema, metadata, bodyBytes) {
  return `sha256:${createHash("sha256")
    .update(frame(Buffer.from(domain, "utf8")))
    .update(frame(Buffer.from(schema, "utf8")))
    .update(frame(Buffer.from(canonicalize(metadata), "utf8")))
    .update(frame(bodyBytes))
    .digest("hex")}`;
}

function frame(bytes) {
  const prefix = Buffer.alloc(8);
  prefix.writeBigUInt64BE(BigInt(bytes.byteLength));
  return Buffer.concat([prefix, bytes]);
}

function readFileOnce(
  filePath,
  missingCode,
  seenIdentities,
  repositoryRootReal
) {
  let before;
  try {
    before = fs.lstatSync(filePath);
  } catch {
    fail(missingCode);
  }
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) {
    fail("path_invalid");
  }
  let resolvedPath;
  try {
    resolvedPath = fs.realpathSync.native(filePath);
  } catch {
    fail("path_invalid");
  }
  if (!isWithinRoot(resolvedPath, repositoryRootReal)) {
    fail("path_invalid");
  }
  const identity = `${before.dev}:${before.ino}`;
  if (seenIdentities?.has(identity)) fail("path_invalid");
  seenIdentities?.add(identity);

  let descriptor;
  try {
    descriptor = fs.openSync(
      filePath,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)
    );
    const opened = fs.fstatSync(descriptor);
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size !== before.size ||
      opened.mtimeMs !== before.mtimeMs ||
      opened.ctimeMs !== before.ctimeMs
    ) {
      fail("path_invalid");
    }
    const bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(
        descriptor,
        bytes,
        offset,
        bytes.length - offset,
        offset
      );
      if (count === 0) fail("read_invalid");
      offset += count;
    }
    if (fs.readSync(descriptor, Buffer.alloc(1), 0, 1, bytes.length) !== 0) {
      fail("read_invalid");
    }
    const after = fs.fstatSync(descriptor);
    if (
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      after.size !== opened.size ||
      after.nlink !== opened.nlink ||
      after.mtimeMs !== opened.mtimeMs ||
      after.ctimeMs !== opened.ctimeMs
    ) {
      fail("read_invalid");
    }
    return bytes;
  } catch (error) {
    if (error instanceof GeneratorFailure) throw error;
    fail("read_invalid");
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function writeExclusive(filePath, bytes, repositoryRootReal) {
  const parentPath = path.dirname(filePath);
  const parent = fs.lstatSync(parentPath);
  let resolvedParent;
  try {
    resolvedParent = fs.realpathSync.native(parentPath);
  } catch {
    fail("path_invalid");
  }
  if (
    !parent.isDirectory() ||
    parent.isSymbolicLink() ||
    !isWithinRoot(resolvedParent, repositoryRootReal)
  ) {
    fail("path_invalid");
  }

  let descriptor;
  try {
    descriptor = fs.openSync(
      filePath,
      fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        fs.constants.O_RDWR |
        (fs.constants.O_NOFOLLOW ?? 0),
      0o644
    );
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.writeSync(
        descriptor,
        bytes,
        offset,
        bytes.length - offset,
        offset
      );
      if (count === 0) fail("write_invalid");
      offset += count;
    }
    fs.fsyncSync(descriptor);
    const written = fs.fstatSync(descriptor);
    if (!written.isFile() || written.nlink !== 1 || written.size !== bytes.length) {
      fail("write_invalid");
    }
    const observed = Buffer.alloc(bytes.length);
    let readOffset = 0;
    while (readOffset < observed.length) {
      const count = fs.readSync(
        descriptor,
        observed,
        readOffset,
        observed.length - readOffset,
        readOffset
      );
      if (count === 0) fail("write_invalid");
      readOffset += count;
    }
    if (!observed.equals(bytes)) fail("write_invalid");
  } catch (error) {
    if (error instanceof GeneratorFailure) throw error;
    fail("write_invalid");
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }

  let parentDescriptor;
  try {
    parentDescriptor = fs.openSync(parentPath, fs.constants.O_RDONLY);
    fs.fsyncSync(parentDescriptor);
  } catch {
    fail("durability_invalid");
  } finally {
    if (parentDescriptor !== undefined) fs.closeSync(parentDescriptor);
  }
}

function verifyOutput(bytes, expectedManifest, expectedBytes) {
  const parsed = decodeCanonicalJson(bytes, true);
  validateManifest(parsed);
  if (
    canonicalize(parsed) !== canonicalize(expectedManifest) ||
    !bytes.equals(expectedBytes)
  ) {
    fail("output_drift");
  }
}

function assertRecord(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    fail("json_schema_invalid");
  }
}

function assertObjectWithKeys(value, keys) {
  assertRecord(value);
  assertExactKeys(value, keys);
}

function assertExactKeys(value, keys) {
  const actual = Object.keys(value);
  if (
    actual.length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  ) {
    fail("json_schema_invalid");
  }
}

function validateObjectArray(value, keys, expectedLength) {
  if (
    !Array.isArray(value) ||
    (expectedLength !== undefined && value.length !== expectedLength)
  ) {
    fail("json_schema_invalid");
  }
  value.forEach((entry) => assertObjectWithKeys(entry, keys));
}

function validateStringArray(value, expectedLength) {
  if (
    !Array.isArray(value) ||
    (expectedLength !== undefined && value.length !== expectedLength) ||
    value.some((entry) => typeof entry !== "string")
  ) {
    fail("json_schema_invalid");
  }
}

function validateSafeIntegerArray(value) {
  if (
    !Array.isArray(value) ||
    value.some((entry) => !Number.isSafeInteger(entry))
  ) {
    fail("json_schema_invalid");
  }
}

function assertUtf8Sorted(value) {
  for (let index = 1; index < value.length; index += 1) {
    if (compareUtf8(value[index - 1], value[index]) >= 0) {
      fail("json_schema_invalid");
    }
  }
}

function assertVectorId(value) {
  if (typeof value !== "string" || value.length === 0) {
    fail("vectors_schema_invalid");
  }
}

function assertIntegerInRange(value, minimum, maximum) {
  if (
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    fail("vectors_schema_invalid");
  }
}

function assertEvenLowerHex(value, allowEmpty) {
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.length === 0) ||
    value.length % 2 !== 0 ||
    !/^[0-9a-f]*$/.test(value)
  ) {
    fail("vectors_schema_invalid");
  }
}

function assertSha256(value) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    fail("json_schema_invalid");
  }
}

function assertEqual(actual, expected) {
  if (actual !== expected) fail("json_schema_invalid");
}

function assertNoLoneSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) fail("json_bytes_invalid");
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      fail("json_bytes_invalid");
    }
  }
}

function compareTuple(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    const comparison = compareUtf8(left[index], right[index]);
    if (comparison !== 0) return comparison;
  }
  return 0;
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function compareUtf16(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isWithinRoot(candidate, repositoryRootReal) {
  const relative = path.relative(repositoryRootReal, candidate);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function fail(code) {
  throw new GeneratorFailure(code);
}

function main() {
  const argumentsList = process.argv.slice(2);
  if (
    argumentsList.length !== 1 ||
    !["--write", "--verify"].includes(argumentsList[0])
  ) {
    fail("invalid_arguments");
  }
  const mode = argumentsList[0];
  if (process.versions.node !== REQUIRED_NODE_VERSION) fail("node_version");

  const scriptPath = fileURLToPath(import.meta.url);
  const repositoryRoot = path.resolve(path.dirname(scriptPath), "../../..");
  let repositoryRootReal;
  try {
    repositoryRootReal = fs.realpathSync.native(repositoryRoot);
  } catch {
    fail("path_invalid");
  }
  const seenIdentities = new Set();
  const inputBuffers = INPUT_PATHS.map((relativePath) => {
    const absolutePath = path.resolve(repositoryRoot, relativePath);
    if (
      absolutePath !== path.join(repositoryRoot, relativePath) ||
      !absolutePath.startsWith(`${repositoryRoot}${path.sep}`)
    ) {
      fail("path_invalid");
    }
    return readFileOnce(
      absolutePath,
      "input_missing",
      seenIdentities,
      repositoryRootReal
    );
  });

  const manifest = buildManifest(inputBuffers);
  const expectedBytes = Buffer.from(`${canonicalize(manifest)}\n`, "utf8");
  const outputPath = path.join(repositoryRoot, OUTPUT_RELATIVE_PATH);

  if (mode === "--verify") {
    verifyOutput(
      readFileOnce(
        outputPath,
        "output_missing",
        undefined,
        repositoryRootReal
      ),
      manifest,
      expectedBytes
    );
    return;
  }

  if (fs.existsSync(outputPath)) {
    verifyOutput(
      readFileOnce(
        outputPath,
        "output_missing",
        undefined,
        repositoryRootReal
      ),
      manifest,
      expectedBytes
    );
    return;
  }
  writeExclusive(outputPath, expectedBytes, repositoryRootReal);
}

try {
  main();
} catch (error) {
  const code =
    error instanceof GeneratorFailure ? error.code : "internal";
  process.stderr.write(`migration manifest v2: ${code}\n`);
  process.exitCode = code === "invalid_arguments" ? 64 : 1;
}
