import assert from "node:assert/strict";
import { classifyMatrixArtifacts, inspectMatrixArtifacts, observeMatrixDatabase, observeMatrixDirectory, matrixSha, utf8Order } from "./sequence-3-windows-matrix-observe";

type State = Omit<ReturnType<typeof observeMatrixDatabase>["database"], "logicalDatabaseHash" | "schemaHash"> &
  ReturnType<typeof classifyMatrixArtifacts> & { publicCode: string | null; retryable: boolean | null };

export interface MatrixCase {
  caseId: string;
  fixture: string;
  kind: "crash" | "semantic_failure" | "capability";
  faultPoint: string | null;
  adoptionIndex: number | null;
  expectedProcessResult: string;
  expectedRestart:
    | { kind: "fixed"; state: State }
    | { kind: "pending_namespace"; pendingPresent: State; pendingAbsent: State }
    | { kind: "evidence_namespace"; linkedEvidenceValid: State; linkedEvidenceNotValid: State };
}
export type MatrixObservation = ReturnType<typeof observeMatrixDatabase> & {
  directoryEntries: ReturnType<typeof observeMatrixDirectory>;
  artifacts: ReturnType<typeof inspectMatrixArtifacts>;
  pid: number;
};
export type MatrixResult =
  | { kind: "success"; pid: number }
  | { kind: "storage_error"; code: string; retryable: boolean; pid: number }
  | { kind: "signal"; signal: "SIGKILL"; exitCode: null; marker: { pid: number; point: string; adoptionIndex: number | null } };

function verifyObservation(value: MatrixObservation) {
  const db = value.database;
  assert.match(db.logicalDatabaseHash, /^sha256:[0-9a-f]{64}$/);
  assert.match(db.schemaHash, /^sha256:[0-9a-f]{64}$/);
  assert(db.userVersion === 2 || db.userVersion === 3);
  assert([0, 1].includes(db.appliedSequence3Count));
  assert([0, 1].includes(db.transformApplicationCount));
  assert(Number.isSafeInteger(db.adoptionCount) && db.adoptionCount >= 0);
  assert([null, "applying", "blocked", "completed"].includes(String(db.attemptStatus) === "null" ? null : String(db.attemptStatus)));
  assert(db.migrationStateStatus === "ready" || db.migrationStateStatus === "blocked");
  assert([null, "applied_prefix_mismatch", "checksum_mismatch", "precondition_failed", "postcondition_failed", "backup_failed"].includes(db.blockedReason as string | null));
  let previous: string | undefined;
  for (const entry of value.directoryEntries) {
    assert(!previous || utf8Order(previous, entry.relativePath) < 0);
    assert.match(entry.relativePath, /^[^\\/]+(?:\/[^\\/]+)*$/);
    assert(!entry.relativePath.split("/").some((segment) => segment === ".." || segment === "."));
    assert.match(entry.modeOctal, /^[0-7]{4}$/);
    assert.match(entry.uidDecimal, /^\d+$/);
    assert.match(entry.byteLengthDecimal, /^\d+$/);
    if (entry.kind === "directory") assert.equal(entry.rawSha256, null);
    else {
      assert.equal(entry.kind, "regular_file");
      assert.match(entry.rawSha256 ?? "", /^sha256:[0-9a-f]{64}$/);
    }
    previous = entry.relativePath;
  }
  for (const [artifact, raw] of Object.entries(value.artifacts)) {
    const match = value.directoryEntries.filter((entry) => entry.relativePath.endsWith(`.${artifact}.json`));
    assert.equal(match.length, raw === null ? 0 : 1);
    if (raw !== null) assert.equal(match[0]?.rawSha256, matrixSha(raw));
  }
}

function observationState(observation: MatrixObservation, result: MatrixResult): State {
  const { logicalDatabaseHash: _logical, schemaHash: _schema, ...rest } = observation.database;
  return {
    ...rest,
    ...classifyMatrixArtifacts(observation.artifacts),
    publicCode: result.kind === "storage_error" ? result.code : null,
    retryable: result.kind === "storage_error" ? result.retryable : null
  };
}

export function verifyMatrixCase(
  spec: MatrixCase, pre: MatrixObservation, result: MatrixResult, post: MatrixObservation,
  reopen: MatrixResult, first: MatrixObservation, finalReopen: MatrixResult, final: MatrixObservation
) {
  for (const observation of [pre, post, first, final]) verifyObservation(observation);
  assert.equal(pre.database.userVersion, 2);
  assert.equal(pre.database.appliedSequence3Count, 0);
  assert.equal(pre.database.transformApplicationCount, 0);
  assert.equal(pre.database.adoptionCount, 0);
  let processResult;
  if (spec.kind === "crash") {
    assert.equal(result.kind, "signal");
    assert.equal(result.signal, spec.expectedProcessResult);
    assert.equal(result.exitCode, null);
    assert.equal(result.marker.point, spec.faultPoint);
    assert.equal(result.marker.adoptionIndex, spec.adoptionIndex);
    assert(reopen.kind !== "signal" && reopen.pid !== result.marker.pid);
    if (post.database.userVersion === 2) {
      assert.equal(post.database.appliedSequence3Count, 0);
      assert.equal(post.database.transformApplicationCount, 0);
      assert.equal(post.database.adoptionCount, 0);
      assert.equal(post.database.schemaHash, pre.database.schemaHash);
    }
    processResult = { kind: "signal", signal: result.signal, exitCode: null };
  } else {
    assert.equal(result.kind, "storage_error");
    assert.equal(result.code, spec.expectedProcessResult);
    assert.equal(result.retryable, result.code === "MIGRATION_IN_PROGRESS");
    assert(reopen.kind !== "signal" && reopen.pid !== result.pid);
    processResult = { kind: "storage_error", signal: null, exitCode: 1, code: result.code, retryable: result.retryable };
  }
  const branch = spec.expectedRestart;
  const artifacts = classifyMatrixArtifacts(post.artifacts);
  const expected = branch.kind === "fixed" ? branch.state
    : branch.kind === "pending_namespace" ? artifacts.pendingArtifact === "absent" ? branch.pendingAbsent : branch.pendingPresent
      : artifacts.evidenceArtifact === "valid_linked" ? branch.linkedEvidenceValid : branch.linkedEvidenceNotValid;
  assert.deepEqual(observationState(first, reopen), expected);
  assert.deepEqual(observationState(final, finalReopen), expected);
  assert.deepEqual(final.database, first.database);
  assert.deepEqual(final.directoryEntries, first.directoryEntries);

  if (spec.kind === "capability") {
    assert.deepEqual(post.database, pre.database);
    assert.deepEqual(post.directoryEntries, pre.directoryEntries);
  }
  if (post.database.userVersion === 3 || (expected.publicCode && post.database.attemptStatus === expected.attemptStatus)) {
    assert.deepEqual(first.database, post.database);
    assert.deepEqual(first.directoryEntries, post.directoryEntries);
  }
  if (post.database.userVersion === 2 && first.database.userVersion === 3 && post.attempt) {
    assert(first.application);
    assert(Number(first.application.fence_lease_generation) > Number(post.attempt.lease_generation));
    assert.notEqual(first.application.fence_owner_token, post.attempt.owner_token);
  }
  if (first.database.userVersion === 3) {
    const rows = spec.fixture === "empty_legacy_runs" ? []
      : spec.fixture === "three_mixed_runs" ? [
        { run_id: "run_a", original_status: "succeeded", projected_status: "succeeded" },
        { run_id: "run_b", original_status: "running", projected_status: "interrupted_legacy" },
        { run_id: "run_c", original_status: "cancelled", projected_status: "cancelled" }
      ] : [{
        run_id: "run_a", original_status: spec.fixture === "one_nonterminal_run" ? "running" : "succeeded",
        projected_status: spec.fixture === "one_nonterminal_run" ? "interrupted_legacy" : "succeeded"
      }];
    assert.deepEqual(first.adoptions.map((row) => ({ ...row })), rows);
  }
  return {
    caseId: spec.caseId,
    observedProcessResult: processResult,
    preExecutionDatabase: pre.database,
    postProcessDatabase: post.database,
    postProcessDirectoryEntries: post.directoryEntries,
    firstReopen: {
      code: reopen.kind === "storage_error" ? reopen.code : null,
      retryable: reopen.kind === "storage_error" ? reopen.retryable : null,
      database: first.database,
      directoryEntries: first.directoryEntries
    },
    finalDatabase: final.database,
    finalDirectoryEntries: final.directoryEntries,
    matchedExpectedPolicy: true as const
  };
}
