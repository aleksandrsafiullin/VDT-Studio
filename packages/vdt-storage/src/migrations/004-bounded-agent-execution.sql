CREATE TABLE agent_session_bindings_v2 (
  run_id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK(schema_version = 2),
  binding_id TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL,
  execution_profile TEXT NOT NULL CHECK(execution_profile IN ('external_cli_agent', 'model_agent')),
  engine_id TEXT NOT NULL,
  engine_adapter_id TEXT NOT NULL,
  backend_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  protocol_version TEXT NOT NULL,
  cli_version TEXT,
  tool_isolation TEXT NOT NULL CHECK(tool_isolation IN ('unverified', 'permission_only', 'hard_verified')),
  qualification_status TEXT NOT NULL CHECK(qualification_status IN ('unverified', 'qualified', 'rejected', 'revoked')),
  capability_evidence_hash TEXT CHECK(capability_evidence_hash IS NULL OR (length(capability_evidence_hash) = 71 AND substr(capability_evidence_hash, 1, 7) = 'sha256:' AND substr(capability_evidence_hash, 8) NOT GLOB '*[^0-9a-f]*')),
  settings_hash TEXT NOT NULL CHECK(length(settings_hash) = 71 AND substr(settings_hash, 1, 7) = 'sha256:' AND substr(settings_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  capability_profile_hash TEXT NOT NULL CHECK(length(capability_profile_hash) = 71 AND substr(capability_profile_hash, 1, 7) = 'sha256:' AND substr(capability_profile_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  tool_catalog_hash TEXT NOT NULL CHECK(length(tool_catalog_hash) = 71 AND substr(tool_catalog_hash, 1, 7) = 'sha256:' AND substr(tool_catalog_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  external_session_id TEXT,
  session_epoch INTEGER NOT NULL CHECK(session_epoch >= 1 AND session_epoch <= 9007199254740991),
  binding_fence_token TEXT NOT NULL,
  binding_fence_generation INTEGER NOT NULL CHECK(binding_fence_generation >= 1 AND binding_fence_generation <= 9007199254740991),
  binding_fence_expires_at TEXT NOT NULL,
  binding_canonical_json TEXT NOT NULL CHECK(json_valid(binding_canonical_json) AND json_type(binding_canonical_json) = 'object'),
  binding_hash TEXT NOT NULL UNIQUE CHECK(length(binding_hash) = 71 AND substr(binding_hash, 1, 7) = 'sha256:' AND substr(binding_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  bound_at TEXT NOT NULL,
  CHECK((execution_profile = 'external_cli_agent' AND cli_version IS NOT NULL) OR (execution_profile = 'model_agent' AND cli_version IS NULL)),
  CHECK(qualification_status <> 'qualified' OR capability_evidence_hash IS NOT NULL),
  CHECK(execution_profile <> 'external_cli_agent' OR (qualification_status = 'qualified' AND tool_isolation = 'hard_verified' AND capability_evidence_hash IS NOT NULL)),
  UNIQUE(run_id, binding_id),
  UNIQUE(run_id, project_id, binding_id),
  UNIQUE(run_id, binding_id, session_epoch),
  FOREIGN KEY(run_id) REFERENCES agent_runs(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE TRIGGER agent_session_bindings_v2_no_delete
BEFORE DELETE ON agent_session_bindings_v2
BEGIN
  SELECT RAISE(ABORT, 'agent_session_binding_append_only');
END;

CREATE TRIGGER agent_session_bindings_v2_immutable_update
BEFORE UPDATE ON agent_session_bindings_v2
WHEN OLD.run_id IS NOT NEW.run_id
  OR OLD.schema_version IS NOT NEW.schema_version
  OR OLD.binding_id IS NOT NEW.binding_id
  OR OLD.project_id IS NOT NEW.project_id
  OR OLD.execution_profile IS NOT NEW.execution_profile
  OR OLD.engine_id IS NOT NEW.engine_id
  OR OLD.engine_adapter_id IS NOT NEW.engine_adapter_id
  OR OLD.backend_id IS NOT NEW.backend_id
  OR OLD.model_id IS NOT NEW.model_id
  OR OLD.protocol_version IS NOT NEW.protocol_version
  OR OLD.cli_version IS NOT NEW.cli_version
  OR OLD.tool_isolation IS NOT NEW.tool_isolation
  OR OLD.qualification_status IS NOT NEW.qualification_status
  OR OLD.capability_evidence_hash IS NOT NEW.capability_evidence_hash
  OR OLD.settings_hash IS NOT NEW.settings_hash
  OR OLD.capability_profile_hash IS NOT NEW.capability_profile_hash
  OR OLD.tool_catalog_hash IS NOT NEW.tool_catalog_hash
  OR OLD.session_epoch IS NOT NEW.session_epoch
  OR OLD.binding_fence_token IS NOT NEW.binding_fence_token
  OR OLD.binding_fence_generation IS NOT NEW.binding_fence_generation
  OR OLD.binding_fence_expires_at IS NOT NEW.binding_fence_expires_at
  OR OLD.bound_at IS NOT NEW.bound_at
  OR NOT (
    OLD.external_session_id IS NULL
    AND NEW.external_session_id IS NOT NULL
    AND OLD.binding_canonical_json IS NOT NEW.binding_canonical_json
    AND OLD.binding_hash IS NOT NEW.binding_hash
  )
BEGIN
  SELECT RAISE(ABORT, 'agent_session_binding_immutable');
END;

CREATE TABLE agent_session_epochs_v2 (
  epoch_id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK(schema_version = 2),
  run_id TEXT NOT NULL,
  binding_id TEXT NOT NULL,
  session_epoch INTEGER NOT NULL CHECK(session_epoch >= 1 AND session_epoch <= 9007199254740991),
  predecessor_epoch INTEGER CHECK(predecessor_epoch IS NULL OR (predecessor_epoch >= 1 AND predecessor_epoch <= 9007199254740991)),
  start_reason TEXT NOT NULL CHECK(start_reason IN ('initial', 'checkpoint_resume', 'crash_recovery')),
  write_fence_token TEXT NOT NULL,
  write_fence_generation INTEGER NOT NULL CHECK(write_fence_generation >= 1 AND write_fence_generation <= 9007199254740991),
  write_fence_expires_at TEXT NOT NULL,
  epoch_canonical_json TEXT NOT NULL CHECK(json_valid(epoch_canonical_json) AND json_type(epoch_canonical_json) = 'object'),
  epoch_hash TEXT NOT NULL UNIQUE CHECK(length(epoch_hash) = 71 AND substr(epoch_hash, 1, 7) = 'sha256:' AND substr(epoch_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  started_at TEXT NOT NULL,
  UNIQUE(run_id, session_epoch),
  UNIQUE(run_id, binding_id, session_epoch),
  FOREIGN KEY(run_id, binding_id) REFERENCES agent_session_bindings_v2(run_id, binding_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id, predecessor_epoch) REFERENCES agent_session_epochs_v2(run_id, session_epoch) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);

CREATE TRIGGER agent_session_epochs_v2_contiguous_insert
BEFORE INSERT ON agent_session_epochs_v2
WHEN NEW.session_epoch IS NOT COALESCE(
  (SELECT MAX(session_epoch) + 1 FROM agent_session_epochs_v2 WHERE run_id = NEW.run_id),
  (SELECT session_epoch FROM agent_session_bindings_v2 WHERE run_id = NEW.run_id AND binding_id = NEW.binding_id)
)
OR (
  NEW.session_epoch = (SELECT session_epoch FROM agent_session_bindings_v2 WHERE run_id = NEW.run_id AND binding_id = NEW.binding_id)
  AND (NEW.predecessor_epoch IS NOT NULL OR NEW.start_reason <> 'initial')
)
OR (
  NEW.session_epoch > (SELECT session_epoch FROM agent_session_bindings_v2 WHERE run_id = NEW.run_id AND binding_id = NEW.binding_id)
  AND (NEW.predecessor_epoch IS NOT NEW.session_epoch - 1 OR NEW.start_reason = 'initial')
)
BEGIN
  SELECT RAISE(ABORT, 'agent_session_epoch_not_next');
END;

CREATE TRIGGER agent_session_bindings_v2_create_initial_epoch
AFTER INSERT ON agent_session_bindings_v2
BEGIN
  INSERT INTO agent_session_epochs_v2
  (epoch_id, schema_version, run_id, binding_id, session_epoch,
   predecessor_epoch, start_reason, write_fence_token,
   write_fence_generation, write_fence_expires_at, epoch_canonical_json,
   epoch_hash, started_at)
  VALUES
  ('epoch:' || NEW.binding_id || ':' || NEW.session_epoch, 2, NEW.run_id,
   NEW.binding_id, NEW.session_epoch, NULL, 'initial',
   NEW.binding_fence_token, NEW.binding_fence_generation,
   NEW.binding_fence_expires_at, NEW.binding_canonical_json,
   NEW.binding_hash, NEW.bound_at);
END;

CREATE TRIGGER agent_session_epochs_v2_no_update
BEFORE UPDATE ON agent_session_epochs_v2
BEGIN
  SELECT RAISE(ABORT, 'agent_session_epoch_append_only');
END;

CREATE TRIGGER agent_session_epochs_v2_no_delete
BEFORE DELETE ON agent_session_epochs_v2
BEGIN
  SELECT RAISE(ABORT, 'agent_session_epoch_append_only');
END;

CREATE TABLE agent_engine_checkpoints_v2 (
  checkpoint_id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK(schema_version = 2),
  run_id TEXT NOT NULL,
  binding_id TEXT NOT NULL,
  session_epoch INTEGER NOT NULL CHECK(session_epoch >= 1 AND session_epoch <= 9007199254740991),
  external_session_id TEXT,
  last_confirmed_input_cursor TEXT,
  last_confirmed_input_hash TEXT CHECK(last_confirmed_input_hash IS NULL OR (length(last_confirmed_input_hash) = 71 AND substr(last_confirmed_input_hash, 1, 7) = 'sha256:' AND substr(last_confirmed_input_hash, 8) NOT GLOB '*[^0-9a-f]*')),
  last_confirmed_output_cursor TEXT,
  last_confirmed_output_hash TEXT CHECK(last_confirmed_output_hash IS NULL OR (length(last_confirmed_output_hash) = 71 AND substr(last_confirmed_output_hash, 1, 7) = 'sha256:' AND substr(last_confirmed_output_hash, 8) NOT GLOB '*[^0-9a-f]*')),
  active_exchange_id TEXT,
  active_exchange_stable_call_key TEXT,
  active_exchange_state TEXT CHECK(active_exchange_state IS NULL OR active_exchange_state IN ('prepared', 'in_flight', 'completed', 'failed', 'ambiguous')),
  active_tool_external_call_id TEXT,
  active_tool_name TEXT,
  active_tool_state TEXT CHECK(active_tool_state IS NULL OR active_tool_state IN ('reserved', 'in_flight', 'completed', 'failed', 'ambiguous')),
  finish_receipt_id TEXT,
  finish_receipt_state TEXT CHECK(finish_receipt_state IS NULL OR finish_receipt_state IN ('verified', 'final_persisted')),
  finish_receipt_hash TEXT CHECK(finish_receipt_hash IS NULL OR (length(finish_receipt_hash) = 71 AND substr(finish_receipt_hash, 1, 7) = 'sha256:' AND substr(finish_receipt_hash, 8) NOT GLOB '*[^0-9a-f]*')),
  write_fence_token TEXT NOT NULL,
  write_fence_generation INTEGER NOT NULL CHECK(write_fence_generation >= 1 AND write_fence_generation <= 9007199254740991),
  write_fence_expires_at TEXT NOT NULL,
  checkpoint_canonical_json TEXT NOT NULL CHECK(json_valid(checkpoint_canonical_json) AND json_type(checkpoint_canonical_json) = 'object'),
  checkpoint_hash TEXT NOT NULL UNIQUE CHECK(length(checkpoint_hash) = 71 AND substr(checkpoint_hash, 1, 7) = 'sha256:' AND substr(checkpoint_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL,
  CHECK((last_confirmed_input_cursor IS NULL) = (last_confirmed_input_hash IS NULL)),
  CHECK((last_confirmed_output_cursor IS NULL) = (last_confirmed_output_hash IS NULL)),
  CHECK((active_exchange_id IS NULL) = (active_exchange_stable_call_key IS NULL) AND (active_exchange_id IS NULL) = (active_exchange_state IS NULL)),
  CHECK((active_tool_external_call_id IS NULL) = (active_tool_name IS NULL) AND (active_tool_external_call_id IS NULL) = (active_tool_state IS NULL)),
  CHECK((finish_receipt_id IS NULL) = (finish_receipt_state IS NULL) AND (finish_receipt_id IS NULL) = (finish_receipt_hash IS NULL)),
  UNIQUE(run_id, checkpoint_id),
  UNIQUE(run_id, binding_id, checkpoint_id),
  FOREIGN KEY(run_id, binding_id, session_epoch) REFERENCES agent_session_epochs_v2(run_id, binding_id, session_epoch) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX agent_engine_checkpoints_v2_latest_idx
ON agent_engine_checkpoints_v2(run_id ASC, created_at DESC, checkpoint_id DESC);

CREATE TRIGGER agent_engine_checkpoints_v2_no_update
BEFORE UPDATE ON agent_engine_checkpoints_v2
BEGIN
  SELECT RAISE(ABORT, 'agent_engine_checkpoint_append_only');
END;

CREATE TRIGGER agent_engine_checkpoints_v2_current_epoch_insert
BEFORE INSERT ON agent_engine_checkpoints_v2
WHEN NEW.session_epoch IS NOT (SELECT MAX(session_epoch) FROM agent_session_epochs_v2 WHERE run_id = NEW.run_id)
BEGIN
  SELECT RAISE(ABORT, 'agent_session_epoch_stale');
END;

CREATE TRIGGER agent_engine_checkpoints_v2_no_delete
BEFORE DELETE ON agent_engine_checkpoints_v2
BEGIN
  SELECT RAISE(ABORT, 'agent_engine_checkpoint_append_only');
END;

CREATE TABLE agent_engine_exchange_receipts_v2 (
  transition_id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK(schema_version = 2),
  receipt_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  binding_id TEXT NOT NULL,
  exchange_id TEXT NOT NULL,
  stable_call_key TEXT NOT NULL,
  transition_sequence INTEGER NOT NULL CHECK(transition_sequence >= 1 AND transition_sequence <= 9007199254740991),
  session_epoch INTEGER NOT NULL CHECK(session_epoch >= 1 AND session_epoch <= 9007199254740991),
  state TEXT NOT NULL CHECK(state IN ('prepared', 'in_flight', 'completed', 'failed', 'ambiguous')),
  input_hash TEXT NOT NULL CHECK(length(input_hash) = 71 AND substr(input_hash, 1, 7) = 'sha256:' AND substr(input_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  output_hash TEXT CHECK(output_hash IS NULL OR (length(output_hash) = 71 AND substr(output_hash, 1, 7) = 'sha256:' AND substr(output_hash, 8) NOT GLOB '*[^0-9a-f]*')),
  result_code TEXT,
  write_fence_token TEXT NOT NULL,
  write_fence_generation INTEGER NOT NULL CHECK(write_fence_generation >= 1 AND write_fence_generation <= 9007199254740991),
  write_fence_expires_at TEXT NOT NULL,
  receipt_canonical_json TEXT NOT NULL CHECK(json_valid(receipt_canonical_json) AND json_type(receipt_canonical_json) = 'object'),
  receipt_hash TEXT NOT NULL UNIQUE CHECK(length(receipt_hash) = 71 AND substr(receipt_hash, 1, 7) = 'sha256:' AND substr(receipt_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(updated_at >= started_at),
  CHECK(state <> 'completed' OR output_hash IS NOT NULL),
  CHECK(state NOT IN ('failed', 'ambiguous') OR result_code IS NOT NULL),
  UNIQUE(run_id, stable_call_key, transition_sequence),
  UNIQUE(run_id, exchange_id, transition_sequence),
  UNIQUE(run_id, receipt_id, transition_sequence),
  FOREIGN KEY(run_id, binding_id, session_epoch) REFERENCES agent_session_epochs_v2(run_id, binding_id, session_epoch) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX agent_engine_exchange_receipts_v2_latest_idx
ON agent_engine_exchange_receipts_v2(run_id ASC, stable_call_key ASC, transition_sequence DESC);

CREATE UNIQUE INDEX agent_engine_exchange_receipts_v2_one_terminal_uq
ON agent_engine_exchange_receipts_v2(run_id ASC, stable_call_key ASC)
WHERE state IN ('completed', 'failed');

CREATE TRIGGER agent_engine_exchange_receipts_v2_no_update
BEFORE UPDATE ON agent_engine_exchange_receipts_v2
BEGIN
  SELECT RAISE(ABORT, 'agent_engine_exchange_receipt_append_only');
END;

CREATE TRIGGER agent_engine_exchange_receipts_v2_current_epoch_insert
BEFORE INSERT ON agent_engine_exchange_receipts_v2
WHEN NEW.session_epoch IS NOT (SELECT MAX(session_epoch) FROM agent_session_epochs_v2 WHERE run_id = NEW.run_id)
BEGIN
  SELECT RAISE(ABORT, 'agent_session_epoch_stale');
END;

CREATE TRIGGER agent_engine_exchange_receipts_v2_contiguous_insert
BEFORE INSERT ON agent_engine_exchange_receipts_v2
WHEN NEW.transition_sequence IS NOT COALESCE(
  (SELECT MAX(transition_sequence) + 1
   FROM agent_engine_exchange_receipts_v2
   WHERE run_id = NEW.run_id AND stable_call_key = NEW.stable_call_key),
  1
)
OR EXISTS (
  SELECT 1 FROM agent_engine_exchange_receipts_v2 prior
  WHERE prior.run_id = NEW.run_id AND prior.stable_call_key = NEW.stable_call_key
    AND (prior.receipt_id IS NOT NEW.receipt_id
      OR prior.binding_id IS NOT NEW.binding_id
      OR prior.exchange_id IS NOT NEW.exchange_id
      OR prior.session_epoch IS NOT NEW.session_epoch
      OR prior.input_hash IS NOT NEW.input_hash
      OR prior.started_at IS NOT NEW.started_at)
)
BEGIN
  SELECT RAISE(ABORT, 'agent_engine_exchange_transition_invalid');
END;

CREATE TRIGGER agent_engine_exchange_receipts_v2_no_delete
BEFORE DELETE ON agent_engine_exchange_receipts_v2
BEGIN
  SELECT RAISE(ABORT, 'agent_engine_exchange_receipt_append_only');
END;

CREATE TABLE agent_tool_operation_receipts_v2 (
  transition_id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK(schema_version = 2),
  receipt_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  binding_id TEXT NOT NULL,
  external_call_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  transition_sequence INTEGER NOT NULL CHECK(transition_sequence >= 1 AND transition_sequence <= 9007199254740991),
  session_epoch INTEGER NOT NULL CHECK(session_epoch >= 1 AND session_epoch <= 9007199254740991),
  state TEXT NOT NULL CHECK(state IN ('reserved', 'in_flight', 'completed', 'failed', 'ambiguous')),
  args_hash TEXT NOT NULL CHECK(length(args_hash) = 71 AND substr(args_hash, 1, 7) = 'sha256:' AND substr(args_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  result_hash TEXT CHECK(result_hash IS NULL OR (length(result_hash) = 71 AND substr(result_hash, 1, 7) = 'sha256:' AND substr(result_hash, 8) NOT GLOB '*[^0-9a-f]*')),
  result_code TEXT,
  replay_result_json TEXT CHECK(replay_result_json IS NULL OR (json_valid(replay_result_json) AND json_type(replay_result_json) = 'object' AND length(CAST(replay_result_json AS BLOB)) <= 262144)),
  expected_revision INTEGER CHECK(expected_revision IS NULL OR (expected_revision >= 0 AND expected_revision <= 9007199254740991)),
  committed_revision INTEGER CHECK(committed_revision IS NULL OR (committed_revision >= 0 AND committed_revision <= 9007199254740991)),
  write_fence_token TEXT NOT NULL,
  write_fence_generation INTEGER NOT NULL CHECK(write_fence_generation >= 1 AND write_fence_generation <= 9007199254740991),
  write_fence_expires_at TEXT NOT NULL,
  receipt_canonical_json TEXT NOT NULL CHECK(json_valid(receipt_canonical_json) AND json_type(receipt_canonical_json) = 'object'),
  receipt_hash TEXT NOT NULL UNIQUE CHECK(length(receipt_hash) = 71 AND substr(receipt_hash, 1, 7) = 'sha256:' AND substr(receipt_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(updated_at >= started_at),
  CHECK(state <> 'completed' OR (result_hash IS NOT NULL AND result_code IS NOT NULL)),
  CHECK(state NOT IN ('failed', 'ambiguous') OR result_code IS NOT NULL),
  CHECK(committed_revision IS NULL OR expected_revision IS NULL OR committed_revision >= expected_revision),
  UNIQUE(run_id, external_call_id, transition_sequence),
  UNIQUE(run_id, idempotency_key, transition_sequence),
  UNIQUE(run_id, receipt_id, transition_sequence),
  FOREIGN KEY(run_id, binding_id, session_epoch) REFERENCES agent_session_epochs_v2(run_id, binding_id, session_epoch) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX agent_tool_operation_receipts_v2_latest_idx
ON agent_tool_operation_receipts_v2(run_id ASC, external_call_id ASC, transition_sequence DESC);

CREATE UNIQUE INDEX agent_tool_operation_receipts_v2_one_terminal_uq
ON agent_tool_operation_receipts_v2(run_id ASC, external_call_id ASC)
WHERE state IN ('completed', 'failed');

CREATE TRIGGER agent_tool_operation_receipts_v2_no_update
BEFORE UPDATE ON agent_tool_operation_receipts_v2
BEGIN
  SELECT RAISE(ABORT, 'agent_tool_operation_receipt_append_only');
END;

CREATE TRIGGER agent_tool_operation_receipts_v2_current_epoch_insert
BEFORE INSERT ON agent_tool_operation_receipts_v2
WHEN NEW.session_epoch IS NOT (SELECT MAX(session_epoch) FROM agent_session_epochs_v2 WHERE run_id = NEW.run_id)
BEGIN
  SELECT RAISE(ABORT, 'agent_session_epoch_stale');
END;

CREATE TRIGGER agent_tool_operation_receipts_v2_contiguous_insert
BEFORE INSERT ON agent_tool_operation_receipts_v2
WHEN NEW.transition_sequence IS NOT COALESCE(
  (SELECT MAX(transition_sequence) + 1
   FROM agent_tool_operation_receipts_v2
   WHERE run_id = NEW.run_id AND external_call_id = NEW.external_call_id),
  1
)
OR EXISTS (
  SELECT 1 FROM agent_tool_operation_receipts_v2 prior
  WHERE prior.run_id = NEW.run_id AND prior.external_call_id = NEW.external_call_id
    AND (prior.receipt_id IS NOT NEW.receipt_id
      OR prior.binding_id IS NOT NEW.binding_id
      OR prior.tool_name IS NOT NEW.tool_name
      OR prior.idempotency_key IS NOT NEW.idempotency_key
      OR prior.session_epoch IS NOT NEW.session_epoch
      OR prior.args_hash IS NOT NEW.args_hash
      OR prior.expected_revision IS NOT NEW.expected_revision
      OR prior.started_at IS NOT NEW.started_at)
)
BEGIN
  SELECT RAISE(ABORT, 'agent_tool_operation_transition_invalid');
END;

CREATE TRIGGER agent_tool_operation_receipts_v2_no_delete
BEFORE DELETE ON agent_tool_operation_receipts_v2
BEGIN
  SELECT RAISE(ABORT, 'agent_tool_operation_receipt_append_only');
END;

CREATE TABLE agent_finish_receipts_v2 (
  transition_id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK(schema_version = 2),
  receipt_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  binding_id TEXT NOT NULL,
  transition_sequence INTEGER NOT NULL CHECK(transition_sequence IN (1, 2)),
  session_epoch INTEGER NOT NULL CHECK(session_epoch >= 1 AND session_epoch <= 9007199254740991),
  authorization_epoch INTEGER NOT NULL CHECK(authorization_epoch >= 1 AND authorization_epoch <= 9007199254740991),
  state TEXT NOT NULL CHECK(state IN ('verified', 'final_persisted')),
  receipt_hash TEXT NOT NULL CHECK(length(receipt_hash) = 71 AND substr(receipt_hash, 1, 7) = 'sha256:' AND substr(receipt_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  project_revision INTEGER NOT NULL CHECK(project_revision >= 0 AND project_revision <= 9007199254740991),
  project_hash TEXT NOT NULL CHECK(length(project_hash) = 71 AND substr(project_hash, 1, 7) = 'sha256:' AND substr(project_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  validation_hash TEXT NOT NULL CHECK(length(validation_hash) = 71 AND substr(validation_hash, 1, 7) = 'sha256:' AND substr(validation_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  calculation_hash TEXT NOT NULL CHECK(length(calculation_hash) = 71 AND substr(calculation_hash, 1, 7) = 'sha256:' AND substr(calculation_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  final_message_hash TEXT CHECK(final_message_hash IS NULL OR (length(final_message_hash) = 71 AND substr(final_message_hash, 1, 7) = 'sha256:' AND substr(final_message_hash, 8) NOT GLOB '*[^0-9a-f]*')),
  write_fence_token TEXT NOT NULL,
  write_fence_generation INTEGER NOT NULL CHECK(write_fence_generation >= 1 AND write_fence_generation <= 9007199254740991),
  write_fence_expires_at TEXT NOT NULL,
  receipt_canonical_json TEXT NOT NULL CHECK(json_valid(receipt_canonical_json) AND json_type(receipt_canonical_json) = 'object'),
  transition_hash TEXT NOT NULL UNIQUE CHECK(length(transition_hash) = 71 AND substr(transition_hash, 1, 7) = 'sha256:' AND substr(transition_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  verified_at TEXT NOT NULL,
  final_persisted_at TEXT,
  CHECK((state = 'verified' AND transition_sequence = 1 AND final_message_hash IS NULL AND final_persisted_at IS NULL) OR (state = 'final_persisted' AND transition_sequence = 2 AND final_message_hash IS NOT NULL AND final_persisted_at IS NOT NULL AND final_persisted_at >= verified_at)),
  CHECK(authorization_epoch = session_epoch OR (state = 'final_persisted' AND transition_sequence = 2 AND authorization_epoch = session_epoch + 1)),
  UNIQUE(run_id, receipt_id, transition_sequence),
  UNIQUE(run_id, state),
  FOREIGN KEY(run_id, binding_id, session_epoch) REFERENCES agent_session_epochs_v2(run_id, binding_id, session_epoch) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id, binding_id, authorization_epoch) REFERENCES agent_session_epochs_v2(run_id, binding_id, session_epoch) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE TRIGGER agent_finish_receipts_v2_no_update
BEFORE UPDATE ON agent_finish_receipts_v2
BEGIN
  SELECT RAISE(ABORT, 'agent_finish_receipt_append_only');
END;

CREATE TRIGGER agent_finish_receipts_v2_current_epoch_insert
BEFORE INSERT ON agent_finish_receipts_v2
WHEN NEW.authorization_epoch IS NOT (SELECT MAX(session_epoch) FROM agent_session_epochs_v2 WHERE run_id = NEW.run_id)
BEGIN
  SELECT RAISE(ABORT, 'agent_session_epoch_stale');
END;

CREATE TRIGGER agent_finish_receipts_v2_contiguous_insert
BEFORE INSERT ON agent_finish_receipts_v2
WHEN NEW.transition_sequence IS NOT COALESCE(
  (SELECT MAX(transition_sequence) + 1
   FROM agent_finish_receipts_v2 WHERE run_id = NEW.run_id),
  1
)
OR EXISTS (
  SELECT 1 FROM agent_finish_receipts_v2 prior
  WHERE prior.run_id = NEW.run_id
    AND (prior.receipt_id IS NOT NEW.receipt_id
      OR prior.binding_id IS NOT NEW.binding_id
      OR prior.session_epoch IS NOT NEW.session_epoch
      OR prior.receipt_hash IS NOT NEW.receipt_hash
      OR prior.project_revision IS NOT NEW.project_revision
      OR prior.project_hash IS NOT NEW.project_hash
      OR prior.validation_hash IS NOT NEW.validation_hash
      OR prior.calculation_hash IS NOT NEW.calculation_hash
      OR prior.verified_at IS NOT NEW.verified_at)
)
BEGIN
  SELECT RAISE(ABORT, 'agent_finish_transition_invalid');
END;

CREATE TRIGGER agent_finish_receipts_v2_no_delete
BEFORE DELETE ON agent_finish_receipts_v2
BEGIN
  SELECT RAISE(ABORT, 'agent_finish_receipt_append_only');
END;

CREATE TABLE agent_run_event_outbox_v2 (
  event_id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK(schema_version = 2),
  run_id TEXT NOT NULL,
  binding_id TEXT NOT NULL,
  session_epoch INTEGER NOT NULL CHECK(session_epoch >= 1 AND session_epoch <= 9007199254740991),
  sequence INTEGER NOT NULL CHECK(sequence >= 1 AND sequence <= 9007199254740991),
  previous_hash TEXT CHECK(previous_hash IS NULL OR (length(previous_hash) = 71 AND substr(previous_hash, 1, 7) = 'sha256:' AND substr(previous_hash, 8) NOT GLOB '*[^0-9a-f]*')),
  event_hash TEXT NOT NULL CHECK(length(event_hash) = 71 AND substr(event_hash, 1, 7) = 'sha256:' AND substr(event_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  event_type TEXT NOT NULL CHECK(event_type IN ('assistant_message', 'question', 'runtime_status', 'tool_call', 'tool_result', 'approval_required', 'checkpoint', 'warning', 'final', 'error')),
  source TEXT NOT NULL CHECK(source IN ('external_agent', 'vdt_agent', 'runtime', 'tool_gateway')),
  session_id TEXT,
  turn_id TEXT,
  correlation_id TEXT,
  message_id TEXT,
  payload_canonical_json TEXT NOT NULL CHECK(json_valid(payload_canonical_json)),
  event_canonical_json TEXT NOT NULL CHECK(json_valid(event_canonical_json) AND json_type(event_canonical_json) = 'object'),
  write_fence_token TEXT NOT NULL,
  write_fence_generation INTEGER NOT NULL CHECK(write_fence_generation >= 1 AND write_fence_generation <= 9007199254740991),
  write_fence_expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK((sequence = 1 AND previous_hash IS NULL) OR (sequence > 1 AND previous_hash IS NOT NULL)),
  CHECK((source IN ('external_agent', 'vdt_agent') AND event_type IN ('assistant_message', 'question', 'final')) OR (source = 'runtime' AND event_type IN ('runtime_status', 'checkpoint', 'warning', 'error')) OR (source = 'tool_gateway' AND event_type IN ('tool_call', 'tool_result', 'approval_required', 'warning', 'error'))),
  CHECK(event_type NOT IN ('assistant_message', 'question', 'final') OR (session_id IS NOT NULL AND message_id IS NOT NULL)),
  CHECK(event_type NOT IN ('tool_call', 'tool_result', 'approval_required') OR correlation_id IS NOT NULL),
  UNIQUE(run_id, sequence),
  UNIQUE(run_id, event_hash),
  UNIQUE(run_id, event_id),
  FOREIGN KEY(run_id, binding_id, session_epoch) REFERENCES agent_session_epochs_v2(run_id, binding_id, session_epoch) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(run_id, previous_hash) REFERENCES agent_run_event_outbox_v2(run_id, event_hash) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX agent_run_event_outbox_v2_replay_idx
ON agent_run_event_outbox_v2(run_id ASC, sequence ASC, event_hash ASC);

CREATE TRIGGER agent_run_event_outbox_v2_no_update
BEFORE UPDATE ON agent_run_event_outbox_v2
BEGIN
  SELECT RAISE(ABORT, 'agent_run_event_append_only');
END;

CREATE TRIGGER agent_run_event_outbox_v2_current_epoch_insert
BEFORE INSERT ON agent_run_event_outbox_v2
WHEN NEW.session_epoch IS NOT (SELECT MAX(session_epoch) FROM agent_session_epochs_v2 WHERE run_id = NEW.run_id)
BEGIN
  SELECT RAISE(ABORT, 'agent_session_epoch_stale');
END;

CREATE TRIGGER agent_run_event_outbox_v2_chain_insert
BEFORE INSERT ON agent_run_event_outbox_v2
WHEN NEW.sequence IS NOT COALESCE(
  (SELECT MAX(sequence) + 1 FROM agent_run_event_outbox_v2 WHERE run_id = NEW.run_id),
  1
)
OR (
  NEW.sequence > 1
  AND NEW.previous_hash IS NOT (
    SELECT event_hash FROM agent_run_event_outbox_v2
    WHERE run_id = NEW.run_id AND sequence = NEW.sequence - 1
  )
)
BEGIN
  SELECT RAISE(ABORT, 'agent_run_event_chain_invalid');
END;

CREATE TRIGGER agent_run_event_outbox_v2_no_delete
BEFORE DELETE ON agent_run_event_outbox_v2
BEGIN
  SELECT RAISE(ABORT, 'agent_run_event_append_only');
END;

CREATE VIEW agent_latest_engine_checkpoint_v2 AS
SELECT checkpoint.*
FROM agent_engine_checkpoints_v2 checkpoint
WHERE NOT EXISTS (
  SELECT 1 FROM agent_engine_checkpoints_v2 later
  WHERE later.run_id = checkpoint.run_id
    AND (later.created_at > checkpoint.created_at OR (later.created_at = checkpoint.created_at AND later.checkpoint_id > checkpoint.checkpoint_id))
);

CREATE VIEW agent_current_session_epochs_v2 AS
SELECT epoch.*
FROM agent_session_epochs_v2 epoch
WHERE epoch.session_epoch = (
  SELECT MAX(current.session_epoch)
  FROM agent_session_epochs_v2 current
  WHERE current.run_id = epoch.run_id
);

CREATE VIEW agent_latest_engine_exchange_receipts_v2 AS
SELECT receipt.*
FROM agent_engine_exchange_receipts_v2 receipt
WHERE NOT EXISTS (
  SELECT 1 FROM agent_engine_exchange_receipts_v2 later
  WHERE later.run_id = receipt.run_id
    AND later.stable_call_key = receipt.stable_call_key
    AND later.transition_sequence > receipt.transition_sequence
);

CREATE VIEW agent_latest_tool_operation_receipts_v2 AS
SELECT receipt.*
FROM agent_tool_operation_receipts_v2 receipt
WHERE NOT EXISTS (
  SELECT 1 FROM agent_tool_operation_receipts_v2 later
  WHERE later.run_id = receipt.run_id
    AND later.external_call_id = receipt.external_call_id
    AND later.transition_sequence > receipt.transition_sequence
);

CREATE VIEW agent_latest_finish_receipts_v2 AS
SELECT receipt.*
FROM agent_finish_receipts_v2 receipt
WHERE NOT EXISTS (
  SELECT 1 FROM agent_finish_receipts_v2 later
  WHERE later.run_id = receipt.run_id
    AND later.transition_sequence > receipt.transition_sequence
);
