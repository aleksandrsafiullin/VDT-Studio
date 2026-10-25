import type { DatabaseSync } from "node:sqlite";

// Keep the ownership parents until their child-only guards have resolved the
// run. Foreign keys are deferred for the intentional coordinator/receipt cycles;
// SQLite still checks every remaining reference at the transaction's COMMIT.
const RUN_TABLES = [
  "agent_coordinator_effect_commits_v2",
  "agent_engine_checkpoints_v2",
  "agent_engine_exchange_receipts_v2",
  "agent_finish_receipts_v2",
  "agent_tool_operation_receipts_v2",
  "agent_run_event_outbox_v2",
  "agent_session_epochs_v2",
  "agent_session_bindings_v2",
  "agent_manual_resync_bases_v2",
  "agent_manual_operations_v2",
  "agent_manual_editing_sessions_v2",
  "agent_mutation_reconciliations_v2",
  "agent_w01_commit_bindings_v2",
  "agent_merge_records_v2",
  "agent_mutation_actions_v2",
  "agent_question_answers_v2",
  "agent_question_sets_v2",
  "agent_retry_records_v2",
  "agent_retry_budgets_v2",
  "agent_run_outbox_v2",
  "agent_run_effects_v2",
  "agent_tool_calls_v2",
  "agent_provider_decisions_v2",
  "agent_run_attempts_v2",
  "agent_run_commands_v2",
  "agent_run_preferences_v2",
  "agent_run_project_states_v2",
  "agent_run_feature_snapshots_v2",
  "agent_run_coordinators_v2",
  "legacy_agent_run_adoptions_v1"
] as const;

/** Must run inside the same transaction as the owning project's DELETE. */
export function deleteProjectAgentData(db: DatabaseSync, projectId: string, deletedAt: number): void {
  db.exec("PRAGMA defer_foreign_keys = ON;");
  db.prepare(`
    INSERT INTO project_deletion_runs_v1 (run_id, project_id)
    SELECT id, project_id FROM agent_runs WHERE project_id = ?
    UNION
    SELECT run_id, project_id FROM agent_run_coordinators_v2 WHERE project_id = ?
    UNION
    SELECT run_id, project_id FROM agent_session_bindings_v2 WHERE project_id = ?
  `).run(projectId, projectId, projectId);

  // Preserve only the migration's hashed membership evidence. The original
  // request, snapshots, session history and project data are actually deleted.
  db.prepare(`
    INSERT INTO project_deleted_legacy_adoptions_v1
      (run_id, database_id, migration_application_id, migration_sequence,
       project_id, legacy_row_hash, deleted_at)
    SELECT run_id, database_id, migration_application_id, migration_sequence,
           project_id, legacy_row_hash, ?
    FROM legacy_agent_run_adoptions_v1 WHERE project_id = ?
  `).run(deletedAt, projectId);

  const scopedRuns = "SELECT run_id FROM project_deletion_runs_v1 WHERE project_id = ?";
  db.prepare(`
    DELETE FROM agent_command_execution_bases_v2 WHERE attempt_id IN (
      SELECT attempt_id FROM agent_run_attempts_v2 WHERE run_id IN (${scopedRuns})
    )
  `).run(projectId);
  db.prepare(`
    DELETE FROM agent_mutation_approval_bases_v2 WHERE action_id IN (
      SELECT action_id FROM agent_mutation_actions_v2 WHERE run_id IN (${scopedRuns})
    )
  `).run(projectId);
  for (const table of RUN_TABLES) {
    db.prepare(`DELETE FROM ${table} WHERE run_id IN (${scopedRuns})`).run(projectId);
  }
  db.prepare(`
    DELETE FROM idempotency_records
    WHERE operation IN ('skill.read', 'skill.select') AND scope_id IN (${scopedRuns})
  `).run(projectId);
  db.prepare("DELETE FROM agent_runs WHERE project_id = ?").run(projectId);
  // Deleting the project cascades to the temporary scope rows. A failed COMMIT
  // rolls back the scopes, audit cleanup, migration hashes and project together.
}
