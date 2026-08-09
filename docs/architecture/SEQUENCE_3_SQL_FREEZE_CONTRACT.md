# Sequence-3 SQL Freeze Contract

Status: **proposed SQL-half closure; not a production migration**

This addendum freezes the SQL half of the design-reserved migration
`003-durable-agent-run-coordination`. It is deliberately separate from the
future repository artifact. Nothing in this file adds sequence 3 to the
manifest, authorizes Gate R2, enables a feature, adopts data, or changes a
running database.

## Proposed technical closures

The accepted logical contract does not choose every physical column, index,
foreign-key action, or trigger body. The SQL below closes those choices
normatively for storage review:

1. Nested and discriminated values whose members are not relational join keys
   are stored in one explicitly named `*_canonical_json TEXT` column. The
   runner/runtime must strict-decode, reject unknown keys, RFC 8785 serialize,
   and byte-compare before writing. Discriminators and every value used by a
   CHECK, FK, UNIQUE constraint, fence, queue, or recovery scan are separate
   snake-case columns.
2. `AgentRunCoordinatorV1` does not expose `featureConfigHash`, although the
   accepted relational prose requires the coordinator and immutable feature
   snapshot to share the start config version/hash. The physical coordinator
   therefore adds `feature_config_hash`.
3. `MigrationTransformApplicationV1` does not expose its migration-attempt
   fence. The physical transform-application row therefore adds
   `migration_attempt_id`, `backup_evidence_id`, `fence_owner_token`,
   `fence_lease_generation`, `target_manifest_hash`, and `sql_checksum`.
   Composite FKs and triggers bind them to the exact already-durable attempt,
   backup, target manifest, and SQL artifact.
   `migration_application_id` is deterministic:
   `"migration_application_" + hashFramed(...).slice("sha256:".length)`.
   The framing is domain `vdt-studio/migration-application-identity`, schema
   `migration_application_identity_hash.v1`, metadata exactly
   `{schemaVersion:"migration_application_identity.v1",databaseId,attemptId,
   backupEvidenceId,fenceOwnerToken,fenceLeaseGeneration,targetManifestHash,
   sequence:3,migrationId:"003-durable-agent-run-coordination",sqlChecksum,
   transformId:"legacy-agent-run-adoption-v1",transformVersion:1,
   moduleChecksum,contractChecksum,goldenVectorsChecksum}`, and an empty body.
   The runner recomputes it before any write; SQLite constrains its
   prefix/hex shape and cross-row use.
4. SQLite cannot add a table-level UNIQUE constraint to the existing
   `applied_migrations` table. The exact parent key is therefore the unique
   index `applied_migrations_database_application_sequence_uq`; SQLite accepts
   that index as the parent key of the deferred composite FK.
5. Logical state transitions still require storage-owned compare-and-set
   statements. SQL enforces closed state sets, terminal shapes, cross-row
   identity, append-only evidence, and the most important monotonic
   transitions; it does not pretend that a CHECK can recompute a framed hash.

These are proposed technical closures, not changes to the product semantics.
An independent freeze review must STOP on any disagreement and require a
revised contract before artifact generation.

## Byte policy

The future file name is exactly
`packages/vdt-storage/src/migrations/003-durable-agent-run-coordination.sql`.
Its bytes are the UTF-8 encoding of the complete SQL code block below:

- no UTF-8 BOM;
- LF (`0x0a`) line endings only;
- no CR bytes;
- ASCII spaces for indentation, with no tab bytes or trailing spaces;
- exactly one final LF after the last semicolon;
- no bytes before the first `CREATE UNIQUE INDEX`;
- no SQL comments in the generated artifact.

The Markdown fence and this prose are not artifact bytes. The freeze generator
must extract the block body verbatim and prove re-encoding equality before
computing `sqlChecksum`.

## Physical scalar conventions

- IDs, enum literals, schema versions, hashes, and canonical JSON use SQLite
  `TEXT`. A `Sha256` is exactly `sha256:` plus 64 lowercase hexadecimal
  characters.
- All timestamps are Unix epoch milliseconds in SQLite `INTEGER`,
  `0..9007199254740991`. No timestamp is stored as ISO text.
- TypeScript booleans are SQLite `INTEGER` constrained to `IN (0, 1)`.
- Counters, versions, sequences, lengths, and basis points are SQLite
  `INTEGER`; each CHECK supplies the accepted non-negative or positive range.
- Nullable means SQL `NULL`. Empty strings never stand in for null.
- `*_canonical_json` preserves the exact validated RFC 8785 text. Legacy raw
  JSON is not copied into V2 tables; only its byte attestations are stored in
  `legacy_agent_run_adoptions_v1`.
- Every new table is `STRICT`. No `ANY`, `REAL`, or `BLOB` column is used.
- FK actions are explicit. Durable retention is uniform: project, VDT, run,
  command, attempt, and evidence parents use `ON UPDATE RESTRICT ON DELETE
  RESTRICT`. A project or VDT cannot be deleted while any V2 run/audit row
  references it. Nullable VDT columns describe pre-publication state; deletion
  never rewrites them to null.

Stock SQLite SHA-256 functions are not assumed. Adoption triggers prove source
storage classes, exact nullness, IDs, status, phase bytes, timestamp values,
and raw JSON byte lengths available to SQLite. The verified host transform
must independently recompute and revalidate each raw JSON SHA-256,
`original_phase_raw_utf8_hash`, `legacy_row_hash`, and
`transform_result_hash` from the exact BLOB reads before its bound INSERTs.
The SQL never claims to recompute a cryptographic hash.

## Exact SQL

```sql
CREATE UNIQUE INDEX applied_migrations_database_application_sequence_uq
ON applied_migrations(database_id ASC, application_id ASC, sequence ASC);

CREATE UNIQUE INDEX migration_attempts_sequence3_fence_uq
ON migration_attempts(database_id ASC, attempt_id ASC, backup_evidence_id ASC, target_manifest_hash ASC, owner_token ASC, lease_generation ASC);

CREATE UNIQUE INDEX migration_backup_evidence_sequence3_binding_uq
ON migration_backup_evidence(database_id ASC, backup_evidence_id ASC, manifest_hash ASC);

CREATE TABLE agent_run_coordinators_v2 (
  run_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL CHECK(schema_version = 'agent_run_coordinator.v1'),
  project_id TEXT NOT NULL,
  vdt_id TEXT,
  creator_principal_id TEXT NOT NULL CHECK(length(creator_principal_id) > 0),
  creator_auth_source TEXT NOT NULL CHECK(creator_auth_source IN ('desktop_local', 'hosted_session')),
  runtime_generation TEXT NOT NULL CHECK(runtime_generation IN ('v1', 'v2')),
  generation_version INTEGER NOT NULL CHECK(generation_version >= 0 AND generation_version <= 9007199254740991),
  feature_snapshot_hash TEXT NOT NULL CHECK(length(feature_snapshot_hash) = 71 AND substr(feature_snapshot_hash, 1, 7) = 'sha256:' AND substr(feature_snapshot_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  feature_config_version INTEGER NOT NULL CHECK(feature_config_version >= 0 AND feature_config_version <= 9007199254740991),
  feature_config_hash TEXT NOT NULL CHECK(length(feature_config_hash) = 71 AND substr(feature_config_hash, 1, 7) = 'sha256:' AND substr(feature_config_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  active_preference_version INTEGER NOT NULL CHECK(active_preference_version >= 1 AND active_preference_version <= 9007199254740991),
  active_preference_hash TEXT NOT NULL CHECK(length(active_preference_hash) = 71 AND substr(active_preference_hash, 1, 7) = 'sha256:' AND substr(active_preference_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  provider_binding_id TEXT NOT NULL CHECK(length(provider_binding_id) > 0),
  provider_id TEXT NOT NULL CHECK(length(provider_id) > 0),
  provider_model TEXT NOT NULL CHECK(length(provider_model) > 0),
  provider_settings_hash TEXT NOT NULL CHECK(length(provider_settings_hash) = 71 AND substr(provider_settings_hash, 1, 7) = 'sha256:' AND substr(provider_settings_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  run_state_version INTEGER NOT NULL CHECK(run_state_version >= 0 AND run_state_version <= 9007199254740991),
  execution_epoch INTEGER NOT NULL CHECK(execution_epoch >= 0 AND execution_epoch <= 9007199254740991),
  lease_generation INTEGER NOT NULL CHECK(lease_generation >= 0 AND lease_generation <= 9007199254740991),
  status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'waiting_user', 'waiting_approval', 'retry_wait', 'merge_required', 'cancelling', 'interrupted', 'interrupted_legacy', 'succeeded', 'failed', 'cancelled')),
  phase TEXT NOT NULL CHECK(length(phase) > 0),
  command_head_sequence INTEGER NOT NULL CHECK(command_head_sequence >= 0 AND command_head_sequence <= 9007199254740991),
  last_completed_command_sequence INTEGER NOT NULL CHECK(last_completed_command_sequence >= 0 AND last_completed_command_sequence <= command_head_sequence),
  outbox_head_sequence INTEGER NOT NULL CHECK(outbox_head_sequence >= 0 AND outbox_head_sequence <= 9007199254740991),
  outbox_head_hash TEXT CHECK(outbox_head_hash IS NULL OR (length(outbox_head_hash) = 71 AND substr(outbox_head_hash, 1, 7) = 'sha256:' AND substr(outbox_head_hash, 8) NOT GLOB '*[^0-9a-f]*')),
  manual_operation_head_sequence INTEGER NOT NULL CHECK(manual_operation_head_sequence >= 0 AND manual_operation_head_sequence <= 9007199254740991),
  manual_operation_head_hash TEXT CHECK(manual_operation_head_hash IS NULL OR (length(manual_operation_head_hash) = 71 AND substr(manual_operation_head_hash, 1, 7) = 'sha256:' AND substr(manual_operation_head_hash, 8) NOT GLOB '*[^0-9a-f]*')),
  processed_manual_operation_sequence INTEGER NOT NULL CHECK(processed_manual_operation_sequence = manual_operation_head_sequence),
  processed_manual_operation_hash TEXT CHECK(processed_manual_operation_hash IS manual_operation_head_hash),
  active_attempt_id TEXT,
  active_mutation_action_id TEXT,
  active_reconciliation_id TEXT,
  active_question_set_id TEXT,
  turn_budget_epoch INTEGER NOT NULL CHECK(turn_budget_epoch >= 1 AND turn_budget_epoch <= 9007199254740991),
  turn_budget_limit INTEGER NOT NULL CHECK(turn_budget_limit BETWEEN 1 AND 30),
  turns_consumed INTEGER NOT NULL CHECK(turns_consumed BETWEEN 0 AND turn_budget_limit),
  retry_budget_epoch INTEGER NOT NULL CHECK(retry_budget_epoch >= 1 AND retry_budget_epoch <= 9007199254740991),
  automatic_retry_window_started_at INTEGER CHECK(automatic_retry_window_started_at IS NULL OR automatic_retry_window_started_at BETWEEN 0 AND 9007199254740991),
  cancel_requested_at INTEGER CHECK(cancel_requested_at IS NULL OR cancel_requested_at BETWEEN 0 AND 9007199254740991),
  created_at INTEGER NOT NULL CHECK(created_at BETWEEN 0 AND 9007199254740991),
  updated_at INTEGER NOT NULL CHECK(updated_at BETWEEN created_at AND 9007199254740991),
  completed_at INTEGER CHECK(completed_at IS NULL OR completed_at BETWEEN created_at AND updated_at),
  CHECK((outbox_head_sequence = 0 AND outbox_head_hash IS NULL) OR (outbox_head_sequence > 0 AND outbox_head_hash IS NOT NULL)),
  CHECK((manual_operation_head_sequence = 0 AND manual_operation_head_hash IS NULL) OR (manual_operation_head_sequence > 0 AND manual_operation_head_hash IS NOT NULL)),
  CHECK((status IN ('succeeded', 'failed', 'cancelled', 'interrupted_legacy') AND completed_at IS NOT NULL) OR (status NOT IN ('succeeded', 'failed', 'cancelled', 'interrupted_legacy') AND completed_at IS NULL)),
  UNIQUE(run_id, feature_snapshot_hash, feature_config_version, feature_config_hash, project_id, runtime_generation, generation_version),
  UNIQUE(run_id, project_id),
  UNIQUE(run_id, active_preference_version, active_preference_hash),
  UNIQUE(run_id, provider_binding_id, provider_id, provider_model, provider_settings_hash),
  UNIQUE(run_id, retry_budget_epoch),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(vdt_id) REFERENCES vdts(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id, feature_snapshot_hash, feature_config_version, feature_config_hash, project_id, runtime_generation, generation_version) REFERENCES agent_run_feature_snapshots_v2(run_id, snapshot_hash, config_version, config_hash, project_id, runtime_generation, generation_version) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(run_id, active_attempt_id) REFERENCES agent_run_attempts_v2(run_id, attempt_id) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(run_id, active_mutation_action_id) REFERENCES agent_mutation_actions_v2(run_id, action_id) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(run_id, active_reconciliation_id) REFERENCES agent_mutation_reconciliations_v2(run_id, reconciliation_id) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(run_id, active_question_set_id) REFERENCES agent_question_sets_v2(run_id, question_set_id) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(run_id, active_preference_version, active_preference_hash) REFERENCES agent_run_preferences_v2(run_id, preference_version, preference_hash) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(run_id, retry_budget_epoch) REFERENCES agent_retry_budgets_v2(run_id, retry_budget_epoch) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE agent_run_feature_snapshots_v2 (
  run_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL CHECK(schema_version = 'run_feature_snapshot.v1'),
  project_id TEXT NOT NULL,
  config_version INTEGER NOT NULL CHECK(config_version >= 0 AND config_version <= 9007199254740991),
  config_hash TEXT NOT NULL CHECK(length(config_hash) = 71 AND substr(config_hash, 1, 7) = 'sha256:' AND substr(config_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  dependency_graph_version TEXT NOT NULL CHECK(length(dependency_graph_version) > 0),
  runtime_generation TEXT NOT NULL CHECK(runtime_generation IN ('v1', 'v2')),
  generation_version INTEGER NOT NULL CHECK(generation_version >= 0 AND generation_version <= 9007199254740991),
  flag_orchestrator_v2 INTEGER NOT NULL CHECK(flag_orchestrator_v2 IN (0, 1)),
  flag_agent_skill_resolution_v2 INTEGER NOT NULL CHECK(flag_agent_skill_resolution_v2 IN (0, 1)),
  flag_metric_model_v2 INTEGER NOT NULL CHECK(flag_metric_model_v2 IN (0, 1)),
  flag_evidence_v2 INTEGER NOT NULL CHECK(flag_evidence_v2 IN (0, 1)),
  flag_benchmark_v2 INTEGER NOT NULL CHECK(flag_benchmark_v2 IN (0, 1)),
  flag_metric_binding_v2 INTEGER NOT NULL CHECK(flag_metric_binding_v2 IN (0, 1)),
  flag_data_ingestion_v2 INTEGER NOT NULL CHECK(flag_data_ingestion_v2 IN (0, 1)),
  flag_external_research INTEGER NOT NULL CHECK(flag_external_research IN (0, 1)),
  flag_autonomous_mutations INTEGER NOT NULL CHECK(flag_autonomous_mutations IN (0, 1)),
  bucket_orchestrator_v2 INTEGER NOT NULL CHECK(bucket_orchestrator_v2 BETWEEN 0 AND 9999),
  bucket_agent_skill_resolution_v2 INTEGER NOT NULL CHECK(bucket_agent_skill_resolution_v2 BETWEEN 0 AND 9999),
  bucket_metric_model_v2 INTEGER NOT NULL CHECK(bucket_metric_model_v2 BETWEEN 0 AND 9999),
  bucket_evidence_v2 INTEGER NOT NULL CHECK(bucket_evidence_v2 BETWEEN 0 AND 9999),
  bucket_benchmark_v2 INTEGER NOT NULL CHECK(bucket_benchmark_v2 BETWEEN 0 AND 9999),
  bucket_metric_binding_v2 INTEGER NOT NULL CHECK(bucket_metric_binding_v2 BETWEEN 0 AND 9999),
  bucket_data_ingestion_v2 INTEGER NOT NULL CHECK(bucket_data_ingestion_v2 BETWEEN 0 AND 9999),
  bucket_external_research INTEGER NOT NULL CHECK(bucket_external_research BETWEEN 0 AND 9999),
  bucket_autonomous_mutations INTEGER NOT NULL CHECK(bucket_autonomous_mutations BETWEEN 0 AND 9999),
  project_assignment_hash TEXT NOT NULL CHECK(length(project_assignment_hash) = 71 AND substr(project_assignment_hash, 1, 7) = 'sha256:' AND substr(project_assignment_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  snapshot_hash TEXT NOT NULL UNIQUE CHECK(length(snapshot_hash) = 71 AND substr(snapshot_hash, 1, 7) = 'sha256:' AND substr(snapshot_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  captured_at INTEGER NOT NULL CHECK(captured_at BETWEEN 0 AND 9007199254740991),
  UNIQUE(run_id, snapshot_hash, config_version, config_hash, project_id, runtime_generation, generation_version),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id) REFERENCES agent_run_coordinators_v2(run_id) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(run_id, project_id) REFERENCES agent_run_coordinators_v2(run_id, project_id) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE agent_run_preferences_v2 (
  run_id TEXT NOT NULL,
  preference_version INTEGER NOT NULL CHECK(preference_version >= 1 AND preference_version <= 9007199254740991),
  schema_version TEXT NOT NULL CHECK(schema_version = 'agent_run_preference_record.v1'),
  source_command_id TEXT NOT NULL UNIQUE,
  max_auto_depth INTEGER NOT NULL CHECK(max_auto_depth BETWEEN 1 AND 8),
  continue_with_assumptions INTEGER NOT NULL CHECK(continue_with_assumptions IN (0, 1)),
  requested_research_mode TEXT NOT NULL CHECK(requested_research_mode IN ('auto', 'on', 'off')),
  previous_preference_hash TEXT CHECK(previous_preference_hash IS NULL OR (length(previous_preference_hash) = 71 AND substr(previous_preference_hash, 1, 7) = 'sha256:' AND substr(previous_preference_hash, 8) NOT GLOB '*[^0-9a-f]*')),
  preference_hash TEXT NOT NULL CHECK(length(preference_hash) = 71 AND substr(preference_hash, 1, 7) = 'sha256:' AND substr(preference_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  created_at INTEGER NOT NULL CHECK(created_at BETWEEN 0 AND 9007199254740991),
  PRIMARY KEY(run_id, preference_version),
  UNIQUE(run_id, preference_hash),
  UNIQUE(run_id, preference_version, preference_hash),
  FOREIGN KEY(run_id) REFERENCES agent_run_coordinators_v2(run_id) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(source_command_id) REFERENCES agent_run_commands_v2(command_id) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(run_id, source_command_id) REFERENCES agent_run_commands_v2(run_id, command_id) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CHECK((preference_version = 1 AND previous_preference_hash IS NULL) OR (preference_version > 1 AND previous_preference_hash IS NOT NULL))
) STRICT;

CREATE TABLE agent_run_commands_v2 (
  command_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL CHECK(schema_version = 'agent_run_command.v1'),
  run_id TEXT NOT NULL,
  scope_id TEXT NOT NULL CHECK(length(scope_id) > 0),
  project_id TEXT NOT NULL,
  actor_principal_id TEXT NOT NULL CHECK(length(actor_principal_id) > 0),
  actor_auth_source TEXT NOT NULL CHECK(actor_auth_source IN ('desktop_local', 'hosted_session', 'internal_coordinator')),
  command_sequence INTEGER NOT NULL CHECK(command_sequence >= 1 AND command_sequence <= 9007199254740991),
  kind TEXT NOT NULL CHECK(kind IN ('start', 'instruction', 'answer', 'approval', 'manual_operation', 'merge_resolution', 'retry', 'cancel', 'drive_run')),
  operation TEXT NOT NULL CHECK(operation = 'agent_run.' || kind),
  idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) > 0),
  request_hash TEXT NOT NULL CHECK(length(request_hash) = 71 AND substr(request_hash, 1, 7) = 'sha256:' AND substr(request_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  observed_run_state_version INTEGER CHECK(observed_run_state_version IS NULL OR observed_run_state_version BETWEEN 0 AND 9007199254740991),
  observed_execution_epoch INTEGER NOT NULL CHECK(observed_execution_epoch BETWEEN 0 AND 9007199254740991),
  payload_type TEXT NOT NULL CHECK(payload_type = kind),
  payload_canonical_json TEXT NOT NULL CHECK(length(payload_canonical_json) > 0 AND json_valid(payload_canonical_json)),
  predecessor_command_id TEXT,
  predecessor_result_hash TEXT CHECK(predecessor_result_hash IS NULL OR (length(predecessor_result_hash) = 71 AND substr(predecessor_result_hash, 1, 7) = 'sha256:' AND substr(predecessor_result_hash, 8) NOT GLOB '*[^0-9a-f]*')),
  initiating_external_command_id TEXT,
  initiating_actor_principal_id TEXT,
  initiating_actor_auth_source TEXT CHECK(initiating_actor_auth_source IS NULL OR initiating_actor_auth_source IN ('desktop_local', 'hosted_session')),
  turn_number INTEGER CHECK(turn_number IS NULL OR turn_number BETWEEN 1 AND 9007199254740991),
  status TEXT NOT NULL CHECK(status IN ('queued', 'claimed', 'reconciliation_pending', 'succeeded', 'rejected', 'superseded', 'cancelled')),
  claimed_attempt_id TEXT,
  terminal_code TEXT,
  terminal_result_schema_version TEXT,
  terminal_result_canonical_json TEXT CHECK(terminal_result_canonical_json IS NULL OR json_valid(terminal_result_canonical_json)),
  terminal_result_hash TEXT CHECK(terminal_result_hash IS NULL OR (length(terminal_result_hash) = 71 AND substr(terminal_result_hash, 1, 7) = 'sha256:' AND substr(terminal_result_hash, 8) NOT GLOB '*[^0-9a-f]*')),
  enqueued_at INTEGER NOT NULL CHECK(enqueued_at BETWEEN 0 AND 9007199254740991),
  completed_at INTEGER CHECK(completed_at IS NULL OR completed_at BETWEEN enqueued_at AND 9007199254740991),
  UNIQUE(run_id, command_sequence),
  UNIQUE(scope_id, operation, idempotency_key),
  UNIQUE(run_id, command_id, command_sequence),
  UNIQUE(run_id, command_id),
  UNIQUE(run_id, project_id, command_id),
  UNIQUE(run_id, project_id, command_id, command_sequence),
  FOREIGN KEY(run_id) REFERENCES agent_run_coordinators_v2(run_id) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id, project_id) REFERENCES agent_run_coordinators_v2(run_id, project_id) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(claimed_attempt_id) REFERENCES agent_run_attempts_v2(attempt_id) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(run_id, project_id, claimed_attempt_id) REFERENCES agent_run_attempts_v2(run_id, project_id, attempt_id) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(run_id, project_id, claimed_attempt_id, command_id) REFERENCES agent_run_attempts_v2(run_id, project_id, attempt_id, command_id) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(predecessor_command_id) REFERENCES agent_run_commands_v2(command_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(initiating_external_command_id) REFERENCES agent_run_commands_v2(command_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id, project_id, predecessor_command_id) REFERENCES agent_run_commands_v2(run_id, project_id, command_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id, project_id, initiating_external_command_id) REFERENCES agent_run_commands_v2(run_id, project_id, command_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK((kind = 'start' AND observed_run_state_version IS NULL AND observed_execution_epoch = 0) OR (kind <> 'start' AND observed_run_state_version IS NOT NULL)),
  CHECK((kind = 'start' AND scope_id = project_id) OR (kind <> 'start' AND scope_id = run_id)),
  CHECK((kind = 'drive_run' AND actor_principal_id = 'vdt_studio_internal_coordinator' AND actor_auth_source = 'internal_coordinator' AND predecessor_command_id IS NOT NULL AND predecessor_result_hash IS NOT NULL AND initiating_external_command_id IS NOT NULL AND initiating_actor_principal_id IS NOT NULL AND initiating_actor_auth_source IS NOT NULL AND turn_number IS NOT NULL) OR (kind <> 'drive_run' AND actor_auth_source <> 'internal_coordinator' AND predecessor_command_id IS NULL AND predecessor_result_hash IS NULL AND initiating_external_command_id IS NULL AND initiating_actor_principal_id IS NULL AND initiating_actor_auth_source IS NULL AND turn_number IS NULL)),
  CHECK(kind NOT IN ('manual_operation', 'cancel') OR claimed_attempt_id IS NULL),
  CHECK(terminal_code NOT IN ('INTERACTION_RESOLUTION_REQUIRED', 'INTERACTION_ACTIVE', 'STALE_QUESTION_SET', 'QUESTION_SET_ALREADY_ANSWERED', 'MERGE_STATE_CONFLICT') OR claimed_attempt_id IS NULL),
  CHECK(terminal_code <> 'INTERACTION_ACTIVE' OR (kind = 'drive_run' AND status = 'superseded')),
  CHECK(terminal_code NOT IN ('STALE_QUESTION_SET', 'QUESTION_SET_ALREADY_ANSWERED') OR (kind = 'answer' AND status = 'rejected')),
  CHECK(terminal_code <> 'MERGE_STATE_CONFLICT' OR (kind = 'merge_resolution' AND status = 'rejected')),
  CHECK(terminal_code <> 'INTERACTION_RESOLUTION_REQUIRED' OR (kind IN ('instruction', 'answer', 'approval', 'merge_resolution', 'retry') AND status = 'rejected')),
  CHECK((status IN ('queued', 'claimed', 'reconciliation_pending') AND completed_at IS NULL AND terminal_result_hash IS NULL) OR (status IN ('succeeded', 'rejected', 'superseded', 'cancelled') AND completed_at IS NOT NULL AND terminal_result_schema_version IS NOT NULL AND terminal_result_canonical_json IS NOT NULL AND terminal_result_hash IS NOT NULL)),
  CHECK((terminal_result_canonical_json IS NULL AND terminal_result_schema_version IS NULL AND terminal_result_hash IS NULL) OR (terminal_result_canonical_json IS NOT NULL AND terminal_result_schema_version IS NOT NULL AND terminal_result_hash IS NOT NULL))
) STRICT;

CREATE UNIQUE INDEX agent_run_commands_one_queued_drive_uq
ON agent_run_commands_v2(run_id ASC)
WHERE kind = 'drive_run' AND status = 'queued';

CREATE INDEX agent_run_commands_claim_order_idx
ON agent_run_commands_v2(run_id ASC, status ASC, command_sequence ASC);

CREATE TABLE agent_command_execution_bases_v2 (
  attempt_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL CHECK(schema_version = 'agent_command_execution_basis.v1'),
  command_id TEXT NOT NULL,
  work_command_id TEXT NOT NULL,
  run_state_version_at_claim INTEGER NOT NULL CHECK(run_state_version_at_claim BETWEEN 0 AND 9007199254740991),
  execution_epoch_at_claim INTEGER NOT NULL CHECK(execution_epoch_at_claim BETWEEN 0 AND 9007199254740991),
  status_at_claim TEXT NOT NULL CHECK(status_at_claim IN ('queued', 'running', 'waiting_user', 'waiting_approval', 'retry_wait', 'merge_required', 'cancelling', 'interrupted', 'interrupted_legacy', 'succeeded', 'failed', 'cancelled')),
  active_question_set_id_at_claim TEXT,
  active_mutation_action_id_at_claim TEXT,
  project_content_scheme_at_claim TEXT CHECK(project_content_scheme_at_claim IS NULL OR project_content_scheme_at_claim IN ('legacy_graph_sha256', 'vdt_revision_payload_hash.v1')),
  project_content_hash_at_claim TEXT CHECK(project_content_hash_at_claim IS NULL OR (length(project_content_hash_at_claim) = 71 AND substr(project_content_hash_at_claim, 1, 7) = 'sha256:' AND substr(project_content_hash_at_claim, 8) NOT GLOB '*[^0-9a-f]*')),
  manual_operation_head_sequence_at_claim INTEGER NOT NULL CHECK(manual_operation_head_sequence_at_claim BETWEEN 0 AND 9007199254740991),
  manual_operation_head_hash_at_claim TEXT CHECK(manual_operation_head_hash_at_claim IS NULL OR (length(manual_operation_head_hash_at_claim) = 71 AND substr(manual_operation_head_hash_at_claim, 1, 7) = 'sha256:' AND substr(manual_operation_head_hash_at_claim, 8) NOT GLOB '*[^0-9a-f]*')),
  execution_basis_hash TEXT NOT NULL CHECK(length(execution_basis_hash) = 71 AND substr(execution_basis_hash, 1, 7) = 'sha256:' AND substr(execution_basis_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  claimed_at INTEGER NOT NULL CHECK(claimed_at BETWEEN 0 AND 9007199254740991),
  FOREIGN KEY(attempt_id) REFERENCES agent_run_attempts_v2(attempt_id) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(attempt_id, command_id, work_command_id) REFERENCES agent_run_attempts_v2(attempt_id, command_id, work_command_id) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(command_id) REFERENCES agent_run_commands_v2(command_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(work_command_id) REFERENCES agent_run_commands_v2(command_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(active_question_set_id_at_claim) REFERENCES agent_question_sets_v2(question_set_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(active_mutation_action_id_at_claim) REFERENCES agent_mutation_actions_v2(action_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK((project_content_scheme_at_claim IS NULL AND project_content_hash_at_claim IS NULL) OR (project_content_scheme_at_claim IS NOT NULL AND project_content_hash_at_claim IS NOT NULL)),
  CHECK((manual_operation_head_sequence_at_claim = 0 AND manual_operation_head_hash_at_claim IS NULL) OR (manual_operation_head_sequence_at_claim > 0 AND manual_operation_head_hash_at_claim IS NOT NULL))
) STRICT;

CREATE INDEX agent_command_execution_bases_command_idx
ON agent_command_execution_bases_v2(command_id ASC, attempt_id ASC);

CREATE INDEX agent_command_execution_bases_work_command_idx
ON agent_command_execution_bases_v2(work_command_id ASC, attempt_id ASC);

CREATE TABLE agent_run_attempts_v2 (
  attempt_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL CHECK(schema_version = 'agent_run_attempt.v1'),
  run_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  command_id TEXT NOT NULL,
  work_command_id TEXT NOT NULL,
  command_sequence INTEGER NOT NULL CHECK(command_sequence >= 1 AND command_sequence <= 9007199254740991),
  attempt_number INTEGER NOT NULL CHECK(attempt_number >= 1 AND attempt_number <= 9007199254740991),
  retry_record_id TEXT,
  retry_of_attempt_id TEXT,
  owner_token TEXT NOT NULL CHECK(length(owner_token) > 0),
  lease_generation INTEGER NOT NULL CHECK(lease_generation >= 1 AND lease_generation <= 9007199254740991),
  execution_epoch INTEGER NOT NULL CHECK(execution_epoch BETWEEN 0 AND 9007199254740991),
  lease_expires_at INTEGER NOT NULL CHECK(lease_expires_at BETWEEN 0 AND 9007199254740991),
  heartbeat_at INTEGER NOT NULL CHECK(heartbeat_at BETWEEN 0 AND lease_expires_at),
  state TEXT NOT NULL CHECK(state IN ('claimed', 'running', 'effect_staged', 'committing', 'completed', 'rejected', 'retry_scheduled', 'interrupted', 'cancelled', 'lease_lost')),
  provider_call_id TEXT,
  tool_call_id TEXT,
  execution_basis_hash TEXT NOT NULL CHECK(length(execution_basis_hash) = 71 AND substr(execution_basis_hash, 1, 7) = 'sha256:' AND substr(execution_basis_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  effect_id TEXT,
  mutation_action_id TEXT,
  terminal_code TEXT,
  started_at INTEGER NOT NULL CHECK(started_at BETWEEN 0 AND 9007199254740991),
  updated_at INTEGER NOT NULL CHECK(updated_at BETWEEN started_at AND 9007199254740991),
  completed_at INTEGER CHECK(completed_at IS NULL OR completed_at BETWEEN started_at AND updated_at),
  UNIQUE(run_id, attempt_number),
  UNIQUE(run_id, attempt_id),
  UNIQUE(run_id, project_id, attempt_id),
  UNIQUE(run_id, project_id, attempt_id, command_id),
  UNIQUE(attempt_id, command_id, work_command_id),
  UNIQUE(run_id, attempt_id, command_id, work_command_id),
  FOREIGN KEY(run_id) REFERENCES agent_run_coordinators_v2(run_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(command_id) REFERENCES agent_run_commands_v2(command_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(work_command_id) REFERENCES agent_run_commands_v2(command_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id, project_id) REFERENCES agent_run_coordinators_v2(run_id, project_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id, project_id, command_id, command_sequence) REFERENCES agent_run_commands_v2(run_id, project_id, command_id, command_sequence) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id, project_id, work_command_id) REFERENCES agent_run_commands_v2(run_id, project_id, command_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(retry_record_id) REFERENCES agent_retry_records_v2(retry_id) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(retry_of_attempt_id) REFERENCES agent_run_attempts_v2(attempt_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id, project_id, retry_record_id) REFERENCES agent_retry_records_v2(run_id, project_id, retry_id) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(run_id, project_id, retry_of_attempt_id) REFERENCES agent_run_attempts_v2(run_id, project_id, attempt_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id, project_id, retry_record_id, command_id) REFERENCES agent_retry_records_v2(run_id, project_id, retry_id, command_id) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(run_id, project_id, retry_of_attempt_id, command_id) REFERENCES agent_run_attempts_v2(run_id, project_id, attempt_id, command_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(provider_call_id) REFERENCES agent_provider_decisions_v2(decision_id) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(tool_call_id) REFERENCES agent_tool_calls_v2(tool_call_id) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(effect_id) REFERENCES agent_run_effects_v2(effect_id) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(mutation_action_id) REFERENCES agent_mutation_actions_v2(action_id) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(run_id, project_id, provider_call_id, attempt_id, command_id) REFERENCES agent_provider_decisions_v2(run_id, project_id, decision_id, attempt_id, command_id) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(run_id, project_id, tool_call_id, attempt_id, command_id) REFERENCES agent_tool_calls_v2(run_id, project_id, tool_call_id, attempt_id, command_id) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(run_id, project_id, effect_id, attempt_id, command_id) REFERENCES agent_run_effects_v2(run_id, project_id, effect_id, attempt_id, command_id) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(run_id, project_id, mutation_action_id, command_id) REFERENCES agent_mutation_actions_v2(run_id, project_id, action_id, source_command_id) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CHECK((retry_record_id IS NULL AND retry_of_attempt_id IS NULL) OR (retry_record_id IS NOT NULL AND retry_of_attempt_id IS NOT NULL)),
  CHECK(state <> 'claimed' OR (provider_call_id IS NULL AND tool_call_id IS NULL AND effect_id IS NULL AND mutation_action_id IS NULL)),
  CHECK((state IN ('completed', 'rejected', 'retry_scheduled', 'interrupted', 'cancelled', 'lease_lost') AND completed_at IS NOT NULL) OR (state IN ('claimed', 'running', 'effect_staged', 'committing') AND completed_at IS NULL))
) STRICT;

CREATE UNIQUE INDEX agent_run_attempts_one_nonterminal_uq
ON agent_run_attempts_v2(run_id ASC)
WHERE state IN ('claimed', 'running', 'effect_staged', 'committing');

CREATE INDEX agent_run_attempts_lease_recovery_idx
ON agent_run_attempts_v2(state ASC, lease_expires_at ASC, run_id ASC);

CREATE TABLE agent_provider_decisions_v2 (
  decision_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL CHECK(schema_version = 'provider_decision_receipt.v1'),
  run_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  command_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL UNIQUE,
  turn_budget_epoch INTEGER NOT NULL CHECK(turn_budget_epoch >= 1 AND turn_budget_epoch <= 9007199254740991),
  turn_number INTEGER NOT NULL CHECK(turn_number >= 1 AND turn_number <= 9007199254740991),
  provider_binding_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model TEXT NOT NULL CHECK(length(model) > 0),
  non_secret_settings_hash TEXT NOT NULL CHECK(length(non_secret_settings_hash) = 71 AND substr(non_secret_settings_hash, 1, 7) = 'sha256:' AND substr(non_secret_settings_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  call_idempotency_key TEXT NOT NULL CHECK(length(call_idempotency_key) > 0),
  input_canonical_json TEXT NOT NULL CHECK(json_valid(input_canonical_json)),
  input_hash TEXT NOT NULL CHECK(length(input_hash) = 71 AND substr(input_hash, 1, 7) = 'sha256:' AND substr(input_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  state TEXT NOT NULL CHECK(state IN ('prepared', 'in_flight', 'completed', 'failed', 'ambiguous')),
  provider_request_id TEXT,
  output_canonical_json TEXT CHECK(output_canonical_json IS NULL OR json_valid(output_canonical_json)),
  output_hash TEXT CHECK(output_hash IS NULL OR (length(output_hash) = 71 AND substr(output_hash, 1, 7) = 'sha256:' AND substr(output_hash, 8) NOT GLOB '*[^0-9a-f]*')),
  error_code TEXT,
  http_status_class TEXT NOT NULL CHECK(http_status_class IN ('none', '4xx', '5xx')),
  terminal_receipt_hash TEXT CHECK(terminal_receipt_hash IS NULL OR (length(terminal_receipt_hash) = 71 AND substr(terminal_receipt_hash, 1, 7) = 'sha256:' AND substr(terminal_receipt_hash, 8) NOT GLOB '*[^0-9a-f]*')),
  prepared_at INTEGER NOT NULL CHECK(prepared_at BETWEEN 0 AND 9007199254740991),
  started_at INTEGER CHECK(started_at IS NULL OR started_at BETWEEN prepared_at AND 9007199254740991),
  completed_at INTEGER CHECK(completed_at IS NULL OR completed_at BETWEEN COALESCE(started_at, prepared_at) AND 9007199254740991),
  UNIQUE(provider_binding_id, call_idempotency_key),
  UNIQUE(run_id, project_id, decision_id, attempt_id, command_id),
  FOREIGN KEY(run_id) REFERENCES agent_run_coordinators_v2(run_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(command_id) REFERENCES agent_run_commands_v2(command_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(attempt_id) REFERENCES agent_run_attempts_v2(attempt_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id, project_id) REFERENCES agent_run_coordinators_v2(run_id, project_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id, project_id, attempt_id, command_id) REFERENCES agent_run_attempts_v2(run_id, project_id, attempt_id, command_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id, provider_binding_id, provider_id, model, non_secret_settings_hash) REFERENCES agent_run_coordinators_v2(run_id, provider_binding_id, provider_id, provider_model, provider_settings_hash) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK((output_canonical_json IS NULL AND output_hash IS NULL) OR (output_canonical_json IS NOT NULL AND output_hash IS NOT NULL)),
  CHECK((state = 'prepared' AND started_at IS NULL AND completed_at IS NULL AND terminal_receipt_hash IS NULL) OR (state = 'in_flight' AND started_at IS NOT NULL AND completed_at IS NULL AND terminal_receipt_hash IS NULL) OR (state = 'completed' AND started_at IS NOT NULL AND completed_at IS NOT NULL AND output_canonical_json IS NOT NULL AND output_hash IS NOT NULL AND error_code IS NULL AND terminal_receipt_hash IS NOT NULL) OR (state = 'failed' AND completed_at IS NOT NULL AND error_code IS NOT NULL AND terminal_receipt_hash IS NOT NULL) OR (state = 'ambiguous' AND started_at IS NOT NULL AND completed_at IS NOT NULL AND output_canonical_json IS NULL AND output_hash IS NULL AND terminal_receipt_hash IS NOT NULL))
) STRICT;

CREATE TABLE agent_tool_calls_v2 (
  tool_call_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL CHECK(schema_version = 'tool_call_receipt.v1'),
  run_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  command_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL UNIQUE,
  decision_id TEXT NOT NULL UNIQUE,
  registry_snapshot_hash TEXT NOT NULL CHECK(length(registry_snapshot_hash) = 71 AND substr(registry_snapshot_hash, 1, 7) = 'sha256:' AND substr(registry_snapshot_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  tool_name TEXT NOT NULL CHECK(length(tool_name) > 0),
  tool_contract_version TEXT NOT NULL CHECK(length(tool_contract_version) > 0),
  capability_class TEXT NOT NULL CHECK(capability_class IN ('pure_read', 'external_read', 'project_candidate', 'coordinator_effect')),
  adapter TEXT NOT NULL CHECK(adapter IN ('pure_result', 'external_research_receipt', 'project_effect', 'initial_create_effect', 'run_note', 'subagent_task', 'question_set', 'approval_request', 'outbox_status')),
  call_idempotency_key TEXT NOT NULL CHECK(length(call_idempotency_key) > 0),
  input_canonical_json TEXT NOT NULL CHECK(json_valid(input_canonical_json)),
  input_hash TEXT NOT NULL CHECK(length(input_hash) = 71 AND substr(input_hash, 1, 7) = 'sha256:' AND substr(input_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  state TEXT NOT NULL CHECK(state IN ('prepared', 'in_flight', 'completed', 'failed', 'ambiguous')),
  output_canonical_json TEXT CHECK(output_canonical_json IS NULL OR json_valid(output_canonical_json)),
  output_hash TEXT CHECK(output_hash IS NULL OR (length(output_hash) = 71 AND substr(output_hash, 1, 7) = 'sha256:' AND substr(output_hash, 8) NOT GLOB '*[^0-9a-f]*')),
  error_code TEXT,
  terminal_receipt_hash TEXT CHECK(terminal_receipt_hash IS NULL OR (length(terminal_receipt_hash) = 71 AND substr(terminal_receipt_hash, 1, 7) = 'sha256:' AND substr(terminal_receipt_hash, 8) NOT GLOB '*[^0-9a-f]*')),
  prepared_at INTEGER NOT NULL CHECK(prepared_at BETWEEN 0 AND 9007199254740991),
  started_at INTEGER CHECK(started_at IS NULL OR started_at BETWEEN prepared_at AND 9007199254740991),
  completed_at INTEGER CHECK(completed_at IS NULL OR completed_at BETWEEN COALESCE(started_at, prepared_at) AND 9007199254740991),
  UNIQUE(tool_name, tool_contract_version, call_idempotency_key),
  UNIQUE(run_id, project_id, tool_call_id, attempt_id, command_id),
  UNIQUE(run_id, project_id, tool_call_id, attempt_id, command_id, decision_id),
  FOREIGN KEY(run_id) REFERENCES agent_run_coordinators_v2(run_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(command_id) REFERENCES agent_run_commands_v2(command_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(attempt_id) REFERENCES agent_run_attempts_v2(attempt_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(decision_id) REFERENCES agent_provider_decisions_v2(decision_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id, project_id) REFERENCES agent_run_coordinators_v2(run_id, project_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id, project_id, attempt_id, command_id) REFERENCES agent_run_attempts_v2(run_id, project_id, attempt_id, command_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id, project_id, decision_id, attempt_id, command_id) REFERENCES agent_provider_decisions_v2(run_id, project_id, decision_id, attempt_id, command_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK((output_canonical_json IS NULL AND output_hash IS NULL) OR (output_canonical_json IS NOT NULL AND output_hash IS NOT NULL)),
  CHECK((state = 'prepared' AND started_at IS NULL AND completed_at IS NULL AND terminal_receipt_hash IS NULL) OR (state = 'in_flight' AND started_at IS NOT NULL AND completed_at IS NULL AND terminal_receipt_hash IS NULL) OR (state = 'completed' AND started_at IS NOT NULL AND completed_at IS NOT NULL AND output_canonical_json IS NOT NULL AND output_hash IS NOT NULL AND error_code IS NULL AND terminal_receipt_hash IS NOT NULL) OR (state = 'failed' AND completed_at IS NOT NULL AND error_code IS NOT NULL AND terminal_receipt_hash IS NOT NULL) OR (state = 'ambiguous' AND started_at IS NOT NULL AND completed_at IS NOT NULL AND output_canonical_json IS NULL AND output_hash IS NULL AND terminal_receipt_hash IS NOT NULL))
) STRICT;

CREATE TABLE agent_run_effects_v2 (
  effect_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL CHECK(schema_version = 'agent_run_effect.v1'),
  run_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  command_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL UNIQUE,
  effect_kind TEXT NOT NULL CHECK(effect_kind IN ('read_only_result', 'project_mutation', 'ask_user', 'final_report', 'run_note', 'subagent_task', 'approval_request', 'public_status')),
  provider_decision_id TEXT NOT NULL,
  provider_terminal_receipt_hash TEXT NOT NULL CHECK(length(provider_terminal_receipt_hash) = 71 AND substr(provider_terminal_receipt_hash, 1, 7) = 'sha256:' AND substr(provider_terminal_receipt_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  tool_call_id TEXT,
  tool_terminal_receipt_hash TEXT CHECK(tool_terminal_receipt_hash IS NULL OR (length(tool_terminal_receipt_hash) = 71 AND substr(tool_terminal_receipt_hash, 1, 7) = 'sha256:' AND substr(tool_terminal_receipt_hash, 8) NOT GLOB '*[^0-9a-f]*')),
  payload_kind TEXT NOT NULL CHECK(payload_kind = effect_kind),
  payload_canonical_json TEXT NOT NULL CHECK(json_valid(payload_canonical_json)),
  effect_hash TEXT NOT NULL CHECK(length(effect_hash) = 71 AND substr(effect_hash, 1, 7) = 'sha256:' AND substr(effect_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  staged_at INTEGER NOT NULL CHECK(staged_at BETWEEN 0 AND 9007199254740991),
  UNIQUE(run_id, effect_hash),
  UNIQUE(run_id, effect_id),
  UNIQUE(run_id, effect_id, command_id),
  UNIQUE(run_id, project_id, effect_id),
  UNIQUE(run_id, project_id, effect_id, command_id),
  UNIQUE(run_id, project_id, effect_id, attempt_id, command_id),
  FOREIGN KEY(run_id) REFERENCES agent_run_coordinators_v2(run_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(command_id) REFERENCES agent_run_commands_v2(command_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(attempt_id) REFERENCES agent_run_attempts_v2(attempt_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(provider_decision_id) REFERENCES agent_provider_decisions_v2(decision_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(tool_call_id) REFERENCES agent_tool_calls_v2(tool_call_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id, project_id) REFERENCES agent_run_coordinators_v2(run_id, project_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id, project_id, attempt_id, command_id) REFERENCES agent_run_attempts_v2(run_id, project_id, attempt_id, command_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id, project_id, provider_decision_id, attempt_id, command_id) REFERENCES agent_provider_decisions_v2(run_id, project_id, decision_id, attempt_id, command_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id, project_id, tool_call_id, attempt_id, command_id, provider_decision_id) REFERENCES agent_tool_calls_v2(run_id, project_id, tool_call_id, attempt_id, command_id, decision_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK((tool_call_id IS NULL AND tool_terminal_receipt_hash IS NULL) OR (tool_call_id IS NOT NULL AND tool_terminal_receipt_hash IS NOT NULL))
) STRICT;

CREATE TABLE agent_coordinator_effect_commits_v2 (
  commit_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL CHECK(schema_version = 'agent_coordinator_effect_commit.v1'),
  effect_id TEXT NOT NULL UNIQUE,
  run_id TEXT NOT NULL,
  command_id TEXT NOT NULL,
  adapter TEXT NOT NULL CHECK(adapter IN ('run_note', 'subagent_task', 'question_set', 'approval_request', 'outbox_status')),
  adapter_idempotency_key TEXT NOT NULL CHECK(length(adapter_idempotency_key) > 0),
  effect_hash TEXT NOT NULL CHECK(length(effect_hash) = 71 AND substr(effect_hash, 1, 7) = 'sha256:' AND substr(effect_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  target_record_id TEXT,
  terminal_result_canonical_json TEXT CHECK(terminal_result_canonical_json IS NULL OR json_valid(terminal_result_canonical_json)),
  terminal_result_hash TEXT CHECK(terminal_result_hash IS NULL OR (length(terminal_result_hash) = 71 AND substr(terminal_result_hash, 1, 7) = 'sha256:' AND substr(terminal_result_hash, 8) NOT GLOB '*[^0-9a-f]*')),
  state TEXT NOT NULL CHECK(state IN ('prepared', 'in_flight', 'committed', 'rejected', 'ambiguous')),
  terminal_code TEXT,
  created_at INTEGER NOT NULL CHECK(created_at BETWEEN 0 AND 9007199254740991),
  completed_at INTEGER CHECK(completed_at IS NULL OR completed_at BETWEEN created_at AND 9007199254740991),
  UNIQUE(adapter, adapter_idempotency_key),
  FOREIGN KEY(effect_id) REFERENCES agent_run_effects_v2(effect_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id) REFERENCES agent_run_coordinators_v2(run_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(command_id) REFERENCES agent_run_commands_v2(command_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id, effect_id) REFERENCES agent_run_effects_v2(run_id, effect_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id, command_id) REFERENCES agent_run_commands_v2(run_id, command_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id, effect_id, command_id) REFERENCES agent_run_effects_v2(run_id, effect_id, command_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK((terminal_result_canonical_json IS NULL AND terminal_result_hash IS NULL) OR (terminal_result_canonical_json IS NOT NULL AND terminal_result_hash IS NOT NULL)),
  CHECK((state IN ('prepared', 'in_flight') AND completed_at IS NULL AND terminal_result_hash IS NULL) OR (state IN ('committed', 'rejected', 'ambiguous') AND completed_at IS NOT NULL AND terminal_result_canonical_json IS NOT NULL AND terminal_result_hash IS NOT NULL)),
  CHECK(adapter = 'subagent_task' OR state <> 'in_flight')
) STRICT;

CREATE TABLE agent_run_project_states_v2 (
  run_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL CHECK(schema_version = 'agent_run_project_state.v1'),
  project_id TEXT NOT NULL,
  vdt_id TEXT,
  project_canonical_json TEXT NOT NULL CHECK(json_valid(project_canonical_json)),
  project_content_scheme TEXT NOT NULL CHECK(project_content_scheme IN ('legacy_graph_sha256', 'vdt_revision_payload_hash.v1')),
  project_content_hash TEXT NOT NULL CHECK(length(project_content_hash) = 71 AND substr(project_content_hash, 1, 7) = 'sha256:' AND substr(project_content_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  runtime_generation TEXT NOT NULL CHECK(runtime_generation IN ('v1', 'v2')),
  generation_version INTEGER NOT NULL CHECK(generation_version >= 0 AND generation_version <= 9007199254740991),
  migration_state TEXT NOT NULL CHECK(migration_state IN ('not_started', 'shadow_ready', 'migrating', 'v2_active', 'rollback_readonly')),
  write_state TEXT NOT NULL CHECK(write_state IN ('enabled', 'disabled')),
  runtime_updated_at INTEGER NOT NULL CHECK(runtime_updated_at BETWEEN 0 AND 9007199254740991),
  based_on_revision_head_canonical_json TEXT CHECK(based_on_revision_head_canonical_json IS NULL OR json_valid(based_on_revision_head_canonical_json)),
  manual_operation_journal_head_sequence INTEGER NOT NULL CHECK(manual_operation_journal_head_sequence >= 0 AND manual_operation_journal_head_sequence <= 9007199254740991),
  manual_operation_journal_head_hash TEXT CHECK(manual_operation_journal_head_hash IS NULL OR (length(manual_operation_journal_head_hash) = 71 AND substr(manual_operation_journal_head_hash, 1, 7) = 'sha256:' AND substr(manual_operation_journal_head_hash, 8) NOT GLOB '*[^0-9a-f]*')),
  processed_manual_operation_sequence INTEGER NOT NULL CHECK(processed_manual_operation_sequence = manual_operation_journal_head_sequence),
  processed_manual_operation_hash TEXT CHECK(processed_manual_operation_hash IS manual_operation_journal_head_hash),
  run_state_version INTEGER NOT NULL CHECK(run_state_version >= 0 AND run_state_version <= 9007199254740991),
  updated_at INTEGER NOT NULL CHECK(updated_at BETWEEN 0 AND 9007199254740991),
  UNIQUE(run_id, project_id, vdt_id),
  FOREIGN KEY(run_id) REFERENCES agent_run_coordinators_v2(run_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(vdt_id) REFERENCES vdts(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id, project_id) REFERENCES agent_run_coordinators_v2(run_id, project_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK((vdt_id IS NULL AND based_on_revision_head_canonical_json IS NULL) OR vdt_id IS NOT NULL),
  CHECK((manual_operation_journal_head_sequence = 0 AND manual_operation_journal_head_hash IS NULL) OR (manual_operation_journal_head_sequence > 0 AND manual_operation_journal_head_hash IS NOT NULL))
) STRICT;

CREATE TABLE agent_manual_editing_sessions_v2 (
  run_id TEXT NOT NULL,
  editing_session_id TEXT NOT NULL,
  schema_version TEXT NOT NULL CHECK(schema_version = 'manual_editing_session.v1'),
  actor_principal_id TEXT NOT NULL CHECK(length(actor_principal_id) > 0),
  last_editing_session_sequence INTEGER NOT NULL CHECK(last_editing_session_sequence >= 0 AND last_editing_session_sequence <= 9007199254740991),
  last_operation_hash TEXT CHECK(last_operation_hash IS NULL OR (length(last_operation_hash) = 71 AND substr(last_operation_hash, 1, 7) = 'sha256:' AND substr(last_operation_hash, 8) NOT GLOB '*[^0-9a-f]*')),
  state TEXT NOT NULL CHECK(state IN ('open', 'resync_required', 'closed')),
  blocked_operation_id TEXT,
  blocked_code TEXT CHECK(blocked_code IS NULL OR blocked_code IN ('MANUAL_OPERATION_GAP', 'MANUAL_OPERATION_HASH_MISMATCH', 'MANUAL_OPERATION_CONFLICT')),
  resync_basis_id TEXT,
  resync_basis_hash TEXT CHECK(resync_basis_hash IS NULL OR (length(resync_basis_hash) = 71 AND substr(resync_basis_hash, 1, 7) = 'sha256:' AND substr(resync_basis_hash, 8) NOT GLOB '*[^0-9a-f]*')),
  replacement_editing_session_id TEXT,
  created_at INTEGER NOT NULL CHECK(created_at BETWEEN 0 AND 9007199254740991),
  updated_at INTEGER NOT NULL CHECK(updated_at BETWEEN created_at AND 9007199254740991),
  PRIMARY KEY(run_id, editing_session_id),
  UNIQUE(run_id, editing_session_id, actor_principal_id),
  UNIQUE(run_id, replacement_editing_session_id),
  FOREIGN KEY(run_id) REFERENCES agent_run_coordinators_v2(run_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(blocked_operation_id) REFERENCES agent_manual_operations_v2(operation_id) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(run_id, blocked_operation_id) REFERENCES agent_manual_operations_v2(run_id, operation_id) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(resync_basis_id) REFERENCES agent_manual_resync_bases_v2(resync_basis_id) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(run_id, editing_session_id, resync_basis_id, resync_basis_hash) REFERENCES agent_manual_resync_bases_v2(run_id, blocked_editing_session_id, resync_basis_id, resync_basis_hash) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(run_id, replacement_editing_session_id) REFERENCES agent_manual_editing_sessions_v2(run_id, editing_session_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK((last_editing_session_sequence = 0 AND last_operation_hash IS NULL) OR (last_editing_session_sequence > 0 AND last_operation_hash IS NOT NULL)),
  CHECK((state = 'open' AND blocked_operation_id IS NULL AND blocked_code IS NULL AND resync_basis_id IS NULL AND resync_basis_hash IS NULL AND replacement_editing_session_id IS NULL) OR (state = 'resync_required' AND blocked_operation_id IS NOT NULL AND blocked_code IS NOT NULL AND resync_basis_id IS NOT NULL AND resync_basis_hash IS NOT NULL AND replacement_editing_session_id IS NULL) OR (state = 'closed' AND blocked_operation_id IS NOT NULL AND blocked_code IS NOT NULL AND resync_basis_id IS NOT NULL AND resync_basis_hash IS NOT NULL AND replacement_editing_session_id IS NOT NULL))
) STRICT;

CREATE TABLE agent_manual_operations_v2 (
  operation_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL CHECK(schema_version = 'manual_project_operation.v1'),
  command_id TEXT NOT NULL UNIQUE,
  run_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  vdt_id TEXT,
  actor_principal_id TEXT NOT NULL,
  operation_sequence INTEGER NOT NULL CHECK(operation_sequence >= 1 AND operation_sequence <= 9007199254740991),
  previous_operation_hash TEXT CHECK(previous_operation_hash IS NULL OR (length(previous_operation_hash) = 71 AND substr(previous_operation_hash, 1, 7) = 'sha256:' AND substr(previous_operation_hash, 8) NOT GLOB '*[^0-9a-f]*')),
  editing_session_id TEXT NOT NULL,
  editing_session_sequence INTEGER NOT NULL CHECK(editing_session_sequence >= 1 AND editing_session_sequence <= 9007199254740991),
  previous_editing_session_operation_hash TEXT CHECK(previous_editing_session_operation_hash IS NULL OR (length(previous_editing_session_operation_hash) = 71 AND substr(previous_editing_session_operation_hash, 1, 7) = 'sha256:' AND substr(previous_editing_session_operation_hash, 8) NOT GLOB '*[^0-9a-f]*')),
  observed_revision_head_canonical_json TEXT CHECK(observed_revision_head_canonical_json IS NULL OR json_valid(observed_revision_head_canonical_json)),
  observed_project_content_scheme TEXT NOT NULL CHECK(observed_project_content_scheme IN ('legacy_graph_sha256', 'vdt_revision_payload_hash.v1')),
  observed_project_content_hash TEXT NOT NULL CHECK(length(observed_project_content_hash) = 71 AND substr(observed_project_content_hash, 1, 7) = 'sha256:' AND substr(observed_project_content_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  resync_blocked_editing_session_id TEXT,
  resync_basis_hash TEXT CHECK(resync_basis_hash IS NULL OR (length(resync_basis_hash) = 71 AND substr(resync_basis_hash, 1, 7) = 'sha256:' AND substr(resync_basis_hash, 8) NOT GLOB '*[^0-9a-f]*')),
  operation_kind TEXT NOT NULL CHECK(operation_kind IN ('node.add', 'node.replace', 'node.delete', 'node.position', 'edge.add', 'edge.replace', 'edge.delete', 'changeset.apply', 'project.replace')),
  operation_canonical_json TEXT NOT NULL CHECK(json_valid(operation_canonical_json)),
  summary TEXT CHECK(summary IS NULL OR length(summary) <= 1000),
  input_canonical_json TEXT NOT NULL CHECK(json_valid(input_canonical_json)),
  input_hash TEXT NOT NULL CHECK(length(input_hash) = 71 AND substr(input_hash, 1, 7) = 'sha256:' AND substr(input_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  operation_hash TEXT NOT NULL CHECK(length(operation_hash) = 71 AND substr(operation_hash, 1, 7) = 'sha256:' AND substr(operation_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  status TEXT NOT NULL CHECK(status IN ('applied', 'gap', 'conflict')),
  resulting_project_content_scheme TEXT CHECK(resulting_project_content_scheme IS NULL OR resulting_project_content_scheme IN ('legacy_graph_sha256', 'vdt_revision_payload_hash.v1')),
  resulting_project_content_hash TEXT CHECK(resulting_project_content_hash IS NULL OR (length(resulting_project_content_hash) = 71 AND substr(resulting_project_content_hash, 1, 7) = 'sha256:' AND substr(resulting_project_content_hash, 8) NOT GLOB '*[^0-9a-f]*')),
  created_at INTEGER NOT NULL CHECK(created_at BETWEEN 0 AND 9007199254740991),
  completed_at INTEGER NOT NULL CHECK(completed_at BETWEEN created_at AND 9007199254740991),
  UNIQUE(run_id, operation_sequence),
  UNIQUE(run_id, editing_session_id, editing_session_sequence),
  UNIQUE(run_id, operation_hash),
  UNIQUE(run_id, operation_id),
  FOREIGN KEY(command_id) REFERENCES agent_run_commands_v2(command_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id) REFERENCES agent_run_coordinators_v2(run_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(vdt_id) REFERENCES vdts(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id, project_id) REFERENCES agent_run_coordinators_v2(run_id, project_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id, project_id, command_id) REFERENCES agent_run_commands_v2(run_id, project_id, command_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id, editing_session_id, actor_principal_id) REFERENCES agent_manual_editing_sessions_v2(run_id, editing_session_id, actor_principal_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id, resync_blocked_editing_session_id) REFERENCES agent_manual_editing_sessions_v2(run_id, editing_session_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK((operation_sequence = 1 AND previous_operation_hash IS NULL) OR (operation_sequence > 1 AND previous_operation_hash IS NOT NULL)),
  CHECK((editing_session_sequence = 1 AND previous_editing_session_operation_hash IS NULL) OR (editing_session_sequence > 1 AND previous_editing_session_operation_hash IS NOT NULL)),
  CHECK((resync_blocked_editing_session_id IS NULL AND resync_basis_hash IS NULL) OR (editing_session_sequence = 1 AND resync_blocked_editing_session_id IS NOT NULL AND resync_basis_hash IS NOT NULL)),
  CHECK((status = 'applied' AND resulting_project_content_scheme IS NOT NULL AND resulting_project_content_hash IS NOT NULL) OR (status IN ('gap', 'conflict') AND resulting_project_content_scheme IS NULL AND resulting_project_content_hash IS NULL))
) STRICT;

CREATE TABLE agent_manual_resync_bases_v2 (
  resync_basis_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL CHECK(schema_version = 'manual_operation_resync_basis.v1'),
  run_id TEXT NOT NULL,
  blocked_editing_session_id TEXT NOT NULL,
  blocked_operation_id TEXT NOT NULL UNIQUE,
  revision_head_canonical_json TEXT CHECK(revision_head_canonical_json IS NULL OR json_valid(revision_head_canonical_json)),
  project_canonical_json TEXT NOT NULL CHECK(json_valid(project_canonical_json)),
  project_content_scheme TEXT NOT NULL CHECK(project_content_scheme IN ('legacy_graph_sha256', 'vdt_revision_payload_hash.v1')),
  project_content_hash TEXT NOT NULL CHECK(length(project_content_hash) = 71 AND substr(project_content_hash, 1, 7) = 'sha256:' AND substr(project_content_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  manual_operation_head_sequence INTEGER NOT NULL CHECK(manual_operation_head_sequence >= 0 AND manual_operation_head_sequence <= 9007199254740991),
  manual_operation_head_hash TEXT CHECK(manual_operation_head_hash IS NULL OR (length(manual_operation_head_hash) = 71 AND substr(manual_operation_head_hash, 1, 7) = 'sha256:' AND substr(manual_operation_head_hash, 8) NOT GLOB '*[^0-9a-f]*')),
  resync_basis_hash TEXT NOT NULL CHECK(length(resync_basis_hash) = 71 AND substr(resync_basis_hash, 1, 7) = 'sha256:' AND substr(resync_basis_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  created_at INTEGER NOT NULL CHECK(created_at BETWEEN 0 AND 9007199254740991),
  UNIQUE(run_id, blocked_editing_session_id, resync_basis_id, resync_basis_hash),
  FOREIGN KEY(run_id, blocked_editing_session_id) REFERENCES agent_manual_editing_sessions_v2(run_id, editing_session_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(blocked_operation_id) REFERENCES agent_manual_operations_v2(operation_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id, blocked_operation_id) REFERENCES agent_manual_operations_v2(run_id, operation_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK((manual_operation_head_sequence = 0 AND manual_operation_head_hash IS NULL) OR (manual_operation_head_sequence > 0 AND manual_operation_head_hash IS NOT NULL))
) STRICT;

CREATE TABLE agent_question_sets_v2 (
  question_set_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL CHECK(schema_version = 'agent_question_set.v1'),
  run_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  command_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  effect_id TEXT NOT NULL UNIQUE,
  questions_canonical_json TEXT NOT NULL CHECK(json_valid(questions_canonical_json) AND json_type(questions_canonical_json) = 'array'),
  question_set_hash TEXT NOT NULL CHECK(length(question_set_hash) = 71 AND substr(question_set_hash, 1, 7) = 'sha256:' AND substr(question_set_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  state TEXT NOT NULL CHECK(state IN ('staged', 'active', 'answered', 'superseded', 'cancelled')),
  activated_run_state_version INTEGER CHECK(activated_run_state_version IS NULL OR activated_run_state_version BETWEEN 0 AND 9007199254740991),
  answer_command_id TEXT,
  answer_receipt_hash TEXT CHECK(answer_receipt_hash IS NULL OR (length(answer_receipt_hash) = 71 AND substr(answer_receipt_hash, 1, 7) = 'sha256:' AND substr(answer_receipt_hash, 8) NOT GLOB '*[^0-9a-f]*')),
  created_at INTEGER NOT NULL CHECK(created_at BETWEEN 0 AND 9007199254740991),
  activated_at INTEGER CHECK(activated_at IS NULL OR activated_at BETWEEN created_at AND 9007199254740991),
  answered_at INTEGER CHECK(answered_at IS NULL OR answered_at BETWEEN COALESCE(activated_at, created_at) AND 9007199254740991),
  UNIQUE(question_set_id, question_set_hash, run_id),
  UNIQUE(run_id, question_set_id),
  UNIQUE(run_id, project_id, question_set_id),
  FOREIGN KEY(run_id) REFERENCES agent_run_coordinators_v2(run_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(command_id) REFERENCES agent_run_commands_v2(command_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(attempt_id) REFERENCES agent_run_attempts_v2(attempt_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(effect_id) REFERENCES agent_run_effects_v2(effect_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(answer_command_id) REFERENCES agent_run_commands_v2(command_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id, project_id) REFERENCES agent_run_coordinators_v2(run_id, project_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id, project_id, attempt_id, command_id) REFERENCES agent_run_attempts_v2(run_id, project_id, attempt_id, command_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id, project_id, effect_id, attempt_id, command_id) REFERENCES agent_run_effects_v2(run_id, project_id, effect_id, attempt_id, command_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id, project_id, answer_command_id) REFERENCES agent_run_commands_v2(run_id, project_id, command_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK((state = 'staged' AND activated_run_state_version IS NULL AND activated_at IS NULL AND answer_command_id IS NULL AND answer_receipt_hash IS NULL AND answered_at IS NULL) OR (state = 'active' AND activated_run_state_version IS NOT NULL AND activated_at IS NOT NULL AND answer_command_id IS NULL AND answer_receipt_hash IS NULL AND answered_at IS NULL) OR (state = 'answered' AND activated_run_state_version IS NOT NULL AND activated_at IS NOT NULL AND answer_command_id IS NOT NULL AND answer_receipt_hash IS NOT NULL AND answered_at IS NOT NULL) OR (state IN ('superseded', 'cancelled') AND answer_command_id IS NULL AND answer_receipt_hash IS NULL AND answered_at IS NULL))
) STRICT;

CREATE UNIQUE INDEX agent_question_sets_one_active_uq
ON agent_question_sets_v2(run_id ASC)
WHERE state = 'active';

CREATE TABLE agent_question_answers_v2 (
  answer_receipt_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL CHECK(schema_version = 'agent_question_answer_receipt.v1'),
  question_set_id TEXT NOT NULL UNIQUE,
  question_set_hash TEXT NOT NULL CHECK(length(question_set_hash) = 71 AND substr(question_set_hash, 1, 7) = 'sha256:' AND substr(question_set_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  run_id TEXT NOT NULL,
  command_id TEXT NOT NULL UNIQUE,
  actor_principal_id TEXT NOT NULL CHECK(length(actor_principal_id) > 0),
  answers_canonical_json TEXT NOT NULL CHECK(json_valid(answers_canonical_json) AND json_type(answers_canonical_json) = 'array'),
  answer_hash TEXT NOT NULL CHECK(length(answer_hash) = 71 AND substr(answer_hash, 1, 7) = 'sha256:' AND substr(answer_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  created_at INTEGER NOT NULL CHECK(created_at BETWEEN 0 AND 9007199254740991),
  UNIQUE(question_set_id, command_id, answer_hash),
  FOREIGN KEY(question_set_id, question_set_hash, run_id) REFERENCES agent_question_sets_v2(question_set_id, question_set_hash, run_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id) REFERENCES agent_run_coordinators_v2(run_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(command_id) REFERENCES agent_run_commands_v2(command_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id, command_id) REFERENCES agent_run_commands_v2(run_id, command_id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE agent_mutation_approval_policies_v2 (
  policy_hash TEXT PRIMARY KEY CHECK(length(policy_hash) = 71 AND substr(policy_hash, 1, 7) = 'sha256:' AND substr(policy_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  schema_version TEXT NOT NULL CHECK(schema_version = 'agent_mutation_approval_policy_snapshot.v1'),
  policy_version TEXT NOT NULL UNIQUE CHECK(policy_version = 'agent_mutation_approval_policy.v1'),
  human_required_risk_classes_canonical_json TEXT NOT NULL CHECK(human_required_risk_classes_canonical_json = '["entity_delete","full_project_replacement","selected_changeset_application","persisted_recomputation"]'),
  autonomous_eligible_risk_classes_canonical_json TEXT NOT NULL CHECK(autonomous_eligible_risk_classes_canonical_json = '["non_destructive"]'),
  captured_at INTEGER NOT NULL CHECK(captured_at BETWEEN 0 AND 9007199254740991)
) STRICT;

CREATE TABLE agent_mutation_approval_bases_v2 (
  approval_basis_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL CHECK(schema_version = 'agent_mutation_approval_basis.v1'),
  approval_basis_hash TEXT NOT NULL UNIQUE CHECK(length(approval_basis_hash) = 71 AND substr(approval_basis_hash, 1, 7) = 'sha256:' AND substr(approval_basis_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  action_id TEXT NOT NULL,
  proposal_basis_hash TEXT NOT NULL CHECK(length(proposal_basis_hash) = 71 AND substr(proposal_basis_hash, 1, 7) = 'sha256:' AND substr(proposal_basis_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  kind TEXT NOT NULL CHECK(kind IN ('human', 'autonomous')),
  approval_command_id TEXT,
  actor_principal_id TEXT,
  feature_snapshot_hash TEXT NOT NULL CHECK(length(feature_snapshot_hash) = 71 AND substr(feature_snapshot_hash, 1, 7) = 'sha256:' AND substr(feature_snapshot_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  current_feature_config_hash TEXT NOT NULL CHECK(length(current_feature_config_hash) = 71 AND substr(current_feature_config_hash, 1, 7) = 'sha256:' AND substr(current_feature_config_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  approval_policy_hash TEXT NOT NULL,
  risk_classes_canonical_json TEXT NOT NULL CHECK(json_valid(risk_classes_canonical_json) AND json_type(risk_classes_canonical_json) = 'array'),
  approved_change_ids_canonical_json TEXT NOT NULL CHECK(json_valid(approved_change_ids_canonical_json) AND json_type(approved_change_ids_canonical_json) = 'array'),
  approved_at INTEGER NOT NULL CHECK(approved_at BETWEEN 0 AND 9007199254740991),
  UNIQUE(action_id, proposal_basis_hash),
  UNIQUE(approval_basis_id, action_id, proposal_basis_hash),
  FOREIGN KEY(action_id) REFERENCES agent_mutation_actions_v2(action_id) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(approval_command_id) REFERENCES agent_run_commands_v2(command_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(approval_policy_hash) REFERENCES agent_mutation_approval_policies_v2(policy_hash) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK((kind = 'human' AND approval_command_id IS NOT NULL AND actor_principal_id IS NOT NULL) OR (kind = 'autonomous' AND approval_command_id IS NULL AND actor_principal_id IS NULL AND risk_classes_canonical_json = '["non_destructive"]'))
) STRICT;

CREATE TABLE agent_mutation_actions_v2 (
  action_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL CHECK(schema_version = 'agent_mutation_action.v1'),
  run_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  vdt_id TEXT,
  publication_operation TEXT NOT NULL CHECK(publication_operation IN ('revision.commit', 'vdt.create_with_initial')),
  source_command_id TEXT NOT NULL,
  effect_id TEXT NOT NULL UNIQUE,
  proposal_id TEXT NOT NULL UNIQUE,
  proposal_basis_hash TEXT NOT NULL CHECK(length(proposal_basis_hash) = 71 AND substr(proposal_basis_hash, 1, 7) = 'sha256:' AND substr(proposal_basis_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  base_run_state_version INTEGER NOT NULL CHECK(base_run_state_version BETWEEN 0 AND 9007199254740991),
  base_execution_epoch INTEGER NOT NULL CHECK(base_execution_epoch BETWEEN 0 AND 9007199254740991),
  base_project_runtime_state_canonical_json TEXT NOT NULL CHECK(json_valid(base_project_runtime_state_canonical_json)),
  base_revision_head_canonical_json TEXT CHECK(base_revision_head_canonical_json IS NULL OR json_valid(base_revision_head_canonical_json)),
  base_project_content_scheme TEXT CHECK(base_project_content_scheme IS NULL OR base_project_content_scheme IN ('legacy_graph_sha256', 'vdt_revision_payload_hash.v1')),
  base_project_content_hash TEXT CHECK(base_project_content_hash IS NULL OR (length(base_project_content_hash) = 71 AND substr(base_project_content_hash, 1, 7) = 'sha256:' AND substr(base_project_content_hash, 8) NOT GLOB '*[^0-9a-f]*')),
  base_manual_operation_journal_sequence INTEGER NOT NULL CHECK(base_manual_operation_journal_sequence BETWEEN 0 AND 9007199254740991),
  base_manual_operation_journal_hash TEXT CHECK(base_manual_operation_journal_hash IS NULL OR (length(base_manual_operation_journal_hash) = 71 AND substr(base_manual_operation_journal_hash, 1, 7) = 'sha256:' AND substr(base_manual_operation_journal_hash, 8) NOT GLOB '*[^0-9a-f]*')),
  base_processed_manual_operation_sequence INTEGER NOT NULL CHECK(base_processed_manual_operation_sequence = base_manual_operation_journal_sequence),
  base_processed_manual_operation_hash TEXT CHECK(base_processed_manual_operation_hash IS base_manual_operation_journal_hash),
  change_set_hash TEXT NOT NULL CHECK(length(change_set_hash) = 71 AND substr(change_set_hash, 1, 7) = 'sha256:' AND substr(change_set_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  target_project_canonical_json TEXT NOT NULL CHECK(json_valid(target_project_canonical_json)),
  target_project_content_scheme TEXT NOT NULL CHECK(target_project_content_scheme IN ('legacy_graph_sha256', 'vdt_revision_payload_hash.v1')),
  target_project_content_hash TEXT NOT NULL CHECK(length(target_project_content_hash) = 71 AND substr(target_project_content_hash, 1, 7) = 'sha256:' AND substr(target_project_content_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  approval_basis_id TEXT,
  merge_id TEXT,
  merge_version INTEGER NOT NULL CHECK(merge_version >= 0 AND merge_version <= 9007199254740991),
  barrier_command_id TEXT,
  barrier_attempt_id TEXT,
  commit_barrier_command_sequence INTEGER CHECK(commit_barrier_command_sequence IS NULL OR commit_barrier_command_sequence BETWEEN 1 AND 9007199254740991),
  w01_commit_basis_canonical_json TEXT CHECK(w01_commit_basis_canonical_json IS NULL OR json_valid(w01_commit_basis_canonical_json)),
  w01_commit_basis_hash TEXT CHECK(w01_commit_basis_hash IS NULL OR (length(w01_commit_basis_hash) = 71 AND substr(w01_commit_basis_hash, 1, 7) = 'sha256:' AND substr(w01_commit_basis_hash, 8) NOT GLOB '*[^0-9a-f]*')),
  w01_binding_id TEXT UNIQUE,
  state TEXT NOT NULL CHECK(state IN ('proposed', 'waiting_approval', 'approved', 'reconciling', 'merge_required', 'ready_to_commit', 'committing', 'committed', 'rejected', 'superseded', 'quarantined')),
  revision_result_hash TEXT CHECK(revision_result_hash IS NULL OR (length(revision_result_hash) = 71 AND substr(revision_result_hash, 1, 7) = 'sha256:' AND substr(revision_result_hash, 8) NOT GLOB '*[^0-9a-f]*')),
  resulting_vdt_id TEXT,
  resulting_revision_id TEXT,
  resulting_revision_head_canonical_json TEXT CHECK(resulting_revision_head_canonical_json IS NULL OR json_valid(resulting_revision_head_canonical_json)),
  terminal_code TEXT,
  created_at INTEGER NOT NULL CHECK(created_at BETWEEN 0 AND 9007199254740991),
  updated_at INTEGER NOT NULL CHECK(updated_at BETWEEN created_at AND 9007199254740991),
  completed_at INTEGER CHECK(completed_at IS NULL OR completed_at BETWEEN created_at AND updated_at),
  UNIQUE(run_id, action_id, barrier_command_id, barrier_attempt_id),
  UNIQUE(run_id, action_id),
  UNIQUE(run_id, project_id, action_id),
  UNIQUE(run_id, project_id, action_id, source_command_id),
  FOREIGN KEY(run_id) REFERENCES agent_run_coordinators_v2(run_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(vdt_id) REFERENCES vdts(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(source_command_id) REFERENCES agent_run_commands_v2(command_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(effect_id) REFERENCES agent_run_effects_v2(effect_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id, project_id) REFERENCES agent_run_coordinators_v2(run_id, project_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id, project_id, source_command_id) REFERENCES agent_run_commands_v2(run_id, project_id, command_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id, project_id, effect_id, source_command_id) REFERENCES agent_run_effects_v2(run_id, project_id, effect_id, command_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(approval_basis_id, action_id, proposal_basis_hash) REFERENCES agent_mutation_approval_bases_v2(approval_basis_id, action_id, proposal_basis_hash) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(merge_id, action_id, run_id) REFERENCES agent_merge_records_v2(merge_id, action_id, run_id) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(barrier_command_id) REFERENCES agent_run_commands_v2(command_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(barrier_attempt_id) REFERENCES agent_run_attempts_v2(attempt_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id, project_id, barrier_command_id) REFERENCES agent_run_commands_v2(run_id, project_id, command_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id, project_id, barrier_attempt_id, barrier_command_id) REFERENCES agent_run_attempts_v2(run_id, project_id, attempt_id, command_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(w01_binding_id, action_id, w01_commit_basis_hash) REFERENCES agent_w01_commit_bindings_v2(binding_id, action_id, w01_commit_basis_hash) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(resulting_vdt_id) REFERENCES vdts(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(resulting_revision_id) REFERENCES vdt_revisions(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK((publication_operation = 'revision.commit' AND vdt_id IS NOT NULL AND base_revision_head_canonical_json IS NOT NULL AND base_project_content_scheme IS NOT NULL AND base_project_content_hash IS NOT NULL) OR (publication_operation = 'vdt.create_with_initial' AND vdt_id IS NULL AND base_revision_head_canonical_json IS NULL AND base_project_content_scheme IS NULL AND base_project_content_hash IS NULL)),
  CHECK((base_manual_operation_journal_sequence = 0 AND base_manual_operation_journal_hash IS NULL) OR (base_manual_operation_journal_sequence > 0 AND base_manual_operation_journal_hash IS NOT NULL)),
  CHECK(
    (state IN ('proposed', 'waiting_approval', 'approved', 'reconciling', 'merge_required', 'ready_to_commit', 'superseded') AND barrier_command_id IS NULL AND barrier_attempt_id IS NULL AND commit_barrier_command_sequence IS NULL)
    OR (state IN ('committing', 'committed', 'quarantined') AND barrier_command_id IS NOT NULL AND barrier_attempt_id IS NOT NULL AND commit_barrier_command_sequence IS NOT NULL)
    OR (state = 'rejected' AND ((barrier_command_id IS NULL AND barrier_attempt_id IS NULL AND commit_barrier_command_sequence IS NULL) OR (barrier_command_id IS NOT NULL AND barrier_attempt_id IS NOT NULL AND commit_barrier_command_sequence IS NOT NULL)))
  ),
  CHECK((w01_commit_basis_canonical_json IS NULL AND w01_commit_basis_hash IS NULL AND w01_binding_id IS NULL) OR (w01_commit_basis_canonical_json IS NOT NULL AND w01_commit_basis_hash IS NOT NULL AND w01_binding_id IS NOT NULL)),
  CHECK(state NOT IN ('ready_to_commit', 'committing', 'committed', 'quarantined') OR w01_binding_id IS NOT NULL),
  CHECK((state IN ('committed', 'rejected', 'superseded', 'quarantined') AND completed_at IS NOT NULL) OR (state NOT IN ('committed', 'rejected', 'superseded', 'quarantined') AND completed_at IS NULL))
) STRICT;

CREATE UNIQUE INDEX agent_mutation_actions_barrier_command_uq
ON agent_mutation_actions_v2(barrier_command_id ASC)
WHERE barrier_command_id IS NOT NULL;

CREATE UNIQUE INDEX agent_mutation_actions_barrier_attempt_uq
ON agent_mutation_actions_v2(barrier_attempt_id ASC)
WHERE barrier_attempt_id IS NOT NULL;

CREATE TABLE agent_w01_commit_bindings_v2 (
  binding_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL CHECK(schema_version = 'agent_w01_commit_binding.v1'),
  action_id TEXT NOT NULL UNIQUE,
  run_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('revision.commit', 'vdt.create_with_initial')),
  scope_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  w01_request_hash TEXT NOT NULL CHECK(length(w01_request_hash) = 71 AND substr(w01_request_hash, 1, 7) = 'sha256:' AND substr(w01_request_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  w01_commit_basis_hash TEXT NOT NULL CHECK(length(w01_commit_basis_hash) = 71 AND substr(w01_commit_basis_hash, 1, 7) = 'sha256:' AND substr(w01_commit_basis_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  revision_commit_attempt_id TEXT UNIQUE,
  revision_id TEXT,
  resulting_vdt_id TEXT,
  resulting_head_canonical_json TEXT CHECK(resulting_head_canonical_json IS NULL OR json_valid(resulting_head_canonical_json)),
  terminal_result_schema_version TEXT,
  terminal_result_canonical_json TEXT CHECK(terminal_result_canonical_json IS NULL OR json_valid(terminal_result_canonical_json)),
  terminal_result_hash TEXT CHECK(terminal_result_hash IS NULL OR (length(terminal_result_hash) = 71 AND substr(terminal_result_hash, 1, 7) = 'sha256:' AND substr(terminal_result_hash, 8) NOT GLOB '*[^0-9a-f]*')),
  state TEXT NOT NULL CHECK(state IN ('unreserved', 'in_progress', 'succeeded', 'rejected', 'quarantined')),
  created_at INTEGER NOT NULL CHECK(created_at BETWEEN 0 AND 9007199254740991),
  completed_at INTEGER CHECK(completed_at IS NULL OR completed_at BETWEEN created_at AND 9007199254740991),
  UNIQUE(operation, scope_id, idempotency_key),
  UNIQUE(binding_id, action_id, w01_commit_basis_hash),
  FOREIGN KEY(action_id) REFERENCES agent_mutation_actions_v2(action_id) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(run_id) REFERENCES agent_run_coordinators_v2(run_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id, project_id, action_id) REFERENCES agent_mutation_actions_v2(run_id, project_id, action_id) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(revision_commit_attempt_id) REFERENCES revision_commit_attempts(attempt_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(revision_id) REFERENCES vdt_revisions(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(resulting_vdt_id) REFERENCES vdts(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK((terminal_result_canonical_json IS NULL AND terminal_result_schema_version IS NULL AND terminal_result_hash IS NULL) OR (terminal_result_canonical_json IS NOT NULL AND terminal_result_schema_version IS NOT NULL AND terminal_result_hash IS NOT NULL)),
  CHECK((state = 'unreserved' AND revision_commit_attempt_id IS NULL AND completed_at IS NULL) OR (state = 'in_progress' AND revision_commit_attempt_id IS NOT NULL AND completed_at IS NULL) OR (state IN ('succeeded', 'rejected', 'quarantined') AND revision_commit_attempt_id IS NOT NULL AND terminal_result_hash IS NOT NULL AND completed_at IS NOT NULL)),
  CHECK((state = 'succeeded' AND revision_id IS NOT NULL AND resulting_vdt_id IS NOT NULL AND resulting_head_canonical_json IS NOT NULL) OR state <> 'succeeded')
) STRICT;

CREATE TABLE agent_mutation_reconciliations_v2 (
  reconciliation_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL CHECK(schema_version = 'agent_mutation_reconciliation.v1'),
  action_id TEXT NOT NULL UNIQUE,
  binding_id TEXT NOT NULL UNIQUE,
  run_id TEXT NOT NULL,
  barrier_command_id TEXT NOT NULL UNIQUE,
  barrier_attempt_id TEXT NOT NULL UNIQUE,
  cancel_execution_epoch INTEGER NOT NULL CHECK(cancel_execution_epoch >= 1 AND cancel_execution_epoch <= 9007199254740991),
  commit_barrier_command_sequence INTEGER NOT NULL CHECK(commit_barrier_command_sequence >= 1 AND commit_barrier_command_sequence <= 9007199254740991),
  w01_commit_basis_hash TEXT NOT NULL CHECK(length(w01_commit_basis_hash) = 71 AND substr(w01_commit_basis_hash, 1, 7) = 'sha256:' AND substr(w01_commit_basis_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  owner_token TEXT,
  lease_generation INTEGER NOT NULL CHECK(lease_generation >= 0 AND lease_generation <= 9007199254740991),
  lease_expires_at INTEGER CHECK(lease_expires_at IS NULL OR lease_expires_at BETWEEN 0 AND 9007199254740991),
  state TEXT NOT NULL CHECK(state IN ('pending', 'leased', 'w01_in_progress', 'settled')),
  outcome TEXT CHECK(outcome IS NULL OR outcome IN ('committed', 'rejected', 'quarantined')),
  created_at INTEGER NOT NULL CHECK(created_at BETWEEN 0 AND 9007199254740991),
  completed_at INTEGER CHECK(completed_at IS NULL OR completed_at BETWEEN created_at AND 9007199254740991),
  UNIQUE(run_id, action_id, barrier_command_id, barrier_attempt_id),
  UNIQUE(run_id, reconciliation_id),
  FOREIGN KEY(binding_id, action_id, w01_commit_basis_hash) REFERENCES agent_w01_commit_bindings_v2(binding_id, action_id, w01_commit_basis_hash) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id, action_id, barrier_command_id, barrier_attempt_id) REFERENCES agent_mutation_actions_v2(run_id, action_id, barrier_command_id, barrier_attempt_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(barrier_command_id) REFERENCES agent_run_commands_v2(command_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(barrier_attempt_id) REFERENCES agent_run_attempts_v2(attempt_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK((state = 'pending' AND owner_token IS NULL AND lease_generation = 0 AND lease_expires_at IS NULL AND outcome IS NULL AND completed_at IS NULL) OR (state IN ('leased', 'w01_in_progress') AND owner_token IS NOT NULL AND lease_generation >= 1 AND lease_expires_at IS NOT NULL AND outcome IS NULL AND completed_at IS NULL) OR (state = 'settled' AND owner_token IS NOT NULL AND lease_generation >= 1 AND lease_expires_at IS NOT NULL AND outcome IS NOT NULL AND completed_at IS NOT NULL))
) STRICT;

CREATE UNIQUE INDEX agent_mutation_reconciliations_one_nonterminal_uq
ON agent_mutation_reconciliations_v2(run_id ASC)
WHERE state IN ('pending', 'leased', 'w01_in_progress');

CREATE TABLE agent_merge_records_v2 (
  merge_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL CHECK(schema_version = 'agent_merge_record.v1'),
  action_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  vdt_id TEXT,
  merge_version INTEGER NOT NULL CHECK(merge_version >= 1 AND merge_version <= 9007199254740991),
  base_project_content_scheme TEXT NOT NULL CHECK(base_project_content_scheme IN ('legacy_graph_sha256', 'vdt_revision_payload_hash.v1')),
  base_project_content_hash TEXT NOT NULL CHECK(length(base_project_content_hash) = 71 AND substr(base_project_content_hash, 1, 7) = 'sha256:' AND substr(base_project_content_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  manual_project_content_scheme TEXT NOT NULL CHECK(manual_project_content_scheme IN ('legacy_graph_sha256', 'vdt_revision_payload_hash.v1')),
  manual_project_content_hash TEXT NOT NULL CHECK(length(manual_project_content_hash) = 71 AND substr(manual_project_content_hash, 1, 7) = 'sha256:' AND substr(manual_project_content_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  agent_project_content_scheme TEXT NOT NULL CHECK(agent_project_content_scheme IN ('legacy_graph_sha256', 'vdt_revision_payload_hash.v1')),
  agent_project_content_hash TEXT NOT NULL CHECK(length(agent_project_content_hash) = 71 AND substr(agent_project_content_hash, 1, 7) = 'sha256:' AND substr(agent_project_content_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  manual_operation_head_sequence INTEGER NOT NULL CHECK(manual_operation_head_sequence >= 0 AND manual_operation_head_sequence <= 9007199254740991),
  manual_operation_head_hash TEXT CHECK(manual_operation_head_hash IS NULL OR (length(manual_operation_head_hash) = 71 AND substr(manual_operation_head_hash, 1, 7) = 'sha256:' AND substr(manual_operation_head_hash, 8) NOT GLOB '*[^0-9a-f]*')),
  conflicts_canonical_json TEXT NOT NULL CHECK(json_valid(conflicts_canonical_json) AND json_type(conflicts_canonical_json) = 'array'),
  auto_merged_project_canonical_json TEXT CHECK(auto_merged_project_canonical_json IS NULL OR json_valid(auto_merged_project_canonical_json)),
  auto_merged_project_content_scheme TEXT CHECK(auto_merged_project_content_scheme IS NULL OR auto_merged_project_content_scheme IN ('legacy_graph_sha256', 'vdt_revision_payload_hash.v1')),
  auto_merged_project_content_hash TEXT CHECK(auto_merged_project_content_hash IS NULL OR (length(auto_merged_project_content_hash) = 71 AND substr(auto_merged_project_content_hash, 1, 7) = 'sha256:' AND substr(auto_merged_project_content_hash, 8) NOT GLOB '*[^0-9a-f]*')),
  state TEXT NOT NULL CHECK(state IN ('required', 'resolved', 'superseded')),
  merge_hash TEXT NOT NULL UNIQUE CHECK(length(merge_hash) = 71 AND substr(merge_hash, 1, 7) = 'sha256:' AND substr(merge_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  created_at INTEGER NOT NULL CHECK(created_at BETWEEN 0 AND 9007199254740991),
  resolved_at INTEGER CHECK(resolved_at IS NULL OR resolved_at BETWEEN created_at AND 9007199254740991),
  UNIQUE(action_id, merge_version),
  UNIQUE(merge_id, action_id, run_id),
  UNIQUE(run_id, project_id, merge_id, action_id),
  FOREIGN KEY(action_id) REFERENCES agent_mutation_actions_v2(action_id) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(run_id) REFERENCES agent_run_coordinators_v2(run_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(vdt_id) REFERENCES vdts(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id, project_id, action_id) REFERENCES agent_mutation_actions_v2(run_id, project_id, action_id) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CHECK((manual_operation_head_sequence = 0 AND manual_operation_head_hash IS NULL) OR (manual_operation_head_sequence > 0 AND manual_operation_head_hash IS NOT NULL)),
  CHECK((auto_merged_project_canonical_json IS NULL AND auto_merged_project_content_scheme IS NULL AND auto_merged_project_content_hash IS NULL) OR (auto_merged_project_canonical_json IS NOT NULL AND auto_merged_project_content_scheme IS NOT NULL AND auto_merged_project_content_hash IS NOT NULL)),
  CHECK((state = 'required' AND resolved_at IS NULL) OR (state IN ('resolved', 'superseded') AND resolved_at IS NOT NULL))
) STRICT;

CREATE TABLE agent_retry_budgets_v2 (
  run_id TEXT NOT NULL,
  retry_budget_epoch INTEGER NOT NULL CHECK(retry_budget_epoch >= 1 AND retry_budget_epoch <= 9007199254740991),
  schema_version TEXT NOT NULL CHECK(schema_version = 'agent_retry_budget_state.v1'),
  policy_schema_version TEXT NOT NULL CHECK(policy_schema_version = 'agent_retry_policy_snapshot.v1'),
  policy_version TEXT NOT NULL CHECK(policy_version = 'agent_retry_policy.v1'),
  max_automatic_retries_per_fingerprint INTEGER NOT NULL CHECK(max_automatic_retries_per_fingerprint = 3),
  max_automatic_retries_per_run INTEGER NOT NULL CHECK(max_automatic_retries_per_run = 8),
  max_automatic_retry_window_ms INTEGER NOT NULL CHECK(max_automatic_retry_window_ms = 300000),
  provider_429_base_delay_ms INTEGER NOT NULL CHECK(provider_429_base_delay_ms = 2000),
  timeout_transport_5xx_base_delay_ms INTEGER NOT NULL CHECK(timeout_transport_5xx_base_delay_ms = 1000),
  exponential_factor INTEGER NOT NULL CHECK(exponential_factor = 2),
  maximum_delay_ms INTEGER NOT NULL CHECK(maximum_delay_ms = 60000),
  jitter_minimum_basis_points INTEGER NOT NULL CHECK(jitter_minimum_basis_points = 8000),
  jitter_maximum_basis_points INTEGER NOT NULL CHECK(jitter_maximum_basis_points = 12000),
  automatic_retry_window_started_at INTEGER CHECK(automatic_retry_window_started_at IS NULL OR automatic_retry_window_started_at BETWEEN 0 AND 9007199254740991),
  automatic_retry_window_deadline_at INTEGER CHECK(automatic_retry_window_deadline_at IS NULL OR automatic_retry_window_deadline_at BETWEEN 0 AND 9007199254740991),
  automatic_retries_consumed INTEGER NOT NULL CHECK(automatic_retries_consumed BETWEEN 0 AND 8),
  state TEXT NOT NULL CHECK(state IN ('open', 'exhausted', 'cancelled')),
  created_at INTEGER NOT NULL CHECK(created_at BETWEEN 0 AND 9007199254740991),
  updated_at INTEGER NOT NULL CHECK(updated_at BETWEEN created_at AND 9007199254740991),
  PRIMARY KEY(run_id, retry_budget_epoch),
  FOREIGN KEY(run_id) REFERENCES agent_run_coordinators_v2(run_id) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CHECK((automatic_retry_window_started_at IS NULL AND automatic_retry_window_deadline_at IS NULL AND automatic_retries_consumed = 0) OR (automatic_retry_window_started_at IS NOT NULL AND automatic_retry_window_deadline_at = automatic_retry_window_started_at + 300000))
) STRICT;

CREATE TABLE agent_retry_records_v2 (
  retry_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL CHECK(schema_version = 'agent_retry_record.v1'),
  run_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  command_id TEXT NOT NULL,
  failed_attempt_id TEXT NOT NULL,
  failed_step_id TEXT NOT NULL,
  phase TEXT NOT NULL CHECK(length(phase) > 0),
  step_kind TEXT NOT NULL CHECK(step_kind IN ('provider_decision', 'tool_call', 'structured_output_repair')),
  failure_class TEXT NOT NULL CHECK(failure_class IN ('provider_429', 'provider_5xx', 'provider_timeout', 'transport', 'schema_repair', 'tool_retryable')),
  provider_or_tool_id TEXT NOT NULL CHECK(length(provider_or_tool_id) > 0),
  error_code TEXT NOT NULL CHECK(length(error_code) > 0),
  http_status_class TEXT NOT NULL CHECK(http_status_class IN ('none', '4xx', '5xx')),
  fingerprint TEXT NOT NULL CHECK(length(fingerprint) = 71 AND substr(fingerprint, 1, 7) = 'sha256:' AND substr(fingerprint, 8) NOT GLOB '*[^0-9a-f]*'),
  retry_budget_epoch INTEGER NOT NULL CHECK(retry_budget_epoch >= 1 AND retry_budget_epoch <= 9007199254740991),
  occurrence_for_fingerprint INTEGER NOT NULL CHECK(occurrence_for_fingerprint BETWEEN 1 AND 3),
  automatic_retry_number_for_run INTEGER NOT NULL CHECK(automatic_retry_number_for_run BETWEEN 1 AND 8),
  policy_schema_version TEXT NOT NULL CHECK(policy_schema_version = 'agent_retry_policy_snapshot.v1'),
  policy_version TEXT NOT NULL CHECK(policy_version = 'agent_retry_policy.v1'),
  max_automatic_retries_per_fingerprint INTEGER NOT NULL CHECK(max_automatic_retries_per_fingerprint = 3),
  max_automatic_retries_per_run INTEGER NOT NULL CHECK(max_automatic_retries_per_run = 8),
  max_automatic_retry_window_ms INTEGER NOT NULL CHECK(max_automatic_retry_window_ms = 300000),
  provider_429_base_delay_ms INTEGER NOT NULL CHECK(provider_429_base_delay_ms = 2000),
  timeout_transport_5xx_base_delay_ms INTEGER NOT NULL CHECK(timeout_transport_5xx_base_delay_ms = 1000),
  exponential_factor INTEGER NOT NULL CHECK(exponential_factor = 2),
  maximum_delay_ms INTEGER NOT NULL CHECK(maximum_delay_ms = 60000),
  jitter_minimum_basis_points INTEGER NOT NULL CHECK(jitter_minimum_basis_points = 8000),
  jitter_maximum_basis_points INTEGER NOT NULL CHECK(jitter_maximum_basis_points = 12000),
  automatic_retry_window_started_at INTEGER NOT NULL CHECK(automatic_retry_window_started_at BETWEEN 0 AND 9007199254740991),
  automatic_retry_window_deadline_at INTEGER NOT NULL CHECK(automatic_retry_window_deadline_at = automatic_retry_window_started_at + 300000),
  retry_after_ms INTEGER CHECK(retry_after_ms IS NULL OR retry_after_ms BETWEEN 0 AND 60000),
  computed_delay_ms INTEGER NOT NULL CHECK(computed_delay_ms BETWEEN 0 AND 60000),
  next_attempt_at INTEGER NOT NULL CHECK(next_attempt_at BETWEEN automatic_retry_window_started_at AND automatic_retry_window_deadline_at),
  claimed_attempt_id TEXT UNIQUE,
  state TEXT NOT NULL CHECK(state IN ('scheduled', 'claimed', 'succeeded', 'failed', 'cancelled')),
  created_at INTEGER NOT NULL CHECK(created_at BETWEEN automatic_retry_window_started_at AND automatic_retry_window_deadline_at),
  completed_at INTEGER CHECK(completed_at IS NULL OR completed_at BETWEEN created_at AND 9007199254740991),
  UNIQUE(run_id, retry_budget_epoch, fingerprint, occurrence_for_fingerprint),
  UNIQUE(run_id, project_id, retry_id),
  UNIQUE(run_id, project_id, retry_id, command_id),
  FOREIGN KEY(run_id, retry_budget_epoch) REFERENCES agent_retry_budgets_v2(run_id, retry_budget_epoch) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(command_id) REFERENCES agent_run_commands_v2(command_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(failed_attempt_id) REFERENCES agent_run_attempts_v2(attempt_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(claimed_attempt_id) REFERENCES agent_run_attempts_v2(attempt_id) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(run_id, project_id) REFERENCES agent_run_coordinators_v2(run_id, project_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id, project_id, command_id) REFERENCES agent_run_commands_v2(run_id, project_id, command_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id, project_id, failed_attempt_id) REFERENCES agent_run_attempts_v2(run_id, project_id, attempt_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id, project_id, claimed_attempt_id) REFERENCES agent_run_attempts_v2(run_id, project_id, attempt_id) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(run_id, project_id, failed_attempt_id, command_id) REFERENCES agent_run_attempts_v2(run_id, project_id, attempt_id, command_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id, project_id, claimed_attempt_id, command_id) REFERENCES agent_run_attempts_v2(run_id, project_id, attempt_id, command_id) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CHECK((state = 'scheduled' AND claimed_attempt_id IS NULL AND completed_at IS NULL) OR (state = 'claimed' AND claimed_attempt_id IS NOT NULL AND completed_at IS NULL) OR (state IN ('succeeded', 'failed') AND claimed_attempt_id IS NOT NULL AND completed_at IS NOT NULL) OR (state = 'cancelled' AND completed_at IS NOT NULL))
) STRICT;

CREATE INDEX agent_retry_records_due_idx
ON agent_retry_records_v2(state ASC, next_attempt_at ASC, run_id ASC, retry_budget_epoch ASC);

CREATE TABLE agent_run_outbox_v2 (
  event_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL CHECK(schema_version = 'agent_run_outbox_event.v1'),
  run_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  event_sequence INTEGER NOT NULL CHECK(event_sequence >= 1 AND event_sequence <= 9007199254740991),
  previous_event_hash TEXT CHECK(previous_event_hash IS NULL OR (length(previous_event_hash) = 71 AND substr(previous_event_hash, 1, 7) = 'sha256:' AND substr(previous_event_hash, 8) NOT GLOB '*[^0-9a-f]*')),
  event_hash TEXT NOT NULL CHECK(length(event_hash) = 71 AND substr(event_hash, 1, 7) = 'sha256:' AND substr(event_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  run_state_version INTEGER NOT NULL CHECK(run_state_version BETWEEN 0 AND 9007199254740991),
  execution_epoch INTEGER NOT NULL CHECK(execution_epoch BETWEEN 0 AND 9007199254740991),
  command_id TEXT,
  attempt_id TEXT,
  event_type TEXT NOT NULL CHECK(event_type IN ('command_accepted', 'command_started', 'command_completed', 'run_preferences_changed', 'public_status', 'manual_operation', 'effect_staged', 'mutation_proposed', 'mutation_committing', 'mutation_committed', 'merge_required', 'retry_scheduled', 'cancel_requested', 'run_interrupted', 'run_terminal', 'error')),
  public_payload_canonical_json TEXT NOT NULL CHECK(json_valid(public_payload_canonical_json)),
  created_at INTEGER NOT NULL CHECK(created_at BETWEEN 0 AND 9007199254740991),
  UNIQUE(run_id, event_sequence),
  UNIQUE(run_id, event_hash),
  FOREIGN KEY(run_id) REFERENCES agent_run_coordinators_v2(run_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(command_id) REFERENCES agent_run_commands_v2(command_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(attempt_id) REFERENCES agent_run_attempts_v2(attempt_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id, project_id) REFERENCES agent_run_coordinators_v2(run_id, project_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id, project_id, command_id) REFERENCES agent_run_commands_v2(run_id, project_id, command_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id, project_id, attempt_id) REFERENCES agent_run_attempts_v2(run_id, project_id, attempt_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id, project_id, attempt_id, command_id) REFERENCES agent_run_attempts_v2(run_id, project_id, attempt_id, command_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK((event_sequence = 1 AND previous_event_hash IS NULL) OR (event_sequence > 1 AND previous_event_hash IS NOT NULL))
) STRICT;

CREATE INDEX agent_run_outbox_tail_idx
ON agent_run_outbox_v2(run_id ASC, event_sequence DESC);

CREATE TABLE migration_transform_applications_v1 (
  database_id TEXT NOT NULL,
  migration_application_id TEXT NOT NULL CHECK(length(migration_application_id) = 86 AND substr(migration_application_id, 1, 22) = 'migration_application_' AND substr(migration_application_id, 23) NOT GLOB '*[^0-9a-f]*'),
  sequence INTEGER NOT NULL CHECK(sequence = 3),
  schema_version TEXT NOT NULL CHECK(schema_version = 'migration_transform_application.v1'),
  migration_id TEXT NOT NULL CHECK(migration_id = '003-durable-agent-run-coordination'),
  transform_id TEXT NOT NULL CHECK(transform_id = 'legacy-agent-run-adoption-v1'),
  transform_version INTEGER NOT NULL CHECK(transform_version = 1),
  artifact_format TEXT NOT NULL CHECK(artifact_format = 'wasm32-no-imports-v1'),
  abi_version TEXT NOT NULL CHECK(abi_version = 'legacy-agent-run-adoption-abi.v1'),
  module_checksum TEXT NOT NULL CHECK(length(module_checksum) = 71 AND substr(module_checksum, 1, 7) = 'sha256:' AND substr(module_checksum, 8) NOT GLOB '*[^0-9a-f]*'),
  contract_checksum TEXT NOT NULL CHECK(length(contract_checksum) = 71 AND substr(contract_checksum, 1, 7) = 'sha256:' AND substr(contract_checksum, 8) NOT GLOB '*[^0-9a-f]*'),
  golden_vectors_checksum TEXT NOT NULL CHECK(length(golden_vectors_checksum) = 71 AND substr(golden_vectors_checksum, 1, 7) = 'sha256:' AND substr(golden_vectors_checksum, 8) NOT GLOB '*[^0-9a-f]*'),
  input_legacy_run_count INTEGER NOT NULL CHECK(input_legacy_run_count >= 0 AND input_legacy_run_count <= 9007199254740991),
  inserted_adoption_count INTEGER NOT NULL CHECK(inserted_adoption_count = input_legacy_run_count),
  transform_result_hash TEXT NOT NULL CHECK(length(transform_result_hash) = 71 AND substr(transform_result_hash, 1, 7) = 'sha256:' AND substr(transform_result_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  applied_at INTEGER NOT NULL CHECK(applied_at BETWEEN 0 AND 9007199254740991),
  migration_attempt_id TEXT NOT NULL,
  backup_evidence_id TEXT NOT NULL,
  fence_owner_token TEXT NOT NULL CHECK(length(fence_owner_token) > 0),
  fence_lease_generation INTEGER NOT NULL CHECK(fence_lease_generation >= 1 AND fence_lease_generation <= 9007199254740991),
  target_manifest_hash TEXT NOT NULL CHECK(length(target_manifest_hash) = 71 AND substr(target_manifest_hash, 1, 7) = 'sha256:' AND substr(target_manifest_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  sql_checksum TEXT NOT NULL CHECK(length(sql_checksum) = 71 AND substr(sql_checksum, 1, 7) = 'sha256:' AND substr(sql_checksum, 8) NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY(database_id, migration_application_id, sequence),
  UNIQUE(migration_application_id, sequence, transform_id, transform_version),
  UNIQUE(database_id, migration_application_id, sequence, applied_at),
  FOREIGN KEY(database_id, migration_application_id, sequence) REFERENCES applied_migrations(database_id, application_id, sequence) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(database_id, migration_attempt_id, backup_evidence_id, target_manifest_hash, fence_owner_token, fence_lease_generation) REFERENCES migration_attempts(database_id, attempt_id, backup_evidence_id, target_manifest_hash, owner_token, lease_generation) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(database_id, backup_evidence_id, target_manifest_hash) REFERENCES migration_backup_evidence(database_id, backup_evidence_id, manifest_hash) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE legacy_agent_run_adoptions_v1 (
  run_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL CHECK(schema_version = 'legacy_agent_run_adoption.v1'),
  database_id TEXT NOT NULL,
  migration_application_id TEXT NOT NULL,
  migration_sequence INTEGER NOT NULL CHECK(migration_sequence = 3),
  project_id TEXT NOT NULL,
  vdt_id TEXT,
  conversation_id TEXT,
  original_status TEXT NOT NULL CHECK(original_status IN ('queued', 'running', 'needs_user_input', 'waiting_approval', 'succeeded', 'failed', 'cancelled')),
  original_phase TEXT NOT NULL CHECK(original_phase IN ('classifying_request', 'retrieving_skills', 'reading_skills', 'asking_clarifying_questions', 'planning_decomposition', 'building_graph', 'previewing_mutation', 'validating_graph', 'repairing_graph', 'applying_graph', 'reporting')),
  original_phase_utf8_byte_length INTEGER NOT NULL CHECK(original_phase_utf8_byte_length = length(CAST(original_phase AS BLOB))),
  original_phase_raw_utf8_hash TEXT NOT NULL CHECK(length(original_phase_raw_utf8_hash) = 71 AND substr(original_phase_raw_utf8_hash, 1, 7) = 'sha256:' AND substr(original_phase_raw_utf8_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  request_json_is_null INTEGER NOT NULL CHECK(request_json_is_null = 0),
  request_json_utf8_byte_length INTEGER NOT NULL CHECK(request_json_utf8_byte_length >= 0 AND request_json_utf8_byte_length <= 9007199254740991),
  request_json_raw_utf8_hash TEXT NOT NULL CHECK(length(request_json_raw_utf8_hash) = 71 AND substr(request_json_raw_utf8_hash, 1, 7) = 'sha256:' AND substr(request_json_raw_utf8_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  public_snapshot_json_is_null INTEGER NOT NULL CHECK(public_snapshot_json_is_null IN (0, 1)),
  public_snapshot_json_utf8_byte_length INTEGER NOT NULL CHECK(public_snapshot_json_utf8_byte_length >= 0 AND public_snapshot_json_utf8_byte_length <= 9007199254740991),
  public_snapshot_json_raw_utf8_hash TEXT CHECK(public_snapshot_json_raw_utf8_hash IS NULL OR (length(public_snapshot_json_raw_utf8_hash) = 71 AND substr(public_snapshot_json_raw_utf8_hash, 1, 7) = 'sha256:' AND substr(public_snapshot_json_raw_utf8_hash, 8) NOT GLOB '*[^0-9a-f]*')),
  internal_state_json_is_null INTEGER NOT NULL CHECK(internal_state_json_is_null IN (0, 1)),
  internal_state_json_utf8_byte_length INTEGER NOT NULL CHECK(internal_state_json_utf8_byte_length >= 0 AND internal_state_json_utf8_byte_length <= 9007199254740991),
  internal_state_json_raw_utf8_hash TEXT CHECK(internal_state_json_raw_utf8_hash IS NULL OR (length(internal_state_json_raw_utf8_hash) = 71 AND substr(internal_state_json_raw_utf8_hash, 1, 7) = 'sha256:' AND substr(internal_state_json_raw_utf8_hash, 8) NOT GLOB '*[^0-9a-f]*')),
  original_created_at_millis INTEGER NOT NULL CHECK(original_created_at_millis BETWEEN 0 AND 9007199254740991),
  original_updated_at_millis INTEGER NOT NULL CHECK(original_updated_at_millis BETWEEN original_created_at_millis AND 9007199254740991),
  original_completed_at_millis INTEGER CHECK(original_completed_at_millis IS NULL OR original_completed_at_millis BETWEEN original_created_at_millis AND original_updated_at_millis),
  disposition TEXT NOT NULL CHECK(disposition IN ('retained_terminal', 'interrupted_nonterminal')),
  projected_status TEXT NOT NULL CHECK(projected_status IN ('succeeded', 'failed', 'cancelled', 'interrupted_legacy')),
  legacy_row_hash TEXT NOT NULL CHECK(length(legacy_row_hash) = 71 AND substr(legacy_row_hash, 1, 7) = 'sha256:' AND substr(legacy_row_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  adopted_at INTEGER NOT NULL CHECK(adopted_at BETWEEN 0 AND 9007199254740991),
  UNIQUE(database_id, migration_application_id, migration_sequence, run_id),
  FOREIGN KEY(run_id) REFERENCES agent_runs(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(vdt_id) REFERENCES vdts(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(database_id, migration_application_id, migration_sequence) REFERENCES migration_transform_applications_v1(database_id, migration_application_id, sequence) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(database_id, migration_application_id, migration_sequence, adopted_at) REFERENCES migration_transform_applications_v1(database_id, migration_application_id, sequence, applied_at) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CHECK((public_snapshot_json_is_null = 1 AND public_snapshot_json_utf8_byte_length = 0 AND public_snapshot_json_raw_utf8_hash IS NULL) OR (public_snapshot_json_is_null = 0 AND public_snapshot_json_raw_utf8_hash IS NOT NULL)),
  CHECK((internal_state_json_is_null = 1 AND internal_state_json_utf8_byte_length = 0 AND internal_state_json_raw_utf8_hash IS NULL) OR (internal_state_json_is_null = 0 AND internal_state_json_raw_utf8_hash IS NOT NULL)),
  CHECK((original_status IN ('queued', 'running', 'needs_user_input', 'waiting_approval') AND original_completed_at_millis IS NULL AND disposition = 'interrupted_nonterminal' AND projected_status = 'interrupted_legacy') OR (original_status IN ('succeeded', 'failed', 'cancelled') AND original_completed_at_millis IS NOT NULL AND disposition = 'retained_terminal' AND projected_status = original_status))
) STRICT;

CREATE TRIGGER agent_run_coordinators_start_basis_insert_guard
BEFORE INSERT ON agent_run_coordinators_v2
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM agent_run_feature_snapshots_v2 AS s
    WHERE s.run_id = NEW.run_id
      AND s.project_id = NEW.project_id
      AND s.snapshot_hash = NEW.feature_snapshot_hash
      AND s.config_version = NEW.feature_config_version
      AND s.config_hash = NEW.feature_config_hash
      AND s.runtime_generation = NEW.runtime_generation
      AND s.generation_version = NEW.generation_version
  ) THEN RAISE(ABORT, 'coordinator_feature_snapshot_basis_mismatch') END;
END;

CREATE TRIGGER agent_run_coordinators_immutable_delete
BEFORE DELETE ON agent_run_coordinators_v2
BEGIN
  SELECT RAISE(ABORT, 'run_coordinator_is_durable');
END;

CREATE TRIGGER agent_run_feature_snapshots_immutable_update
BEFORE UPDATE ON agent_run_feature_snapshots_v2
BEGIN
  SELECT RAISE(ABORT, 'feature_snapshot_is_immutable');
END;

CREATE TRIGGER agent_run_feature_snapshots_immutable_delete
BEFORE DELETE ON agent_run_feature_snapshots_v2
BEGIN
  SELECT RAISE(ABORT, 'feature_snapshot_is_immutable');
END;

CREATE TRIGGER agent_run_preferences_chain_insert_guard
BEFORE INSERT ON agent_run_preferences_v2
WHEN NEW.preference_version > 1
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM agent_run_preferences_v2 AS p
    WHERE p.run_id = NEW.run_id
      AND p.preference_version = NEW.preference_version - 1
      AND p.preference_hash = NEW.previous_preference_hash
      AND p.max_auto_depth = NEW.max_auto_depth
      AND p.continue_with_assumptions = NEW.continue_with_assumptions
  ) THEN RAISE(ABORT, 'preference_chain_mismatch') END;
END;

CREATE TRIGGER agent_run_preferences_immutable_update
BEFORE UPDATE ON agent_run_preferences_v2
BEGIN
  SELECT RAISE(ABORT, 'run_preference_is_immutable');
END;

CREATE TRIGGER agent_run_preferences_immutable_delete
BEFORE DELETE ON agent_run_preferences_v2
BEGIN
  SELECT RAISE(ABORT, 'run_preference_is_immutable');
END;

CREATE TRIGGER agent_run_commands_drive_insert_guard
BEFORE INSERT ON agent_run_commands_v2
WHEN NEW.kind = 'drive_run'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM agent_run_commands_v2 AS predecessor
    JOIN agent_run_commands_v2 AS initiating
      ON initiating.command_id = NEW.initiating_external_command_id
    WHERE predecessor.command_id = NEW.predecessor_command_id
      AND predecessor.run_id = NEW.run_id
      AND predecessor.terminal_result_hash = NEW.predecessor_result_hash
      AND predecessor.status IN ('succeeded', 'rejected', 'superseded', 'cancelled')
      AND initiating.run_id = NEW.run_id
      AND initiating.actor_auth_source IN ('desktop_local', 'hosted_session')
      AND initiating.actor_principal_id = NEW.initiating_actor_principal_id
      AND initiating.actor_auth_source = NEW.initiating_actor_auth_source
  ) THEN RAISE(ABORT, 'drive_command_basis_mismatch') END;
END;

CREATE TRIGGER agent_run_commands_immutable_request_guard
BEFORE UPDATE ON agent_run_commands_v2
WHEN NEW.command_id <> OLD.command_id
  OR NEW.schema_version <> OLD.schema_version
  OR NEW.run_id <> OLD.run_id
  OR NEW.scope_id <> OLD.scope_id
  OR NEW.project_id <> OLD.project_id
  OR NEW.actor_principal_id <> OLD.actor_principal_id
  OR NEW.actor_auth_source <> OLD.actor_auth_source
  OR NEW.command_sequence <> OLD.command_sequence
  OR NEW.kind <> OLD.kind
  OR NEW.operation <> OLD.operation
  OR NEW.idempotency_key <> OLD.idempotency_key
  OR NEW.request_hash <> OLD.request_hash
  OR NEW.observed_run_state_version IS NOT OLD.observed_run_state_version
  OR NEW.observed_execution_epoch <> OLD.observed_execution_epoch
  OR NEW.payload_type <> OLD.payload_type
  OR NEW.payload_canonical_json <> OLD.payload_canonical_json
  OR NEW.predecessor_command_id IS NOT OLD.predecessor_command_id
  OR NEW.predecessor_result_hash IS NOT OLD.predecessor_result_hash
  OR NEW.initiating_external_command_id IS NOT OLD.initiating_external_command_id
  OR NEW.initiating_actor_principal_id IS NOT OLD.initiating_actor_principal_id
  OR NEW.initiating_actor_auth_source IS NOT OLD.initiating_actor_auth_source
  OR NEW.turn_number IS NOT OLD.turn_number
  OR NEW.enqueued_at <> OLD.enqueued_at
  OR (OLD.claimed_attempt_id IS NOT NULL AND NEW.claimed_attempt_id IS NOT OLD.claimed_attempt_id)
BEGIN
  SELECT RAISE(ABORT, 'command_immutable_request_changed');
END;

CREATE TRIGGER agent_run_commands_transition_guard
BEFORE UPDATE OF status ON agent_run_commands_v2
WHEN NEW.status <> OLD.status
  AND NOT (
    (OLD.status = 'queued' AND NEW.status IN ('claimed', 'succeeded', 'rejected', 'superseded', 'cancelled'))
    OR (OLD.status = 'claimed' AND NEW.status IN ('reconciliation_pending', 'succeeded', 'rejected', 'superseded', 'cancelled'))
    OR (OLD.status = 'reconciliation_pending' AND NEW.status IN ('succeeded', 'rejected', 'cancelled'))
  )
BEGIN
  SELECT RAISE(ABORT, 'command_transition_invalid');
END;

CREATE TRIGGER agent_run_commands_terminal_immutable_guard
BEFORE UPDATE ON agent_run_commands_v2
WHEN OLD.status IN ('succeeded', 'rejected', 'superseded', 'cancelled')
BEGIN
  SELECT RAISE(ABORT, 'terminal_command_is_immutable');
END;

CREATE TRIGGER agent_run_commands_immutable_delete
BEFORE DELETE ON agent_run_commands_v2
BEGIN
  SELECT RAISE(ABORT, 'run_command_is_durable');
END;

CREATE TRIGGER agent_command_execution_bases_insert_guard
BEFORE INSERT ON agent_command_execution_bases_v2
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM agent_run_attempts_v2 AS a
    WHERE a.attempt_id = NEW.attempt_id
      AND a.command_id = NEW.command_id
      AND a.work_command_id = NEW.work_command_id
      AND a.execution_basis_hash = NEW.execution_basis_hash
      AND (
        NEW.active_question_set_id_at_claim IS NULL
        OR EXISTS (
          SELECT 1
          FROM agent_question_sets_v2 AS q
          WHERE q.question_set_id = NEW.active_question_set_id_at_claim
            AND q.run_id = a.run_id
            AND q.project_id = a.project_id
        )
      )
      AND (
        NEW.active_mutation_action_id_at_claim IS NULL
        OR EXISTS (
          SELECT 1
          FROM agent_mutation_actions_v2 AS m
          WHERE m.action_id = NEW.active_mutation_action_id_at_claim
            AND m.run_id = a.run_id
            AND m.project_id = a.project_id
        )
      )
  ) THEN RAISE(ABORT, 'execution_basis_attempt_mismatch') END;
END;

CREATE TRIGGER agent_command_execution_bases_immutable_update
BEFORE UPDATE ON agent_command_execution_bases_v2
BEGIN
  SELECT RAISE(ABORT, 'execution_basis_is_immutable');
END;

CREATE TRIGGER agent_command_execution_bases_immutable_delete
BEFORE DELETE ON agent_command_execution_bases_v2
BEGIN
  SELECT RAISE(ABORT, 'execution_basis_is_immutable');
END;

CREATE TRIGGER agent_run_attempts_identity_update_guard
BEFORE UPDATE ON agent_run_attempts_v2
WHEN NEW.attempt_id <> OLD.attempt_id
  OR NEW.run_id <> OLD.run_id
  OR NEW.project_id <> OLD.project_id
  OR NEW.command_id <> OLD.command_id
  OR NEW.work_command_id <> OLD.work_command_id
  OR NEW.command_sequence <> OLD.command_sequence
  OR NEW.attempt_number <> OLD.attempt_number
  OR NEW.retry_record_id IS NOT OLD.retry_record_id
  OR NEW.retry_of_attempt_id IS NOT OLD.retry_of_attempt_id
  OR NEW.execution_epoch <> OLD.execution_epoch
  OR NEW.execution_basis_hash <> OLD.execution_basis_hash
  OR NEW.started_at <> OLD.started_at
BEGIN
  SELECT RAISE(ABORT, 'attempt_immutable_identity_changed');
END;

CREATE TRIGGER agent_run_attempts_initial_state_insert_guard
BEFORE INSERT ON agent_run_attempts_v2
WHEN NEW.state <> 'claimed'
BEGIN
  SELECT RAISE(ABORT, 'attempt_must_start_claimed');
END;

CREATE TRIGGER agent_run_attempts_pointer_update_guard
BEFORE UPDATE ON agent_run_attempts_v2
BEGIN
  SELECT CASE WHEN NEW.provider_call_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM agent_provider_decisions_v2 AS d
    WHERE d.decision_id = NEW.provider_call_id
      AND d.run_id = NEW.run_id
      AND d.project_id = NEW.project_id
      AND d.attempt_id = NEW.attempt_id
      AND d.command_id = NEW.command_id
  ) THEN RAISE(ABORT, 'attempt_provider_pointer_mismatch') END;
  SELECT CASE WHEN NEW.tool_call_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM agent_tool_calls_v2 AS t
    WHERE t.tool_call_id = NEW.tool_call_id
      AND t.run_id = NEW.run_id
      AND t.project_id = NEW.project_id
      AND t.attempt_id = NEW.attempt_id
      AND t.command_id = NEW.command_id
  ) THEN RAISE(ABORT, 'attempt_tool_pointer_mismatch') END;
  SELECT CASE WHEN NEW.effect_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM agent_run_effects_v2 AS e
    WHERE e.effect_id = NEW.effect_id
      AND e.run_id = NEW.run_id
      AND e.project_id = NEW.project_id
      AND e.attempt_id = NEW.attempt_id
      AND e.command_id = NEW.command_id
  ) THEN RAISE(ABORT, 'attempt_effect_pointer_mismatch') END;
  SELECT CASE WHEN NEW.mutation_action_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM agent_mutation_actions_v2 AS a
    WHERE a.action_id = NEW.mutation_action_id
      AND a.run_id = NEW.run_id
      AND a.project_id = NEW.project_id
  ) THEN RAISE(ABORT, 'attempt_mutation_pointer_mismatch') END;
END;

CREATE TRIGGER agent_run_attempts_transition_guard
BEFORE UPDATE OF state ON agent_run_attempts_v2
WHEN NOT (
  (OLD.state = 'claimed' AND NEW.state IN ('claimed', 'running', 'interrupted', 'cancelled'))
  OR (OLD.state = 'running' AND NEW.state IN ('running', 'effect_staged', 'completed', 'rejected', 'retry_scheduled', 'interrupted', 'cancelled'))
  OR (OLD.state = 'effect_staged' AND NEW.state IN ('effect_staged', 'committing', 'completed', 'rejected', 'interrupted', 'cancelled'))
  OR (OLD.state = 'committing' AND NEW.state IN ('committing', 'completed', 'rejected', 'interrupted', 'lease_lost'))
)
BEGIN
  SELECT RAISE(ABORT, 'attempt_transition_invalid');
END;

CREATE TRIGGER agent_run_attempts_immutable_delete
BEFORE DELETE ON agent_run_attempts_v2
BEGIN
  SELECT RAISE(ABORT, 'run_attempt_is_durable');
END;

CREATE TRIGGER agent_provider_decisions_insert_guard
BEFORE INSERT ON agent_provider_decisions_v2
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM agent_run_attempts_v2 AS a
    WHERE a.attempt_id = NEW.attempt_id
      AND a.run_id = NEW.run_id
      AND a.project_id = NEW.project_id
      AND a.command_id = NEW.command_id
      AND a.state = 'running'
  ) THEN RAISE(ABORT, 'provider_receipt_attempt_mismatch') END;
END;

CREATE TRIGGER agent_provider_decisions_immutable_identity_guard
BEFORE UPDATE ON agent_provider_decisions_v2
WHEN NEW.decision_id <> OLD.decision_id
  OR NEW.run_id <> OLD.run_id
  OR NEW.project_id <> OLD.project_id
  OR NEW.command_id <> OLD.command_id
  OR NEW.attempt_id <> OLD.attempt_id
  OR NEW.turn_budget_epoch <> OLD.turn_budget_epoch
  OR NEW.turn_number <> OLD.turn_number
  OR NEW.provider_binding_id <> OLD.provider_binding_id
  OR NEW.provider_id <> OLD.provider_id
  OR NEW.model <> OLD.model
  OR NEW.non_secret_settings_hash <> OLD.non_secret_settings_hash
  OR NEW.call_idempotency_key <> OLD.call_idempotency_key
  OR NEW.input_canonical_json <> OLD.input_canonical_json
  OR NEW.input_hash <> OLD.input_hash
  OR NEW.prepared_at <> OLD.prepared_at
BEGIN
  SELECT RAISE(ABORT, 'provider_receipt_immutable_identity_changed');
END;

CREATE TRIGGER agent_provider_decisions_transition_guard
BEFORE UPDATE OF state ON agent_provider_decisions_v2
WHEN NOT (
  (OLD.state = 'prepared' AND NEW.state IN ('prepared', 'in_flight', 'failed'))
  OR (OLD.state = 'in_flight' AND NEW.state IN ('in_flight', 'completed', 'failed', 'ambiguous'))
)
BEGIN
  SELECT RAISE(ABORT, 'provider_receipt_transition_invalid');
END;

CREATE TRIGGER agent_tool_calls_insert_guard
BEFORE INSERT ON agent_tool_calls_v2
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM agent_run_attempts_v2 AS a
    JOIN agent_provider_decisions_v2 AS d
      ON d.decision_id = NEW.decision_id
    WHERE a.attempt_id = NEW.attempt_id
      AND a.run_id = NEW.run_id
      AND a.project_id = NEW.project_id
      AND a.command_id = NEW.command_id
      AND a.state = 'running'
      AND d.attempt_id = NEW.attempt_id
      AND d.state = 'completed'
  ) THEN RAISE(ABORT, 'tool_receipt_attempt_or_decision_mismatch') END;
END;

CREATE TRIGGER agent_tool_calls_transition_guard
BEFORE UPDATE OF state ON agent_tool_calls_v2
WHEN NOT (
  (OLD.state = 'prepared' AND NEW.state IN ('prepared', 'in_flight', 'failed'))
  OR (OLD.state = 'in_flight' AND NEW.state IN ('in_flight', 'completed', 'failed', 'ambiguous'))
)
BEGIN
  SELECT RAISE(ABORT, 'tool_receipt_transition_invalid');
END;

CREATE TRIGGER agent_tool_calls_immutable_identity_guard
BEFORE UPDATE ON agent_tool_calls_v2
WHEN NEW.tool_call_id <> OLD.tool_call_id
  OR NEW.schema_version <> OLD.schema_version
  OR NEW.run_id <> OLD.run_id
  OR NEW.project_id <> OLD.project_id
  OR NEW.command_id <> OLD.command_id
  OR NEW.attempt_id <> OLD.attempt_id
  OR NEW.decision_id <> OLD.decision_id
  OR NEW.registry_snapshot_hash <> OLD.registry_snapshot_hash
  OR NEW.tool_name <> OLD.tool_name
  OR NEW.tool_contract_version <> OLD.tool_contract_version
  OR NEW.capability_class <> OLD.capability_class
  OR NEW.adapter <> OLD.adapter
  OR NEW.call_idempotency_key <> OLD.call_idempotency_key
  OR NEW.input_canonical_json <> OLD.input_canonical_json
  OR NEW.input_hash <> OLD.input_hash
  OR NEW.prepared_at <> OLD.prepared_at
BEGIN
  SELECT RAISE(ABORT, 'tool_receipt_immutable_identity_changed');
END;

CREATE TRIGGER agent_provider_decisions_terminal_immutable_guard
BEFORE UPDATE ON agent_provider_decisions_v2
WHEN OLD.state IN ('completed', 'failed', 'ambiguous')
BEGIN
  SELECT RAISE(ABORT, 'terminal_provider_receipt_is_immutable');
END;

CREATE TRIGGER agent_tool_calls_terminal_immutable_guard
BEFORE UPDATE ON agent_tool_calls_v2
WHEN OLD.state IN ('completed', 'failed', 'ambiguous')
BEGIN
  SELECT RAISE(ABORT, 'terminal_tool_receipt_is_immutable');
END;

CREATE TRIGGER agent_provider_decisions_immutable_delete
BEFORE DELETE ON agent_provider_decisions_v2
BEGIN
  SELECT RAISE(ABORT, 'provider_receipt_is_durable');
END;

CREATE TRIGGER agent_tool_calls_immutable_delete
BEFORE DELETE ON agent_tool_calls_v2
BEGIN
  SELECT RAISE(ABORT, 'tool_receipt_is_durable');
END;

CREATE TRIGGER agent_run_effects_insert_guard
BEFORE INSERT ON agent_run_effects_v2
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM agent_provider_decisions_v2 AS d
    WHERE d.decision_id = NEW.provider_decision_id
      AND d.attempt_id = NEW.attempt_id
      AND d.run_id = NEW.run_id
      AND d.project_id = NEW.project_id
      AND d.command_id = NEW.command_id
      AND d.state IN ('completed', 'failed', 'ambiguous')
      AND d.terminal_receipt_hash = NEW.provider_terminal_receipt_hash
  ) THEN RAISE(ABORT, 'effect_provider_receipt_mismatch') END;
  SELECT CASE WHEN NEW.tool_call_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM agent_tool_calls_v2 AS t
    WHERE t.tool_call_id = NEW.tool_call_id
      AND t.attempt_id = NEW.attempt_id
      AND t.run_id = NEW.run_id
      AND t.project_id = NEW.project_id
      AND t.command_id = NEW.command_id
      AND t.state IN ('completed', 'failed', 'ambiguous')
      AND t.terminal_receipt_hash = NEW.tool_terminal_receipt_hash
  ) THEN RAISE(ABORT, 'effect_tool_receipt_mismatch') END;
END;

CREATE TRIGGER agent_run_effects_immutable_update
BEFORE UPDATE ON agent_run_effects_v2
BEGIN
  SELECT RAISE(ABORT, 'run_effect_is_immutable');
END;

CREATE TRIGGER agent_run_effects_immutable_delete
BEFORE DELETE ON agent_run_effects_v2
BEGIN
  SELECT RAISE(ABORT, 'run_effect_is_immutable');
END;

CREATE TRIGGER agent_coordinator_effect_commits_identity_update_guard
BEFORE UPDATE ON agent_coordinator_effect_commits_v2
WHEN NEW.commit_id <> OLD.commit_id
  OR NEW.schema_version <> OLD.schema_version
  OR NEW.effect_id <> OLD.effect_id
  OR NEW.run_id <> OLD.run_id
  OR NEW.command_id <> OLD.command_id
  OR NEW.adapter <> OLD.adapter
  OR NEW.adapter_idempotency_key <> OLD.adapter_idempotency_key
  OR NEW.effect_hash <> OLD.effect_hash
  OR NEW.created_at <> OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'coordinator_effect_commit_identity_changed');
END;

CREATE TRIGGER agent_coordinator_effect_commits_insert_guard
BEFORE INSERT ON agent_coordinator_effect_commits_v2
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM agent_run_effects_v2 AS e
    WHERE e.effect_id = NEW.effect_id
      AND e.run_id = NEW.run_id
      AND e.command_id = NEW.command_id
      AND e.effect_hash = NEW.effect_hash
  ) THEN RAISE(ABORT, 'coordinator_effect_commit_identity_mismatch') END;
END;

CREATE TRIGGER agent_coordinator_effect_commits_transition_guard
BEFORE UPDATE OF state ON agent_coordinator_effect_commits_v2
WHEN NEW.state <> OLD.state
  AND NOT (
    (OLD.state = 'prepared' AND NEW.state IN ('in_flight', 'committed', 'rejected'))
    OR (OLD.state = 'in_flight' AND NEW.state IN ('committed', 'rejected', 'ambiguous'))
  )
BEGIN
  SELECT RAISE(ABORT, 'coordinator_effect_commit_transition_invalid');
END;

CREATE TRIGGER agent_coordinator_effect_commits_terminal_immutable_guard
BEFORE UPDATE ON agent_coordinator_effect_commits_v2
WHEN OLD.state IN ('committed', 'rejected', 'ambiguous')
BEGIN
  SELECT RAISE(ABORT, 'terminal_coordinator_effect_commit_is_immutable');
END;

CREATE TRIGGER agent_coordinator_effect_commits_immutable_delete
BEFORE DELETE ON agent_coordinator_effect_commits_v2
BEGIN
  SELECT RAISE(ABORT, 'coordinator_effect_commit_is_durable');
END;

CREATE TRIGGER agent_run_project_states_insert_guard
BEFORE INSERT ON agent_run_project_states_v2
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM agent_run_coordinators_v2 AS c
    WHERE c.run_id = NEW.run_id
      AND c.project_id = NEW.project_id
      AND c.vdt_id IS NEW.vdt_id
  ) THEN RAISE(ABORT, 'run_project_state_coordinator_mismatch') END;
END;

CREATE TRIGGER agent_run_project_states_identity_update_guard
BEFORE UPDATE ON agent_run_project_states_v2
WHEN NEW.run_id <> OLD.run_id
  OR NEW.schema_version <> OLD.schema_version
  OR NEW.project_id <> OLD.project_id
BEGIN
  SELECT RAISE(ABORT, 'run_project_state_identity_changed');
END;

CREATE TRIGGER agent_run_project_states_coordinator_update_guard
BEFORE UPDATE ON agent_run_project_states_v2
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM agent_run_coordinators_v2 AS c
    WHERE c.run_id = NEW.run_id
      AND c.project_id = NEW.project_id
      AND c.vdt_id IS NEW.vdt_id
  ) THEN RAISE(ABORT, 'run_project_state_coordinator_mismatch') END;
END;

CREATE TRIGGER agent_run_project_states_immutable_delete
BEFORE DELETE ON agent_run_project_states_v2
BEGIN
  SELECT RAISE(ABORT, 'run_project_state_is_durable');
END;

CREATE TRIGGER agent_manual_operations_insert_guard
BEFORE INSERT ON agent_manual_operations_v2
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM agent_run_commands_v2 AS c
    WHERE c.command_id = NEW.command_id
      AND c.run_id = NEW.run_id
      AND c.project_id = NEW.project_id
      AND c.kind = 'manual_operation'
      AND c.claimed_attempt_id IS NULL
      AND c.status IN ('succeeded', 'rejected')
      AND c.completed_at IS NOT NULL
  ) THEN RAISE(ABORT, 'manual_operation_command_mismatch') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM agent_run_project_states_v2 AS p
    WHERE p.run_id = NEW.run_id
      AND p.project_id = NEW.project_id
      AND p.vdt_id IS NEW.vdt_id
  ) THEN RAISE(ABORT, 'manual_operation_project_state_mismatch') END;
  SELECT CASE WHEN NEW.operation_sequence > 1 AND NOT EXISTS (
    SELECT 1
    FROM agent_manual_operations_v2 AS p
    WHERE p.run_id = NEW.run_id
      AND p.operation_sequence = NEW.operation_sequence - 1
      AND p.operation_hash = NEW.previous_operation_hash
  ) THEN RAISE(ABORT, 'manual_operation_global_chain_mismatch') END;
  SELECT CASE WHEN NEW.editing_session_sequence > 1 AND NOT EXISTS (
    SELECT 1
    FROM agent_manual_operations_v2 AS p
    WHERE p.run_id = NEW.run_id
      AND p.editing_session_id = NEW.editing_session_id
      AND p.editing_session_sequence = NEW.editing_session_sequence - 1
      AND p.operation_hash = NEW.previous_editing_session_operation_hash
  ) THEN RAISE(ABORT, 'manual_operation_session_chain_mismatch') END;
END;

CREATE TRIGGER agent_manual_editing_sessions_replacement_insert_guard
BEFORE INSERT ON agent_manual_editing_sessions_v2
WHEN NEW.replacement_editing_session_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM agent_manual_editing_sessions_v2 AS replacement
    WHERE replacement.run_id = NEW.run_id
      AND replacement.editing_session_id = NEW.replacement_editing_session_id
      AND replacement.actor_principal_id = NEW.actor_principal_id
  ) THEN RAISE(ABORT, 'manual_replacement_session_actor_mismatch') END;
END;

CREATE TRIGGER agent_manual_editing_sessions_replacement_update_guard
BEFORE UPDATE OF replacement_editing_session_id ON agent_manual_editing_sessions_v2
WHEN NEW.replacement_editing_session_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM agent_manual_editing_sessions_v2 AS replacement
    WHERE replacement.run_id = NEW.run_id
      AND replacement.editing_session_id = NEW.replacement_editing_session_id
      AND replacement.actor_principal_id = NEW.actor_principal_id
  ) THEN RAISE(ABORT, 'manual_replacement_session_actor_mismatch') END;
END;

CREATE TRIGGER agent_manual_editing_sessions_identity_update_guard
BEFORE UPDATE ON agent_manual_editing_sessions_v2
WHEN NEW.run_id <> OLD.run_id
  OR NEW.editing_session_id <> OLD.editing_session_id
  OR NEW.schema_version <> OLD.schema_version
  OR NEW.actor_principal_id <> OLD.actor_principal_id
  OR NEW.created_at <> OLD.created_at
  OR (OLD.replacement_editing_session_id IS NOT NULL AND NEW.replacement_editing_session_id IS NOT OLD.replacement_editing_session_id)
BEGIN
  SELECT RAISE(ABORT, 'manual_editing_session_identity_changed');
END;

CREATE TRIGGER agent_manual_editing_sessions_immutable_delete
BEFORE DELETE ON agent_manual_editing_sessions_v2
BEGIN
  SELECT RAISE(ABORT, 'manual_editing_session_is_durable');
END;

CREATE TRIGGER agent_manual_operations_immutable_update
BEFORE UPDATE ON agent_manual_operations_v2
BEGIN
  SELECT RAISE(ABORT, 'manual_operation_is_immutable');
END;

CREATE TRIGGER agent_manual_operations_immutable_delete
BEFORE DELETE ON agent_manual_operations_v2
BEGIN
  SELECT RAISE(ABORT, 'manual_operation_is_immutable');
END;

CREATE TRIGGER agent_manual_resync_bases_immutable_update
BEFORE UPDATE ON agent_manual_resync_bases_v2
BEGIN
  SELECT RAISE(ABORT, 'manual_resync_basis_is_immutable');
END;

CREATE TRIGGER agent_manual_resync_bases_insert_guard
BEFORE INSERT ON agent_manual_resync_bases_v2
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM agent_manual_operations_v2 AS o
    WHERE o.operation_id = NEW.blocked_operation_id
      AND o.run_id = NEW.run_id
      AND o.editing_session_id = NEW.blocked_editing_session_id
      AND o.status IN ('gap', 'conflict')
  ) THEN RAISE(ABORT, 'manual_resync_basis_operation_mismatch') END;
END;

CREATE TRIGGER agent_manual_resync_bases_immutable_delete
BEFORE DELETE ON agent_manual_resync_bases_v2
BEGIN
  SELECT RAISE(ABORT, 'manual_resync_basis_is_immutable');
END;

CREATE TRIGGER agent_question_answers_insert_guard
BEFORE INSERT ON agent_question_answers_v2
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM agent_question_sets_v2 AS q
    WHERE q.question_set_id = NEW.question_set_id
      AND q.question_set_hash = NEW.question_set_hash
      AND q.run_id = NEW.run_id
      AND q.state = 'active'
  ) THEN RAISE(ABORT, 'question_answer_not_for_active_set') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM agent_run_commands_v2 AS c
    WHERE c.command_id = NEW.command_id
      AND c.run_id = NEW.run_id
      AND c.kind = 'answer'
      AND c.status = 'claimed'
      AND c.claimed_attempt_id IS NOT NULL
  ) THEN RAISE(ABORT, 'question_answer_command_mismatch') END;
END;

CREATE TRIGGER agent_question_sets_identity_update_guard
BEFORE UPDATE ON agent_question_sets_v2
WHEN NEW.question_set_id <> OLD.question_set_id
  OR NEW.schema_version <> OLD.schema_version
  OR NEW.run_id <> OLD.run_id
  OR NEW.project_id <> OLD.project_id
  OR NEW.command_id <> OLD.command_id
  OR NEW.attempt_id <> OLD.attempt_id
  OR NEW.effect_id <> OLD.effect_id
  OR NEW.questions_canonical_json <> OLD.questions_canonical_json
  OR NEW.question_set_hash <> OLD.question_set_hash
  OR NEW.created_at <> OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'question_set_immutable_identity_changed');
END;

CREATE TRIGGER agent_question_sets_transition_guard
BEFORE UPDATE OF state ON agent_question_sets_v2
WHEN NEW.state <> OLD.state
  AND NOT (
    (OLD.state = 'staged' AND NEW.state IN ('active', 'superseded', 'cancelled'))
    OR (OLD.state = 'active' AND NEW.state IN ('answered', 'superseded', 'cancelled'))
  )
BEGIN
  SELECT RAISE(ABORT, 'question_set_transition_invalid');
END;

CREATE TRIGGER agent_question_sets_answer_binding_update_guard
BEFORE UPDATE OF state ON agent_question_sets_v2
WHEN NEW.state = 'answered'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM agent_question_answers_v2 AS a
    WHERE a.question_set_id = NEW.question_set_id
      AND a.question_set_hash = NEW.question_set_hash
      AND a.run_id = NEW.run_id
      AND a.command_id = NEW.answer_command_id
      AND a.answer_hash = NEW.answer_receipt_hash
  ) THEN RAISE(ABORT, 'question_set_answer_receipt_mismatch') END;
END;

CREATE TRIGGER agent_question_sets_terminal_immutable_guard
BEFORE UPDATE ON agent_question_sets_v2
WHEN OLD.state IN ('answered', 'superseded', 'cancelled')
BEGIN
  SELECT RAISE(ABORT, 'terminal_question_set_is_immutable');
END;

CREATE TRIGGER agent_question_sets_immutable_delete
BEFORE DELETE ON agent_question_sets_v2
BEGIN
  SELECT RAISE(ABORT, 'question_set_is_durable');
END;

CREATE TRIGGER agent_question_answers_immutable_update
BEFORE UPDATE ON agent_question_answers_v2
BEGIN
  SELECT RAISE(ABORT, 'question_answer_is_immutable');
END;

CREATE TRIGGER agent_question_answers_immutable_delete
BEFORE DELETE ON agent_question_answers_v2
BEGIN
  SELECT RAISE(ABORT, 'question_answer_is_immutable');
END;

CREATE TRIGGER agent_mutation_approval_policies_immutable_update
BEFORE UPDATE ON agent_mutation_approval_policies_v2
BEGIN
  SELECT RAISE(ABORT, 'approval_policy_is_immutable');
END;

CREATE TRIGGER agent_mutation_approval_policies_immutable_delete
BEFORE DELETE ON agent_mutation_approval_policies_v2
BEGIN
  SELECT RAISE(ABORT, 'approval_policy_is_immutable');
END;

CREATE TRIGGER agent_mutation_approval_bases_immutable_update
BEFORE UPDATE ON agent_mutation_approval_bases_v2
BEGIN
  SELECT RAISE(ABORT, 'approval_basis_is_immutable');
END;

CREATE TRIGGER agent_mutation_approval_bases_insert_guard
BEFORE INSERT ON agent_mutation_approval_bases_v2
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM agent_mutation_actions_v2 AS a
    WHERE a.action_id = NEW.action_id
      AND a.proposal_basis_hash = NEW.proposal_basis_hash
  ) THEN RAISE(ABORT, 'approval_basis_action_mismatch') END;
  SELECT CASE WHEN NEW.approval_command_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM agent_run_commands_v2 AS c
    JOIN agent_mutation_actions_v2 AS a
      ON a.action_id = NEW.action_id
    WHERE c.command_id = NEW.approval_command_id
      AND c.run_id = a.run_id
      AND c.project_id = a.project_id
      AND c.kind = 'approval'
  ) THEN RAISE(ABORT, 'approval_basis_command_mismatch') END;
END;

CREATE TRIGGER agent_mutation_approval_bases_immutable_delete
BEFORE DELETE ON agent_mutation_approval_bases_v2
BEGIN
  SELECT RAISE(ABORT, 'approval_basis_is_immutable');
END;

CREATE TRIGGER agent_mutation_actions_barrier_immutable_guard
BEFORE UPDATE ON agent_mutation_actions_v2
WHEN (OLD.barrier_command_id IS NOT NULL AND NEW.barrier_command_id IS NOT OLD.barrier_command_id)
  OR (OLD.barrier_attempt_id IS NOT NULL AND NEW.barrier_attempt_id IS NOT OLD.barrier_attempt_id)
  OR (OLD.commit_barrier_command_sequence IS NOT NULL AND NEW.commit_barrier_command_sequence IS NOT OLD.commit_barrier_command_sequence)
  OR (OLD.w01_commit_basis_hash IS NOT NULL AND NEW.w01_commit_basis_hash IS NOT OLD.w01_commit_basis_hash)
  OR (OLD.w01_binding_id IS NOT NULL AND NEW.w01_binding_id IS NOT OLD.w01_binding_id)
BEGIN
  SELECT RAISE(ABORT, 'mutation_barrier_binding_is_immutable');
END;

CREATE TRIGGER agent_mutation_actions_barrier_first_set_guard
BEFORE UPDATE ON agent_mutation_actions_v2
WHEN OLD.barrier_command_id IS NULL
  AND (NEW.barrier_command_id IS NOT NULL OR NEW.barrier_attempt_id IS NOT NULL OR NEW.commit_barrier_command_sequence IS NOT NULL)
  AND NEW.state <> 'committing'
BEGIN
  SELECT RAISE(ABORT, 'mutation_barrier_can_only_be_set_entering_committing');
END;

CREATE TRIGGER agent_mutation_actions_initial_state_insert_guard
BEFORE INSERT ON agent_mutation_actions_v2
WHEN NEW.state <> 'proposed'
BEGIN
  SELECT RAISE(ABORT, 'mutation_action_must_start_proposed');
END;

CREATE TRIGGER agent_mutation_actions_relational_insert_guard
BEFORE INSERT ON agent_mutation_actions_v2
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM agent_run_coordinators_v2 AS c
    JOIN agent_run_commands_v2 AS source
      ON source.command_id = NEW.source_command_id
    JOIN agent_run_effects_v2 AS e
      ON e.effect_id = NEW.effect_id
    WHERE c.run_id = NEW.run_id
      AND c.project_id = NEW.project_id
      AND c.vdt_id IS NEW.vdt_id
      AND source.run_id = NEW.run_id
      AND source.project_id = NEW.project_id
      AND e.run_id = NEW.run_id
      AND e.project_id = NEW.project_id
      AND e.command_id = NEW.source_command_id
      AND e.effect_kind = 'project_mutation'
  ) THEN RAISE(ABORT, 'mutation_action_source_identity_mismatch') END;
END;

CREATE TRIGGER agent_mutation_actions_transition_guard
BEFORE UPDATE OF state ON agent_mutation_actions_v2
WHEN NEW.state <> OLD.state
  AND NOT (
    (OLD.state = 'proposed' AND NEW.state IN ('waiting_approval', 'approved', 'rejected', 'superseded'))
    OR (OLD.state = 'waiting_approval' AND NEW.state IN ('approved', 'rejected', 'superseded'))
    OR (OLD.state = 'approved' AND NEW.state IN ('reconciling', 'rejected', 'superseded'))
    OR (OLD.state = 'reconciling' AND NEW.state IN ('ready_to_commit', 'merge_required', 'rejected', 'superseded'))
    OR (OLD.state = 'merge_required' AND NEW.state IN ('reconciling', 'rejected', 'superseded'))
    OR (OLD.state = 'ready_to_commit' AND NEW.state IN ('committing', 'rejected', 'superseded'))
    OR (OLD.state = 'committing' AND NEW.state IN ('committed', 'rejected', 'quarantined'))
  )
BEGIN
  SELECT RAISE(ABORT, 'mutation_action_transition_invalid');
END;

CREATE TRIGGER agent_mutation_actions_entering_barrier_guard
BEFORE UPDATE OF state ON agent_mutation_actions_v2
WHEN NEW.state = 'committing' AND OLD.state <> 'committing'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM agent_run_attempts_v2 AS a
    JOIN agent_run_commands_v2 AS c
      ON c.command_id = NEW.barrier_command_id
    JOIN agent_w01_commit_bindings_v2 AS b
      ON b.binding_id = NEW.w01_binding_id
    WHERE a.attempt_id = NEW.barrier_attempt_id
      AND a.run_id = NEW.run_id
      AND a.project_id = NEW.project_id
      AND a.command_id = NEW.barrier_command_id
      AND a.command_sequence = NEW.commit_barrier_command_sequence
      AND a.state IN ('effect_staged', 'committing')
      AND c.run_id = NEW.run_id
      AND c.project_id = NEW.project_id
      AND c.command_sequence = NEW.commit_barrier_command_sequence
      AND c.claimed_attempt_id = NEW.barrier_attempt_id
      AND c.status = 'claimed'
      AND b.action_id = NEW.action_id
      AND b.run_id = NEW.run_id
      AND b.project_id = NEW.project_id
      AND b.w01_commit_basis_hash = NEW.w01_commit_basis_hash
  ) THEN RAISE(ABORT, 'mutation_barrier_tuple_mismatch') END;
END;

CREATE TRIGGER agent_mutation_actions_terminal_immutable_guard
BEFORE UPDATE ON agent_mutation_actions_v2
WHEN OLD.state IN ('committed', 'rejected', 'superseded', 'quarantined')
BEGIN
  SELECT RAISE(ABORT, 'terminal_mutation_action_is_immutable');
END;

CREATE TRIGGER agent_mutation_actions_immutable_delete
BEFORE DELETE ON agent_mutation_actions_v2
BEGIN
  SELECT RAISE(ABORT, 'mutation_action_is_durable');
END;

CREATE TRIGGER agent_mutation_actions_identity_update_guard
BEFORE UPDATE ON agent_mutation_actions_v2
WHEN NEW.action_id <> OLD.action_id
  OR NEW.schema_version <> OLD.schema_version
  OR NEW.run_id <> OLD.run_id
  OR NEW.project_id <> OLD.project_id
  OR NEW.vdt_id IS NOT OLD.vdt_id
  OR NEW.publication_operation <> OLD.publication_operation
  OR NEW.source_command_id <> OLD.source_command_id
  OR NEW.effect_id <> OLD.effect_id
  OR NEW.proposal_id <> OLD.proposal_id
  OR NEW.base_run_state_version <> OLD.base_run_state_version
  OR NEW.base_execution_epoch <> OLD.base_execution_epoch
  OR NEW.base_project_runtime_state_canonical_json <> OLD.base_project_runtime_state_canonical_json
  OR NEW.base_revision_head_canonical_json IS NOT OLD.base_revision_head_canonical_json
  OR NEW.base_project_content_scheme IS NOT OLD.base_project_content_scheme
  OR NEW.base_project_content_hash IS NOT OLD.base_project_content_hash
  OR NEW.base_manual_operation_journal_sequence <> OLD.base_manual_operation_journal_sequence
  OR NEW.base_manual_operation_journal_hash IS NOT OLD.base_manual_operation_journal_hash
  OR NEW.base_processed_manual_operation_sequence <> OLD.base_processed_manual_operation_sequence
  OR NEW.base_processed_manual_operation_hash IS NOT OLD.base_processed_manual_operation_hash
  OR NEW.created_at <> OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'mutation_action_immutable_identity_changed');
END;

CREATE TRIGGER agent_w01_commit_bindings_identity_update_guard
BEFORE UPDATE ON agent_w01_commit_bindings_v2
WHEN NEW.binding_id <> OLD.binding_id
  OR NEW.action_id <> OLD.action_id
  OR NEW.run_id <> OLD.run_id
  OR NEW.project_id <> OLD.project_id
  OR NEW.operation <> OLD.operation
  OR NEW.scope_id <> OLD.scope_id
  OR NEW.idempotency_key <> OLD.idempotency_key
  OR NEW.w01_request_hash <> OLD.w01_request_hash
  OR NEW.w01_commit_basis_hash <> OLD.w01_commit_basis_hash
  OR NEW.created_at <> OLD.created_at
  OR (OLD.revision_commit_attempt_id IS NOT NULL AND NEW.revision_commit_attempt_id IS NOT OLD.revision_commit_attempt_id)
BEGIN
  SELECT RAISE(ABORT, 'w01_binding_immutable_identity_changed');
END;

CREATE TRIGGER agent_w01_commit_bindings_insert_guard
BEFORE INSERT ON agent_w01_commit_bindings_v2
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM agent_mutation_actions_v2 AS a
    WHERE a.action_id = NEW.action_id
      AND a.run_id = NEW.run_id
      AND a.project_id = NEW.project_id
      AND a.publication_operation = NEW.operation
      AND a.w01_commit_basis_hash = NEW.w01_commit_basis_hash
  ) THEN RAISE(ABORT, 'w01_binding_action_mismatch') END;
END;

CREATE TRIGGER agent_w01_commit_bindings_transition_guard
BEFORE UPDATE OF state ON agent_w01_commit_bindings_v2
WHEN NEW.state <> OLD.state
  AND NOT (
    (OLD.state = 'unreserved' AND NEW.state = 'in_progress')
    OR (OLD.state = 'in_progress' AND NEW.state IN ('succeeded', 'rejected', 'quarantined'))
  )
BEGIN
  SELECT RAISE(ABORT, 'w01_binding_transition_invalid');
END;

CREATE TRIGGER agent_w01_commit_bindings_terminal_immutable_guard
BEFORE UPDATE ON agent_w01_commit_bindings_v2
WHEN OLD.state IN ('succeeded', 'rejected', 'quarantined')
BEGIN
  SELECT RAISE(ABORT, 'terminal_w01_binding_is_immutable');
END;

CREATE TRIGGER agent_w01_commit_bindings_immutable_delete
BEFORE DELETE ON agent_w01_commit_bindings_v2
BEGIN
  SELECT RAISE(ABORT, 'w01_binding_is_durable');
END;

CREATE TRIGGER agent_mutation_reconciliations_insert_guard
BEFORE INSERT ON agent_mutation_reconciliations_v2
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM agent_mutation_actions_v2 AS a
    JOIN agent_w01_commit_bindings_v2 AS b
      ON b.binding_id = NEW.binding_id
    WHERE a.action_id = NEW.action_id
      AND a.run_id = NEW.run_id
      AND a.state = 'committing'
      AND a.barrier_command_id = NEW.barrier_command_id
      AND a.barrier_attempt_id = NEW.barrier_attempt_id
      AND a.commit_barrier_command_sequence = NEW.commit_barrier_command_sequence
      AND a.w01_commit_basis_hash = NEW.w01_commit_basis_hash
      AND a.w01_binding_id = NEW.binding_id
      AND b.action_id = NEW.action_id
      AND b.w01_commit_basis_hash = NEW.w01_commit_basis_hash
  ) THEN RAISE(ABORT, 'reconciliation_barrier_binding_mismatch') END;
END;

CREATE TRIGGER agent_mutation_reconciliations_identity_update_guard
BEFORE UPDATE ON agent_mutation_reconciliations_v2
WHEN NEW.reconciliation_id <> OLD.reconciliation_id
  OR NEW.schema_version <> OLD.schema_version
  OR NEW.action_id <> OLD.action_id
  OR NEW.binding_id <> OLD.binding_id
  OR NEW.run_id <> OLD.run_id
  OR NEW.barrier_command_id <> OLD.barrier_command_id
  OR NEW.barrier_attempt_id <> OLD.barrier_attempt_id
  OR NEW.cancel_execution_epoch <> OLD.cancel_execution_epoch
  OR NEW.commit_barrier_command_sequence <> OLD.commit_barrier_command_sequence
  OR NEW.w01_commit_basis_hash <> OLD.w01_commit_basis_hash
  OR NEW.created_at <> OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'reconciliation_immutable_identity_changed');
END;

CREATE TRIGGER agent_mutation_reconciliations_transition_guard
BEFORE UPDATE OF state ON agent_mutation_reconciliations_v2
WHEN NEW.state <> OLD.state
  AND NOT (
    (OLD.state = 'pending' AND NEW.state = 'leased')
    OR (OLD.state = 'leased' AND NEW.state IN ('leased', 'w01_in_progress', 'settled'))
    OR (OLD.state = 'w01_in_progress' AND NEW.state IN ('w01_in_progress', 'settled'))
  )
BEGIN
  SELECT RAISE(ABORT, 'reconciliation_transition_invalid');
END;

CREATE TRIGGER agent_mutation_reconciliations_settled_immutable_guard
BEFORE UPDATE ON agent_mutation_reconciliations_v2
WHEN OLD.state = 'settled'
BEGIN
  SELECT RAISE(ABORT, 'settled_reconciliation_is_immutable');
END;

CREATE TRIGGER agent_mutation_reconciliations_immutable_delete
BEFORE DELETE ON agent_mutation_reconciliations_v2
BEGIN
  SELECT RAISE(ABORT, 'mutation_reconciliation_is_durable');
END;

CREATE TRIGGER agent_merge_records_action_insert_guard
BEFORE INSERT ON agent_merge_records_v2
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM agent_mutation_actions_v2 AS a
    WHERE a.action_id = NEW.action_id
      AND a.run_id = NEW.run_id
      AND a.project_id = NEW.project_id
      AND ((a.publication_operation = 'revision.commit' AND NEW.vdt_id = a.vdt_id AND NEW.vdt_id IS NOT NULL) OR (a.publication_operation = 'vdt.create_with_initial' AND a.vdt_id IS NULL AND NEW.vdt_id IS NULL))
  ) THEN RAISE(ABORT, 'merge_action_vdt_mismatch') END;
END;

CREATE TRIGGER agent_merge_records_identity_update_guard
BEFORE UPDATE ON agent_merge_records_v2
WHEN NEW.merge_id <> OLD.merge_id
  OR NEW.schema_version <> OLD.schema_version
  OR NEW.action_id <> OLD.action_id
  OR NEW.run_id <> OLD.run_id
  OR NEW.project_id <> OLD.project_id
  OR NEW.vdt_id IS NOT OLD.vdt_id
  OR NEW.merge_version <> OLD.merge_version
  OR NEW.base_project_content_scheme <> OLD.base_project_content_scheme
  OR NEW.base_project_content_hash <> OLD.base_project_content_hash
  OR NEW.manual_project_content_scheme <> OLD.manual_project_content_scheme
  OR NEW.manual_project_content_hash <> OLD.manual_project_content_hash
  OR NEW.agent_project_content_scheme <> OLD.agent_project_content_scheme
  OR NEW.agent_project_content_hash <> OLD.agent_project_content_hash
  OR NEW.manual_operation_head_sequence <> OLD.manual_operation_head_sequence
  OR NEW.manual_operation_head_hash IS NOT OLD.manual_operation_head_hash
  OR NEW.conflicts_canonical_json <> OLD.conflicts_canonical_json
  OR NEW.merge_hash <> OLD.merge_hash
  OR NEW.created_at <> OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'merge_record_immutable_identity_changed');
END;

CREATE TRIGGER agent_merge_records_transition_guard
BEFORE UPDATE OF state ON agent_merge_records_v2
WHEN NEW.state <> OLD.state
  AND NOT (OLD.state = 'required' AND NEW.state IN ('resolved', 'superseded'))
BEGIN
  SELECT RAISE(ABORT, 'merge_record_transition_invalid');
END;

CREATE TRIGGER agent_merge_records_terminal_immutable_guard
BEFORE UPDATE ON agent_merge_records_v2
WHEN OLD.state IN ('resolved', 'superseded')
BEGIN
  SELECT RAISE(ABORT, 'terminal_merge_record_is_immutable');
END;

CREATE TRIGGER agent_merge_records_immutable_delete
BEFORE DELETE ON agent_merge_records_v2
BEGIN
  SELECT RAISE(ABORT, 'merge_record_is_durable');
END;

CREATE TRIGGER agent_retry_records_budget_insert_guard
BEFORE INSERT ON agent_retry_records_v2
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM agent_retry_budgets_v2 AS b
    WHERE b.run_id = NEW.run_id
      AND b.retry_budget_epoch = NEW.retry_budget_epoch
      AND b.state = 'open'
      AND b.automatic_retry_window_started_at = NEW.automatic_retry_window_started_at
      AND b.automatic_retry_window_deadline_at = NEW.automatic_retry_window_deadline_at
      AND b.max_automatic_retries_per_fingerprint = NEW.max_automatic_retries_per_fingerprint
      AND b.max_automatic_retries_per_run = NEW.max_automatic_retries_per_run
      AND b.max_automatic_retry_window_ms = NEW.max_automatic_retry_window_ms
      AND b.provider_429_base_delay_ms = NEW.provider_429_base_delay_ms
      AND b.timeout_transport_5xx_base_delay_ms = NEW.timeout_transport_5xx_base_delay_ms
      AND b.exponential_factor = NEW.exponential_factor
      AND b.maximum_delay_ms = NEW.maximum_delay_ms
      AND b.jitter_minimum_basis_points = NEW.jitter_minimum_basis_points
      AND b.jitter_maximum_basis_points = NEW.jitter_maximum_basis_points
  ) THEN RAISE(ABORT, 'retry_record_budget_mismatch') END;
END;

CREATE TRIGGER agent_retry_budgets_identity_update_guard
BEFORE UPDATE ON agent_retry_budgets_v2
WHEN NEW.run_id <> OLD.run_id
  OR NEW.retry_budget_epoch <> OLD.retry_budget_epoch
  OR NEW.schema_version <> OLD.schema_version
  OR NEW.policy_schema_version <> OLD.policy_schema_version
  OR NEW.policy_version <> OLD.policy_version
  OR NEW.max_automatic_retries_per_fingerprint <> OLD.max_automatic_retries_per_fingerprint
  OR NEW.max_automatic_retries_per_run <> OLD.max_automatic_retries_per_run
  OR NEW.max_automatic_retry_window_ms <> OLD.max_automatic_retry_window_ms
  OR NEW.provider_429_base_delay_ms <> OLD.provider_429_base_delay_ms
  OR NEW.timeout_transport_5xx_base_delay_ms <> OLD.timeout_transport_5xx_base_delay_ms
  OR NEW.exponential_factor <> OLD.exponential_factor
  OR NEW.maximum_delay_ms <> OLD.maximum_delay_ms
  OR NEW.jitter_minimum_basis_points <> OLD.jitter_minimum_basis_points
  OR NEW.jitter_maximum_basis_points <> OLD.jitter_maximum_basis_points
  OR NEW.created_at <> OLD.created_at
  OR (OLD.automatic_retry_window_started_at IS NOT NULL AND NEW.automatic_retry_window_started_at IS NOT OLD.automatic_retry_window_started_at)
  OR (OLD.automatic_retry_window_deadline_at IS NOT NULL AND NEW.automatic_retry_window_deadline_at IS NOT OLD.automatic_retry_window_deadline_at)
BEGIN
  SELECT RAISE(ABORT, 'retry_budget_immutable_basis_changed');
END;

CREATE TRIGGER agent_retry_budgets_immutable_delete
BEFORE DELETE ON agent_retry_budgets_v2
BEGIN
  SELECT RAISE(ABORT, 'retry_budget_is_durable');
END;

CREATE TRIGGER agent_retry_records_identity_update_guard
BEFORE UPDATE ON agent_retry_records_v2
WHEN NEW.retry_id <> OLD.retry_id
  OR NEW.schema_version <> OLD.schema_version
  OR NEW.run_id <> OLD.run_id
  OR NEW.project_id <> OLD.project_id
  OR NEW.command_id <> OLD.command_id
  OR NEW.failed_attempt_id <> OLD.failed_attempt_id
  OR NEW.failed_step_id <> OLD.failed_step_id
  OR NEW.phase <> OLD.phase
  OR NEW.step_kind <> OLD.step_kind
  OR NEW.failure_class <> OLD.failure_class
  OR NEW.provider_or_tool_id <> OLD.provider_or_tool_id
  OR NEW.error_code <> OLD.error_code
  OR NEW.http_status_class <> OLD.http_status_class
  OR NEW.fingerprint <> OLD.fingerprint
  OR NEW.retry_budget_epoch <> OLD.retry_budget_epoch
  OR NEW.occurrence_for_fingerprint <> OLD.occurrence_for_fingerprint
  OR NEW.automatic_retry_number_for_run <> OLD.automatic_retry_number_for_run
  OR NEW.policy_schema_version <> OLD.policy_schema_version
  OR NEW.policy_version <> OLD.policy_version
  OR NEW.max_automatic_retries_per_fingerprint <> OLD.max_automatic_retries_per_fingerprint
  OR NEW.max_automatic_retries_per_run <> OLD.max_automatic_retries_per_run
  OR NEW.max_automatic_retry_window_ms <> OLD.max_automatic_retry_window_ms
  OR NEW.provider_429_base_delay_ms <> OLD.provider_429_base_delay_ms
  OR NEW.timeout_transport_5xx_base_delay_ms <> OLD.timeout_transport_5xx_base_delay_ms
  OR NEW.exponential_factor <> OLD.exponential_factor
  OR NEW.maximum_delay_ms <> OLD.maximum_delay_ms
  OR NEW.jitter_minimum_basis_points <> OLD.jitter_minimum_basis_points
  OR NEW.jitter_maximum_basis_points <> OLD.jitter_maximum_basis_points
  OR NEW.automatic_retry_window_started_at <> OLD.automatic_retry_window_started_at
  OR NEW.automatic_retry_window_deadline_at <> OLD.automatic_retry_window_deadline_at
  OR NEW.retry_after_ms IS NOT OLD.retry_after_ms
  OR NEW.computed_delay_ms <> OLD.computed_delay_ms
  OR NEW.next_attempt_at <> OLD.next_attempt_at
  OR NEW.created_at <> OLD.created_at
  OR (OLD.claimed_attempt_id IS NOT NULL AND NEW.claimed_attempt_id IS NOT OLD.claimed_attempt_id)
BEGIN
  SELECT RAISE(ABORT, 'retry_record_immutable_basis_changed');
END;

CREATE TRIGGER agent_retry_records_transition_guard
BEFORE UPDATE OF state ON agent_retry_records_v2
WHEN NEW.state <> OLD.state
  AND NOT (
    (OLD.state = 'scheduled' AND NEW.state IN ('claimed', 'cancelled'))
    OR (OLD.state = 'claimed' AND NEW.state IN ('succeeded', 'failed'))
  )
BEGIN
  SELECT RAISE(ABORT, 'retry_record_transition_invalid');
END;

CREATE TRIGGER agent_retry_records_terminal_immutable_guard
BEFORE UPDATE ON agent_retry_records_v2
WHEN OLD.state IN ('succeeded', 'failed', 'cancelled')
BEGIN
  SELECT RAISE(ABORT, 'terminal_retry_record_is_immutable');
END;

CREATE TRIGGER agent_retry_records_immutable_delete
BEFORE DELETE ON agent_retry_records_v2
BEGIN
  SELECT RAISE(ABORT, 'retry_record_is_durable');
END;

CREATE TRIGGER agent_run_outbox_chain_insert_guard
BEFORE INSERT ON agent_run_outbox_v2
WHEN NEW.event_sequence > 1
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM agent_run_outbox_v2 AS p
    WHERE p.run_id = NEW.run_id
      AND p.event_sequence = NEW.event_sequence - 1
      AND p.event_hash = NEW.previous_event_hash
  ) THEN RAISE(ABORT, 'outbox_chain_mismatch') END;
END;

CREATE TRIGGER agent_run_outbox_immutable_update
BEFORE UPDATE ON agent_run_outbox_v2
BEGIN
  SELECT RAISE(ABORT, 'outbox_event_is_immutable');
END;

CREATE TRIGGER agent_run_outbox_immutable_delete
BEFORE DELETE ON agent_run_outbox_v2
BEGIN
  SELECT RAISE(ABORT, 'outbox_event_is_immutable');
END;

CREATE TRIGGER legacy_agent_run_adoptions_source_insert_guard
BEFORE INSERT ON legacy_agent_run_adoptions_v1
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM agent_runs AS r
    WHERE typeof(r.id) = 'text'
      AND r.id = NEW.run_id
      AND typeof(r.project_id) = 'text'
      AND r.project_id = NEW.project_id
      AND ((typeof(r.vdt_id) = 'null' AND NEW.vdt_id IS NULL) OR (typeof(r.vdt_id) = 'text' AND r.vdt_id = NEW.vdt_id))
      AND r.vdt_id IS NEW.vdt_id
      AND ((typeof(r.conversation_id) = 'null' AND NEW.conversation_id IS NULL) OR (typeof(r.conversation_id) = 'text' AND r.conversation_id = NEW.conversation_id))
      AND r.conversation_id IS NEW.conversation_id
      AND typeof(r.status) = 'text'
      AND r.status = NEW.original_status
      AND typeof(r.phase) = 'text'
      AND r.phase = NEW.original_phase
      AND CAST(r.phase AS BLOB) = CAST(NEW.original_phase AS BLOB)
      AND length(CAST(r.phase AS BLOB)) = NEW.original_phase_utf8_byte_length
      AND typeof(r.request_json) = 'text'
      AND NEW.request_json_is_null = 0
      AND length(CAST(r.request_json AS BLOB)) = NEW.request_json_utf8_byte_length
      AND (
        (typeof(r.public_snapshot_json) = 'null' AND NEW.public_snapshot_json_is_null = 1 AND NEW.public_snapshot_json_utf8_byte_length = 0 AND NEW.public_snapshot_json_raw_utf8_hash IS NULL)
        OR
        (typeof(r.public_snapshot_json) = 'text' AND NEW.public_snapshot_json_is_null = 0 AND length(CAST(r.public_snapshot_json AS BLOB)) = NEW.public_snapshot_json_utf8_byte_length AND NEW.public_snapshot_json_raw_utf8_hash IS NOT NULL)
      )
      AND (
        (typeof(r.internal_state_json) = 'null' AND NEW.internal_state_json_is_null = 1 AND NEW.internal_state_json_utf8_byte_length = 0 AND NEW.internal_state_json_raw_utf8_hash IS NULL)
        OR
        (typeof(r.internal_state_json) = 'text' AND NEW.internal_state_json_is_null = 0 AND length(CAST(r.internal_state_json AS BLOB)) = NEW.internal_state_json_utf8_byte_length AND NEW.internal_state_json_raw_utf8_hash IS NOT NULL)
      )
      AND typeof(r.created_at) = 'integer'
      AND typeof(r.updated_at) = 'integer'
      AND r.created_at = NEW.original_created_at_millis
      AND r.updated_at = NEW.original_updated_at_millis
      AND ((typeof(r.completed_at) = 'null' AND NEW.original_completed_at_millis IS NULL) OR (typeof(r.completed_at) = 'integer' AND r.completed_at = NEW.original_completed_at_millis))
  ) THEN RAISE(ABORT, 'legacy_adoption_source_mismatch') END;
END;

CREATE TRIGGER legacy_agent_run_adoptions_immutable_update
BEFORE UPDATE ON legacy_agent_run_adoptions_v1
BEGIN
  SELECT RAISE(ABORT, 'legacy_adoption_is_immutable');
END;

CREATE TRIGGER legacy_agent_run_adoptions_immutable_delete
BEFORE DELETE ON legacy_agent_run_adoptions_v1
BEGIN
  SELECT RAISE(ABORT, 'legacy_adoption_is_immutable');
END;

CREATE TRIGGER legacy_agent_runs_adopted_immutable_update
BEFORE UPDATE ON agent_runs
WHEN EXISTS (
  SELECT 1
  FROM legacy_agent_run_adoptions_v1 AS a
  WHERE a.run_id = OLD.id
)
BEGIN
  SELECT RAISE(ABORT, 'adopted_legacy_agent_run_is_immutable');
END;

CREATE TRIGGER legacy_agent_runs_adopted_immutable_delete
BEFORE DELETE ON agent_runs
WHEN EXISTS (
  SELECT 1
  FROM legacy_agent_run_adoptions_v1 AS a
  WHERE a.run_id = OLD.id
)
BEGIN
  SELECT RAISE(ABORT, 'adopted_legacy_agent_run_is_immutable');
END;

CREATE TRIGGER migration_transform_applications_binding_insert_guard
BEFORE INSERT ON migration_transform_applications_v1
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM migration_attempts AS a
    JOIN migration_backup_evidence AS b
      ON b.backup_evidence_id = a.backup_evidence_id
    WHERE a.database_id = NEW.database_id
      AND a.attempt_id = NEW.migration_attempt_id
      AND a.backup_evidence_id = NEW.backup_evidence_id
      AND a.target_manifest_hash = NEW.target_manifest_hash
      AND a.owner_token = NEW.fence_owner_token
      AND a.lease_generation = NEW.fence_lease_generation
      AND a.status = 'applying'
      AND a.active_migration_id = NEW.migration_id
      AND a.next_sequence = NEW.sequence
      AND b.database_id = NEW.database_id
      AND b.manifest_hash = NEW.target_manifest_hash
  ) THEN RAISE(ABORT, 'transform_application_attempt_fence_mismatch') END;
  SELECT CASE WHEN NEW.input_legacy_run_count <> (SELECT count(*) FROM agent_runs)
    OR NEW.inserted_adoption_count <> (
      SELECT count(*)
      FROM legacy_agent_run_adoptions_v1 AS x
      WHERE x.database_id = NEW.database_id
        AND x.migration_application_id = NEW.migration_application_id
        AND x.migration_sequence = NEW.sequence
    )
    OR EXISTS (
      SELECT 1
      FROM agent_runs AS r
      WHERE NOT EXISTS (
        SELECT 1
        FROM legacy_agent_run_adoptions_v1 AS x
        WHERE x.run_id = r.id
          AND x.database_id = NEW.database_id
          AND x.migration_application_id = NEW.migration_application_id
          AND x.migration_sequence = NEW.sequence
      )
    )
  THEN RAISE(ABORT, 'transform_application_adoption_set_mismatch') END;
END;

CREATE TRIGGER migration_transform_applications_immutable_update
BEFORE UPDATE ON migration_transform_applications_v1
BEGIN
  SELECT RAISE(ABORT, 'transform_application_is_immutable');
END;

CREATE TRIGGER migration_transform_applications_immutable_delete
BEFORE DELETE ON migration_transform_applications_v1
BEGIN
  SELECT RAISE(ABORT, 'transform_application_is_immutable');
END;

CREATE TRIGGER applied_migrations_sequence3_binding_insert_guard
BEFORE INSERT ON applied_migrations
WHEN NEW.sequence = 3
BEGIN
  SELECT CASE WHEN NEW.schema_version <> 'applied_migration.v1'
    OR NEW.migration_id <> '003-durable-agent-run-coordination'
    OR NEW.from_user_version <> 2
    OR NEW.to_user_version <> 3
    OR NOT EXISTS (
      SELECT 1
      FROM migration_transform_applications_v1 AS t
      WHERE t.database_id = NEW.database_id
        AND t.migration_application_id = NEW.application_id
        AND t.sequence = NEW.sequence
        AND t.migration_id = NEW.migration_id
        AND t.target_manifest_hash = NEW.manifest_hash
        AND t.sql_checksum = NEW.sql_checksum
        AND t.applied_at = NEW.applied_at
    )
  THEN RAISE(ABORT, 'sequence3_applied_migration_binding_mismatch') END;
END;

CREATE TRIGGER applied_migrations_sequence3_immutable_update
BEFORE UPDATE ON applied_migrations
WHEN OLD.sequence = 3 OR NEW.sequence = 3
BEGIN
  SELECT RAISE(ABORT, 'sequence3_applied_migration_is_immutable');
END;

CREATE TRIGGER applied_migrations_sequence3_immutable_delete
BEFORE DELETE ON applied_migrations
WHEN OLD.sequence = 3
BEGIN
  SELECT RAISE(ABORT, 'sequence3_applied_migration_is_immutable');
END;
```

## Required execution boundary

The SQL has no transaction-control `BEGIN TRANSACTION`, `BEGIN DEFERRED`,
`BEGIN IMMEDIATE`, `BEGIN EXCLUSIVE`, `COMMIT`, or `ROLLBACK`; the `BEGIN ...
END` tokens present in the block are mandatory SQLite trigger-body grammar.
It also has no `PRAGMA user_version`, data-adoption statement, transform code,
manifest registration, feature change, or destructive legacy rewrite. Gate R2
alone may execute these exact bytes inside the already-fenced sequence-3
application transaction. The runner then invokes the independently frozen
transform, inserts adoption rows child-first, inserts the transform
application, inserts `applied_migrations`, advances audit state and
`user_version`, and runs the durable FK-latch protocol. The SQL block is not
independently executable as a production migration.

## Introspection acceptance appendix

Run each query on a fresh V2 fixture immediately after executing the exact SQL
block. Preserve SQLite values exactly; do not normalize SQL text.

```sql
SELECT type, name, tbl_name, sql
FROM sqlite_schema
WHERE name NOT LIKE 'sqlite_%'
ORDER BY type ASC, name ASC, tbl_name ASC;
```

Expected additions are exactly 27 tables, all names listed below, plus the
named explicit indexes and triggers in the SQL block. The existing tables and
indexes from sequences 1 and 2 remain byte-identical in `sqlite_schema`.

```sql
SELECT name
FROM sqlite_schema
WHERE type = 'table'
  AND name IN (
    'agent_run_coordinators_v2',
    'agent_run_feature_snapshots_v2',
    'agent_run_preferences_v2',
    'agent_run_commands_v2',
    'agent_command_execution_bases_v2',
    'agent_run_attempts_v2',
    'agent_provider_decisions_v2',
    'agent_tool_calls_v2',
    'agent_run_effects_v2',
    'agent_coordinator_effect_commits_v2',
    'agent_run_project_states_v2',
    'agent_manual_operations_v2',
    'agent_manual_editing_sessions_v2',
    'agent_manual_resync_bases_v2',
    'agent_question_sets_v2',
    'agent_question_answers_v2',
    'agent_mutation_approval_policies_v2',
    'agent_mutation_approval_bases_v2',
    'agent_mutation_actions_v2',
    'agent_w01_commit_bindings_v2',
    'agent_mutation_reconciliations_v2',
    'agent_merge_records_v2',
    'agent_retry_budgets_v2',
    'agent_retry_records_v2',
    'agent_run_outbox_v2',
    'migration_transform_applications_v1',
    'legacy_agent_run_adoptions_v1'
  )
ORDER BY name ASC;
```

For every name returned above, run:

```sql
SELECT cid, name, type, "notnull", dflt_value, pk, hidden
FROM pragma_table_xinfo(?)
ORDER BY cid ASC;
```

No column may be hidden, have an empty type, or use a type other than `TEXT`
or `INTEGER`. Defaults are null because all defaulting is explicit in the
storage transaction.

For every table, run both index queries in this exact order:

```sql
SELECT seq, name, "unique", origin, partial
FROM pragma_index_list(?)
ORDER BY name ASC;
```

```sql
SELECT seqno, cid, name, desc, coll, key
FROM pragma_index_xinfo(?)
ORDER BY seqno ASC;
```

For every table, run:

```sql
SELECT id, seq, "table", "from", "to", on_update, on_delete, match
FROM pragma_foreign_key_list(?)
ORDER BY id ASC, seq ASC;
```

The two adoption/transform application links must appear as three-column
composite FKs with `on_update='RESTRICT'`, `on_delete='RESTRICT'`; their
deferrability is verified from the exact `sqlite_schema.sql` text because
`foreign_key_list` does not expose it. The required text is
`DEFERRABLE INITIALLY DEFERRED`.

Trigger text is accepted only from:

```sql
SELECT name, tbl_name, sql
FROM sqlite_schema
WHERE type = 'trigger'
ORDER BY name ASC;
```

The returned trigger names and bodies must byte-equal the block. In
particular, no generated or hand-edited trigger may replace the exact
transform-attempt/backup fence, full adoption-set guard, sequence-3 applied
row guard, or immutable update/delete guards.

Finally:

```sql
PRAGMA foreign_key_check;
```

must return zero rows after the Gate-R2 fixture inserts a complete valid
sequence-3 application.

## Semantic negative cases

Each case runs in a fresh transaction and must fail with the named constraint
or trigger before commit, leaving `PRAGMA foreign_key_check` empty and no
partial rows:

1. duplicate `(database_id, application_id, sequence)` in
   `applied_migrations`;
2. a transform application with a changed attempt ID, backup ID, owner token,
   lease generation, or target manifest hash;
3. a transform application whose attempt is not `applying`, whose
   `active_migration_id` is not sequence 3, or whose backup manifest differs;
4. a missing, duplicate, or extra legacy adoption, or transform counts that
   differ from the exact legacy `agent_runs` cardinality;
5. update/delete of an adoption, transform application, or sequence-3 applied
   row;
6. an adoption whose raw legacy project/VDT/conversation/status/phase or
   timestamp tuple, storage class, nullness attestation, or exact UTF-8 byte
   length differs from its source row;
7. a provider receipt whose frozen provider tuple differs from the
   coordinator or whose attempt/run/command does not match;
8. a tool receipt whose provider decision is not terminally `completed`;
9. an effect whose provider/tool receipt hash or attempt identity differs;
10. a second active attempt, queued drive, active question set, or
    non-terminal reconciliation for one run;
11. a drive command whose predecessor terminal hash or initiating external
    actor differs;
12. a preference version gap or previous-hash mismatch;
13. a manual operation with a global/session predecessor gap, actor mismatch,
    non-terminal command, or queued status;
14. an answer for a non-active or hash-mismatched question set;
15. a mutation reconciliation whose action barrier IDs, binding, basis hash,
    or command sequence differ;
16. a merge whose VDT nullability/equality differs from its linked action;
17. a retry record whose fixed window or policy fields differ from its budget;
18. an outbox sequence gap or previous-event-hash mismatch;
19. any enum, boolean, timestamp, safe-integer, hash, terminal-nullability, or
    JSON CHECK violation;
20. deletion of any project, VDT, run, command, attempt, or other FK parent
    still referenced by durable audit evidence;
21. a claimed attempt, retry attempt, effect receipt, question answer, outbox
    event, predecessor command, or initiating command whose duplicated
    run/project/command/attempt tuple names individually valid rows but not
    the same relational identity;
22. changing any coordinator feature/config/runtime start-basis member after
    insertion;
23. setting a mutation commit barrier before the legal transition into
    `committing`, changing any barrier member after first set, or taking an
    unlisted mutation-action transition;
24. any interaction-mismatch terminal code retaining a claimed attempt;
25. an adoption whose `adopted_at` differs from its transform application's
    `applied_at`.

## Author validation record

The proposed block was extracted in memory and executed with Node
`v24.15.0`, SQLite `3.53.2`, and `node:sqlite` `DatabaseSync` after the exact
sequence-1 and sequence-2 SQL fixtures. This did not create a repository
migration or modify a workspace database.

- block size: 158,462 UTF-8 bytes across 2,402 SQL lines, including exactly
  one final LF;
- byte checks: no BOM, CR, tab, trailing whitespace, or extra final LF;
- raw block hash:
  `sha256:2bb4eacb0f2565975a1318f5d6a917a325e69337677651a87c21710c6451bbda`;
- schema delta: 27 tables, 15 explicitly named indexes, and 110 explicitly
  named triggers;
- new-table column count from ordered `pragma_table_xinfo`: 573;
- every new FK has explicit `ON UPDATE RESTRICT ON DELETE RESTRICT`; the block
  has no `ON DELETE CASCADE` or `ON DELETE SET NULL`;
- `PRAGMA integrity_check`: `ok`;
- empty-fixture and post-fixture `PRAGMA foreign_key_check`: zero rows;
- the user-version-2 precondition reproduced the frozen semantic schema hash
  `sha256:b3eda62829523baced9238894eaabbb3cad30721b75bf02a59166bf4d759bb02`;
- the candidate user-version-3 introspection contains 178 rows and 191,398
  canonical row-array bytes, with raw row hash
  `sha256:5fa24ae3bef1dfaa6cc25153b224b4a54380c15b58e9582532960e20fffa89ac`
  and candidate semantic postcondition schema hash
  `sha256:c4206299c5399b4ee113c920f02af650aa39ad6af452f5c46330dcec10adbb5a`;
- a new-run reservation fixture inserted snapshot-first, then coordinator,
  start command, preference version 1, and retry budget epoch 1 in one
  transaction; both sides of the intentional deferred FK cycle committed;
- coordinator feature-config drift, a same-run wrong-command claimed attempt,
  and deletion of its project each failed with `FOREIGN KEY constraint
  failed`;
- an interaction-mismatch terminal command retaining its claimed attempt
  failed the exact terminal-code CHECK, while the same terminal code with a
  null claimed attempt inserted successfully;
- setting the mutation barrier before `committing` failed with
  `mutation_barrier_can_only_be_set_entering_committing`, and the direct
  `proposed -> committed` transition failed with
  `mutation_action_transition_invalid`;
- a one-terminal-legacy-run child-first adoption/transform/application
  transaction committed with one adoption; false request-byte-length,
  nullness, and timestamp attestations each failed with
  `legacy_adoption_source_mismatch`;
- an adoption/transform timestamp mismatch failed its deferred FK at commit;
  external project and VDT deletion failed with `FOREIGN KEY constraint
  failed`; and update of the adopted source run failed with
  `adopted_legacy_agent_run_is_immutable`.

This is author-run candidate syntax, shape, and focused semantic evidence, not
an independent artifact-freeze verdict or a Gate-R2 result. Independent
reproduction, frozen generated artifacts, transform golden vectors, crash
injection, and the complete negative matrix remain required.

## Unresolved cross-file dependencies

The inert artifact-freeze gate owns only these cross-file dependencies:

- the precondition is already frozen as
  `sha256:b3eda62829523baced9238894eaabbb3cad30721b75bf02a59166bf4d759bb02`;
  the artifact gate must independently reproduce it from the exact
  user-version-2 fixture;
- independent reproduction and freeze of the candidate sequence-3
  postcondition schema hash
  `sha256:c4206299c5399b4ee113c920f02af650aa39ad6af452f5c46330dcec10adbb5a`;
- independent reproduction and freeze of the candidate SQL `sqlChecksum`
  `sha256:c9b7ce6486a50024259e53f34a7f4a1750544c442b75df310a55c03e5f8d3e0f`
  after binding the candidate postcondition hash under the byte policy;
- the V2 manifest hash and exact entry-3 manifest projection;
- WASM module, ABI contract, and golden-vector byte lengths/checksums;
- the transform result golden vectors and child-first bound INSERT statements;
- static schema-introspection and fault-vector bytes/checksums; and
- no-wiring evidence proving that the frozen artifacts are not imported,
  exported, discovered, bundled, executed, or feature-enabled.

Only after independent artifact-freeze approval may Gate R2 own production
runner integration, transaction ordering, the FK-latch protocol, crash
injection, stale-fence/takeover behavior, and platform execution evidence.
Native-Windows durability and release evidence remains later release work; it
is not an input to the inert artifact freeze.

Until those dependencies receive their own independent approvals, sequence 3,
Gate R2, W0.2 runtime, feature enablement, and production remain blocked.
