import assert from "node:assert/strict";
import fs from "node:fs";
import { hashFramed } from "./canonical";
import { MATRIX_MANIFEST, MATRIX_MIGRATION_ID } from "./sequence-3-windows-matrix-fixtures";
import { matrixSha } from "./sequence-3-windows-matrix-observe";
import { verifyMatrixCase, type MatrixCase, type MatrixObservation, type MatrixResult } from "./sequence-3-windows-matrix-verify";

const [filename] = process.argv.slice(2);
assert(filename, "Usage: sequence-3-windows-matrix-evidence.ts EVIDENCE_FILE");
const specBytes = fs.readFileSync(new URL("./migrations/sequence-3-fault-vectors.v1.json", import.meta.url));
const frozen = JSON.parse(specBytes.toString()) as { cases: MatrixCase[] };
const reported = JSON.parse(fs.readFileSync(filename, "utf8"));
const raw = JSON.parse(fs.readFileSync(filename + ".observations.json", "utf8")) as {
  failures: unknown[];
  observations: {
    caseId: string;
    pre: MatrixObservation;
    result: MatrixResult;
    post: MatrixObservation;
    reopen: MatrixResult;
    first: MatrixObservation;
    finalReopen: MatrixResult;
    final: MatrixObservation;
  }[];
};
assert.deepEqual(raw.failures, []);
assert.equal(raw.observations.length, 65);
assert.equal(frozen.cases.length, 65);
const cases = frozen.cases.map((spec, index) => {
  const row = raw.observations[index]!;
  assert.equal(row.caseId, spec.caseId);
  for (const snapshot of [row.pre, row.post, row.first, row.final]) assert.equal(snapshot.nativeNamespaceVerified, true);
  return verifyMatrixCase(spec, row.pre, row.result, row.post, row.reopen, row.first, row.finalReopen, row.final);
});
const platform = reported.platform;
assert.deepEqual(Object.keys(platform).sort(), ["filesystemType", "nodeVersion", "processArch", "processPlatform", "sqliteVersion"]);
assert.equal(platform.processPlatform, "win32");
assert.equal(platform.processArch, "x64");
assert.match(platform.nodeVersion, /^v24\.\d+\.\d+$/);
assert.match(platform.sqliteVersion, /^\d+\.\d+\.\d+$/);
assert.equal(platform.filesystemType, "NTFS");
assert.deepEqual(reported, {
  schemaVersion: "sequence_3_gate_r2_fault_execution_evidence.v1",
  migrationSequence: 3,
  migrationId: MATRIX_MIGRATION_ID,
  manifestHash: MATRIX_MANIFEST,
  faultSpecRawSha256: matrixSha(specBytes),
  faultVectorsHash: hashFramed("vdt-studio/migration-fault-vectors", "migration_fault_vectors_hash.v1",
    { migrationSequence: 3, migrationId: MATRIX_MIGRATION_ID }, specBytes),
  faultSpecCaseCount: 65,
  platform,
  cases
});
console.log(JSON.stringify({ verifiedCases: cases.length, evidenceSha256: matrixSha(fs.readFileSync(filename)) }));
