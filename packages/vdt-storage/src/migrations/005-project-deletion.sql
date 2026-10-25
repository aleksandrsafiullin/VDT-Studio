CREATE TABLE project_deletion_runs_v1 (
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
END;

DROP TRIGGER agent_command_execution_bases_immutable_delete;

CREATE TRIGGER agent_command_execution_bases_immutable_delete
BEFORE DELETE ON agent_command_execution_bases_v2
WHEN NOT EXISTS (
  SELECT 1 FROM project_deletion_runs_v1 WHERE run_id = (SELECT run_id FROM agent_run_attempts_v2 WHERE attempt_id = OLD.attempt_id)
)
BEGIN
  SELECT RAISE(ABORT, 'execution_basis_is_immutable');
END;

DROP TRIGGER agent_coordinator_effect_commits_immutable_delete;

CREATE TRIGGER agent_coordinator_effect_commits_immutable_delete
BEFORE DELETE ON agent_coordinator_effect_commits_v2
WHEN NOT EXISTS (
  SELECT 1 FROM project_deletion_runs_v1 WHERE run_id = OLD.run_id
)
BEGIN
  SELECT RAISE(ABORT, 'coordinator_effect_commit_is_durable');
END;

DROP TRIGGER agent_engine_checkpoints_v2_no_delete;

CREATE TRIGGER agent_engine_checkpoints_v2_no_delete
BEFORE DELETE ON agent_engine_checkpoints_v2
WHEN NOT EXISTS (
  SELECT 1 FROM project_deletion_runs_v1 WHERE run_id = OLD.run_id
)
BEGIN
  SELECT RAISE(ABORT, 'agent_engine_checkpoint_append_only');
END;

DROP TRIGGER agent_engine_exchange_receipts_v2_no_delete;

CREATE TRIGGER agent_engine_exchange_receipts_v2_no_delete
BEFORE DELETE ON agent_engine_exchange_receipts_v2
WHEN NOT EXISTS (
  SELECT 1 FROM project_deletion_runs_v1 WHERE run_id = OLD.run_id
)
BEGIN
  SELECT RAISE(ABORT, 'agent_engine_exchange_receipt_append_only');
END;

DROP TRIGGER agent_finish_receipts_v2_no_delete;

CREATE TRIGGER agent_finish_receipts_v2_no_delete
BEFORE DELETE ON agent_finish_receipts_v2
WHEN NOT EXISTS (
  SELECT 1 FROM project_deletion_runs_v1 WHERE run_id = OLD.run_id
)
BEGIN
  SELECT RAISE(ABORT, 'agent_finish_receipt_append_only');
END;

DROP TRIGGER agent_manual_editing_sessions_immutable_delete;

CREATE TRIGGER agent_manual_editing_sessions_immutable_delete
BEFORE DELETE ON agent_manual_editing_sessions_v2
WHEN NOT EXISTS (
  SELECT 1 FROM project_deletion_runs_v1 WHERE run_id = OLD.run_id
)
BEGIN
  SELECT RAISE(ABORT, 'manual_editing_session_is_durable');
END;

DROP TRIGGER agent_manual_operations_immutable_delete;

CREATE TRIGGER agent_manual_operations_immutable_delete
BEFORE DELETE ON agent_manual_operations_v2
WHEN NOT EXISTS (
  SELECT 1 FROM project_deletion_runs_v1 WHERE run_id = OLD.run_id
)
BEGIN
  SELECT RAISE(ABORT, 'manual_operation_is_immutable');
END;

DROP TRIGGER agent_manual_resync_bases_immutable_delete;

CREATE TRIGGER agent_manual_resync_bases_immutable_delete
BEFORE DELETE ON agent_manual_resync_bases_v2
WHEN NOT EXISTS (
  SELECT 1 FROM project_deletion_runs_v1 WHERE run_id = OLD.run_id
)
BEGIN
  SELECT RAISE(ABORT, 'manual_resync_basis_is_immutable');
END;

DROP TRIGGER agent_merge_records_immutable_delete;

CREATE TRIGGER agent_merge_records_immutable_delete
BEFORE DELETE ON agent_merge_records_v2
WHEN NOT EXISTS (
  SELECT 1 FROM project_deletion_runs_v1 WHERE run_id = OLD.run_id
)
BEGIN
  SELECT RAISE(ABORT, 'merge_record_is_durable');
END;

DROP TRIGGER agent_mutation_actions_immutable_delete;

CREATE TRIGGER agent_mutation_actions_immutable_delete
BEFORE DELETE ON agent_mutation_actions_v2
WHEN NOT EXISTS (
  SELECT 1 FROM project_deletion_runs_v1 WHERE run_id = OLD.run_id
)
BEGIN
  SELECT RAISE(ABORT, 'mutation_action_is_durable');
END;

DROP TRIGGER agent_mutation_approval_bases_immutable_delete;

CREATE TRIGGER agent_mutation_approval_bases_immutable_delete
BEFORE DELETE ON agent_mutation_approval_bases_v2
WHEN NOT EXISTS (
  SELECT 1 FROM project_deletion_runs_v1 WHERE run_id = (SELECT run_id FROM agent_mutation_actions_v2 WHERE action_id = OLD.action_id)
)
BEGIN
  SELECT RAISE(ABORT, 'approval_basis_is_immutable');
END;

DROP TRIGGER agent_mutation_reconciliations_immutable_delete;

CREATE TRIGGER agent_mutation_reconciliations_immutable_delete
BEFORE DELETE ON agent_mutation_reconciliations_v2
WHEN NOT EXISTS (
  SELECT 1 FROM project_deletion_runs_v1 WHERE run_id = OLD.run_id
)
BEGIN
  SELECT RAISE(ABORT, 'mutation_reconciliation_is_durable');
END;

DROP TRIGGER agent_provider_decisions_immutable_delete;

CREATE TRIGGER agent_provider_decisions_immutable_delete
BEFORE DELETE ON agent_provider_decisions_v2
WHEN NOT EXISTS (
  SELECT 1 FROM project_deletion_runs_v1 WHERE run_id = OLD.run_id
)
BEGIN
  SELECT RAISE(ABORT, 'provider_receipt_is_durable');
END;

DROP TRIGGER agent_question_answers_immutable_delete;

CREATE TRIGGER agent_question_answers_immutable_delete
BEFORE DELETE ON agent_question_answers_v2
WHEN NOT EXISTS (
  SELECT 1 FROM project_deletion_runs_v1 WHERE run_id = OLD.run_id
)
BEGIN
  SELECT RAISE(ABORT, 'question_answer_is_immutable');
END;

DROP TRIGGER agent_question_sets_immutable_delete;

CREATE TRIGGER agent_question_sets_immutable_delete
BEFORE DELETE ON agent_question_sets_v2
WHEN NOT EXISTS (
  SELECT 1 FROM project_deletion_runs_v1 WHERE run_id = OLD.run_id
)
BEGIN
  SELECT RAISE(ABORT, 'question_set_is_durable');
END;

DROP TRIGGER agent_retry_budgets_immutable_delete;

CREATE TRIGGER agent_retry_budgets_immutable_delete
BEFORE DELETE ON agent_retry_budgets_v2
WHEN NOT EXISTS (
  SELECT 1 FROM project_deletion_runs_v1 WHERE run_id = OLD.run_id
)
BEGIN
  SELECT RAISE(ABORT, 'retry_budget_is_durable');
END;

DROP TRIGGER agent_retry_records_immutable_delete;

CREATE TRIGGER agent_retry_records_immutable_delete
BEFORE DELETE ON agent_retry_records_v2
WHEN NOT EXISTS (
  SELECT 1 FROM project_deletion_runs_v1 WHERE run_id = OLD.run_id
)
BEGIN
  SELECT RAISE(ABORT, 'retry_record_is_durable');
END;

DROP TRIGGER agent_run_attempts_immutable_delete;

CREATE TRIGGER agent_run_attempts_immutable_delete
BEFORE DELETE ON agent_run_attempts_v2
WHEN NOT EXISTS (
  SELECT 1 FROM project_deletion_runs_v1 WHERE run_id = OLD.run_id
)
BEGIN
  SELECT RAISE(ABORT, 'run_attempt_is_durable');
END;

DROP TRIGGER agent_run_commands_immutable_delete;

CREATE TRIGGER agent_run_commands_immutable_delete
BEFORE DELETE ON agent_run_commands_v2
WHEN NOT EXISTS (
  SELECT 1 FROM project_deletion_runs_v1 WHERE run_id = OLD.run_id
)
BEGIN
  SELECT RAISE(ABORT, 'run_command_is_durable');
END;

DROP TRIGGER agent_run_coordinators_immutable_delete;

CREATE TRIGGER agent_run_coordinators_immutable_delete
BEFORE DELETE ON agent_run_coordinators_v2
WHEN NOT EXISTS (
  SELECT 1 FROM project_deletion_runs_v1 WHERE run_id = OLD.run_id
)
BEGIN
  SELECT RAISE(ABORT, 'run_coordinator_is_durable');
END;

DROP TRIGGER agent_run_effects_immutable_delete;

CREATE TRIGGER agent_run_effects_immutable_delete
BEFORE DELETE ON agent_run_effects_v2
WHEN NOT EXISTS (
  SELECT 1 FROM project_deletion_runs_v1 WHERE run_id = OLD.run_id
)
BEGIN
  SELECT RAISE(ABORT, 'run_effect_is_immutable');
END;

DROP TRIGGER agent_run_event_outbox_v2_no_delete;

CREATE TRIGGER agent_run_event_outbox_v2_no_delete
BEFORE DELETE ON agent_run_event_outbox_v2
WHEN NOT EXISTS (
  SELECT 1 FROM project_deletion_runs_v1 WHERE run_id = OLD.run_id
)
BEGIN
  SELECT RAISE(ABORT, 'agent_run_event_append_only');
END;

DROP TRIGGER agent_run_feature_snapshots_immutable_delete;

CREATE TRIGGER agent_run_feature_snapshots_immutable_delete
BEFORE DELETE ON agent_run_feature_snapshots_v2
WHEN NOT EXISTS (
  SELECT 1 FROM project_deletion_runs_v1 WHERE run_id = OLD.run_id
)
BEGIN
  SELECT RAISE(ABORT, 'feature_snapshot_is_immutable');
END;

DROP TRIGGER agent_run_outbox_immutable_delete;

CREATE TRIGGER agent_run_outbox_immutable_delete
BEFORE DELETE ON agent_run_outbox_v2
WHEN NOT EXISTS (
  SELECT 1 FROM project_deletion_runs_v1 WHERE run_id = OLD.run_id
)
BEGIN
  SELECT RAISE(ABORT, 'outbox_event_is_immutable');
END;

DROP TRIGGER agent_run_preferences_immutable_delete;

CREATE TRIGGER agent_run_preferences_immutable_delete
BEFORE DELETE ON agent_run_preferences_v2
WHEN NOT EXISTS (
  SELECT 1 FROM project_deletion_runs_v1 WHERE run_id = OLD.run_id
)
BEGIN
  SELECT RAISE(ABORT, 'run_preference_is_immutable');
END;

DROP TRIGGER agent_run_project_states_immutable_delete;

CREATE TRIGGER agent_run_project_states_immutable_delete
BEFORE DELETE ON agent_run_project_states_v2
WHEN NOT EXISTS (
  SELECT 1 FROM project_deletion_runs_v1 WHERE run_id = OLD.run_id
)
BEGIN
  SELECT RAISE(ABORT, 'run_project_state_is_durable');
END;

DROP TRIGGER agent_session_bindings_v2_no_delete;

CREATE TRIGGER agent_session_bindings_v2_no_delete
BEFORE DELETE ON agent_session_bindings_v2
WHEN NOT EXISTS (
  SELECT 1 FROM project_deletion_runs_v1 WHERE run_id = OLD.run_id
)
BEGIN
  SELECT RAISE(ABORT, 'agent_session_binding_append_only');
END;

DROP TRIGGER agent_session_epochs_v2_no_delete;

CREATE TRIGGER agent_session_epochs_v2_no_delete
BEFORE DELETE ON agent_session_epochs_v2
WHEN NOT EXISTS (
  SELECT 1 FROM project_deletion_runs_v1 WHERE run_id = OLD.run_id
)
BEGIN
  SELECT RAISE(ABORT, 'agent_session_epoch_append_only');
END;

DROP TRIGGER agent_tool_calls_immutable_delete;

CREATE TRIGGER agent_tool_calls_immutable_delete
BEFORE DELETE ON agent_tool_calls_v2
WHEN NOT EXISTS (
  SELECT 1 FROM project_deletion_runs_v1 WHERE run_id = OLD.run_id
)
BEGIN
  SELECT RAISE(ABORT, 'tool_receipt_is_durable');
END;

DROP TRIGGER agent_tool_operation_receipts_v2_no_delete;

CREATE TRIGGER agent_tool_operation_receipts_v2_no_delete
BEFORE DELETE ON agent_tool_operation_receipts_v2
WHEN NOT EXISTS (
  SELECT 1 FROM project_deletion_runs_v1 WHERE run_id = OLD.run_id
)
BEGIN
  SELECT RAISE(ABORT, 'agent_tool_operation_receipt_append_only');
END;

DROP TRIGGER agent_w01_commit_bindings_immutable_delete;

CREATE TRIGGER agent_w01_commit_bindings_immutable_delete
BEFORE DELETE ON agent_w01_commit_bindings_v2
WHEN NOT EXISTS (
  SELECT 1 FROM project_deletion_runs_v1 WHERE run_id = OLD.run_id
)
BEGIN
  SELECT RAISE(ABORT, 'w01_binding_is_durable');
END;

DROP TRIGGER legacy_agent_run_adoptions_immutable_delete;

CREATE TRIGGER legacy_agent_run_adoptions_immutable_delete
BEFORE DELETE ON legacy_agent_run_adoptions_v1
WHEN NOT EXISTS (
  SELECT 1 FROM project_deletion_runs_v1 WHERE run_id = OLD.run_id
) OR NOT EXISTS (
  SELECT 1 FROM project_deleted_legacy_adoptions_v1 AS deleted
  WHERE deleted.run_id = OLD.run_id AND deleted.project_id = OLD.project_id
    AND deleted.database_id = OLD.database_id
    AND deleted.migration_application_id = OLD.migration_application_id
    AND deleted.migration_sequence = OLD.migration_sequence
    AND deleted.legacy_row_hash = OLD.legacy_row_hash
)
BEGIN
  SELECT RAISE(ABORT, 'legacy_adoption_is_immutable');
END;
