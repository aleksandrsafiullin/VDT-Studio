import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import type { StorageMigrationFaultContext, StorageMigrationFaultPoint } from "./types";

export const MATRIX_NOW = "2026-11-13T00:00:00.000Z";
export const MATRIX_REOPEN = "2026-11-13T00:02:00.000Z";
export const MATRIX_MANIFEST = "sha256:791fc7c7cce9abd11b2509ddaa6ba9e92e469178a3d1add6803b083295c849e8";
export const MATRIX_MIGRATION_ID = "003-durable-agent-run-coordination";

export function seedMatrixLegacyRuns(db: DatabaseSync, fixture: string): void {
  if (fixture === "empty_legacy_runs" || fixture === "windows_unsupported") return;
  db.exec(`
    PRAGMA foreign_keys = ON;
    INSERT INTO projects (id,name,created_at,updated_at) VALUES ('project_matrix','Matrix fixture',0,30);
    INSERT INTO project_runtime_states
      (project_id,schema_version,runtime_generation,generation_version,migration_state,write_state,updated_at)
      VALUES ('project_matrix','project_runtime_state.v1','v1',0,'not_started','disabled',30);
  `);
  const rows = fixture === "three_mixed_runs"
    ? [["run_c", "cancelled"], ["run_b", "running"], ["run_a", "succeeded"]]
    : [["run_a", fixture === "one_nonterminal_run" ? "running" : fixture === "legacy_validation_failure" ? "unknown" : "succeeded"]];
  const insert = db.prepare(`
    INSERT INTO agent_runs
      (id,project_id,status,phase,request_json,created_at,updated_at,completed_at)
    VALUES (?, 'project_matrix', ?, ?, '{}', 0, 10, ?)
  `);
  for (const [id, status] of rows) {
    insert.run(id!, status!, status === "running" ? "applying_graph" : "reporting", status === "running" ? null : 10);
  }
}

export function assertMatrixAdoptionBoundary(context: StorageMigrationFaultContext | undefined, index: number): void {
  assert.equal(context?.adoptionIndex, index);
  assert.equal(context?.inputLegacyRunCount, 3);
  assert.equal(context?.runId, ["run_a", "run_b", "run_c"][index]);
}

export function injectMatrixCondition(db: DatabaseSync, fixture: string, point: StorageMigrationFaultPoint): void {
  const constraint = {
    adoption_constraint_failure: ["sequence3_before_adoption_row_insert", "legacy_agent_run_adoptions_v1"],
    transform_application_constraint_failure: ["sequence3_before_transform_application_insert", "migration_transform_applications_v1"],
    applied_parent_constraint_failure: ["sequence3_before_applied_migration_insert", "applied_migrations"]
  }[fixture];
  if (constraint?.[0] === point) {
    db.exec(`CREATE TEMP TRIGGER matrix_reject BEFORE INSERT ON main."${constraint[1]}"
      BEGIN SELECT RAISE(ABORT, 'matrix constraint failure'); END`);
  }
  if (fixture === "schema_postcondition_mismatch" && point === "sequence3_after_user_version_set") {
    db.exec("CREATE TABLE matrix_unexpected_postcondition(id TEXT)");
  }
  if (fixture === "foreign_key_violation" && point === "sequence3_before_foreign_key_check") {
    db.exec("PRAGMA defer_foreign_keys = ON");
    db.prepare("UPDATE agent_runs SET project_id='matrix_missing_parent' WHERE id='run_a'").run();
  }
  if (fixture === "backup_failure" && point === "after_later_backup_owner_fsynced") {
    throw new Error("Matrix injection at owned backup boundary");
  }
}
