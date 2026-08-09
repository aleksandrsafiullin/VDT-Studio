import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  unlinkSync,
  writeSync
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const MODES = new Set(["--write", "--verify"]);
const args = process.argv.slice(2);
if (args.length !== 1 || !MODES.has(args[0])) {
  throw new Error("usage: generate-sequence-3-schema-introspection.mjs --write|--verify");
}
const mode = args[0];

const EXPECTED_NODE_VERSION = "24.15.0";
const EXPECTED_NODE_SQLITE_VERSION = "3.53.0";
const EXPECTED_SQLITE_VERSION = "3.53.2";
const EXPECTED_SQLITE_SOURCE_ID =
  "2026-06-03 19:12:13 d6e03d8c777cfa2d35e3b60d8ec3e0187f3e9f99d8e2ee9cac695fd6fcdf1a24";
const EXPECTED_COMPILE_OPTIONS_COUNT = 53;
const EXPECTED_COMPILE_OPTIONS_BYTE_LENGTH = 1215;
const EXPECTED_COMPILE_OPTIONS_RAW_SHA256 =
  "sha256:99d80fee03818112b412ae76c1b334602ab6b6de6899610155a90a043ed5bbbc";
const EXPECTED_PRECONDITION_SCHEMA_HASH =
  "sha256:b3eda62829523baced9238894eaabbb3cad30721b75bf02a59166bf4d759bb02";
const EXPECTED_POSTCONDITION_SCHEMA_HASH =
  "sha256:c4206299c5399b4ee113c920f02af650aa39ad6af452f5c46330dcec10adbb5a";
const EXPECTED_SQL_CHECKSUM =
  "sha256:c9b7ce6486a50024259e53f34a7f4a1750544c442b75df310a55c03e5f8d3e0f";
const QUERY =
  "SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name, tbl_name";
const OUTPUT_RELATIVE_PATH =
  "packages/vdt-storage/src/migrations/sequence-3-schema-introspection.v1.json";
let ROOT;

const SQL_INPUTS = [
  {
    path: "packages/vdt-storage/src/migrations/001-legacy-v1-bootstrap.sql",
    byteLength: 4304,
    rawSha256: "sha256:285a037c50be8fa260e73b8fb5ced7788aa36f8d95e21617cc629e02c79a543f"
  },
  {
    path: "packages/vdt-storage/src/migrations/002-atomic-revisions.sql",
    byteLength: 6972,
    rawSha256: "sha256:4e677b0310c703a82054826c97c1d16678059a6254cc9234d2a280872309c171"
  },
  {
    path: "packages/vdt-storage/src/migrations/003-durable-agent-run-coordination.sql",
    byteLength: 158462,
    rawSha256: "sha256:2bb4eacb0f2565975a1318f5d6a917a325e69337677651a87c21710c6451bbda"
  }
];

const EXPECTED_NEW_TABLES = [
  "agent_command_execution_bases_v2",
  "agent_coordinator_effect_commits_v2",
  "agent_manual_editing_sessions_v2",
  "agent_manual_operations_v2",
  "agent_manual_resync_bases_v2",
  "agent_merge_records_v2",
  "agent_mutation_actions_v2",
  "agent_mutation_approval_bases_v2",
  "agent_mutation_approval_policies_v2",
  "agent_mutation_reconciliations_v2",
  "agent_provider_decisions_v2",
  "agent_question_answers_v2",
  "agent_question_sets_v2",
  "agent_retry_budgets_v2",
  "agent_retry_records_v2",
  "agent_run_attempts_v2",
  "agent_run_commands_v2",
  "agent_run_coordinators_v2",
  "agent_run_effects_v2",
  "agent_run_feature_snapshots_v2",
  "agent_run_outbox_v2",
  "agent_run_preferences_v2",
  "agent_run_project_states_v2",
  "agent_tool_calls_v2",
  "agent_w01_commit_bindings_v2",
  "legacy_agent_run_adoptions_v1",
  "migration_transform_applications_v1"
];

if (process.versions.node !== EXPECTED_NODE_VERSION) {
  throw new Error(
    `Node ${EXPECTED_NODE_VERSION} is required; received ${process.versions.node}`
  );
}
if (process.versions.sqlite !== EXPECTED_NODE_SQLITE_VERSION) {
  throw new Error(
    `Node-reported SQLite ${EXPECTED_NODE_SQLITE_VERSION} is required; received ${process.versions.sqlite}`
  );
}
ROOT = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../.."));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function rawSha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function frame(bytes) {
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(bytes.byteLength));
  return Buffer.concat([length, bytes]);
}

function hashFramed(domain, schema, metadata, body = Buffer.alloc(0)) {
  const metadataBytes = Buffer.from(canonicalize(metadata), "utf8");
  return `sha256:${createHash("sha256")
    .update(frame(Buffer.from(domain, "utf8")))
    .update(frame(Buffer.from(schema, "utf8")))
    .update(frame(metadataBytes))
    .update(frame(Buffer.from(body)))
    .digest("hex")}`;
}

function canonicalize(value) {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    assert(Number.isFinite(value), "canonical JSON cannot contain a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  assert(value !== undefined && typeof value === "object", "invalid canonical JSON value");
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
    .join(",")}}`;
}

function assertUnicodeString(value, label) {
  assert(typeof value === "string" && value.length > 0, `${label} must be a non-empty string`);
  assert(!value.includes("\u0000"), `${label} contains U+0000`);
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      assert(next >= 0xdc00 && next <= 0xdfff, `${label} contains a lone high surrogate`);
      index += 1;
    } else {
      assert(!(code >= 0xdc00 && code <= 0xdfff), `${label} contains a lone low surrogate`);
    }
  }
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

function resolveClosedPath(relativePath) {
  assert(!isAbsolute(relativePath), `absolute path is forbidden: ${relativePath}`);
  const absolutePath = resolve(ROOT, relativePath);
  const back = relative(ROOT, absolutePath);
  assert(back !== "" && back !== ".." && !back.startsWith(`..${sep}`), "path escapes repository");
  return absolutePath;
}

function sameStatIdentity(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

function readClosedRegularFile(relativePath, maximumBytes = 4 * 1024 * 1024) {
  const absolutePath = resolveClosedPath(relativePath);
  const listed = lstatSync(absolutePath, { bigint: true });
  assert(listed.isFile() && !listed.isSymbolicLink(), `${relativePath} is not a regular file`);
  assert(listed.nlink === 1n, `${relativePath} must have one hard link`);
  assert(realpathSync(absolutePath) === absolutePath, `${relativePath} contains a symlink`);
  assert(listed.size >= 0n && listed.size <= BigInt(maximumBytes), `${relativePath} is too large`);

  const descriptor = openSync(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(descriptor, { bigint: true });
    assert(sameStatIdentity(listed, before), `${relativePath} identity changed before read`);
    const buffer = Buffer.alloc(Number(before.size) + 1);
    const bytesRead = readSync(descriptor, buffer, 0, buffer.byteLength, 0);
    assert(bytesRead === Number(before.size), `${relativePath} produced a short or long read`);
    const after = fstatSync(descriptor, { bigint: true });
    assert(sameStatIdentity(before, after), `${relativePath} changed during read`);
    return buffer.subarray(0, bytesRead);
  } finally {
    closeSync(descriptor);
  }
}

function validateSqlBytes(bytes, expected, label) {
  assert(bytes.byteLength === expected.byteLength, `${label} byte length mismatch`);
  assert(rawSha256(bytes) === expected.rawSha256, `${label} raw SHA-256 mismatch`);
  const text = decodeUtf8(bytes, label);
  assert(!bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), `${label} has BOM`);
  assert(!text.includes("\r") && !text.includes("\t") && !text.includes("\u0000"), `${label} byte policy failed`);
  assert(text.endsWith("\n") && !text.endsWith("\n\n"), `${label} final LF policy failed`);
  assert(!/[ \t]+$/m.test(text), `${label} has trailing whitespace`);
  return text;
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function snapshot(db, userVersion) {
  const rows = db.prepare(QUERY).all().map((row, rowIndex) => {
    assertExactKeys(row, ["type", "name", "tbl_name", "sql"], `row ${rowIndex}`);
    assert(["index", "table", "trigger", "view"].includes(row.type), `row ${rowIndex} type`);
    assertUnicodeString(row.type, `row ${rowIndex}.type`);
    assertUnicodeString(row.name, `row ${rowIndex}.name`);
    assertUnicodeString(row.tbl_name, `row ${rowIndex}.tbl_name`);
    assertUnicodeString(row.sql, `row ${rowIndex}.sql`);
    return {
      type: row.type,
      name: row.name,
      tbl_name: row.tbl_name,
      sql: row.sql
    };
  });

  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1];
    const current = rows[index];
    const comparison =
      compareUtf8(previous.type, current.type) ||
      compareUtf8(previous.name, current.name) ||
      compareUtf8(previous.tbl_name, current.tbl_name);
    assert(comparison < 0, `schema rows are unordered or duplicated at index ${index}`);
  }

  const canonicalRowsBytes = Buffer.from(canonicalize(rows), "utf8");
  return {
    userVersion,
    rowCount: rows.length,
    canonicalRowsByteLength: canonicalRowsBytes.byteLength,
    canonicalRowsRawSha256: rawSha256(canonicalRowsBytes),
    semanticSchemaHash: hashFramed(
      "vdt-studio/sqlite-schema",
      "sqlite_schema_hash.v1",
      { userVersion },
      canonicalRowsBytes
    ),
    rows
  };
}

function assertExactKeys(value, keys, label) {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `${label} is not an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  assert(
    actual.length === expected.length && actual.every((key, index) => key === expected[index]),
    `${label} keys mismatch`
  );
}

function assertSnapshotKnownAnswers(value, label, expected) {
  assert(value.rowCount === expected.rowCount, `${label} row count mismatch`);
  assert(
    value.canonicalRowsByteLength === expected.canonicalRowsByteLength,
    `${label} canonical row byte length mismatch`
  );
  assert(
    value.canonicalRowsRawSha256 === expected.canonicalRowsRawSha256,
    `${label} canonical row raw hash mismatch`
  );
  assert(value.semanticSchemaHash === expected.semanticSchemaHash, `${label} semantic hash mismatch`);
}

function assertSchemaDelta(db, precondition, postcondition) {
  const preRows = new Map(
    precondition.rows.map((row) => [`${row.type}\u0000${row.name}\u0000${row.tbl_name}`, row])
  );
  const additions = postcondition.rows.filter(
    (row) => !preRows.has(`${row.type}\u0000${row.name}\u0000${row.tbl_name}`)
  );
  for (const [key, before] of preRows) {
    const after = postcondition.rows.find(
      (row) => `${row.type}\u0000${row.name}\u0000${row.tbl_name}` === key
    );
    assert(after && after.sql === before.sql, `precondition schema row changed: ${key}`);
  }

  const count = (type) => additions.filter((row) => row.type === type).length;
  assert(count("table") === 27, "Sequence 3 table delta must be 27");
  assert(count("index") === 15, "Sequence 3 explicit index delta must be 15");
  assert(count("trigger") === 110, "Sequence 3 trigger delta must be 110");
  assert(count("view") === 0, "Sequence 3 view delta must be zero");
  const tableNames = additions
    .filter((row) => row.type === "table")
    .map((row) => row.name)
    .sort(compareUtf8);
  assert(
    canonicalize(tableNames) === canonicalize(EXPECTED_NEW_TABLES),
    "Sequence 3 table-name set mismatch"
  );

  let columnCount = 0;
  let foreignKeyCount = 0;
  for (const tableName of tableNames) {
    const columns = db
      .prepare(
        'SELECT cid, name, type, "notnull", dflt_value, pk, hidden FROM pragma_table_xinfo(?) ORDER BY cid'
      )
      .all(tableName);
    columnCount += columns.length;
    for (const column of columns) {
      assert(column.hidden === 0, `${tableName}.${column.name} is hidden`);
      assert(column.type === "TEXT" || column.type === "INTEGER", `${tableName}.${column.name} type`);
      assert(column.dflt_value === null, `${tableName}.${column.name} has a default`);
    }
    const foreignKeys = db
      .prepare(
        'SELECT id, seq, "table", "from", "to", on_update, on_delete, match FROM pragma_foreign_key_list(?) ORDER BY id, seq'
      )
      .all(tableName);
    foreignKeyCount += new Set(foreignKeys.map((row) => row.id)).size;
    for (const foreignKey of foreignKeys) {
      assert(foreignKey.on_update === "RESTRICT", `${tableName} FK update action`);
      assert(foreignKey.on_delete === "RESTRICT", `${tableName} FK delete action`);
    }
  }
  assert(columnCount === 573, "Sequence 3 column count must be 573");
  assert(foreignKeyCount === 183, "Sequence 3 foreign-key count must be 183");
}

function captureToolchain(db) {
  const sqliteVersion = db.prepare("SELECT sqlite_version() AS value").get().value;
  const sqliteSourceId = db.prepare("SELECT sqlite_source_id() AS value").get().value;
  const pragmaEncoding = db.prepare("PRAGMA encoding").get().encoding;
  const pragmaForeignKeys = db.prepare("PRAGMA foreign_keys").get().foreign_keys;
  const compileOptions = db
    .prepare("PRAGMA compile_options")
    .all()
    .map((row) => row.compile_options)
    .sort(compareUtf8);
  const compileOptionsBytes = Buffer.from(canonicalize(compileOptions), "utf8");

  assert(sqliteVersion === EXPECTED_SQLITE_VERSION, "SQLite runtime version mismatch");
  assert(sqliteSourceId === EXPECTED_SQLITE_SOURCE_ID, "SQLite source ID mismatch");
  assert(pragmaEncoding === "UTF-8", "SQLite encoding mismatch");
  assert(pragmaForeignKeys === 1, "SQLite foreign keys are not enabled");
  assert(compileOptions.length === EXPECTED_COMPILE_OPTIONS_COUNT, "compile-option count mismatch");
  assert(
    compileOptionsBytes.byteLength === EXPECTED_COMPILE_OPTIONS_BYTE_LENGTH,
    "compile-option canonical byte length mismatch"
  );
  assert(
    rawSha256(compileOptionsBytes) === EXPECTED_COMPILE_OPTIONS_RAW_SHA256,
    "compile-option raw hash mismatch"
  );

  return {
    nodeVersion: process.versions.node,
    nodeReportedSqliteVersion: process.versions.sqlite,
    sqliteVersion,
    sqliteSourceId,
    pragmaEncoding,
    pragmaForeignKeys,
    compileOptionsCount: compileOptions.length,
    compileOptionsCanonicalByteLength: compileOptionsBytes.byteLength,
    compileOptionsRawSha256: rawSha256(compileOptionsBytes),
    compileOptions
  };
}

function buildEvidence(sqlTexts, sqlBytes) {
  const db = new DatabaseSync(":memory:");
  let transactionOpen = false;
  try {
    db.exec("PRAGMA foreign_keys=ON");
    const toolchain = captureToolchain(db);
    db.exec(sqlTexts[0]);
    db.exec("PRAGMA user_version=1");
    db.exec(sqlTexts[1]);
    db.exec("PRAGMA user_version=2");
    assert(db.prepare("PRAGMA user_version").get().user_version === 2, "precondition user version");
    const precondition = snapshot(db, 2);
    assertSnapshotKnownAnswers(precondition, "precondition", {
      rowCount: 26,
      canonicalRowsByteLength: 13611,
      canonicalRowsRawSha256:
        "sha256:065ef144c5c104fb040236fb08ef70bb690055d8f4c5af35a0c14d030813f14d",
      semanticSchemaHash: EXPECTED_PRECONDITION_SCHEMA_HASH
    });

    db.exec("BEGIN IMMEDIATE");
    transactionOpen = true;
    db.exec(sqlTexts[2]);
    db.exec("PRAGMA user_version=3");
    assert(db.prepare("PRAGMA user_version").get().user_version === 3, "postcondition user version");
    const postcondition = snapshot(db, 3);
    assertSnapshotKnownAnswers(postcondition, "postcondition", {
      rowCount: 178,
      canonicalRowsByteLength: 191398,
      canonicalRowsRawSha256:
        "sha256:5fa24ae3bef1dfaa6cc25153b224b4a54380c15b58e9582532960e20fffa89ac",
      semanticSchemaHash: EXPECTED_POSTCONDITION_SCHEMA_HASH
    });
    assertSchemaDelta(db, precondition, postcondition);
    assert(
      db.prepare("PRAGMA integrity_check").get().integrity_check === "ok",
      "PRAGMA integrity_check failed"
    );
    assert(db.prepare("PRAGMA foreign_key_check").all().length === 0, "foreign-key check failed");

    const sqlChecksum = hashFramed(
      "vdt-studio/sql-migration",
      "sql_migration_hash.v1",
      {
        sequence: 3,
        migrationId: "003-durable-agent-run-coordination",
        fromUserVersion: 2,
        toUserVersion: 3,
        preconditionSchemaHash: precondition.semanticSchemaHash,
        postconditionSchemaHash: postcondition.semanticSchemaHash
      },
      sqlBytes[2]
    );
    assert(sqlChecksum === EXPECTED_SQL_CHECKSUM, "Sequence 3 framed SQL checksum mismatch");

    db.exec("ROLLBACK");
    transactionOpen = false;
    return {
      evidence: {
        schemaVersion: "sequence_3_schema_introspection.v1",
        migrationSequence: 3,
        migrationId: "003-durable-agent-run-coordination",
        query: QUERY,
        toolchain,
        precondition,
        postcondition
      },
      sqlChecksum
    };
  } finally {
    if (transactionOpen) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // Preserve the original failure.
      }
    }
    db.close();
  }
}

function parseStrictJson(text) {
  let index = 0;
  const whitespace = () => {
    while (index < text.length && /[\u0009\u000a\u000d\u0020]/.test(text[index])) index += 1;
  };
  const parseString = () => {
    const start = index;
    assert(text[index] === '"', `expected string at ${index}`);
    index += 1;
    while (index < text.length) {
      const code = text.charCodeAt(index);
      if (code === 0x22) {
        index += 1;
        const value = JSON.parse(text.slice(start, index));
        assertUnicodeString(value, `JSON string at ${start}`);
        return value;
      }
      assert(code >= 0x20, `unescaped control character at ${index}`);
      if (code === 0x5c) {
        index += 1;
        assert(index < text.length && '"\\/bfnrtu'.includes(text[index]), `invalid escape at ${index}`);
        if (text[index] === "u") {
          assert(/^[0-9a-fA-F]{4}$/.test(text.slice(index + 1, index + 5)), `invalid Unicode escape`);
          index += 4;
        }
      }
      index += 1;
    }
    throw new Error(`unterminated string at ${start}`);
  };
  const parseValue = () => {
    whitespace();
    const token = text[index];
    if (token === '"') return parseString();
    if (token === "{") {
      index += 1;
      whitespace();
      const value = Object.create(null);
      const keys = new Set();
      if (text[index] === "}") {
        index += 1;
        return value;
      }
      while (true) {
        whitespace();
        const key = parseString();
        assert(!keys.has(key), `duplicate JSON key: ${key}`);
        keys.add(key);
        whitespace();
        assert(text[index] === ":", `expected colon at ${index}`);
        index += 1;
        value[key] = parseValue();
        whitespace();
        if (text[index] === "}") {
          index += 1;
          return value;
        }
        assert(text[index] === ",", `expected comma at ${index}`);
        index += 1;
      }
    }
    if (token === "[") {
      index += 1;
      whitespace();
      const value = [];
      if (text[index] === "]") {
        index += 1;
        return value;
      }
      while (true) {
        value.push(parseValue());
        whitespace();
        if (text[index] === "]") {
          index += 1;
          return value;
        }
        assert(text[index] === ",", `expected comma at ${index}`);
        index += 1;
      }
    }
    for (const [literal, value] of [
      ["true", true],
      ["false", false],
      ["null", null]
    ]) {
      if (text.startsWith(literal, index)) {
        index += literal.length;
        return value;
      }
    }
    const match = text
      .slice(index)
      .match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);
    assert(match, `invalid JSON value at ${index}`);
    const raw = match[0];
    index += raw.length;
    const value = Number(raw);
    assert(Number.isFinite(value) && JSON.stringify(value) === raw, `non-canonical number ${raw}`);
    if (Number.isInteger(value)) assert(Number.isSafeInteger(value), `unsafe integer ${raw}`);
    return value;
  };
  const value = parseValue();
  whitespace();
  assert(index === text.length, `trailing JSON bytes at ${index}`);
  return value;
}

function validateEvidenceObject(value, expected, sourceBytes) {
  assertExactKeys(
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
    "introspection"
  );
  assertExactKeys(
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
    "toolchain"
  );
  for (const [label, snapshotValue] of [
    ["precondition", value.precondition],
    ["postcondition", value.postcondition]
  ]) {
    assertExactKeys(
      snapshotValue,
      [
        "userVersion",
        "rowCount",
        "canonicalRowsByteLength",
        "canonicalRowsRawSha256",
        "semanticSchemaHash",
        "rows"
      ],
      label
    );
    assert(Array.isArray(snapshotValue.rows), `${label}.rows must be an array`);
    snapshotValue.rows.forEach((row, rowIndex) => {
      assertExactKeys(row, ["type", "name", "tbl_name", "sql"], `${label}.rows[${rowIndex}]`);
    });
    const rowsBytes = Buffer.from(canonicalize(snapshotValue.rows), "utf8");
    assert(snapshotValue.rowCount === snapshotValue.rows.length, `${label}.rowCount mismatch`);
    assert(
      snapshotValue.canonicalRowsByteLength === rowsBytes.byteLength,
      `${label}.canonicalRowsByteLength mismatch`
    );
    assert(
      snapshotValue.canonicalRowsRawSha256 === rawSha256(rowsBytes),
      `${label}.canonicalRowsRawSha256 mismatch`
    );
    assert(
      snapshotValue.semanticSchemaHash ===
        hashFramed(
          "vdt-studio/sqlite-schema",
          "sqlite_schema_hash.v1",
          { userVersion: snapshotValue.userVersion },
          rowsBytes
        ),
      `${label}.semanticSchemaHash mismatch`
    );
  }
  assert(
    canonicalize(value) === canonicalize(expected),
    "introspection semantic content differs from recomputed evidence"
  );
  assert(
    sourceBytes.equals(Buffer.from(`${canonicalize(value)}\n`, "utf8")),
    "introspection source is not canonical JSON plus one LF"
  );
}

function readAndValidateOutput(expected, expectedBytes) {
  const bytes = readClosedRegularFile(OUTPUT_RELATIVE_PATH, 4 * 1024 * 1024);
  const text = decodeUtf8(bytes, OUTPUT_RELATIVE_PATH);
  assert(text.endsWith("\n") && !text.endsWith("\n\n"), "output final LF policy failed");
  const parsed = parseStrictJson(text.slice(0, -1));
  validateEvidenceObject(parsed, expected, bytes);
  assert(bytes.equals(expectedBytes), "existing introspection bytes differ from recomputed bytes");
  return bytes;
}

function writeExclusiveOutput(expected, expectedBytes) {
  const absolutePath = resolveClosedPath(OUTPUT_RELATIVE_PATH);
  if (existsSync(absolutePath)) return readAndValidateOutput(expected, expectedBytes);
  let descriptor;
  let created = false;
  try {
    descriptor = openSync(
      absolutePath,
      constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o644
    );
    created = true;
    let offset = 0;
    while (offset < expectedBytes.byteLength) {
      offset += writeSync(
        descriptor,
        expectedBytes,
        offset,
        expectedBytes.byteLength - offset,
        offset
      );
    }
    fsyncSync(descriptor);
    const stat = fstatSync(descriptor, { bigint: true });
    assert(stat.isFile() && stat.nlink === 1n, "written output is not a single-link regular file");
    assert(stat.size === BigInt(expectedBytes.byteLength), "written output size mismatch");
    const verification = Buffer.alloc(expectedBytes.byteLength + 1);
    const bytesRead = readSync(descriptor, verification, 0, verification.byteLength, 0);
    assert(bytesRead === expectedBytes.byteLength, "written output readback length mismatch");
    assert(
      verification.subarray(0, bytesRead).equals(expectedBytes),
      "written output readback mismatch"
    );
    closeSync(descriptor);
    descriptor = undefined;
    const parentDescriptor = openSync(dirname(absolutePath), constants.O_RDONLY);
    try {
      fsyncSync(parentDescriptor);
    } finally {
      closeSync(parentDescriptor);
    }
    return expectedBytes;
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (created) {
      try {
        unlinkSync(absolutePath);
      } catch {
        // The original failure is authoritative.
      }
    }
    throw error;
  }
}

const inputInodes = new Set();
const sqlBytes = SQL_INPUTS.map((input) => {
  const absolutePath = resolveClosedPath(input.path);
  const stat = lstatSync(absolutePath, { bigint: true });
  const inodeKey = `${stat.dev}:${stat.ino}`;
  assert(!inputInodes.has(inodeKey), `duplicate SQL input inode: ${input.path}`);
  inputInodes.add(inodeKey);
  return readClosedRegularFile(input.path);
});
const sqlTexts = sqlBytes.map((bytes, index) =>
  validateSqlBytes(bytes, SQL_INPUTS[index], SQL_INPUTS[index].path)
);
const { evidence, sqlChecksum } = buildEvidence(sqlTexts, sqlBytes);
const expectedBytes = Buffer.from(`${canonicalize(evidence)}\n`, "utf8");
const outputBytes =
  mode === "--write"
    ? writeExclusiveOutput(evidence, expectedBytes)
    : readAndValidateOutput(evidence, expectedBytes);
const evidenceHash = hashFramed(
  "vdt-studio/migration-schema-introspection",
  "migration_schema_introspection_hash.v1",
  {
    migrationSequence: 3,
    migrationId: "003-durable-agent-run-coordination",
    fromUserVersion: 2,
    toUserVersion: 3
  },
  outputBytes
);

console.log(
  JSON.stringify({
    mode,
    sqlByteLength: sqlBytes[2].byteLength,
    sqlRawSha256: rawSha256(sqlBytes[2]),
    preconditionSchemaHash: evidence.precondition.semanticSchemaHash,
    postconditionSchemaHash: evidence.postcondition.semanticSchemaHash,
    sqlChecksum,
    outputByteLength: outputBytes.byteLength,
    outputRawSha256: rawSha256(outputBytes),
    evidenceHash
  })
);
