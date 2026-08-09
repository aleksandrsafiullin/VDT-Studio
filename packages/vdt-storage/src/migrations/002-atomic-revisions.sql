CREATE TABLE applied_migrations (
  sequence INTEGER PRIMARY KEY,
  schema_version TEXT NOT NULL,
  database_id TEXT NOT NULL,
  migration_id TEXT NOT NULL UNIQUE,
  sql_checksum TEXT NOT NULL,
  from_user_version INTEGER NOT NULL,
  to_user_version INTEGER NOT NULL,
  precondition_schema_hash TEXT NOT NULL,
  postcondition_schema_hash TEXT NOT NULL,
  manifest_hash TEXT NOT NULL,
  application_id TEXT NOT NULL UNIQUE,
  applied_at INTEGER NOT NULL
);

CREATE TABLE migration_state (
  database_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  manifest_hash TEXT NOT NULL,
  current_user_version INTEGER NOT NULL,
  last_applied_sequence INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('ready', 'blocked')),
  blocked_reason TEXT
);

CREATE TABLE migration_backup_evidence (
  backup_evidence_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  database_id TEXT NOT NULL,
  from_user_version INTEGER NOT NULL,
  manifest_hash TEXT NOT NULL,
  source_database_hash TEXT NOT NULL,
  backup_hash TEXT NOT NULL,
  backup_relative_path TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE migration_attempts (
  attempt_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  database_id TEXT NOT NULL,
  target_manifest_hash TEXT NOT NULL,
  backup_evidence_id TEXT NOT NULL,
  next_sequence INTEGER NOT NULL,
  owner_token TEXT NOT NULL,
  lease_generation INTEGER NOT NULL,
  lease_expires_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('backed_up', 'applying', 'completed', 'blocked')),
  active_migration_id TEXT,
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE UNIQUE INDEX one_nonterminal_migration_attempt
ON migration_attempts(database_id)
WHERE status IN ('backed_up', 'applying');

CREATE TABLE legacy_migration_adoptions (
  database_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  adopted_sequence INTEGER NOT NULL,
  legacy_user_version INTEGER NOT NULL,
  legacy_schema_migration_version INTEGER NOT NULL,
  legacy_schema_migration_applied_at INTEGER NOT NULL,
  attested_schema_hash TEXT NOT NULL,
  bootstrap_sql_checksum TEXT NOT NULL,
  bootstrap_journal_relative_path TEXT NOT NULL,
  bootstrap_journal_hash TEXT NOT NULL,
  adopted_at INTEGER NOT NULL
);

CREATE TABLE legacy_revision_attestations (
  revision_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  project_id TEXT NOT NULL,
  vdt_id TEXT NOT NULL,
  revision_no INTEGER NOT NULL,
  file_relative_path TEXT NOT NULL,
  content_scheme TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  payload_byte_length INTEGER NOT NULL,
  verified_at INTEGER NOT NULL
);

CREATE TABLE project_runtime_states (
  project_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  runtime_generation TEXT NOT NULL CHECK(runtime_generation IN ('v1', 'v2')),
  generation_version INTEGER NOT NULL CHECK(generation_version >= 0),
  migration_state TEXT NOT NULL CHECK(migration_state IN ('not_started', 'shadow_ready', 'migrating', 'v2_active', 'rollback_readonly')),
  write_state TEXT NOT NULL CHECK(write_state IN ('enabled', 'disabled')),
  updated_at INTEGER NOT NULL
);

CREATE TABLE vdt_revision_heads (
  vdt_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  project_id TEXT NOT NULL,
  active_revision_id TEXT,
  active_content_scheme TEXT,
  active_content_hash TEXT,
  pending_revision_id TEXT,
  commit_generation INTEGER NOT NULL CHECK(commit_generation >= 0),
  CHECK(
    (active_content_scheme IS NULL AND active_content_hash IS NULL)
    OR
    (active_content_scheme IS NOT NULL AND active_content_hash IS NOT NULL)
  )
);

CREATE UNIQUE INDEX one_pending_revision_per_vdt
ON vdt_revision_heads(vdt_id)
WHERE pending_revision_id IS NOT NULL;

CREATE TABLE vdt_storage_lifecycles (
  vdt_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('creating', 'ready')),
  initial_attempt_id TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE idempotency_records (
  scope_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('skill.read', 'skill.select', 'revision.commit', 'vdt.create_with_initial')),
  idempotency_key TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  actor_principal_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('in_progress', 'succeeded', 'rejected')),
  result_code TEXT,
  result_hash TEXT,
  result_schema_version TEXT,
  result_canonical_json TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  PRIMARY KEY(scope_id, operation, idempotency_key)
);

CREATE TABLE revision_commit_attempts (
  attempt_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('revision.commit', 'vdt.create_with_initial')),
  project_id TEXT NOT NULL,
  vdt_id TEXT NOT NULL,
  revision_id TEXT NOT NULL UNIQUE,
  actor_principal_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  intent_json TEXT NOT NULL,
  payload_content_scheme TEXT NOT NULL,
  payload_content_hash TEXT NOT NULL,
  payload_byte_length INTEGER NOT NULL,
  payload_canonical_json TEXT NOT NULL,
  staged_payload_relative_path TEXT NOT NULL UNIQUE,
  final_relative_path TEXT NOT NULL UNIQUE,
  expected_active_revision_id TEXT,
  expected_active_content_scheme TEXT,
  expected_active_content_hash TEXT,
  expected_commit_generation INTEGER NOT NULL,
  expected_runtime_generation TEXT NOT NULL,
  expected_generation_version INTEGER NOT NULL,
  owner_token TEXT NOT NULL,
  lease_generation INTEGER NOT NULL,
  lease_expires_at INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('reserved', 'staged', 'head_reserved', 'published', 'completed', 'rejected', 'quarantined')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  terminal_code TEXT,
  quarantine_reason TEXT,
  UNIQUE(vdt_id, idempotency_key)
);

CREATE INDEX revision_commit_recovery
ON revision_commit_attempts(state, lease_expires_at);

CREATE TABLE revision_commit_records (
  attempt_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  project_id TEXT NOT NULL,
  vdt_id TEXT NOT NULL,
  revision_id TEXT NOT NULL UNIQUE,
  revision_no INTEGER NOT NULL,
  parent_revision_id TEXT,
  runtime_generation TEXT NOT NULL,
  generation_version INTEGER NOT NULL,
  actor_principal_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  intent_json TEXT NOT NULL,
  base_content_scheme TEXT,
  base_content_hash TEXT,
  payload_content_scheme TEXT NOT NULL,
  payload_content_hash TEXT NOT NULL,
  payload_byte_length INTEGER NOT NULL,
  staged_payload_relative_path TEXT NOT NULL,
  final_relative_path TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK(state IN ('pending', 'committed', 'quarantined')),
  reserved_at INTEGER NOT NULL,
  committed_at INTEGER,
  quarantine_reason TEXT,
  UNIQUE(vdt_id, revision_no)
);

CREATE UNIQUE INDEX one_pending_commit_record_per_vdt
ON revision_commit_records(vdt_id)
WHERE state = 'pending';
