import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { canonicalizeJson, hashFramed, hashRawBytes } from "../src/canonical";
import { computeSchemaHash } from "../src/migrations";
import type { JsonValue } from "../src/types";

const directory = new URL("../src/migrations/", import.meta.url);
const prefixHash = "sha256:58440c19c409fb79229458d8448cafa900dd24f8e363c191dd4fbececa54b2d0";
const db = new DatabaseSync(":memory:");
try {
  for (const name of [
    "001-legacy-v1-bootstrap.sql", "002-atomic-revisions.sql",
    "003-durable-agent-run-coordination.sql", "004-bounded-agent-execution.sql"
  ]) db.exec(fs.readFileSync(new URL(name, directory), "utf8"));
  const preconditionSchemaHash = computeSchemaHash(db, 4);
  const triggers = db.prepare(`
    SELECT name, tbl_name, sql FROM sqlite_schema
    WHERE type = 'trigger' AND sql LIKE '%BEFORE DELETE%'
      AND tbl_name NOT IN (
        'agent_runs', 'applied_migrations', 'migration_transform_applications_v1',
        'agent_mutation_approval_policies_v2'
      )
    ORDER BY name
  `).all() as Array<{ name: string; tbl_name: string; sql: string }>;
  if (triggers.length !== 32) throw new Error("Unexpected project audit deletion guards");
  const parts = [`CREATE TABLE project_deletion_runs_v1 (
  run_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON UPDATE RESTRICT ON DELETE CASCADE
) STRICT;

CREATE TRIGGER project_deletion_runs_ownership_guard
BEFORE INSERT ON project_deletion_runs_v1
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM (
      SELECT id AS run_id, project_id FROM agent_runs
      UNION ALL SELECT run_id, project_id FROM agent_run_coordinators_v2
      UNION ALL SELECT run_id, project_id FROM agent_session_bindings_v2
    ) AS owner
    WHERE owner.run_id = NEW.run_id AND owner.project_id = NEW.project_id
  ) OR EXISTS (
    SELECT 1 FROM (
      SELECT id AS run_id, project_id FROM agent_runs
      UNION ALL SELECT run_id, project_id FROM agent_run_coordinators_v2
      UNION ALL SELECT run_id, project_id FROM agent_session_bindings_v2
    ) AS owner
    WHERE owner.run_id = NEW.run_id AND owner.project_id <> NEW.project_id
  ) THEN RAISE(ABORT, 'project_deletion_run_owner_mismatch') END;
END;

CREATE TRIGGER project_deletion_runs_immutable_update
BEFORE UPDATE ON project_deletion_runs_v1
BEGIN
  SELECT RAISE(ABORT, 'project_deletion_run_is_immutable');
END;

CREATE TABLE project_deleted_legacy_adoptions_v1 (
  run_id TEXT PRIMARY KEY,
  database_id TEXT NOT NULL,
  migration_application_id TEXT NOT NULL,
  migration_sequence INTEGER NOT NULL CHECK(migration_sequence = 3),
  project_id TEXT NOT NULL,
  legacy_row_hash TEXT NOT NULL CHECK(length(legacy_row_hash) = 71 AND substr(legacy_row_hash, 1, 7) = 'sha256:' AND substr(legacy_row_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  deleted_at INTEGER NOT NULL CHECK(deleted_at BETWEEN 0 AND 9007199254740991),
  FOREIGN KEY(database_id, migration_application_id, migration_sequence) REFERENCES migration_transform_applications_v1(database_id, migration_application_id, sequence) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TRIGGER project_deleted_legacy_adoptions_insert_guard
BEFORE INSERT ON project_deleted_legacy_adoptions_v1
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM legacy_agent_run_adoptions_v1 AS adoption
    JOIN project_deletion_runs_v1 AS deletion ON deletion.run_id = adoption.run_id
      AND deletion.project_id = adoption.project_id
    WHERE adoption.run_id = NEW.run_id AND adoption.project_id = NEW.project_id
      AND adoption.database_id = NEW.database_id
      AND adoption.migration_application_id = NEW.migration_application_id
      AND adoption.migration_sequence = NEW.migration_sequence
      AND adoption.legacy_row_hash = NEW.legacy_row_hash
  ) THEN RAISE(ABORT, 'project_deleted_legacy_adoption_mismatch') END;
END;

CREATE TRIGGER project_deleted_legacy_adoptions_immutable_update
BEFORE UPDATE ON project_deleted_legacy_adoptions_v1
BEGIN
  SELECT RAISE(ABORT, 'project_deleted_legacy_adoption_is_immutable');
END;

CREATE TRIGGER project_deleted_legacy_adoptions_immutable_delete
BEFORE DELETE ON project_deleted_legacy_adoptions_v1
BEGIN
  SELECT RAISE(ABORT, 'project_deleted_legacy_adoption_is_immutable');
END;`];
  for (const trigger of triggers) {
    const runId = trigger.tbl_name === "agent_command_execution_bases_v2"
      ? "(SELECT run_id FROM agent_run_attempts_v2 WHERE attempt_id = OLD.attempt_id)"
      : trigger.tbl_name === "agent_mutation_approval_bases_v2"
        ? "(SELECT run_id FROM agent_mutation_actions_v2 WHERE action_id = OLD.action_id)"
        : "OLD.run_id";
    let guard = `WHEN NOT EXISTS (\n  SELECT 1 FROM project_deletion_runs_v1 WHERE run_id = ${runId}\n)`;
    if (trigger.tbl_name === "legacy_agent_run_adoptions_v1") {
      guard += ` OR NOT EXISTS (
  SELECT 1 FROM project_deleted_legacy_adoptions_v1 AS deleted
  WHERE deleted.run_id = OLD.run_id AND deleted.project_id = OLD.project_id
    AND deleted.database_id = OLD.database_id
    AND deleted.migration_application_id = OLD.migration_application_id
    AND deleted.migration_sequence = OLD.migration_sequence
    AND deleted.legacy_row_hash = OLD.legacy_row_hash
)`;
    }
    parts.push(`DROP TRIGGER ${trigger.name};\n\n${trigger.sql.replace("\nBEGIN\n", `\n${guard}\nBEGIN\n`)};`);
  }
  const sql = Buffer.from(`${parts.join("\n\n")}\n`, "utf8");
  db.exec(sql.toString("utf8"));
  const entry = {
    sequence: 5, migrationId: "005-project-deletion", fromUserVersion: 4, toUserVersion: 5,
    preconditionSchemaHash, postconditionSchemaHash: computeSchemaHash(db, 5)
  };
  const sqlChecksum = hashFramed("vdt-studio/sql-migration", "sql_migration_hash.v1", entry, sql);
  const body = {
    schemaVersion: "migration_manifest.v4", manifestVersion: 4,
    historicalPrefixManifestHash: prefixHash,
    entries: [
      { entryKind: "v3_manifest_projection", firstSequence: 1, lastSequence: 4, manifestHash: prefixHash },
      { entryKind: "transactional_sql_v1", entry: { ...entry, sqlByteLength: sql.byteLength, sqlChecksum, transactional: true } }
    ]
  };
  const manifestHash = hashFramed("vdt-studio/migration-manifest", "migration_manifest_hash.v4", body as JsonValue);
  const manifest = Buffer.from(`${canonicalizeJson({ ...body, manifestHash } as JsonValue)}\n`, "utf8");
  for (const [name, bytes] of [
    ["005-project-deletion.sql", sql], ["migration-manifest-v4.json", manifest]
  ] as const) {
    const destination = new URL(name, directory);
    if (process.argv.includes("--check")) {
      if (!fs.readFileSync(destination).equals(bytes)) throw new Error(`Generated asset drifted: ${name}`);
    } else fs.writeFileSync(destination, bytes);
  }
  console.log(JSON.stringify({ ...entry, sqlChecksum, manifestHash, sqlBytes: sql.byteLength, sqlRawHash: hashRawBytes(sql), manifestBytes: manifest.byteLength, manifestRawHash: hashRawBytes(manifest) }, null, 2));
} finally {
  db.close();
}
