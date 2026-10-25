import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

/** Real Sequence 4 rows, including a self-referencing event chain. */
export function insertProjectDeletionSession(db: DatabaseSync, runId: string, projectId: string): void {
  const hash = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
  db.prepare(`
    INSERT INTO agent_session_bindings_v2
    (run_id, schema_version, binding_id, project_id, execution_profile,
     engine_id, engine_adapter_id, backend_id, model_id, protocol_version,
     cli_version, tool_isolation, qualification_status, capability_evidence_hash,
     settings_hash, capability_profile_hash, tool_catalog_hash, external_session_id,
     session_epoch, binding_fence_token, binding_fence_generation,
     binding_fence_expires_at, binding_canonical_json, binding_hash, bound_at)
    VALUES (?, 2, ?, ?, 'model_agent', 'engine', 'adapter', 'backend', 'model',
            'protocol', NULL, 'permission_only', 'unverified', NULL, ?, ?, ?, NULL,
            1, 'fence', 1, '2026-10-25T11:00:00.000Z', '{}', ?, '2026-10-25T10:00:00.000Z')
  `).run(runId, `binding_${runId}`, projectId, hash("settings"), hash("capabilities"), hash("tools"), hash(runId));
  for (const sequence of [1, 2]) {
    db.prepare(`
      INSERT INTO agent_run_event_outbox_v2
      (event_id, schema_version, run_id, binding_id, session_epoch, sequence,
       previous_hash, event_hash, event_type, source, session_id, turn_id,
       correlation_id, message_id, payload_canonical_json, event_canonical_json,
       write_fence_token, write_fence_generation, write_fence_expires_at, created_at)
      VALUES (?, 2, ?, ?, 1, ?, ?, ?, 'runtime_status', 'runtime', NULL, NULL,
              NULL, NULL, '{}', '{}', 'fence', 1, '2026-10-25T11:00:00.000Z',
              '2026-10-25T10:00:00.000Z')
    `).run(`event_${runId}_${sequence}`, runId, `binding_${runId}`, sequence,
      sequence === 1 ? null : hash(`${runId}:1`), hash(`${runId}:${sequence}`));
  }
}
