import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_NODE_VERSION = "24.15.0";
const MIGRATION_ID = "003-durable-agent-run-coordination";
const SCHEMA_VERSION = "sequence_3_fault_vectors.v1";
const EXPECTED_CASE_COUNT = 65;
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

const TRANSACTION_POINTS = Object.freeze([
  "sequence3_before_sql",
  "sequence3_after_sql",
  "sequence3_before_transform_invocation",
  "sequence3_after_transform_invocation",
  "sequence3_before_adoption_row_insert",
  "sequence3_after_adoption_row_insert",
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
  "after_later_migration_committed"
]);

const ADOPTION_ROW_POINTS = Object.freeze([
  "sequence3_before_adoption_row_insert",
  "sequence3_after_adoption_row_insert"
]);

const PENDING_POINTS = Object.freeze([
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
  "sequence3_after_foreign_key_pending_unlink_directory_fsynced"
]);

const VIOLATION_POINTS = Object.freeze([
  "after_foreign_key_violation_rollback",
  "sequence3_before_foreign_key_evidence_create",
  "after_foreign_key_evidence_created",
  "sequence3_before_foreign_key_evidence_file_fsync",
  "after_foreign_key_evidence_file_fsynced",
  "sequence3_before_foreign_key_evidence_directory_fsync",
  "after_foreign_key_evidence_fsynced",
  "before_foreign_key_block_commit",
  "after_foreign_key_block_committed"
]);

const CLEANUP_POINTS = Object.freeze([
  "sequence3_before_post_commit_cleanup",
  "sequence3_after_post_commit_cleanup"
]);

const NON_CRASH_REGISTRY = Object.freeze([
  {
    caseId: "applied_prefix_mismatch__semantic_failure",
    membership: "semantic_failure",
    fixture: "applied_prefix_mismatch",
    expectedRestart: fixed(
      blocked("applied_prefix_mismatch", "absent", "absent")
    )
  },
  {
    caseId: "artifact_checksum_mismatch__semantic_failure",
    membership: "semantic_failure",
    fixture: "artifact_checksum_mismatch",
    expectedRestart: fixed(blocked("checksum_mismatch", "absent", "absent"))
  },
  {
    caseId: "schema_precondition_mismatch__semantic_failure",
    membership: "semantic_failure",
    fixture: "schema_precondition_mismatch",
    expectedRestart: fixed(
      blocked("precondition_failed", "absent", "absent")
    )
  },
  {
    caseId: "backup_failure__semantic_failure",
    membership: "semantic_failure",
    fixture: "backup_failure",
    expectedRestart: fixed(blocked("backup_failed", "absent", "absent"))
  },
  {
    caseId: "legacy_validation_failure__semantic_failure",
    membership: "semantic_failure",
    fixture: "legacy_validation_failure",
    expectedRestart: fixed(
      blocked("postcondition_failed", "absent", "absent")
    )
  },
  {
    caseId: "invalid_transform_output__semantic_failure",
    membership: "semantic_failure",
    fixture: "invalid_transform_output",
    expectedRestart: fixed(
      blocked("postcondition_failed", "absent", "absent")
    )
  },
  {
    caseId: "adoption_constraint_failure__semantic_failure",
    membership: "semantic_failure",
    fixture: "adoption_constraint_failure",
    expectedRestart: fixed(
      blocked("postcondition_failed", "absent", "absent")
    )
  },
  {
    caseId: "transform_application_constraint_failure__semantic_failure",
    membership: "semantic_failure",
    fixture: "transform_application_constraint_failure",
    expectedRestart: fixed(
      blocked("postcondition_failed", "absent", "absent")
    )
  },
  {
    caseId: "applied_parent_constraint_failure__semantic_failure",
    membership: "semantic_failure",
    fixture: "applied_parent_constraint_failure",
    expectedRestart: fixed(
      blocked("postcondition_failed", "absent", "absent")
    )
  },
  {
    caseId: "schema_postcondition_mismatch__semantic_failure",
    membership: "semantic_failure",
    fixture: "schema_postcondition_mismatch",
    expectedRestart: fixed(
      blocked("postcondition_failed", "absent", "absent")
    )
  },
  {
    caseId: "foreign_key_violation__semantic_failure",
    membership: "semantic_failure",
    fixture: "foreign_key_violation",
    expectedRestart: fixed(
      blocked("postcondition_failed", "valid", "valid_linked")
    )
  },
  {
    caseId: "pending_collision__semantic_failure",
    membership: "semantic_failure",
    fixture: "pending_collision",
    expectedRestart: fixed(recoveryApplying("partial_or_invalid", "absent"))
  },
  {
    caseId: "partial_pending__semantic_failure",
    membership: "semantic_failure",
    fixture: "partial_pending",
    expectedRestart: fixed(recoveryApplying("partial_or_invalid", "absent"))
  },
  {
    caseId: "partial_evidence__semantic_failure",
    membership: "semantic_failure",
    fixture: "partial_evidence",
    expectedRestart: fixed(recoveryApplying("valid", "partial_or_invalid"))
  },
  {
    caseId: "stale_owner_takeover__semantic_failure",
    membership: "semantic_failure",
    fixture: "stale_owner_takeover",
    expectedRestart: fixed(staleOwner())
  },
  {
    caseId: "windows_unsupported__capability",
    membership: "capability",
    fixture: "windows_unsupported",
    expectedRestart: fixed(
      noAttempt("STORAGE_CAPABILITY_UNSUPPORTED", false)
    )
  }
]);

const ALLOWED_FIXTURES = new Set([
  "empty_legacy_runs",
  "one_terminal_run",
  "one_nonterminal_run",
  "three_mixed_runs",
  "applied_prefix_mismatch",
  "artifact_checksum_mismatch",
  "schema_precondition_mismatch",
  "backup_failure",
  "legacy_validation_failure",
  "invalid_transform_output",
  "adoption_constraint_failure",
  "transform_application_constraint_failure",
  "applied_parent_constraint_failure",
  "schema_postcondition_mismatch",
  "foreign_key_violation",
  "pending_collision",
  "partial_pending",
  "partial_evidence",
  "stale_owner_takeover",
  "windows_unsupported"
]);

const ALLOWED_FAULT_POINTS = new Set([
  ...TRANSACTION_POINTS,
  ...PENDING_POINTS,
  ...VIOLATION_POINTS,
  ...CLEANUP_POINTS
]);

const ALLOWED_BLOCKED_REASONS = new Set([
  "applied_prefix_mismatch",
  "checksum_mismatch",
  "precondition_failed",
  "postcondition_failed",
  "backup_failed"
]);

const ALLOWED_PROCESS_RESULTS = new Set([
  "SIGKILL",
  "MIGRATION_IN_PROGRESS",
  "MIGRATION_RECOVERY_REQUIRED",
  "STORAGE_CAPABILITY_UNSUPPORTED"
]);

const ALLOWED_PUBLIC_CODES = new Set([
  "MIGRATION_IN_PROGRESS",
  "MIGRATION_RECOVERY_REQUIRED",
  "STORAGE_CAPABILITY_UNSUPPORTED"
]);

class GeneratorFailure extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function ready(adoptionCount) {
  return {
    userVersion: 3,
    appliedSequence3Count: 1,
    transformApplicationCount: 1,
    adoptionCount,
    attemptStatus: "completed",
    migrationStateStatus: "ready",
    blockedReason: null,
    pendingArtifact: "absent",
    evidenceArtifact: "absent",
    publicCode: null,
    retryable: null
  };
}

function recoveryApplying(pendingArtifact, evidenceArtifact) {
  return {
    userVersion: 2,
    appliedSequence3Count: 0,
    transformApplicationCount: 0,
    adoptionCount: 0,
    attemptStatus: "applying",
    migrationStateStatus: "ready",
    blockedReason: null,
    pendingArtifact,
    evidenceArtifact,
    publicCode: "MIGRATION_RECOVERY_REQUIRED",
    retryable: false
  };
}

function blocked(blockedReason, pendingArtifact, evidenceArtifact) {
  return {
    userVersion: 2,
    appliedSequence3Count: 0,
    transformApplicationCount: 0,
    adoptionCount: 0,
    attemptStatus: "blocked",
    migrationStateStatus: "blocked",
    blockedReason,
    pendingArtifact,
    evidenceArtifact,
    publicCode: "MIGRATION_RECOVERY_REQUIRED",
    retryable: false
  };
}

function noAttempt(publicCode, retryable) {
  return {
    userVersion: 2,
    appliedSequence3Count: 0,
    transformApplicationCount: 0,
    adoptionCount: 0,
    attemptStatus: null,
    migrationStateStatus: "ready",
    blockedReason: null,
    pendingArtifact: "absent",
    evidenceArtifact: "absent",
    publicCode,
    retryable
  };
}

function staleOwner() {
  return {
    userVersion: 2,
    appliedSequence3Count: 0,
    transformApplicationCount: 0,
    adoptionCount: 0,
    attemptStatus: "applying",
    migrationStateStatus: "ready",
    blockedReason: null,
    pendingArtifact: "absent",
    evidenceArtifact: "absent",
    publicCode: "MIGRATION_IN_PROGRESS",
    retryable: true
  };
}

function fixed(state) {
  return { kind: "fixed", state };
}

function pendingNamespace() {
  return {
    kind: "pending_namespace",
    pendingPresent: recoveryApplying("valid", "absent"),
    pendingAbsent: ready(1)
  };
}

function evidenceNamespace() {
  return {
    kind: "evidence_namespace",
    linkedEvidenceValid: blocked(
      "postcondition_failed",
      "valid",
      "valid_linked"
    ),
    linkedEvidenceNotValid: recoveryApplying("valid", "partial_or_invalid")
  };
}

function crashRegistryEntry(fixture, faultPoint, adoptionIndex, expectedRestart) {
  return {
    caseId: `${fixture}__${faultPoint}__${
      adoptionIndex === null ? "none" : adoptionIndex
    }`,
    membership: "crash",
    fixture,
    faultPoint,
    adoptionIndex,
    expectedRestart
  };
}

function buildRegistry() {
  const registry = [];
  const adoptionPoints = new Set(ADOPTION_ROW_POINTS);

  for (const faultPoint of TRANSACTION_POINTS) {
    if (adoptionPoints.has(faultPoint)) continue;
    registry.push(
      crashRegistryEntry(
        "one_terminal_run",
        faultPoint,
        null,
        fixed(ready(1))
      )
    );
  }

  for (const faultPoint of ADOPTION_ROW_POINTS) {
    for (let adoptionIndex = 0; adoptionIndex < 3; adoptionIndex += 1) {
      registry.push(
        crashRegistryEntry(
          "three_mixed_runs",
          faultPoint,
          adoptionIndex,
          fixed(ready(3))
        )
      );
    }
  }

  for (const [pointIndex, faultPoint] of PENDING_POINTS.entries()) {
    let expectedRestart;
    if (pointIndex === 0 || pointIndex === 11) {
      expectedRestart = fixed(ready(1));
    } else if (pointIndex === 1) {
      expectedRestart = fixed(recoveryApplying("partial_or_invalid", "absent"));
    } else if (pointIndex >= 2 && pointIndex <= 8) {
      expectedRestart = fixed(recoveryApplying("valid", "absent"));
    } else {
      expectedRestart = pendingNamespace();
    }
    registry.push(
      crashRegistryEntry(
        "one_terminal_run",
        faultPoint,
        null,
        expectedRestart
      )
    );
  }

  for (const [pointIndex, faultPoint] of VIOLATION_POINTS.entries()) {
    let expectedRestart;
    if (pointIndex <= 1) {
      expectedRestart = fixed(recoveryApplying("valid", "absent"));
    } else if (pointIndex <= 5) {
      expectedRestart = evidenceNamespace();
    } else {
      expectedRestart = fixed(
        blocked("postcondition_failed", "valid", "valid_linked")
      );
    }
    registry.push(
      crashRegistryEntry(
        "foreign_key_violation",
        faultPoint,
        null,
        expectedRestart
      )
    );
  }

  for (const faultPoint of CLEANUP_POINTS) {
    registry.push(
      crashRegistryEntry(
        "one_terminal_run",
        faultPoint,
        null,
        fixed(ready(1))
      )
    );
  }

  registry.push(
    crashRegistryEntry(
      "empty_legacy_runs",
      "sequence3_after_all_adoptions_verified",
      null,
      fixed(ready(0))
    )
  );
  registry.push(
    crashRegistryEntry(
      "one_nonterminal_run",
      "sequence3_after_transform_invocation",
      null,
      fixed(ready(1))
    )
  );
  registry.push(...NON_CRASH_REGISTRY);

  registry.sort((left, right) => compareUtf8(left.caseId, right.caseId));
  return registry;
}

function materializeCase(entry) {
  if (entry.membership === "crash") {
    return {
      caseId: entry.caseId,
      kind: "crash",
      fixture: entry.fixture,
      faultPoint: entry.faultPoint,
      adoptionIndex: entry.adoptionIndex,
      expectedProcessResult: "SIGKILL",
      expectedRestart: entry.expectedRestart
    };
  }

  const expectedProcessResult =
    entry.membership === "capability"
      ? "STORAGE_CAPABILITY_UNSUPPORTED"
      : entry.caseId === "stale_owner_takeover__semantic_failure"
        ? "MIGRATION_IN_PROGRESS"
        : "MIGRATION_RECOVERY_REQUIRED";

  return {
    caseId: entry.caseId,
    kind: entry.membership,
    fixture: entry.fixture,
    faultPoint: null,
    adoptionIndex: null,
    expectedProcessResult,
    expectedRestart: entry.expectedRestart
  };
}

function buildDocument() {
  return {
    schemaVersion: SCHEMA_VERSION,
    migrationSequence: 3,
    migrationId: MIGRATION_ID,
    expectedCaseCount: EXPECTED_CASE_COUNT,
    cases: buildRegistry().map(materializeCase)
  };
}

function validateDocument(value) {
  assertRecord(value, "$");
  assertExactKeys(
    value,
    [
      "schemaVersion",
      "migrationSequence",
      "migrationId",
      "expectedCaseCount",
      "cases"
    ],
    "$"
  );
  assertEqual(value.schemaVersion, SCHEMA_VERSION, "$.schemaVersion");
  assertEqual(value.migrationSequence, 3, "$.migrationSequence");
  assertEqual(value.migrationId, MIGRATION_ID, "$.migrationId");
  assertEqual(value.expectedCaseCount, EXPECTED_CASE_COUNT, "$.expectedCaseCount");
  if (!Array.isArray(value.cases)) fail("schema_invalid");
  if (value.cases.length !== EXPECTED_CASE_COUNT) fail("count_invalid");

  const seen = new Set();
  const counts = { crash: 0, semantic_failure: 0, capability: 0 };
  let previousCaseId = null;
  for (const [index, faultCase] of value.cases.entries()) {
    validateCase(faultCase, `$.cases[${index}]`);
    if (seen.has(faultCase.caseId)) fail("duplicate_case");
    if (
      previousCaseId !== null &&
      compareUtf8(previousCaseId, faultCase.caseId) >= 0
    ) {
      fail("order_invalid");
    }
    seen.add(faultCase.caseId);
    counts[faultCase.kind] += 1;
    previousCaseId = faultCase.caseId;
  }
  if (
    counts.crash !== 49 ||
    counts.semantic_failure !== 15 ||
    counts.capability !== 1
  ) {
    fail("membership_invalid");
  }

  const expected = buildDocument();
  if (canonicalize(value) !== canonicalize(expected)) fail("registry_invalid");
}

function validateCase(value, label) {
  assertRecord(value, label);
  assertExactKeys(
    value,
    [
      "caseId",
      "kind",
      "fixture",
      "faultPoint",
      "adoptionIndex",
      "expectedProcessResult",
      "expectedRestart"
    ],
    label
  );
  if (
    typeof value.caseId !== "string" ||
    !/^[a-z0-9_]+$/.test(value.caseId)
  ) {
    fail("schema_invalid");
  }
  if (!["crash", "semantic_failure", "capability"].includes(value.kind)) {
    fail("schema_invalid");
  }
  if (!ALLOWED_FIXTURES.has(value.fixture)) fail("schema_invalid");
  if (
    value.faultPoint !== null &&
    !ALLOWED_FAULT_POINTS.has(value.faultPoint)
  ) {
    fail("schema_invalid");
  }
  if (
    value.adoptionIndex !== null &&
    !isNonNegativeSafeInteger(value.adoptionIndex)
  ) {
    fail("schema_invalid");
  }
  if (!ALLOWED_PROCESS_RESULTS.has(value.expectedProcessResult)) {
    fail("schema_invalid");
  }
  validateRestart(value.expectedRestart, `${label}.expectedRestart`);
}

function validateRestart(value, label) {
  assertRecord(value, label);
  if (value.kind === "fixed") {
    assertExactKeys(value, ["kind", "state"], label);
    validateState(value.state, `${label}.state`);
    return;
  }
  if (value.kind === "pending_namespace") {
    assertExactKeys(
      value,
      ["kind", "pendingPresent", "pendingAbsent"],
      label
    );
    validateState(value.pendingPresent, `${label}.pendingPresent`);
    validateState(value.pendingAbsent, `${label}.pendingAbsent`);
    return;
  }
  if (value.kind === "evidence_namespace") {
    assertExactKeys(
      value,
      ["kind", "linkedEvidenceValid", "linkedEvidenceNotValid"],
      label
    );
    validateState(value.linkedEvidenceValid, `${label}.linkedEvidenceValid`);
    validateState(
      value.linkedEvidenceNotValid,
      `${label}.linkedEvidenceNotValid`
    );
    return;
  }
  fail("schema_invalid");
}

function validateState(value, label) {
  assertRecord(value, label);
  assertExactKeys(
    value,
    [
      "userVersion",
      "appliedSequence3Count",
      "transformApplicationCount",
      "adoptionCount",
      "attemptStatus",
      "migrationStateStatus",
      "blockedReason",
      "pendingArtifact",
      "evidenceArtifact",
      "publicCode",
      "retryable"
    ],
    label
  );
  if (![2, 3].includes(value.userVersion)) fail("schema_invalid");
  if (![0, 1].includes(value.appliedSequence3Count)) fail("schema_invalid");
  if (![0, 1].includes(value.transformApplicationCount)) fail("schema_invalid");
  if (!isNonNegativeSafeInteger(value.adoptionCount)) fail("schema_invalid");
  if (
    value.attemptStatus !== null &&
    !["applying", "blocked", "completed"].includes(value.attemptStatus)
  ) {
    fail("schema_invalid");
  }
  if (!["ready", "blocked"].includes(value.migrationStateStatus)) {
    fail("schema_invalid");
  }
  if (
    value.blockedReason !== null &&
    !ALLOWED_BLOCKED_REASONS.has(value.blockedReason)
  ) {
    fail("schema_invalid");
  }
  if (
    !["absent", "valid", "partial_or_invalid"].includes(value.pendingArtifact)
  ) {
    fail("schema_invalid");
  }
  if (
    !["absent", "valid_linked", "partial_or_invalid"].includes(
      value.evidenceArtifact
    )
  ) {
    fail("schema_invalid");
  }
  if (value.publicCode !== null && !ALLOWED_PUBLIC_CODES.has(value.publicCode)) {
    fail("schema_invalid");
  }
  if (
    value.retryable !== null &&
    typeof value.retryable !== "boolean"
  ) {
    fail("schema_invalid");
  }
  if ((value.publicCode === null) !== (value.retryable === null)) {
    fail("schema_invalid");
  }
  if (
    (value.migrationStateStatus === "ready") !==
    (value.blockedReason === null)
  ) {
    fail("schema_invalid");
  }
  if (value.userVersion === 3) {
    if (
      value.appliedSequence3Count !== 1 ||
      value.transformApplicationCount !== 1 ||
      value.attemptStatus !== "completed" ||
      value.migrationStateStatus !== "ready" ||
      value.pendingArtifact !== "absent" ||
      value.evidenceArtifact !== "absent" ||
      value.publicCode !== null
    ) {
      fail("schema_invalid");
    }
  } else if (
    value.appliedSequence3Count !== 0 ||
    value.transformApplicationCount !== 0 ||
    value.adoptionCount !== 0
  ) {
    fail("schema_invalid");
  }
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

function assertDenseJson(value, label = "$") {
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    assertNoLoneSurrogate(value);
    return;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) fail("schema_invalid");
    return;
  }
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) fail("schema_invalid");
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) fail("schema_invalid");
      assertDenseJson(value[index], `${label}[${index}]`);
    }
    return;
  }
  assertRecord(value, label);
  for (const [key, child] of Object.entries(value)) {
    assertNoLoneSurrogate(key);
    assertDenseJson(child, `${label}.${key}`);
  }
}

function parseStrictJson(bytes) {
  let source;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("bytes_invalid");
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
      if (source[cursor] !== '"') fail("bytes_invalid");
      const key = parseString();
      if (keys.has(key)) fail("duplicate_key");
      keys.add(key);
      skipWhitespace();
      if (source[cursor] !== ":") fail("bytes_invalid");
      cursor += 1;
      result[key] = parseValue();
      skipWhitespace();
      if (source[cursor] === "}") {
        cursor += 1;
        return result;
      }
      if (source[cursor] !== ",") fail("bytes_invalid");
      cursor += 1;
    }
    fail("bytes_invalid");
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
      if (source[cursor] !== ",") fail("bytes_invalid");
      cursor += 1;
    }
    fail("bytes_invalid");
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
          fail("bytes_invalid");
        }
        assertNoLoneSurrogate(value);
        return value;
      }
      if (code < 0x20) fail("bytes_invalid");
      if (code === 0x5c) {
        cursor += 2;
      } else {
        cursor += 1;
      }
    }
    fail("bytes_invalid");
  }

  function parseLiteral(literal, value) {
    if (source.slice(cursor, cursor + literal.length) !== literal) {
      fail("bytes_invalid");
    }
    cursor += literal.length;
    return value;
  }

  function parseNumber() {
    const match = source
      .slice(cursor)
      .match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);
    if (!match) fail("bytes_invalid");
    cursor += match[0].length;
    const value = Number(match[0]);
    if (!Number.isSafeInteger(value)) fail("bytes_invalid");
    return value;
  }

  const result = parseValue();
  skipWhitespace();
  if (cursor !== source.length) fail("bytes_invalid");
  return result;
}

function hashRaw(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function hashFramed(domain, schema, metadata, bodyBytes) {
  const metadataBytes = Buffer.from(canonicalize(metadata), "utf8");
  return `sha256:${createHash("sha256")
    .update(frame(Buffer.from(domain, "utf8")))
    .update(frame(Buffer.from(schema, "utf8")))
    .update(frame(metadataBytes))
    .update(frame(bodyBytes))
    .digest("hex")}`;
}

function frame(bytes) {
  const prefix = Buffer.alloc(8);
  prefix.writeBigUInt64BE(BigInt(bytes.byteLength));
  return Buffer.concat([prefix, bytes]);
}

function readFileOnce(filePath) {
  let before;
  try {
    before = fs.lstatSync(filePath);
  } catch {
    fail("output_missing");
  }
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) {
    fail("output_path_invalid");
  }

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
      opened.size !== before.size
    ) {
      fail("output_path_invalid");
    }
    const bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < bytes.length) {
      const read = fs.readSync(
        descriptor,
        bytes,
        offset,
        bytes.length - offset,
        offset
      );
      if (read === 0) fail("output_read_invalid");
      offset += read;
    }
    const extra = Buffer.alloc(1);
    if (fs.readSync(descriptor, extra, 0, 1, bytes.length) !== 0) {
      fail("output_read_invalid");
    }
    const after = fs.fstatSync(descriptor);
    if (
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      after.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs
    ) {
      fail("output_read_invalid");
    }
    return bytes;
  } catch (error) {
    if (error instanceof GeneratorFailure) throw error;
    fail("output_read_invalid");
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function writeExclusive(filePath, bytes) {
  const parentPath = path.dirname(filePath);
  const parent = fs.lstatSync(parentPath);
  if (!parent.isDirectory() || parent.isSymbolicLink()) {
    fail("output_path_invalid");
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
      const written = fs.writeSync(
        descriptor,
        bytes,
        offset,
        bytes.length - offset,
        offset
      );
      if (written === 0) fail("output_write_invalid");
      offset += written;
    }
    fs.fsyncSync(descriptor);
    const written = fs.fstatSync(descriptor);
    if (!written.isFile() || written.nlink !== 1 || written.size !== bytes.length) {
      fail("output_write_invalid");
    }
    const observed = Buffer.alloc(bytes.length);
    let readOffset = 0;
    while (readOffset < observed.length) {
      const read = fs.readSync(
        descriptor,
        observed,
        readOffset,
        observed.length - readOffset,
        readOffset
      );
      if (read === 0) fail("output_write_invalid");
      readOffset += read;
    }
    if (!observed.equals(bytes)) fail("output_write_invalid");
  } catch (error) {
    if (error instanceof GeneratorFailure) throw error;
    fail("output_create_invalid");
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }

  let parentDescriptor;
  try {
    parentDescriptor = fs.openSync(parentPath, fs.constants.O_RDONLY);
    fs.fsyncSync(parentDescriptor);
  } catch {
    fail("output_durability_invalid");
  } finally {
    if (parentDescriptor !== undefined) fs.closeSync(parentDescriptor);
  }
}

function verifyBytes(bytes, expectedBytes) {
  const parsed = parseStrictJson(bytes);
  validateDocument(parsed);
  if (!bytes.equals(expectedBytes)) fail("output_drift");
}

function assertRecord(value, _label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    fail("schema_invalid");
  }
}

function assertExactKeys(value, expectedKeys, _label) {
  const actual = Object.keys(value);
  if (
    actual.length !== expectedKeys.length ||
    expectedKeys.some((key) => !Object.hasOwn(value, key))
  ) {
    fail("schema_invalid");
  }
}

function assertEqual(actual, expected, _label) {
  if (actual !== expected) fail("schema_invalid");
}

function assertNoLoneSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) fail("bytes_invalid");
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      fail("bytes_invalid");
    }
  }
}

function isNonNegativeSafeInteger(value) {
  return (
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_SAFE_INTEGER
  );
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function compareUtf16(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
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

  if (
    TRANSACTION_POINTS.length !== 20 ||
    new Set(TRANSACTION_POINTS).size !== 20 ||
    PENDING_POINTS.length !== 12 ||
    new Set(PENDING_POINTS).size !== 12 ||
    VIOLATION_POINTS.length !== 9 ||
    new Set(VIOLATION_POINTS).size !== 9 ||
    CLEANUP_POINTS.length !== 2 ||
    new Set(CLEANUP_POINTS).size !== 2 ||
    ALLOWED_FAULT_POINTS.size !== 43
  ) {
    fail("registry_invalid");
  }

  const expectedDocument = buildDocument();
  validateDocument(expectedDocument);
  const expectedBytes = Buffer.from(`${canonicalize(expectedDocument)}\n`, "utf8");
  const rawHash = hashRaw(expectedBytes);
  const framedHash = hashFramed(
    "vdt-studio/migration-fault-vectors",
    "migration_fault_vectors_hash.v1",
    { migrationSequence: 3, migrationId: MIGRATION_ID },
    expectedBytes
  );
  if (
    !/^sha256:[0-9a-f]{64}$/.test(rawHash) ||
    !/^sha256:[0-9a-f]{64}$/.test(framedHash)
  ) {
    fail("hash_invalid");
  }

  const scriptPath = fileURLToPath(import.meta.url);
  const repositoryRoot = path.resolve(path.dirname(scriptPath), "../../..");
  const outputPath = path.join(
    repositoryRoot,
    "packages/vdt-storage/src/migrations/sequence-3-fault-vectors.v1.json"
  );

  if (mode === "--verify") {
    verifyBytes(readFileOnce(outputPath), expectedBytes);
    return;
  }

  if (fs.existsSync(outputPath)) {
    verifyBytes(readFileOnce(outputPath), expectedBytes);
    return;
  }
  writeExclusive(outputPath, expectedBytes);
}

try {
  main();
} catch (error) {
  const code =
    error instanceof GeneratorFailure ? error.code : "internal";
  process.stderr.write(`sequence-3 fault vectors: ${code}\n`);
  process.exitCode = code === "invalid_arguments" ? 64 : 1;
}
