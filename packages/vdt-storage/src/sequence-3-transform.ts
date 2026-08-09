import type { DatabaseSync } from "node:sqlite";
import { canonicalizeJson, hashFramed, hashRawBytes } from "./canonical";
import type { JsonValue, Sha256 } from "./types";
import {
  loadSequence3TransformPreflightRegistry,
  loadVerifiedSequence3Assets,
  type VerifiedSequence3Assets
} from "./sequence-3-assets";

const MAX_SAFE = 9_007_199_254_740_991n;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const STATUS = new Map([
  ["queued", ["interrupted_nonterminal", "interrupted_legacy", true, 1]],
  ["running", ["interrupted_nonterminal", "interrupted_legacy", true, 2]],
  ["needs_user_input", ["interrupted_nonterminal", "interrupted_legacy", true, 3]],
  ["waiting_approval", ["interrupted_nonterminal", "interrupted_legacy", true, 4]],
  ["succeeded", ["retained_terminal", "succeeded", false, 5]],
  ["failed", ["retained_terminal", "failed", false, 6]],
  ["cancelled", ["retained_terminal", "cancelled", false, 7]]
] as const);
const PHASES = [
  "classifying_request", "retrieving_skills", "reading_skills",
  "asking_clarifying_questions", "planning_decomposition", "building_graph",
  "previewing_mutation", "validating_graph", "repairing_graph",
  "applying_graph", "reporting"
] as const;
const TEXT_COLUMNS = [
  "id", "project_id", "vdt_id", "conversation_id", "status", "phase",
  "request_json", "public_snapshot_json", "internal_state_json"
] as const;
const INTEGER_COLUMNS = ["created_at", "updated_at", "completed_at"] as const;
let hostPreflightComplete = false;

type HostCode =
  | "LAR_HOST_COUNT_MISMATCH" | "LAR_HOST_STORAGE_CLASS" | "LAR_HOST_UTF8"
  | "LAR_HOST_ID" | "LAR_HOST_JSON_LENGTH" | "LAR_HOST_TOTAL_JSON_BYTES"
  | "LAR_HOST_JSON_SYNTAX" | "LAR_HOST_JSON_DUPLICATE_KEY"
  | "LAR_HOST_JSON_TOP_LEVEL" | "LAR_HOST_JSON_DEPTH"
  | "LAR_HOST_JSON_VALUE_COUNT" | "LAR_HOST_JSON_UNICODE"
  | "LAR_HOST_JSON_NUMBER" | "LAR_HOST_STATUS" | "LAR_HOST_PHASE"
  | "LAR_HOST_TIMESTAMP" | "LAR_HOST_WASM_ERROR" | "LAR_HOST_WASM_OUTPUT";

interface SqlValue {
  storageClass: "null" | "integer" | "real" | "text" | "blob";
  integerDecimal?: string;
  realCanonical?: string;
  bytes?: HostBytes;
}
type HostBytes =
  | { kind: "hex"; hex: string }
  | { kind: "repeat"; prefixHex: string; unitHex: string; repeatCount: number; suffixHex: string }
  | { kind: "nested_object"; objectDepth: number; keyAscii: "x"; leafAscii: "0" }
  | { kind: "integer_array_object"; elementCount: number; keyAscii: "x"; integerLiteral: "0" };
type HostRow = Record<(typeof TEXT_COLUMNS)[number] | (typeof INTEGER_COLUMNS)[number], SqlValue>;
interface TransformContext {
  fixtureMigrationIdentity: Record<string, JsonValue>;
  commitTimestamp: string;
}

export interface Sequence3TransformAccepted {
  readonly outcome: "accepted";
  readonly migrationApplicationId: string;
  readonly adoptionCanonicalJson: readonly string[];
  readonly legacyRowHashes: readonly Sha256[];
  readonly transformResultHash: Sha256;
  readonly persistedBlockedReason: null;
}
export interface Sequence3TransformBlocked {
  readonly outcome: "blocked";
  readonly code: HostCode;
  readonly failingRowIndex: number | null;
  readonly failingColumn: string | null;
  readonly persistedBlockedReason: "postcondition_failed";
}
export type Sequence3TransformResult = Sequence3TransformAccepted | Sequence3TransformBlocked;

export interface Sequence3MigrationIdentity {
  readonly schemaVersion: "migration_application_identity.v1";
  readonly databaseId: string;
  readonly attemptId: string;
  readonly backupEvidenceId: string;
  readonly fenceOwnerToken: string;
  readonly fenceLeaseGeneration: number;
  readonly targetManifestHash: Sha256;
  readonly sequence: 3;
  readonly migrationId: "003-durable-agent-run-coordination";
  readonly sqlChecksum: Sha256;
  readonly transformId: "legacy-agent-run-adoption-v1";
  readonly transformVersion: 1;
  readonly moduleChecksum: Sha256;
  readonly contractChecksum: Sha256;
  readonly goldenVectorsChecksum: Sha256;
}

/**
 * Read-only production boundary. The caller retains and owns the connection;
 * this function neither begins a transaction nor writes a row.
 */
export function validateLegacyAgentRunsForSequence3(
  database: DatabaseSync,
  identity: Sequence3MigrationIdentity,
  commitTimestamp: string
): Sequence3TransformResult {
  const countStatement = database.prepare("SELECT count(*) AS count FROM agent_runs");
  countStatement.setReadBigInts(true);
  const countRow = countStatement.get() as { count: unknown };
  if (
    typeof countRow.count !== "bigint" ||
    countRow.count < 0n ||
    countRow.count > 100_000n
  ) {
    return blocked("LAR_HOST_COUNT_MISMATCH", null, null);
  }
  const count = Number(countRow.count);
  const statement = database.prepare(`
    SELECT
      typeof(id) AS id_type, CAST(id AS BLOB) AS id_bytes,
      typeof(project_id) AS project_id_type, CAST(project_id AS BLOB) AS project_id_bytes,
      typeof(vdt_id) AS vdt_id_type, CAST(vdt_id AS BLOB) AS vdt_id_bytes,
      typeof(conversation_id) AS conversation_id_type, CAST(conversation_id AS BLOB) AS conversation_id_bytes,
      typeof(status) AS status_type, CAST(status AS BLOB) AS status_bytes,
      typeof(phase) AS phase_type, CAST(phase AS BLOB) AS phase_bytes,
      typeof(request_json) AS request_json_type, CAST(request_json AS BLOB) AS request_json_bytes,
      typeof(public_snapshot_json) AS public_snapshot_json_type, CAST(public_snapshot_json AS BLOB) AS public_snapshot_json_bytes,
      typeof(internal_state_json) AS internal_state_json_type, CAST(internal_state_json AS BLOB) AS internal_state_json_bytes,
      typeof(created_at) AS created_at_type, created_at,
      typeof(updated_at) AS updated_at_type, updated_at,
      typeof(completed_at) AS completed_at_type, completed_at
    FROM agent_runs
    ORDER BY CAST(id AS BLOB) ASC
  `);
  statement.setReadBigInts(true);
  const rows = (function* (): Iterable<HostRow> {
    for (const raw of statement.iterate() as Iterable<Record<string, unknown>>) {
      yield databaseRow(raw);
    }
  })();
  return evaluateRows(
    rows,
    count,
    { kind: "exact_frozen_module" },
    { fixtureMigrationIdentity: identity as unknown as Record<string, JsonValue>, commitTimestamp },
    loadVerifiedSequence3Assets()
  );
}

/**
 * Executes every frozen host vector. A future runner must call this production
 * preflight before backup or DDL; this R2.1 slice intentionally does not wire
 * the migration runner.
 */
export function preflightSequence3TransformHost(): void {
  if (hostPreflightComplete) return;
  const registry = loadSequence3TransformPreflightRegistry();
  for (const vector of registry.hostVectors) {
    const actual = evaluateHostVector(
      asHostVectorInput(vector.input),
      registry.fixtureMigrationIdentity as Record<string, JsonValue>,
      registry.fixtureCommitTimestamp
    );
    if (
      canonicalizeJson(actual as unknown as JsonValue) !==
      canonicalizeJson(vector.expected as JsonValue)
    ) {
      throw new Error(`sequence3_host_vector_mismatch:${String(vector.vectorId)}`);
    }
  }
  hostPreflightComplete = true;
}

function asHostVectorInput(value: unknown): Record<string, JsonValue> {
  return record(value);
}

function evaluateHostVector(
  input: Record<string, JsonValue>,
  fixtureMigrationIdentity: Record<string, JsonValue>,
  commitTimestamp: string
): Sequence3TransformResult {
  try {
    const rowSet = record(input.rowSet);
    const stream = record(input.streamBehavior);
    const wasm = record(input.wasmBehavior);
    if (stream.kind === "count_only") {
      const count = Number(stream.reportedCount);
      if (count > 100_000) return blocked("LAR_HOST_COUNT_MISMATCH", null, null);
    }
    const expanded = [...expandRows(rowSet)];
    const yielded =
      stream.kind === "scripted"
        ? (stream.yieldedExpandedRowIndexes as JsonValue[]).map((index) => expanded[Number(index)]!)
        : expanded.sort((a, b) => Buffer.compare(rawBytes(a.id), rawBytes(b.id)));
    if (
      stream.kind === "scripted" &&
      (Number(stream.reportedCount) !== yielded.length ||
        yielded.length !== expanded.length)
    ) {
      if (yielded.length === expanded.length) {
        for (let index = 1; index < yielded.length; index += 1) {
          if (Buffer.compare(rawBytes(yielded[index - 1]!.id), rawBytes(yielded[index]!.id)) >= 0) {
            return blocked("LAR_HOST_COUNT_MISMATCH", index, "id");
          }
        }
      }
      return blocked("LAR_HOST_COUNT_MISMATCH", null, null);
    }
    for (let index = 1; index < yielded.length; index += 1) {
      if (Buffer.compare(rawBytes(yielded[index - 1]!.id), rawBytes(yielded[index]!.id)) >= 0) {
        return blocked("LAR_HOST_COUNT_MISMATCH", index, "id");
      }
    }
    return evaluateRows(
      yielded,
      Number(input.expandedRowCount),
      wasm,
      { fixtureMigrationIdentity, commitTimestamp },
      loadVerifiedSequence3Assets()
    );
  } catch (error) {
    if (error instanceof HostFailure) {
      return blocked(error.code, error.row, error.column);
    }
    throw error;
  }
}

/** Test-only pure seam; it is not exported by packages/vdt-storage/src/index.ts. */
export function __evaluateSequence3HostVectorForTests(
  input: Record<string, JsonValue>,
  fixtureMigrationIdentity: Record<string, JsonValue>,
  commitTimestamp: string
): Sequence3TransformResult {
  return evaluateHostVector(input, fixtureMigrationIdentity, commitTimestamp);
}

function evaluateRows(
  rows: Iterable<HostRow>,
  reportedCount: number,
  wasm: Record<string, JsonValue>,
  context: TransformContext,
  assets: VerifiedSequence3Assets
): Sequence3TransformResult {
  try {
    if (
      !Number.isSafeInteger(reportedCount) ||
      reportedCount < 0 ||
      reportedCount > 100_000
    ) {
      throw new HostFailure("LAR_HOST_COUNT_MISMATCH", null, null);
    }
    let totalJsonBytes = 0;
    let seenCount = 0;
    let previousRawId: Buffer | undefined;
    const adoptions: { runId: string; legacyRowHash: Sha256; canonicalJson: string }[] = [];
    const moduleRuntime =
      wasm.kind === "exact_frozen_module" ? new WebAssembly.Instance(assets.module) : undefined;
    for (const row of rows) {
      if (seenCount >= reportedCount) {
        throw new HostFailure("LAR_HOST_COUNT_MISMATCH", null, null);
      }
      const currentRawId = rawBytes(row.id);
      if (
        previousRawId !== undefined &&
        Buffer.compare(previousRawId, currentRawId) >= 0
      ) {
        throw new HostFailure("LAR_HOST_COUNT_MISMATCH", seenCount, "id");
      }
      previousRawId = currentRawId;
      const decoded = validateRow(row, seenCount, totalJsonBytes);
      totalJsonBytes += decoded.jsonBytes;
      if (totalJsonBytes > 268_435_456) {
        throw new HostFailure("LAR_HOST_TOTAL_JSON_BYTES", seenCount, "request_json");
      }
      validateModule(row, decoded, seenCount, wasm, moduleRuntime);
      adoptions.push(makeAdoption(decoded, context));
      seenCount += 1;
    }
    if (seenCount !== reportedCount) {
      throw new HostFailure("LAR_HOST_COUNT_MISMATCH", null, null);
    }
    const applicationHash = hashFramed(
      "vdt-studio/migration-application-identity",
      "migration_application_identity_hash.v1",
      context.fixtureMigrationIdentity as JsonValue
    );
    const migrationApplicationId = `migration_application_${applicationHash.slice(7)}`;
    const resultHash = hashFramed(
      "vdt-studio/migration-transform-result",
      "migration_transform_result_hash.v1",
      {
        databaseId: context.fixtureMigrationIdentity.databaseId,
        migrationApplicationId,
        sequence: 3,
        transformId: assets.identity.transformId,
        transformVersion: 1,
        artifactFormat: assets.identity.artifactFormat,
        abiVersion: assets.identity.abiVersion,
        moduleChecksum: context.fixtureMigrationIdentity.moduleChecksum,
        contractChecksum: context.fixtureMigrationIdentity.contractChecksum,
        goldenVectorsChecksum: context.fixtureMigrationIdentity.goldenVectorsChecksum,
        inputLegacyRunCount: reportedCount,
        insertedAdoptionCount: reportedCount,
        sortedAdoptions: adoptions.map(({ runId, legacyRowHash }) => ({ runId, legacyRowHash }))
      } as JsonValue
    );
    return {
      outcome: "accepted",
      migrationApplicationId,
      adoptionCanonicalJson: adoptions.map((value) => value.canonicalJson),
      legacyRowHashes: adoptions.map((value) => value.legacyRowHash),
      transformResultHash: resultHash,
      persistedBlockedReason: null
    };
  } catch (error) {
    if (error instanceof HostFailure) return blocked(error.code, error.row, error.column);
    throw error;
  }
}

function validateRow(row: HostRow, index: number, priorJsonBytes: number) {
  for (const column of TEXT_COLUMNS) {
    const value = row[column];
    const nullable = ["vdt_id", "conversation_id", "public_snapshot_json", "internal_state_json"].includes(column);
    if (value.storageClass !== "text" && !(nullable && value.storageClass === "null")) {
      throw new HostFailure("LAR_HOST_STORAGE_CLASS", index, column);
    }
  }
  for (const column of INTEGER_COLUMNS) {
    const value = row[column];
    if (value.storageClass !== "integer" && !(column === "completed_at" && value.storageClass === "null")) {
      throw new HostFailure("LAR_HOST_STORAGE_CLASS", index, column);
    }
  }
  const decoded = Object.fromEntries(
    TEXT_COLUMNS.map((column) => [
      column,
      row[column].storageClass === "null" ? null : decodeUtf8(row[column], index, column)
    ])
  ) as Record<(typeof TEXT_COLUMNS)[number], string | null>;
  for (const column of ["id", "project_id", "vdt_id", "conversation_id"] as const) {
    if (decoded[column] !== null && !SAFE_ID.test(decoded[column]!)) {
      throw new HostFailure("LAR_HOST_ID", index, column);
    }
  }
  let rowJsonBytes = 0;
  for (const column of ["request_json", "public_snapshot_json", "internal_state_json"] as const) {
    if (decoded[column] === null) continue;
    const bytes = rawBytes(row[column]);
    if (bytes.length > 1_048_576) {
      throw new HostFailure("LAR_HOST_JSON_LENGTH", index, column);
    }
    rowJsonBytes += bytes.length;
    if (rowJsonBytes > 2_097_152) {
      throw new HostFailure("LAR_HOST_JSON_LENGTH", index, column);
    }
    if (priorJsonBytes + rowJsonBytes > 268_435_456) {
      throw new HostFailure("LAR_HOST_TOTAL_JSON_BYTES", index, column);
    }
    validateLegacyJson(decoded[column]!, index, column);
  }
  const status = decoded.status!;
  const phase = decoded.phase!;
  const classification = STATUS.get(status as Parameters<typeof STATUS.get>[0]);
  if (!classification) throw new HostFailure("LAR_HOST_STATUS", index, "status");
  if (!PHASES.includes(phase as (typeof PHASES)[number])) {
    throw new HostFailure("LAR_HOST_PHASE", index, "phase");
  }
  const created = timestamp(row.created_at, index, "created_at");
  const updated = timestamp(row.updated_at, index, "updated_at");
  const completed =
    row.completed_at.storageClass === "null" ? null : timestamp(row.completed_at, index, "completed_at");
  if (created > updated) throw new HostFailure("LAR_HOST_TIMESTAMP", index, "updated_at");
  if (
    (classification[2] && completed !== null) ||
    (!classification[2] &&
      (completed === null || completed < created || completed > updated))
  ) throw new HostFailure("LAR_HOST_TIMESTAMP", index, "completed_at");
  return { row, decoded, classification, created, updated, completed, jsonBytes: rowJsonBytes };
}

function validateLegacyJson(source: string, row: number, column: string): void {
  let cursor = 0;
  let values = 0;
  let maximumDepth = 0;
  const ws = () => { while (" \n\r\t".includes(source[cursor] ?? "\u0000")) cursor += 1; };
  const string = (): string => {
    const start = cursor++;
    while (cursor < source.length) {
      const code = source.charCodeAt(cursor);
      if (code === 0x22) {
        cursor += 1;
        let parsed: string;
        try { parsed = JSON.parse(source.slice(start, cursor)) as string; }
        catch { fail("LAR_HOST_JSON_SYNTAX"); }
        if (hasLoneSurrogate(parsed!)) fail("LAR_HOST_JSON_UNICODE");
        return parsed!;
      }
      if (code < 0x20) fail("LAR_HOST_JSON_SYNTAX");
      cursor += code === 0x5c ? 2 : 1;
    }
    return fail("LAR_HOST_JSON_SYNTAX");
  };
  const value = (depth: number): "object" | "other" => {
    ws(); values += 1;
    if (values > 100_000) fail("LAR_HOST_JSON_VALUE_COUNT");
    const token = source[cursor];
    if (token === "{") {
      maximumDepth = Math.max(maximumDepth, depth);
      if (maximumDepth > 64) fail("LAR_HOST_JSON_DEPTH");
      cursor += 1; const keys = new Set<string>(); ws();
      if (source[cursor] === "}") { cursor += 1; return "object"; }
      while (true) {
        ws(); if (source[cursor] !== '"') fail("LAR_HOST_JSON_SYNTAX");
        const key = string();
        if (keys.has(key)) fail("LAR_HOST_JSON_DUPLICATE_KEY");
        keys.add(key); ws();
        if (source[cursor++] !== ":") fail("LAR_HOST_JSON_SYNTAX");
        value(depth + 1); ws();
        if (source[cursor] === "}") { cursor += 1; return "object"; }
        if (source[cursor++] !== ",") fail("LAR_HOST_JSON_SYNTAX");
      }
    }
    if (token === "[") {
      maximumDepth = Math.max(maximumDepth, depth);
      if (maximumDepth > 64) fail("LAR_HOST_JSON_DEPTH");
      cursor += 1; ws();
      if (source[cursor] === "]") { cursor += 1; return "other"; }
      while (true) {
        value(depth + 1); ws();
        if (source[cursor] === "]") { cursor += 1; return "other"; }
        if (source[cursor++] !== ",") fail("LAR_HOST_JSON_SYNTAX");
      }
    }
    if (token === '"') { string(); return "other"; }
    for (const literal of ["true", "false", "null"]) {
      if (source.startsWith(literal, cursor)) { cursor += literal.length; return "other"; }
    }
    const match = source.slice(cursor).match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);
    if (!match) return fail("LAR_HOST_JSON_SYNTAX");
    cursor += match[0].length;
    const number = Number(match[0]);
    if (
      !Number.isFinite(number) ||
      JSON.stringify(number) !== match[0] ||
      (Number.isInteger(number) && !Number.isSafeInteger(number))
    ) fail("LAR_HOST_JSON_NUMBER");
    return "other";
  };
  const fail = (code: HostCode): never => {
    throw new HostFailure(code, row, column);
  };
  ws();
  const top = value(1);
  ws();
  if (cursor !== source.length) fail("LAR_HOST_JSON_SYNTAX");
  if (top !== "object") fail("LAR_HOST_JSON_TOP_LEVEL");
}

function validateModule(
  row: HostRow,
  decoded: ReturnType<typeof validateRow>,
  index: number,
  behavior: Record<string, JsonValue>,
  moduleRuntime: WebAssembly.Instance | undefined
): void {
  const memory =
    behavior.kind === "isolated_test_double"
      ? new Uint8Array(65_536)
      : new Uint8Array(
          (moduleRuntime!.exports as { memory: WebAssembly.Memory }).memory.buffer
        );
  memory.fill(0);
  const status = Buffer.from(decoded.decoded.status!);
  const phase = Buffer.from(decoded.decoded.phase!);
  const input = Buffer.alloc(40 + status.length + phase.length);
  input.write("LAR1"); input[4] = 1; input[5] = decoded.completed === null ? 1 : 0;
  input.writeUInt16LE(40, 6); input.writeUInt32LE(input.length, 8);
  input[12] = status.length; input[13] = phase.length;
  input.writeBigUInt64LE(BigInt(decoded.created), 16);
  input.writeBigUInt64LE(BigInt(decoded.updated), 24);
  input.writeBigUInt64LE(BigInt(decoded.completed ?? 0), 32);
  status.copy(input, 40); phase.copy(input, 40 + status.length);
  memory.set(input, 0);
  let result: number;
  if (behavior.kind === "isolated_test_double") {
    for (const patchValue of behavior.memoryWrites as JsonValue[]) {
      const patch = record(patchValue);
      memory.set(Buffer.from(String(patch.bytesHex), "hex"), Number(patch.offset));
    }
    result = Number(behavior.returnValue);
  } else {
    const exported = moduleRuntime!.exports as {
      memory: WebAssembly.Memory;
      transform_row: (a: number, b: number, c: number, d: number) => number;
    };
    result = exported.transform_row(0, input.length, 128, 16);
  }
  if (result !== 16) throw new HostFailure("LAR_HOST_WASM_ERROR", index, null);
  if (Buffer.from(memory.subarray(0, input.length)).compare(input) !== 0) {
    throw new HostFailure("LAR_HOST_WASM_OUTPUT", index, null);
  }
  const output = memory.subarray(128, 144);
  const expected = Buffer.alloc(16);
  expected.write("LAO1"); expected[4] = 1;
  expected[5] = decoded.classification[3];
  expected[6] = PHASES.indexOf(decoded.decoded.phase as (typeof PHASES)[number]) + 1;
  expected[7] = decoded.classification[0] === "retained_terminal" ? 1 : 2;
  expected[8] =
    ({ succeeded: 1, failed: 2, cancelled: 3 } as Record<string, number>)[
      decoded.classification[1]
    ] ?? 4;
  expected[9] = decoded.completed === null ? 1 : 0;
  expected.writeUInt32LE(16, 12);
  if (!Buffer.from(output).equals(expected)) {
    throw new HostFailure("LAR_HOST_WASM_OUTPUT", index, null);
  }
  const expectedMemory = new Uint8Array(65_536);
  expectedMemory.set(input, 0);
  expectedMemory.set(expected, 128);
  if (
    !Buffer.from(memory.buffer, memory.byteOffset, memory.byteLength).equals(
      expectedMemory
    )
  ) {
    throw new HostFailure("LAR_HOST_WASM_OUTPUT", index, null);
  }
  void row;
}

function makeAdoption(decoded: ReturnType<typeof validateRow>, context: TransformContext) {
  const identityHash = hashFramed(
    "vdt-studio/migration-application-identity",
    "migration_application_identity_hash.v1",
    context.fixtureMigrationIdentity as JsonValue
  );
  const migrationApplicationId = `migration_application_${identityHash.slice(7)}`;
  const metadata = {
    schemaVersion: "legacy_agent_run_adoption.v1",
    databaseId: context.fixtureMigrationIdentity.databaseId,
    migrationApplicationId,
    migrationSequence: 3,
    runId: decoded.decoded.id,
    projectId: decoded.decoded.project_id,
    vdtId: decoded.decoded.vdt_id,
    conversationId: decoded.decoded.conversation_id,
    disposition: decoded.classification[0],
    projectedStatus: decoded.classification[1],
    originalStatus: decoded.decoded.status,
    originalPhase: decoded.decoded.phase,
    originalPhaseUtf8ByteLength: rawBytes(decoded.row.phase).length,
    originalPhaseRawUtf8Hash: hashRawBytes(rawBytes(decoded.row.phase)),
    requestJson: attest(decoded.row.request_json),
    publicSnapshotJson: attest(decoded.row.public_snapshot_json),
    internalStateJson: attest(decoded.row.internal_state_json),
    originalCreatedAtMillis: decoded.created,
    originalUpdatedAtMillis: decoded.updated,
    originalCompletedAtMillis: decoded.completed
  };
  const legacyRowHash = hashFramed(
    "vdt-studio/legacy-agent-run-adoption",
    "legacy_agent_run_adoption_hash.v1",
    metadata as JsonValue
  );
  return {
    runId: decoded.decoded.id!,
    legacyRowHash,
    canonicalJson: canonicalizeJson({
      ...metadata,
      legacyRowHash,
      adoptedAt: context.commitTimestamp
    } as JsonValue)
  };
}

function expandRows(rowSet: Record<string, JsonValue>): Iterable<HostRow> {
  if (rowSet.kind === "literal") return rowSet.rows as unknown as HostRow[];
  return (function* () {
    for (const segmentValue of rowSet.segments as JsonValue[]) {
      const segment = record(segmentValue);
      for (let offset = 0; offset < Number(segment.count); offset += 1) {
        const value = structuredClone(segment.template) as unknown as HostRow;
        value.id = {
          storageClass: "text",
          bytes: {
            kind: "hex",
            hex: Buffer.from(
              `${String(segment.runIdPrefix)}${String(Number(segment.firstIndex) + offset).padStart(Number(segment.decimalWidth), "0")}`
            ).toString("hex")
          }
        };
        yield value;
      }
    }
  })();
}

function rawBytes(value: SqlValue): Buffer {
  if (!value.bytes) return Buffer.alloc(0);
  const bytes = value.bytes;
  if (bytes.kind === "hex") return Buffer.from(bytes.hex, "hex");
  if (bytes.kind === "repeat") return Buffer.concat([
    Buffer.from(bytes.prefixHex, "hex"),
    Buffer.from(bytes.unitHex.repeat(bytes.repeatCount), "hex"),
    Buffer.from(bytes.suffixHex, "hex")
  ]);
  if (bytes.kind === "nested_object") {
    return Buffer.from('{"x":'.repeat(bytes.objectDepth) + "0" + "}".repeat(bytes.objectDepth));
  }
  return Buffer.from(`{"x":[${Array(bytes.elementCount).fill("0").join(",")}]}`);
}
function decodeUtf8(value: SqlValue, row: number, column: string): string {
  const bytes = rawBytes(value);
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new HostFailure("LAR_HOST_UTF8", row, column);
  }
  if (decoded.startsWith("\ufeff") || !Buffer.from(decoded).equals(bytes)) {
    throw new HostFailure("LAR_HOST_UTF8", row, column);
  }
  return decoded;
}
function timestamp(value: SqlValue, row: number, column: string): number {
  const parsed = BigInt(value.integerDecimal!);
  if (parsed < 0n || parsed > MAX_SAFE) throw new HostFailure("LAR_HOST_TIMESTAMP", row, column);
  return Number(parsed);
}
function attest(value: SqlValue) {
  if (value.storageClass === "null") return { isNull: true, rawUtf8Hash: null, utf8ByteLength: 0 };
  const bytes = rawBytes(value);
  return { isNull: false, rawUtf8Hash: hashRawBytes(bytes), utf8ByteLength: bytes.length };
}
function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}
function databaseRow(raw: Record<string, unknown>): HostRow {
  const result: Partial<HostRow> = {};
  for (const column of TEXT_COLUMNS) {
    const storageClass = raw[`${column}_type`] as SqlValue["storageClass"];
    result[column] = storageClass === "null"
      ? { storageClass }
      : {
          storageClass,
          bytes: { kind: "hex", hex: Buffer.from(raw[`${column}_bytes`] as Uint8Array).toString("hex") }
        };
  }
  for (const column of INTEGER_COLUMNS) {
    const storageClass = raw[`${column}_type`] as SqlValue["storageClass"];
    result[column] = storageClass === "null"
      ? { storageClass }
      : { storageClass, integerDecimal: String(raw[column]) };
  }
  return result as HostRow;
}
function record(value: unknown): Record<string, JsonValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("record");
  return value as Record<string, JsonValue>;
}
function blocked(code: HostCode, failingRowIndex: number | null, failingColumn: string | null): Sequence3TransformBlocked {
  return { outcome: "blocked", code, failingRowIndex, failingColumn, persistedBlockedReason: "postcondition_failed" };
}
class HostFailure extends Error {
  constructor(
    readonly code: HostCode,
    readonly row: number | null,
    readonly column: string | null
  ) {
    super(code);
  }
}
