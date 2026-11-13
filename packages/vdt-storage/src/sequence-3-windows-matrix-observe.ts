import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { canonicalizeJson, hashFramed } from "./canonical";
import { computeSchemaHash } from "./migrations";
import type { JsonValue } from "./types";
import { MATRIX_MANIFEST, MATRIX_MIGRATION_ID } from "./sequence-3-windows-matrix-fixtures";

export const matrixSha = (value: string | Uint8Array) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
export const utf8Order = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));
const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';

export function observeMatrixDatabase(db: DatabaseSync) {
  const userVersion = Number(db.prepare("PRAGMA user_version").get()?.user_version);
  const schema = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name").all();
  const data = schema.filter((row) => row.type === "table").map((row) => {
    const table = String(row.name);
    const query = db.prepare(`SELECT * FROM ${quote(table)}`);
    query.setReadBigInts(true);
    const rows = query.all().map((entry) => JSON.stringify(entry, (_key, value: unknown) =>
      typeof value === "bigint" ? { integer: String(value) } : value instanceof Uint8Array ? { blob: Buffer.from(value).toString("hex") } : value));
    return [table, rows.sort(utf8Order)];
  });
  const count = (name: string, where = "") => schema.some((row) => row.type === "table" && row.name === name)
    ? Number(db.prepare(`SELECT count(*) AS count FROM ${quote(name)} ${where}`).get()?.count) : 0;
  const attempt = db.prepare("SELECT status,attempt_id,owner_token,lease_generation,lease_expires_at,database_id FROM migration_attempts WHERE target_manifest_hash=? ORDER BY created_at DESC LIMIT 1").get(MATRIX_MANIFEST) ?? null;
  const state = db.prepare("SELECT status,blocked_reason FROM migration_state").get();
  const application = schema.some((row) => row.name === "migration_transform_applications_v1")
    ? db.prepare("SELECT migration_application_id, fence_owner_token, fence_lease_generation FROM migration_transform_applications_v1").get() ?? null : null;
  const adoptions = schema.some((row) => row.name === "legacy_agent_run_adoptions_v1")
    ? db.prepare("SELECT run_id,original_status,projected_status FROM legacy_agent_run_adoptions_v1 ORDER BY CAST(run_id AS BLOB)").all() : [];
  return {
    database: {
      logicalDatabaseHash: matrixSha(JSON.stringify({ userVersion, schema, data })),
      schemaHash: computeSchemaHash(db, userVersion),
      userVersion,
      appliedSequence3Count: count("applied_migrations", "WHERE sequence=3"),
      transformApplicationCount: count("migration_transform_applications_v1"),
      adoptionCount: count("legacy_agent_run_adoptions_v1"),
      attemptStatus: attempt?.status ?? null,
      migrationStateStatus: state?.status,
      blockedReason: state?.blocked_reason ?? null
    },
    attempt,
    application,
    adoptions
  };
}

export function observeMatrixDirectory(root: string) {
  const result: { relativePath: string; kind: "directory" | "regular_file"; modeOctal: string; uidDecimal: string; byteLengthDecimal: string; rawSha256: string | null }[] = [];
  function walk(relative: string) {
    for (const name of fs.readdirSync(path.join(root, relative))) {
      const child = relative ? relative + "/" + name : name;
      const absolute = path.join(root, child);
      const stat = fs.lstatSync(absolute, { bigint: true });
      assert(stat.isFile() || stat.isDirectory(), `Unexpected filesystem entry: ${child}`);
      result.push({
        relativePath: child, kind: stat.isDirectory() ? "directory" : "regular_file",
        modeOctal: (stat.mode & 0o7777n).toString(8).padStart(4, "0"), uidDecimal: stat.uid.toString(),
        byteLengthDecimal: stat.size.toString(), rawSha256: stat.isFile() ? matrixSha(fs.readFileSync(absolute)) : null
      });
      if (stat.isDirectory()) walk(child);
    }
  }
  walk("");
  return result.sort((a, b) => utf8Order(a.relativePath, b.relativePath));
}

function framed(domain: string, schema: string, value: JsonValue): string {
  return hashFramed(domain, schema, {}, Buffer.from(canonicalizeJson(value)));
}

export function inspectMatrixArtifacts(root: string, entries: ReturnType<typeof observeMatrixDirectory>) {
  const pending = entries.filter(({ relativePath }) => relativePath.endsWith(".pending.json"));
  const evidence = entries.filter(({ relativePath }) => relativePath.endsWith(".evidence.json"));
  assert(pending.length <= 1 && evidence.length <= 1, "Multiple migration latch/evidence files");
  const raw = (entry: (typeof entries)[number]) => fs.readFileSync(path.join(root, entry.relativePath), "utf8");
  const pendingRaw = pending[0] ? raw(pending[0]) : null;
  const evidenceRaw = evidence[0] ? raw(evidence[0]) : null;
  return { pending: pendingRaw, evidence: evidenceRaw };
}

export function classifyMatrixArtifacts(artifacts: ReturnType<typeof inspectMatrixArtifacts>) {
  let pending: Record<string, JsonValue> | undefined;
  let identityHash: string | undefined;
  const checkIdentity = (value: JsonValue): string => {
    assert(value && typeof value === "object" && !Array.isArray(value));
    assert.deepEqual(Object.keys(value).sort(), ["attemptId", "databaseId", "fenceLeaseGeneration", "fenceOwnerToken", "migrationId", "schemaVersion", "sequence", "targetManifestHash"]);
    assert.equal(value.schemaVersion, "migration_foreign_key_check_identity.v1");
    assert.equal(value.sequence, 3);
    assert.equal(value.migrationId, MATRIX_MIGRATION_ID);
    assert.equal(value.targetManifestHash, MATRIX_MANIFEST);
    assert(Number.isSafeInteger(value.fenceLeaseGeneration) && Number(value.fenceLeaseGeneration) > 0);
    for (const key of ["attemptId", "databaseId", "fenceOwnerToken"]) assert(typeof value[key] === "string" && value[key]);
    return framed("vdt-studio/migration-foreign-key-check-identity", "migration_foreign_key_check_identity_hash.v1", value);
  };
  if (artifacts.pending !== null) {
    try {
      const value = JSON.parse(artifacts.pending) as Record<string, JsonValue>;
      const { pendingLatchHash, ...body } = value;
      assert.deepEqual(Object.keys(body).sort(), ["createdAt", "identity", "identityHash", "schemaVersion"]);
      assert.equal(body.schemaVersion, "migration_foreign_key_pending_latch.v1");
      const hash = checkIdentity(body.identity!);
      assert.equal(body.identityHash, hash);
      assert.equal(pendingLatchHash, framed("vdt-studio/migration-foreign-key-pending-latch", "migration_foreign_key_pending_latch_hash.v1", body));
      assert.equal(canonicalizeJson(value), artifacts.pending);
      pending = value;
      identityHash = hash;
    } catch { /* malformed durable branch */ }
  }
  let linked = false;
  if (artifacts.evidence !== null && pending) {
    try {
      const value = JSON.parse(artifacts.evidence) as Record<string, JsonValue>;
      const { evidenceHash, ...body } = value;
      assert.deepEqual(Object.keys(body).sort(), ["createdAt", "identity", "identityHash", "pendingLatchHash", "schemaVersion", "truncated", "violationCount", "violations"]);
      assert.equal(body.schemaVersion, "migration_foreign_key_check_evidence.v1");
      assert.equal(checkIdentity(body.identity!), identityHash);
      assert.equal(body.identityHash, identityHash);
      assert.equal(body.pendingLatchHash, pending.pendingLatchHash);
      assert(Number.isSafeInteger(body.violationCount) && Number(body.violationCount) > 0 && Array.isArray(body.violations));
      assert.equal(body.violations.length, Math.min(50, Number(body.violationCount)));
      assert.equal(body.truncated, Number(body.violationCount) > 50);
      assert.equal(evidenceHash, framed("vdt-studio/migration-foreign-key-check", "migration_foreign_key_check_evidence_hash.v1", body));
      assert.equal(canonicalizeJson(value), artifacts.evidence);
      linked = true;
    } catch { /* malformed durable branch */ }
  }
  return {
    pendingArtifact: artifacts.pending === null ? "absent" : pending ? "valid" : "partial_or_invalid",
    evidenceArtifact: artifacts.evidence === null ? "absent" : linked ? "valid_linked" : "partial_or_invalid"
  };
}
