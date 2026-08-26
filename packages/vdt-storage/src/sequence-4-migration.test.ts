import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  __runBootstrapStorageMigrationsForTests,
  __runSequence3StorageMigrationsForTests,
  computeSchemaHash,
  runStorageMigrations
} from "./migrations";
import { VdtStorageError } from "./types";

const SEQUENCE_3_MANIFEST_HASH =
  "sha256:791fc7c7cce9abd11b2509ddaa6ba9e92e469178a3d1add6803b083295c849e8";
const SEQUENCE_4_MANIFEST_HASH =
  "sha256:58440c19c409fb79229458d8448cafa900dd24f8e363c191dd4fbececa54b2d0";
const SEQUENCE_4_SCHEMA_HASH =
  "sha256:77281710693b86a25722b3f6b14fcd0496fe22918cfc77cb39f1679ffed5dfb0";
const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) {
    fs.rmSync(roots.pop()!, { recursive: true, force: true });
  }
});

describe("Sequence 4 bounded agent execution production migration", () => {
  it("uses a second fenced attempt, preserves the exact Sequence 3 identity, and reopens idempotently", () => {
    const fixture = createFixture();
    runProduction(fixture);
    const db = new DatabaseSync(fixture.databasePath);
    expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 4 });
    expect(computeSchemaHash(db, 4)).toBe(SEQUENCE_4_SCHEMA_HASH);
    expect(db.prepare(`
      SELECT sequence, migration_id, manifest_hash
      FROM applied_migrations ORDER BY sequence
    `).all()).toEqual([
      expect.objectContaining({ sequence: 1 }),
      expect.objectContaining({ sequence: 2 }),
      {
        sequence: 3,
        migration_id: "003-durable-agent-run-coordination",
        manifest_hash: SEQUENCE_3_MANIFEST_HASH
      },
      {
        sequence: 4,
        migration_id: "004-bounded-agent-execution",
        manifest_hash: SEQUENCE_4_MANIFEST_HASH
      }
    ]);
    expect(db.prepare(`
      SELECT target_manifest_hash, next_sequence, status, active_migration_id
      FROM migration_attempts
      WHERE target_manifest_hash IN (?, ?)
      ORDER BY next_sequence
    `).all(SEQUENCE_3_MANIFEST_HASH, SEQUENCE_4_MANIFEST_HASH)).toEqual([
      {
        target_manifest_hash: SEQUENCE_3_MANIFEST_HASH,
        next_sequence: 4,
        status: "completed",
        active_migration_id: "003-durable-agent-run-coordination"
      },
      {
        target_manifest_hash: SEQUENCE_4_MANIFEST_HASH,
        next_sequence: 5,
        status: "completed",
        active_migration_id: "004-bounded-agent-execution"
      }
    ]);
    const evidenceBefore = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM migration_attempts) AS attempts,
        (SELECT COUNT(*) FROM migration_backup_evidence) AS backups,
        (SELECT COUNT(*) FROM applied_migrations) AS applications
    `).get();
    db.close();

    runProduction(fixture);
    const reopened = new DatabaseSync(fixture.databasePath);
    expect(reopened.prepare(`
      SELECT
        (SELECT COUNT(*) FROM migration_attempts) AS attempts,
        (SELECT COUNT(*) FROM migration_backup_evidence) AS backups,
        (SELECT COUNT(*) FROM applied_migrations) AS applications
    `).get()).toEqual(evidenceBefore);
    reopened.close();
  });

  it("keeps V1 runs readable while enforcing immutable binding and Event V2 authority", () => {
    const fixture = createFixture();
    const bootstrap = new DatabaseSync(fixture.databasePath);
    __runBootstrapStorageMigrationsForTests(
      bootstrap,
      fixture.dataDir,
      migrationOptions("bootstrap")
    );
    bootstrap.exec("PRAGMA foreign_keys = ON;");
    bootstrap.prepare(`
      INSERT INTO projects
      (id, name, description, industry, metadata_json, created_at, updated_at)
      VALUES ('project_1', 'Project', NULL, NULL, NULL, 0, 10)
    `).run();
    bootstrap.prepare(`
      INSERT INTO project_runtime_states
      (project_id, schema_version, runtime_generation, generation_version,
       migration_state, write_state, updated_at)
      VALUES ('project_1', 'project_runtime_state.v1', 'v1', 0,
              'not_started', 'disabled', 10)
    `).run();
    bootstrap.prepare(`
      INSERT INTO agent_runs
      (id, project_id, vdt_id, conversation_id, status, phase, request_json,
       public_snapshot_json, internal_state_json, created_at, updated_at,
       completed_at)
      VALUES ('run_legacy', 'project_1', NULL, NULL, 'succeeded', 'reporting',
              '{}', NULL, NULL, 0, 10, 10)
    `).run();
    bootstrap.close();

    runProduction(fixture);
    const db = new DatabaseSync(fixture.databasePath);
    db.exec("PRAGMA foreign_keys = ON;");
    expect(db.prepare(`
      SELECT id, status, phase FROM agent_runs WHERE id = 'run_legacy'
    `).get()).toEqual({
      id: "run_legacy",
      status: "succeeded",
      phase: "reporting"
    });
    const h1 = sha("1");
    const h2 = sha("2");
    const h3 = sha("3");
    db.prepare(`
      INSERT INTO agent_session_bindings_v2
      (run_id, schema_version, binding_id, project_id, execution_profile,
       engine_id, engine_adapter_id, backend_id, model_id, protocol_version,
       cli_version, tool_isolation, qualification_status,
       capability_evidence_hash, settings_hash, capability_profile_hash,
       tool_catalog_hash, external_session_id, session_epoch,
       binding_fence_token, binding_fence_generation,
       binding_fence_expires_at, binding_canonical_json, binding_hash, bound_at)
      VALUES
      ('run_legacy', 2, 'binding_1', 'project_1', 'model_agent',
       'engine_1', 'adapter_1', 'backend_1', 'model_1', 'protocol_1',
       NULL, 'permission_only', 'unverified', NULL, ?, ?, ?, NULL, 1,
       'fence_1', 1, '2026-08-26T00:01:00.000Z', '{"schemaVersion":2}', ?,
       '2026-08-26T00:00:00.000Z')
    `).run(h1, h2, h3, sha("4"));
    db.prepare(`
      INSERT INTO projects
      (id, name, description, industry, metadata_json, created_at, updated_at)
      VALUES ('project_external', 'External', NULL, NULL, NULL, 20, 20)
    `).run();
    db.prepare(`
      INSERT INTO agent_runs
      (id, project_id, vdt_id, conversation_id, status, phase, request_json,
       public_snapshot_json, internal_state_json, created_at, updated_at,
       completed_at)
      VALUES ('run_external', 'project_external', NULL, NULL, 'running',
              'building_graph', '{}', NULL, NULL, 20, 20, NULL)
    `).run();
    expect(() => db.prepare(`
      INSERT INTO agent_session_bindings_v2
      (run_id, schema_version, binding_id, project_id, execution_profile,
       engine_id, engine_adapter_id, backend_id, model_id, protocol_version,
       cli_version, tool_isolation, qualification_status,
       capability_evidence_hash, settings_hash, capability_profile_hash,
       tool_catalog_hash, external_session_id, session_epoch,
       binding_fence_token, binding_fence_generation,
       binding_fence_expires_at, binding_canonical_json, binding_hash, bound_at)
      SELECT 'run_external', 2, 'binding_external', 'project_external',
             'external_cli_agent', engine_id, engine_adapter_id, backend_id,
             model_id, protocol_version, 'cursor-unqualified',
             'permission_only', 'unverified', NULL, settings_hash,
             capability_profile_hash, tool_catalog_hash, NULL, 1,
             'fence_external', 1, binding_fence_expires_at,
             binding_canonical_json, ?, bound_at
      FROM agent_session_bindings_v2 WHERE run_id = 'run_legacy'
    `).run(sha("b"))).toThrow();
    expect(() => db.prepare(`
      UPDATE agent_session_bindings_v2 SET model_id = 'different'
      WHERE run_id = 'run_legacy'
    `).run()).toThrow(/agent_session_binding_immutable/);
    db.prepare(`
      UPDATE agent_session_bindings_v2
      SET external_session_id = 'session_1',
          binding_canonical_json = '{"externalSessionId":"session_1","schemaVersion":2}',
          binding_hash = ?
      WHERE run_id = 'run_legacy'
    `).run(sha("5"));
    expect(() => db.prepare(`
      UPDATE agent_session_bindings_v2
      SET external_session_id = 'session_2', binding_canonical_json = '{}',
          binding_hash = ?
      WHERE run_id = 'run_legacy'
    `).run(sha("6"))).toThrow(/agent_session_binding_immutable/);

    expect(db.prepare(`
      SELECT session_epoch FROM agent_current_session_epochs_v2
      WHERE run_id = 'run_legacy'
    `).get()).toEqual({ session_epoch: 1 });
    db.prepare(`
      INSERT INTO agent_session_epochs_v2
      (epoch_id, schema_version, run_id, binding_id, session_epoch,
       predecessor_epoch, start_reason, write_fence_token,
       write_fence_generation, write_fence_expires_at, epoch_canonical_json,
       epoch_hash, started_at)
      VALUES ('epoch_2', 2, 'run_legacy', 'binding_1', 2, 1,
              'checkpoint_resume', 'fence_2', 2,
              '2026-08-26T00:02:00.000Z', '{"sessionEpoch":2}', ?,
              '2026-08-26T00:01:00.000Z')
    `).run(sha("6"));
    expect(() => db.prepare(`
      INSERT INTO agent_session_epochs_v2
      (epoch_id, schema_version, run_id, binding_id, session_epoch,
       predecessor_epoch, start_reason, write_fence_token,
       write_fence_generation, write_fence_expires_at, epoch_canonical_json,
       epoch_hash, started_at)
      VALUES ('epoch_4', 2, 'run_legacy', 'binding_1', 4, 2,
              'checkpoint_resume', 'fence_4', 4,
              '2026-08-26T00:04:00.000Z', '{"sessionEpoch":4}', ?,
              '2026-08-26T00:03:00.000Z')
    `).run(sha("8"))).toThrow(/agent_session_epoch_not_next/);
    expect(() => db.prepare(`
      INSERT INTO agent_engine_exchange_receipts_v2
      (transition_id, schema_version, receipt_id, run_id, binding_id,
       exchange_id, stable_call_key, transition_sequence, session_epoch,
       state, input_hash, output_hash, result_code, write_fence_token,
       write_fence_generation, write_fence_expires_at,
       receipt_canonical_json, receipt_hash, started_at, updated_at)
      VALUES ('exchange_stale', 2, 'exchange_receipt_stale', 'run_legacy',
              'binding_1', 'exchange_1', 'stable_1', 1, 1, 'prepared', ?,
              NULL, NULL, 'fence_1', 1, '2026-08-26T00:01:00.000Z',
              '{}', ?, '2026-08-26T00:00:00.000Z',
              '2026-08-26T00:00:00.000Z')
    `).run(sha("9"), sha("a"))).toThrow(/agent_session_epoch_stale/);
    db.prepare(`
      INSERT INTO agent_engine_exchange_receipts_v2
      (transition_id, schema_version, receipt_id, run_id, binding_id,
       exchange_id, stable_call_key, transition_sequence, session_epoch,
       state, input_hash, output_hash, result_code, write_fence_token,
       write_fence_generation, write_fence_expires_at,
       receipt_canonical_json, receipt_hash, started_at, updated_at)
      VALUES ('exchange_current', 2, 'exchange_receipt_current', 'run_legacy',
              'binding_1', 'exchange_1', 'stable_1', 1, 2, 'prepared', ?,
              NULL, NULL, 'fence_2', 2, '2026-08-26T00:02:00.000Z',
              '{}', ?, '2026-08-26T00:01:00.000Z',
              '2026-08-26T00:01:00.000Z')
    `).run(sha("9"), sha("a"));

    expect(() => db.prepare(`
      INSERT INTO agent_run_event_outbox_v2
      (event_id, schema_version, run_id, binding_id, session_epoch, sequence, previous_hash,
       event_hash, event_type, source, session_id, turn_id, correlation_id,
       message_id, payload_canonical_json, event_canonical_json,
       write_fence_token, write_fence_generation, write_fence_expires_at,
       created_at)
      VALUES ('event_bad', 2, 'run_legacy', 'binding_1', 2, 1, NULL, ?,
              'runtime_status', 'external_agent', 'session_1', NULL, NULL,
              'message_1', '{}', '{}', 'fence_1', 1,
              '2026-08-26T00:01:00.000Z', '2026-08-26T00:00:00.000Z')
    `).run(sha("7"))).toThrow();
    expect(() => db.prepare(`
      INSERT INTO agent_run_event_outbox_v2
      (event_id, schema_version, run_id, binding_id, session_epoch, sequence,
       previous_hash, event_hash, event_type, source, session_id, turn_id,
       correlation_id, message_id, payload_canonical_json,
       event_canonical_json, write_fence_token, write_fence_generation,
       write_fence_expires_at, created_at)
      VALUES ('event_stale', 2, 'run_legacy', 'binding_1', 1, 1, NULL, ?,
              'runtime_status', 'runtime', NULL, NULL, NULL, NULL, '{}', '{}',
              'fence_1', 1, '2026-08-26T00:01:00.000Z',
              '2026-08-26T00:00:00.000Z')
    `).run(sha("8"))).toThrow(/agent_session_epoch_stale/);
    db.prepare(`
      INSERT INTO agent_run_event_outbox_v2
      (event_id, schema_version, run_id, binding_id, session_epoch, sequence, previous_hash,
       event_hash, event_type, source, session_id, turn_id, correlation_id,
       message_id, payload_canonical_json, event_canonical_json,
       write_fence_token, write_fence_generation, write_fence_expires_at,
       created_at)
      VALUES ('event_1', 2, 'run_legacy', 'binding_1', 2, 1, NULL, ?,
              'runtime_status', 'runtime', NULL, NULL, NULL, NULL, '{}', '{}',
              'fence_2', 2, '2026-08-26T00:02:00.000Z',
              '2026-08-26T00:00:00.000Z')
    `).run(sha("7"));
    expect(() => db.prepare(`
      INSERT INTO agent_run_event_outbox_v2
      (event_id, schema_version, run_id, binding_id, session_epoch, sequence,
       previous_hash, event_hash, event_type, source, session_id, turn_id,
       correlation_id, message_id, payload_canonical_json,
       event_canonical_json, write_fence_token, write_fence_generation,
       write_fence_expires_at, created_at)
      VALUES ('event_gap', 2, 'run_legacy', 'binding_1', 2, 3, ?, ?,
              'runtime_status', 'runtime', NULL, NULL, NULL, NULL, '{}', '{}',
              'fence_2', 2, '2026-08-26T00:02:00.000Z',
              '2026-08-26T00:01:00.000Z')
    `).run(sha("7"), sha("c"))).toThrow(/agent_run_event_chain_invalid/);
    expect(() => db.prepare(`
      UPDATE agent_run_event_outbox_v2 SET created_at = created_at
      WHERE event_id = 'event_1'
    `).run()).toThrow(/agent_run_event_append_only/);
    db.close();
  });

  it("recovers the same Sequence 4 attempt after a pre-commit interruption", () => {
    const fixture = createFixture();
    const db = new DatabaseSync(fixture.databasePath);
    __runSequence3StorageMigrationsForTests(
      db,
      fixture.dataDir,
      migrationOptions("sequence3")
    );
    db.close();

    let now = "2026-08-26T00:00:00.000Z";
    const interrupted = new DatabaseSync(fixture.databasePath);
    expect(() => runStorageMigrations(interrupted, fixture.dataDir, {
      ...migrationOptions("sequence4-interrupted", () => now),
      leaseMs: 1_000,
      faultInjector(point, context) {
        if (point === "before_later_migration_commit" && context?.sequence === 4) {
          throw new Error("injected_sequence4_precommit_interruption");
        }
      }
    })).toThrow(VdtStorageError);
    interrupted.close();

    const beforeRecovery = new DatabaseSync(fixture.databasePath);
    const attemptBefore = beforeRecovery.prepare(`
      SELECT attempt_id, lease_generation, status, next_sequence
      FROM migration_attempts WHERE target_manifest_hash = ?
    `).get(SEQUENCE_4_MANIFEST_HASH) as Record<string, unknown>;
    expect(attemptBefore).toMatchObject({ status: "applying", next_sequence: 4 });
    beforeRecovery.close();

    now = "2026-08-26T00:00:02.000Z";
    runProduction(fixture, () => now);
    const recovered = new DatabaseSync(fixture.databasePath);
    expect(recovered.prepare("PRAGMA user_version").get()).toEqual({ user_version: 4 });
    expect(recovered.prepare(`
      SELECT attempt_id, lease_generation, status, next_sequence
      FROM migration_attempts WHERE target_manifest_hash = ?
    `).get(SEQUENCE_4_MANIFEST_HASH)).toMatchObject({
      attempt_id: attemptBefore.attempt_id,
      lease_generation: expect.any(Number),
      status: "completed",
      next_sequence: 5
    });
    recovered.close();
  });
});

function createFixture(): { dataDir: string; databasePath: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vdt-sequence4-"));
  roots.push(root);
  const dataDir = path.join(root, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  return { dataDir, databasePath: path.join(dataDir, "app.sqlite") };
}

function runProduction(
  fixture: { dataDir: string; databasePath: string },
  now: () => string = () => "2026-08-26T00:00:00.000Z"
): void {
  const db = new DatabaseSync(fixture.databasePath, { timeout: 30_000 });
  try {
    runStorageMigrations(
      db,
      fixture.dataDir,
      migrationOptions("production", now)
    );
  } finally {
    db.close();
  }
}

function migrationOptions(namespace: string, now = () => "2026-08-26T00:00:00.000Z") {
  let id = 0;
  let owner = 0;
  return {
    now,
    busyTimeoutMs: 30_000,
    leaseMs: 30_000,
    idFactory: () => `${namespace}_id_${++id}`,
    ownerTokenFactory: () => `${namespace}_owner_${++owner}`
  };
}

function sha(character: string): string {
  return `sha256:${character.repeat(64)}`;
}
