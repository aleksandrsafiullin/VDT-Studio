import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { VdtProject } from "@vdt-studio/vdt-core";
import {
  assertDensePlainJson,
  assertExactKeys,
  assertRevisionContentIdentity,
  canonicalizeJson,
  hashFramed,
  isPlainRecord,
  validateStrictVdtProjectCommit
} from "./canonical";
import { defined, decodeJson, toIso, toMillis } from "./json";
import { assertInside, assertSafeId, vdtRevisionDir } from "./project-files";
import type {
  ActorContextV1,
  CreateVdtWithInitialSnapshotInputV1,
  CreateVdtWithInitialSnapshotResultV1,
  JsonValue,
  OpenVdtDatabaseOptions,
  ProjectRuntimeStateV1,
  RevisionCommitAttemptV1,
  RevisionCommitCommandV2,
  RevisionCommitFaultPoint,
  RevisionCommitInputV2,
  RevisionCommitIntentV1,
  RevisionCommitResultV2,
  RevisionContentIdentityV1,
  RevisionQuarantineReason,
  Sha256,
  VdtRecord,
  VdtRevisionHeadV2,
  VdtRevisionRecord
} from "./types";
import { VdtStorageError } from "./types";

type Row = Record<string, unknown>;
type Operation = RevisionCommitAttemptV1["operation"];

const TERMINAL_STATES = new Set<RevisionCommitAttemptV1["state"]>([
  "completed",
  "rejected",
  "quarantined"
]);
const REVISION_SOURCES = new Set<RevisionCommitIntentV1["source"]>([
  "user",
  "agent",
  "import",
  "scenario",
  "repair"
]);

export class AtomicRevisionStore {
  private readonly now: () => string;
  private readonly idFactory: () => string;
  private readonly ownerTokenFactory: () => string;
  private readonly leaseMs: number;
  private readonly faultInjector:
    | ((point: RevisionCommitFaultPoint, attempt: RevisionCommitAttemptV1) => void)
    | undefined;

  constructor(
    private readonly db: DatabaseSync,
    private readonly dataDir: string,
    options: OpenVdtDatabaseOptions
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.idFactory = options.idFactory ?? randomUUID;
    this.ownerTokenFactory = options.ownerTokenFactory ?? randomUUID;
    this.leaseMs = options.revisionLeaseMs ?? 30_000;
    if (!Number.isSafeInteger(this.leaseMs) || this.leaseMs < 0) {
      throw new RangeError("revisionLeaseMs must be a safe non-negative integer.");
    }
    this.faultInjector = options.faultInjector;
    probeStorageCapabilities(dataDir, this.idFactory);
  }

  commitVdtRevision(input: RevisionCommitInputV2): RevisionCommitResultV2 {
    assertSafeId(input.projectId, "projectId");
    assertSafeId(input.vdtId, "vdtId");
    validateActor(input.actor, input.projectId);
    validateRevisionCommand(input.command);
    const payload = validateStrictVdtProjectCommit(input.project);
    const requestHash = revisionRequestHash(
      input.projectId,
      input.vdtId,
      input.actor,
      input.command,
      payload.contentIdentity,
      payload.bytes.byteLength
    );
    const existing = this.findIdempotency(input.vdtId, "revision.commit", input.command.idempotencyKey);
    if (existing) {
      return this.resumeExisting<RevisionCommitResultV2>(
        existing,
        input.actor.principalId,
        requestHash,
        "revision_commit_result.v2"
      );
    }
    let attempt: RevisionCommitAttemptV1;
    try {
      attempt = this.reserveRevisionAttempt({
        operation: "revision.commit",
        projectId: input.projectId,
        vdtId: input.vdtId,
        actor: input.actor,
        idempotencyKey: input.command.idempotencyKey,
        requestHash,
        intent: input.command.intent,
        payloadCanonicalJson: payload.canonicalJson,
        payloadContentIdentity: payload.contentIdentity,
        payloadByteLength: payload.bytes.byteLength,
        expectedActiveRevisionId: input.command.expectedActiveRevisionId,
        expectedActiveContentIdentity: input.command.expectedActiveContentIdentity,
        expectedCommitGeneration: input.command.expectedCommitGeneration,
        expectedRuntimeGeneration: input.command.expectedRuntimeGeneration,
        expectedGenerationVersion: input.command.expectedGenerationVersion
      });
    } catch (error) {
      const raced = this.findIdempotency(
        input.vdtId,
        "revision.commit",
        input.command.idempotencyKey
      );
      if (raced) {
        return this.resumeExisting<RevisionCommitResultV2>(
          raced,
          input.actor.principalId,
          requestHash,
          "revision_commit_result.v2"
        );
      }
      throw error;
    }
    this.inject("after_attempt_reserved", attempt);
    return this.advanceAttempt<RevisionCommitResultV2>(attempt);
  }

  createVdtWithInitialSnapshot(
    input: CreateVdtWithInitialSnapshotInputV1
  ): CreateVdtWithInitialSnapshotResultV1 {
    validateCreateCommand(input);
    validateActor(input.actor, input.command.projectId);
    assertSafeId(input.command.projectId, "projectId");
    const payload = validateStrictVdtProjectCommit(input.project);
    const requestHash = createRequestHash(
      input.actor,
      input.command,
      payload.contentIdentity,
      payload.bytes.byteLength
    );
    const existing = this.findIdempotency(
      input.command.projectId,
      "vdt.create_with_initial",
      input.command.idempotencyKey
    );
    if (existing) {
      return this.resumeExisting<CreateVdtWithInitialSnapshotResultV1>(
        existing,
        input.actor.principalId,
        requestHash,
        "create_vdt_with_initial_snapshot_result.v1"
      );
    }

    const vdtId =
      input.command.vdt.requestedVdtId ??
      `vdt_${safeGeneratedId(this.idFactory())}`;
    assertSafeId(vdtId, "vdtId");
    let attempt: RevisionCommitAttemptV1;
    try {
      attempt = this.transaction(() => {
        if (this.db.prepare("SELECT 1 FROM vdts WHERE id = ?").get(vdtId)) {
          throw new VdtStorageError("VDT_ALREADY_EXISTS", `VDT already exists: ${vdtId}.`);
        }
        this.requireWritableProject(
          input.command.projectId,
          input.command.expectedRuntimeGeneration,
          input.command.expectedGenerationVersion
        );
        const timestamp = this.timestamp();
        this.db.prepare(`
        INSERT INTO vdts
        (id, project_id, name, root_kpi, unit, time_period, status, active_revision_id, metadata_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
        `).run(
          vdtId,
          input.command.projectId,
          input.command.vdt.name,
          input.command.vdt.rootKpi,
          input.command.vdt.unit,
          input.command.vdt.timePeriod,
          input.command.vdt.status,
          input.command.vdt.metadata === null
            ? null
            : canonicalizeJson(input.command.vdt.metadata),
          timestamp.ms,
          timestamp.ms
        );
        this.db.prepare(`
        INSERT INTO vdt_revision_heads
        (vdt_id, schema_version, project_id, active_revision_id, active_content_scheme, active_content_hash, pending_revision_id, commit_generation)
        VALUES (?, 'vdt_revision_head.v2', ?, NULL, NULL, NULL, NULL, 0)
        `).run(vdtId, input.command.projectId);
        const attemptId = `revision_attempt_${safeGeneratedId(this.idFactory())}`;
        this.db.prepare(`
        INSERT INTO vdt_storage_lifecycles
        (vdt_id, project_id, state, initial_attempt_id, updated_at)
        VALUES (?, ?, 'creating', ?, ?)
        `).run(vdtId, input.command.projectId, attemptId, timestamp.ms);
        return this.insertReservedAttempt({
          operation: "vdt.create_with_initial",
          scopeId: input.command.projectId,
          attemptId,
          projectId: input.command.projectId,
          vdtId,
          actor: input.actor,
          idempotencyKey: input.command.idempotencyKey,
          requestHash,
          intent: input.command.revisionIntent,
          payloadCanonicalJson: payload.canonicalJson,
          payloadContentIdentity: payload.contentIdentity,
          payloadByteLength: payload.bytes.byteLength,
          expectedActiveRevisionId: null,
          expectedActiveContentIdentity: null,
          expectedCommitGeneration: 0,
          expectedRuntimeGeneration: input.command.expectedRuntimeGeneration,
          expectedGenerationVersion: input.command.expectedGenerationVersion,
          timestamp
        });
      });
    } catch (error) {
      const raced = this.findIdempotency(
        input.command.projectId,
        "vdt.create_with_initial",
        input.command.idempotencyKey
      );
      if (raced) {
        return this.resumeExisting<CreateVdtWithInitialSnapshotResultV1>(
          raced,
          input.actor.principalId,
          requestHash,
          "create_vdt_with_initial_snapshot_result.v1"
        );
      }
      throw error;
    }
    vdtRevisionDir(this.dataDir, attempt.projectId, attempt.vdtId);
    this.inject("after_attempt_reserved", attempt);
    return this.advanceAttempt<CreateVdtWithInitialSnapshotResultV1>(attempt);
  }

  recoverRevisionCommits(): void {
    const now = this.timestamp().ms;
    const rows = this.db.prepare(`
      SELECT * FROM revision_commit_attempts
      WHERE state IN ('reserved', 'staged', 'head_reserved', 'published')
        AND lease_expires_at <= ?
      ORDER BY created_at, attempt_id
    `).all(now) as Row[];
    for (const row of rows) {
      const attempt = attemptFromRow(row);
      const takeover = this.takeOverAttempt(attempt);
      if (!takeover) continue;
      try {
        this.advanceAttempt(takeover);
      } catch (error) {
        if (error instanceof VdtStorageError && !error.retryable) continue;
        throw error;
      }
    }
  }

  getProjectRuntimeState(projectId: string): ProjectRuntimeStateV1 | null {
    assertSafeId(projectId, "projectId");
    const row = this.db.prepare(
      "SELECT * FROM project_runtime_states WHERE project_id = ?"
    ).get(projectId) as Row | undefined;
    return row ? projectRuntimeFromRow(row) : null;
  }

  getVdtRevisionHead(vdtId: string): VdtRevisionHeadV2 | null {
    assertSafeId(vdtId, "vdtId");
    const row = this.db.prepare(
      "SELECT * FROM vdt_revision_heads WHERE vdt_id = ?"
    ).get(vdtId) as Row | undefined;
    return row ? headFromRow(row) : null;
  }

  getRevisionCommitAttempt(attemptId: string): RevisionCommitAttemptV1 | null {
    assertSafeId(attemptId, "attemptId");
    const row = this.db.prepare(
      "SELECT * FROM revision_commit_attempts WHERE attempt_id = ?"
    ).get(attemptId) as Row | undefined;
    return row ? attemptFromRow(row) : null;
  }

  private reserveRevisionAttempt(input: {
    operation: "revision.commit";
    projectId: string;
    vdtId: string;
    actor: ActorContextV1;
    idempotencyKey: string;
    requestHash: Sha256;
    intent: RevisionCommitIntentV1;
    payloadCanonicalJson: string;
    payloadContentIdentity: RevisionContentIdentityV1;
    payloadByteLength: number;
    expectedActiveRevisionId: string | null;
    expectedActiveContentIdentity: RevisionContentIdentityV1 | null;
    expectedCommitGeneration: number;
    expectedRuntimeGeneration: "v1" | "v2";
    expectedGenerationVersion: number;
  }): RevisionCommitAttemptV1 {
    return this.transaction(() => {
      this.assertProjectAndHeadPreflight(input.projectId, input.vdtId, {
        schemaVersion: "revision_commit.v2",
        expectedActiveRevisionId: input.expectedActiveRevisionId,
        expectedActiveContentIdentity: input.expectedActiveContentIdentity,
        expectedCommitGeneration: input.expectedCommitGeneration,
        expectedRuntimeGeneration: input.expectedRuntimeGeneration,
        expectedGenerationVersion: input.expectedGenerationVersion,
        idempotencyKey: input.idempotencyKey,
        intent: input.intent
      });
      const timestamp = this.timestamp();
      return this.insertReservedAttempt({
        ...input,
        scopeId: input.vdtId,
        attemptId: `revision_attempt_${safeGeneratedId(this.idFactory())}`,
        timestamp
      });
    });
  }

  private insertReservedAttempt(input: {
    operation: Operation;
    scopeId: string;
    attemptId: string;
    projectId: string;
    vdtId: string;
    actor: ActorContextV1;
    idempotencyKey: string;
    requestHash: Sha256;
    intent: RevisionCommitIntentV1;
    payloadCanonicalJson: string;
    payloadContentIdentity: RevisionContentIdentityV1;
    payloadByteLength: number;
    expectedActiveRevisionId: string | null;
    expectedActiveContentIdentity: RevisionContentIdentityV1 | null;
    expectedCommitGeneration: number;
    expectedRuntimeGeneration: "v1" | "v2";
    expectedGenerationVersion: number;
    timestamp: { iso: string; ms: number };
  }): RevisionCommitAttemptV1 {
    const revisionId = `revision_${safeGeneratedId(this.idFactory())}`;
    const ownerToken = `revision_owner_${safeGeneratedId(this.ownerTokenFactory())}`;
    const stagePath = path.join(
      "projects",
      input.projectId,
      "vdts",
      input.vdtId,
      "revisions",
      ".staging",
      `${input.attemptId}.vdt.json`
    );
    const finalPath = path.join(
      "projects",
      input.projectId,
      "vdts",
      input.vdtId,
      "revisions",
      `${revisionId}.vdt.json`
    );
    const leaseExpiresAt = new Date(input.timestamp.ms + this.leaseMs).toISOString();
    this.db.prepare(`
      INSERT INTO idempotency_records
      (scope_id, operation, idempotency_key, schema_version, actor_principal_id, request_hash, status, created_at)
      VALUES (?, ?, ?, 'idempotency_record.v1', ?, ?, 'in_progress', ?)
    `).run(
      input.scopeId,
      input.operation,
      input.idempotencyKey,
      input.actor.principalId,
      input.requestHash,
      input.timestamp.ms
    );
    this.db.prepare(`
      INSERT INTO revision_commit_attempts
      (attempt_id, schema_version, operation, project_id, vdt_id, revision_id, actor_principal_id, idempotency_key, request_hash, intent_json,
       payload_content_scheme, payload_content_hash, payload_byte_length, payload_canonical_json, staged_payload_relative_path, final_relative_path,
       expected_active_revision_id, expected_active_content_scheme, expected_active_content_hash, expected_commit_generation,
       expected_runtime_generation, expected_generation_version, owner_token, lease_generation, lease_expires_at, state, created_at, updated_at)
      VALUES (?, 'revision_commit_attempt.v1', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'reserved', ?, ?)
    `).run(
      input.attemptId,
      input.operation,
      input.projectId,
      input.vdtId,
      revisionId,
      input.actor.principalId,
      input.idempotencyKey,
      input.requestHash,
      canonicalizeJson(input.intent as unknown as JsonValue),
      input.payloadContentIdentity.scheme,
      input.payloadContentIdentity.hash,
      input.payloadByteLength,
      input.payloadCanonicalJson,
      stagePath,
      finalPath,
      input.expectedActiveRevisionId,
      input.expectedActiveContentIdentity?.scheme ?? null,
      input.expectedActiveContentIdentity?.hash ?? null,
      input.expectedCommitGeneration,
      input.expectedRuntimeGeneration,
      input.expectedGenerationVersion,
      ownerToken,
      Date.parse(leaseExpiresAt),
      input.timestamp.ms,
      input.timestamp.ms
    );
    return defined({
      schemaVersion: "revision_commit_attempt.v1" as const,
      operation: input.operation,
      attemptId: input.attemptId,
      projectId: input.projectId,
      vdtId: input.vdtId,
      revisionId,
      actorPrincipalId: input.actor.principalId,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      intent: input.intent,
      payloadContentIdentity: input.payloadContentIdentity,
      payloadByteLength: input.payloadByteLength,
      payloadCanonicalJson: input.payloadCanonicalJson,
      stagedPayloadRelativePath: stagePath,
      finalRelativePath: finalPath,
      expectedActiveRevisionId: input.expectedActiveRevisionId,
      expectedActiveContentIdentity: input.expectedActiveContentIdentity,
      expectedCommitGeneration: input.expectedCommitGeneration,
      expectedRuntimeGeneration: input.expectedRuntimeGeneration,
      expectedGenerationVersion: input.expectedGenerationVersion,
      ownerToken,
      leaseGeneration: 1,
      leaseExpiresAt,
      state: "reserved" as const,
      createdAt: input.timestamp.iso,
      updatedAt: input.timestamp.iso
    });
  }

  private advanceAttempt<T extends RevisionCommitResultV2 | CreateVdtWithInitialSnapshotResultV1>(
    initial: RevisionCommitAttemptV1
  ): T {
    let attempt = initial;
    const payload = validateStrictVdtProjectCommit(JSON.parse(attempt.payloadCanonicalJson));
    if (
      payload.canonicalJson !== attempt.payloadCanonicalJson ||
      payload.bytes.byteLength !== attempt.payloadByteLength ||
      !contentIdentityEqual(payload.contentIdentity, attempt.payloadContentIdentity)
    ) {
      this.quarantine(attempt, "staged_payload_mismatch");
    }

    if (attempt.state === "reserved") {
      const stageEvidence = inspectFile(
        this.dataDir,
        attempt.stagedPayloadRelativePath,
        attempt.payloadByteLength,
        attempt.payloadContentIdentity
      );
      const finalEvidence = inspectFile(
        this.dataDir,
        attempt.finalRelativePath,
        attempt.payloadByteLength,
        attempt.payloadContentIdentity
      );
      if (finalEvidence !== "missing") this.quarantine(attempt, "ambiguous_recovery");
      if (stageEvidence === "mismatch") this.quarantine(attempt, "staged_payload_mismatch");
      if (stageEvidence === "missing") {
        writeExclusiveDurable(
          absoluteOwnedPath(this.dataDir, attempt.stagedPayloadRelativePath),
          payload.bytes
        );
      }
      attempt = this.transition(attempt, "reserved", "staged");
      this.inject("after_stage_fsynced", attempt);
    }

    if (attempt.state === "staged") {
      const stageEvidence = inspectFile(
        this.dataDir,
        attempt.stagedPayloadRelativePath,
        attempt.payloadByteLength,
        attempt.payloadContentIdentity
      );
      if (stageEvidence === "missing") this.quarantine(attempt, "staged_payload_missing");
      if (stageEvidence === "mismatch") this.quarantine(attempt, "staged_payload_mismatch");
      attempt = this.reserveHead(attempt);
      this.inject("after_head_reserved", attempt);
    }

    if (attempt.state === "head_reserved") {
      const stageEvidence = inspectFile(
        this.dataDir,
        attempt.stagedPayloadRelativePath,
        attempt.payloadByteLength,
        attempt.payloadContentIdentity
      );
      const finalEvidence = inspectFile(
        this.dataDir,
        attempt.finalRelativePath,
        attempt.payloadByteLength,
        attempt.payloadContentIdentity
      );
      if (finalEvidence === "mismatch") this.quarantine(attempt, "published_hash_mismatch");
      if (finalEvidence === "missing") {
        if (stageEvidence === "missing") this.quarantine(attempt, "staged_payload_missing");
        if (stageEvidence === "mismatch") this.quarantine(attempt, "staged_payload_mismatch");
        publishExclusive(
          absoluteOwnedPath(this.dataDir, attempt.stagedPayloadRelativePath),
          absoluteOwnedPath(this.dataDir, attempt.finalRelativePath)
        );
      } else {
        const durable = readAndFsyncVerifiedFile(
          this.dataDir,
          attempt.finalRelativePath,
          attempt.payloadByteLength,
          attempt.payloadContentIdentity
        );
        if (durable.evidence !== "match") {
          this.quarantine(attempt, "published_hash_mismatch");
        }
      }
      attempt = this.transition(attempt, "head_reserved", "published");
      this.inject("after_final_published", attempt);
    }

    if (attempt.state === "published") {
      const finalEvidence = inspectFile(
        this.dataDir,
        attempt.finalRelativePath,
        attempt.payloadByteLength,
        attempt.payloadContentIdentity
      );
      if (finalEvidence !== "match") {
        this.quarantine(
          attempt,
          finalEvidence === "missing" ? "ambiguous_recovery" : "published_hash_mismatch"
        );
      }
      this.inject("before_finalize", attempt);
      return this.finalize<T>(attempt);
    }

    if (attempt.state === "completed") {
      return this.replaySucceeded<T>(attempt);
    }
    throw new VdtStorageError(
      attempt.terminalCode ?? "REVISION_COMMIT_REJECTED",
      `Revision attempt ${attempt.attemptId} is terminal in state ${attempt.state}.`
    );
  }

  private reserveHead(attempt: RevisionCommitAttemptV1): RevisionCommitAttemptV1 {
    try {
      return this.transaction(() => {
        const project = this.requireWritableProject(
          attempt.projectId,
          attempt.expectedRuntimeGeneration,
          attempt.expectedGenerationVersion
        );
        const head = this.requireHead(attempt.vdtId);
        if (
          head.pendingRevisionId !== null ||
          head.commitGeneration !== attempt.expectedCommitGeneration ||
          head.activeRevisionId !== attempt.expectedActiveRevisionId ||
          !nullableContentIdentityEqual(
            head.activeContentIdentity,
            attempt.expectedActiveContentIdentity
          )
        ) {
          throw new VdtStorageError(
            "REVISION_CONFLICT",
            "The VDT head changed before the pending revision could be reserved."
          );
        }
        const revisionNo = head.commitGeneration + 1;
        const timestamp = this.timestamp();
        this.db.prepare(`
          INSERT INTO revision_commit_records
          (attempt_id, schema_version, project_id, vdt_id, revision_id, revision_no, parent_revision_id,
           runtime_generation, generation_version, actor_principal_id, idempotency_key, request_hash,
           intent_json, base_content_scheme, base_content_hash, payload_content_scheme, payload_content_hash,
           payload_byte_length, staged_payload_relative_path, final_relative_path, state, reserved_at)
          VALUES (?, 'revision_commit_record.v2', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
        `).run(
          attempt.attemptId,
          attempt.projectId,
          attempt.vdtId,
          attempt.revisionId,
          revisionNo,
          attempt.expectedActiveRevisionId,
          project.runtimeGeneration,
          project.generationVersion,
          attempt.actorPrincipalId,
          attempt.idempotencyKey,
          attempt.requestHash,
          canonicalizeJson(attempt.intent as unknown as JsonValue),
          attempt.expectedActiveContentIdentity?.scheme ?? null,
          attempt.expectedActiveContentIdentity?.hash ?? null,
          attempt.payloadContentIdentity.scheme,
          attempt.payloadContentIdentity.hash,
          attempt.payloadByteLength,
          attempt.stagedPayloadRelativePath,
          attempt.finalRelativePath,
          timestamp.ms
        );
        const changed = this.db.prepare(`
          UPDATE vdt_revision_heads
          SET pending_revision_id = ?
          WHERE vdt_id = ? AND pending_revision_id IS NULL
        `).run(attempt.revisionId, attempt.vdtId).changes;
        if (changed !== 1) {
          throw new VdtStorageError("REVISION_CONFLICT", "Another pending revision owns this VDT.");
        }
        return this.transitionInTransaction(attempt, "staged", "head_reserved", timestamp);
      });
    } catch (error) {
      if (
        error instanceof VdtStorageError &&
        (error.code === "REVISION_CONFLICT" ||
          error.code === "PROJECT_WRITE_STATE_CHANGED" ||
          error.code === "PROJECT_WRITE_DISABLED")
      ) {
        const removed = removeDurable(
          absoluteOwnedPath(this.dataDir, attempt.stagedPayloadRelativePath)
        );
        if (!removed) this.quarantine(attempt, "ambiguous_recovery");
        this.reject(attempt, error.code, error.message);
      }
      throw error;
    }
  }

  private finalize<T extends RevisionCommitResultV2 | CreateVdtWithInitialSnapshotResultV1>(
    attempt: RevisionCommitAttemptV1
  ): T {
    let rejection: VdtStorageError | undefined;
    let result: T | undefined;
    this.transaction(() => {
      const owned = this.db.prepare(`
        SELECT 1 FROM revision_commit_attempts
        WHERE attempt_id = ? AND owner_token = ? AND lease_generation = ? AND state = 'published'
      `).get(
        attempt.attemptId,
        attempt.ownerToken,
        attempt.leaseGeneration
      );
      if (!owned) {
        throw new VdtStorageError(
          "STALE_ATTEMPT_OWNER",
          `Attempt ${attempt.attemptId} is no longer owned by this finalize lease.`,
          true
        );
      }
      const project = this.getProjectRuntimeState(attempt.projectId);
      const head = this.requireHead(attempt.vdtId);
      const projectChanged =
        !project ||
        project.runtimeGeneration !== attempt.expectedRuntimeGeneration ||
        project.generationVersion !== attempt.expectedGenerationVersion ||
        !isWritableProjectState(project);
      if (projectChanged) {
        rejection = new VdtStorageError(
          "PROJECT_WRITE_STATE_CHANGED",
          "Project write/runtime state changed after revision reservation."
        );
        this.quarantineInTransaction(
          attempt,
          "project_write_state_changed",
          rejection.code,
          rejection.message
        );
        return;
      }
      const record = this.db.prepare(
        "SELECT * FROM revision_commit_records WHERE attempt_id = ? AND state = 'pending'"
      ).get(attempt.attemptId) as Row | undefined;
      if (
        !record ||
        head.pendingRevisionId !== attempt.revisionId ||
        head.activeRevisionId !== attempt.expectedActiveRevisionId ||
        !nullableContentIdentityEqual(
          head.activeContentIdentity,
          attempt.expectedActiveContentIdentity
        )
      ) {
        rejection = new VdtStorageError(
          "AMBIGUOUS_REVISION_RECOVERY",
          "Pending revision ownership or parent head changed before finalize."
        );
        this.quarantineInTransaction(
          attempt,
          "ambiguous_recovery",
          rejection.code,
          rejection.message
        );
        return;
      }
      const verifiedFinal = readAndFsyncVerifiedFile(
        this.dataDir,
        attempt.finalRelativePath,
        attempt.payloadByteLength,
        attempt.payloadContentIdentity
      );
      if (verifiedFinal.evidence !== "match") {
        rejection = new VdtStorageError(
          "REVISION_QUARANTINED",
          "Published revision bytes changed before the fenced finalize transaction."
        );
        this.quarantineInTransaction(
          attempt,
          verifiedFinal.evidence === "missing"
            ? "ambiguous_recovery"
            : "published_hash_mismatch",
          rejection.code,
          rejection.message
        );
        return;
      }

      const timestamp = this.timestamp();
      const completedAttempt = this.db.prepare(`
        UPDATE revision_commit_attempts
        SET state = 'completed', updated_at = ?, lease_expires_at = ?
        WHERE attempt_id = ? AND owner_token = ? AND lease_generation = ? AND state = 'published'
      `).run(
        timestamp.ms,
        timestamp.ms,
        attempt.attemptId,
        attempt.ownerToken,
        attempt.leaseGeneration
      ).changes;
      if (completedAttempt !== 1) {
        throw new VdtStorageError(
          "STALE_ATTEMPT_OWNER",
          "Attempt ownership changed during finalize.",
          true
        );
      }
      this.db.prepare(`
        INSERT INTO vdt_revisions
        (id, vdt_id, revision_no, parent_revision_id, source, summary, file_path, graph_hash,
         validation_json, calculation_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        attempt.revisionId,
        attempt.vdtId,
        Number(record.revision_no),
        attempt.expectedActiveRevisionId,
        attempt.intent.source,
        attempt.intent.summary,
        attempt.finalRelativePath,
        verifiedFinal.rawHash,
        attempt.intent.validation === null
          ? null
          : canonicalizeJson(attempt.intent.validation),
        attempt.intent.calculation === null
          ? null
          : canonicalizeJson(attempt.intent.calculation),
        timestamp.ms
      );
      const committedRecord = this.db.prepare(`
        UPDATE revision_commit_records
        SET state = 'committed', committed_at = ?
        WHERE attempt_id = ? AND state = 'pending'
      `).run(timestamp.ms, attempt.attemptId).changes;
      if (committedRecord !== 1) {
        throw new VdtStorageError(
          "REVISION_FINALIZE_CONFLICT",
          "Pending revision record changed during finalize."
        );
      }
      const advancedHead = this.db.prepare(`
        UPDATE vdt_revision_heads
        SET active_revision_id = ?, active_content_scheme = ?, active_content_hash = ?,
            pending_revision_id = NULL, commit_generation = commit_generation + 1
        WHERE vdt_id = ? AND pending_revision_id = ?
      `).run(
        attempt.revisionId,
        attempt.payloadContentIdentity.scheme,
        attempt.payloadContentIdentity.hash,
        attempt.vdtId,
        attempt.revisionId
      ).changes;
      if (advancedHead !== 1) {
        throw new VdtStorageError(
          "REVISION_FINALIZE_CONFLICT",
          "VDT pending head changed during finalize."
        );
      }
      const updatedVdt = this.db.prepare(
        "UPDATE vdts SET active_revision_id = ?, updated_at = ? WHERE id = ?"
      ).run(attempt.revisionId, timestamp.ms, attempt.vdtId).changes;
      if (updatedVdt !== 1) {
        throw new VdtStorageError("VDT_NOT_FOUND", "VDT disappeared during finalize.");
      }
      const updatedProject = this.db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(
        timestamp.ms,
        attempt.projectId
      ).changes;
      if (updatedProject !== 1) {
        throw new VdtStorageError("PROJECT_NOT_FOUND", "Project disappeared during finalize.");
      }
      if (attempt.operation === "vdt.create_with_initial") {
        const readyLifecycle = this.db.prepare(`
          UPDATE vdt_storage_lifecycles
          SET state = 'ready', updated_at = ?
          WHERE vdt_id = ? AND initial_attempt_id = ? AND state = 'creating'
        `).run(timestamp.ms, attempt.vdtId, attempt.attemptId).changes;
        if (readyLifecycle !== 1) {
          throw new VdtStorageError(
            "VDT_LIFECYCLE_CONFLICT",
            "Initial VDT lifecycle changed during finalize."
          );
        }
      }

      const revision = revisionFromRow(
        this.db.prepare("SELECT * FROM vdt_revisions WHERE id = ?").get(
          attempt.revisionId
        ) as Row
      );
      const committedHead = this.requireHead(attempt.vdtId);
      if (attempt.operation === "vdt.create_with_initial") {
        const vdt = vdtFromRow(
          this.db.prepare("SELECT * FROM vdts WHERE id = ?").get(attempt.vdtId) as Row
        );
        result = {
          schemaVersion: "create_vdt_with_initial_snapshot_result.v1",
          status: "created",
          vdt,
          revision,
          head: committedHead
        } as T;
      } else {
        result = {
          schemaVersion: "revision_commit_result.v2",
          status: "committed",
          revision,
          head: committedHead
        } as T;
      }
      const canonicalResult = this.finalizeIdempotencySuccess(
        attempt,
        result as unknown as JsonValue,
        timestamp
      );
      result = JSON.parse(canonicalResult) as T;
    });
    if (rejection) throw rejection;
    if (!result) {
      throw new VdtStorageError(
        "REVISION_FINALIZE_FAILED",
        "Revision finalize did not produce a terminal result."
      );
    }
    return result;
  }

  private transition(
    attempt: RevisionCommitAttemptV1,
    from: RevisionCommitAttemptV1["state"],
    to: RevisionCommitAttemptV1["state"]
  ): RevisionCommitAttemptV1 {
    return this.transaction(() =>
      this.transitionInTransaction(attempt, from, to, this.timestamp())
    );
  }

  private transitionInTransaction(
    attempt: RevisionCommitAttemptV1,
    from: RevisionCommitAttemptV1["state"],
    to: RevisionCommitAttemptV1["state"],
    timestamp: { iso: string; ms: number }
  ): RevisionCommitAttemptV1 {
    const expiresAt = timestamp.ms + this.leaseMs;
    const changed = this.db.prepare(`
      UPDATE revision_commit_attempts
      SET state = ?, updated_at = ?, lease_expires_at = ?
      WHERE attempt_id = ? AND owner_token = ? AND lease_generation = ? AND state = ?
    `).run(
      to,
      timestamp.ms,
      expiresAt,
      attempt.attemptId,
      attempt.ownerToken,
      attempt.leaseGeneration,
      from
    ).changes;
    if (changed !== 1) {
      throw new VdtStorageError(
        "STALE_ATTEMPT_OWNER",
        `Attempt ${attempt.attemptId} is no longer owned by this lease.`,
        true
      );
    }
    return {
      ...attempt,
      state: to,
      updatedAt: timestamp.iso,
      leaseExpiresAt: new Date(expiresAt).toISOString()
    };
  }

  private reject(attempt: RevisionCommitAttemptV1, code: string, message: string): never {
    this.transaction(() => {
      const timestamp = this.timestamp();
      const changed = this.db.prepare(`
        UPDATE revision_commit_attempts
        SET state = 'rejected', terminal_code = ?, updated_at = ?, lease_expires_at = ?
        WHERE attempt_id = ? AND owner_token = ? AND lease_generation = ?
          AND state IN ('reserved', 'staged')
      `).run(
        code,
        timestamp.ms,
        timestamp.ms,
        attempt.attemptId,
        attempt.ownerToken,
        attempt.leaseGeneration
      ).changes;
      if (changed !== 1) {
        throw new VdtStorageError(
          "STALE_ATTEMPT_OWNER",
          "Attempt could not be terminally rejected by a stale owner.",
          true
        );
      }
      this.finalizeIdempotencyError(attempt, code, message, timestamp);
      this.removeCreatingVdtInTransaction(attempt, timestamp.ms);
    });
    throw new VdtStorageError(code, message);
  }

  private quarantine(attempt: RevisionCommitAttemptV1, reason: RevisionQuarantineReason): never {
    const code =
      reason === "project_write_state_changed"
        ? "PROJECT_WRITE_STATE_CHANGED"
        : "REVISION_QUARANTINED";
    const message = `Revision attempt ${attempt.attemptId} was quarantined: ${reason}.`;
    this.transaction(() =>
      this.quarantineInTransaction(attempt, reason, code, message)
    );
    throw new VdtStorageError(code, message);
  }

  private quarantineInTransaction(
    attempt: RevisionCommitAttemptV1,
    reason: RevisionQuarantineReason,
    code: string,
    message: string
  ): void {
    const timestamp = this.timestamp();
    this.db.prepare(`
      UPDATE revision_commit_records
      SET state = 'quarantined', quarantine_reason = ?
      WHERE attempt_id = ? AND state = 'pending'
    `).run(reason, attempt.attemptId);
    this.db.prepare(`
      UPDATE vdt_revision_heads
      SET pending_revision_id = NULL
      WHERE vdt_id = ? AND pending_revision_id = ?
    `).run(attempt.vdtId, attempt.revisionId);
    const changed = this.db.prepare(`
      UPDATE revision_commit_attempts
      SET state = 'quarantined', quarantine_reason = ?, terminal_code = ?,
          updated_at = ?, lease_expires_at = ?
      WHERE attempt_id = ? AND owner_token = ? AND lease_generation = ?
        AND state IN ('reserved', 'staged', 'head_reserved', 'published')
    `).run(
      reason,
      code,
      timestamp.ms,
      timestamp.ms,
      attempt.attemptId,
      attempt.ownerToken,
      attempt.leaseGeneration
    ).changes;
    if (changed !== 1) {
      throw new VdtStorageError(
        "STALE_ATTEMPT_OWNER",
        "Attempt could not be quarantined by a stale owner.",
        true
      );
    }
    this.finalizeIdempotencyError(attempt, code, message, timestamp);
    this.removeCreatingVdtInTransaction(attempt, timestamp.ms);
  }

  private removeCreatingVdtInTransaction(
    attempt: RevisionCommitAttemptV1,
    updatedAt: number
  ): void {
    if (attempt.operation !== "vdt.create_with_initial") return;
    const lifecycle = this.db.prepare(`
      SELECT state FROM vdt_storage_lifecycles
      WHERE vdt_id = ? AND initial_attempt_id = ?
    `).get(attempt.vdtId, attempt.attemptId) as Row | undefined;
    const head = this.db.prepare(`
      SELECT active_revision_id, pending_revision_id FROM vdt_revision_heads
      WHERE vdt_id = ?
    `).get(attempt.vdtId) as Row | undefined;
    if (
      lifecycle?.state === "creating" &&
      head?.active_revision_id === null &&
      head.pending_revision_id === null
    ) {
      this.db.prepare("DELETE FROM vdt_storage_lifecycles WHERE vdt_id = ?").run(
        attempt.vdtId
      );
      this.db.prepare("DELETE FROM vdt_revision_heads WHERE vdt_id = ?").run(
        attempt.vdtId
      );
      this.db.prepare("DELETE FROM vdts WHERE id = ?").run(attempt.vdtId);
      this.db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(
        updatedAt,
        attempt.projectId
      );
    }
  }

  private finalizeIdempotencySuccess(
    attempt: RevisionCommitAttemptV1,
    result: JsonValue,
    timestamp: { iso: string; ms: number }
  ): string {
    const canonical = canonicalizeJson(result);
    const resultSchemaVersion = String(
      (result as Record<string, JsonValue>).schemaVersion
    );
    const resultHash = hashFramed(
      "vdt-studio/idempotency-result",
      "idempotency_result_hash.v1",
      { resultSchemaVersion, resultCode: "OK" },
      Buffer.from(canonical, "utf8")
    );
    const scopeId = scopeForAttempt(attempt);
    const finalized = this.db.prepare(`
      UPDATE idempotency_records
      SET status = 'succeeded', result_code = 'OK', result_hash = ?,
          result_schema_version = ?, result_canonical_json = ?, completed_at = ?
      WHERE scope_id = ? AND operation = ? AND idempotency_key = ?
        AND actor_principal_id = ? AND request_hash = ? AND status = 'in_progress'
    `).run(
      resultHash,
      resultSchemaVersion,
      canonical,
      timestamp.ms,
      scopeId,
      attempt.operation,
      attempt.idempotencyKey,
      attempt.actorPrincipalId,
      attempt.requestHash
    ).changes;
    if (finalized !== 1) {
      throw new VdtStorageError(
        "IDEMPOTENCY_FINALIZE_CONFLICT",
        "Idempotency success could not be fenced to the in-progress request."
      );
    }
    return canonical;
  }

  private finalizeIdempotencyError(
    attempt: RevisionCommitAttemptV1,
    code: string,
    message: string,
    timestamp: { iso: string; ms: number }
  ): void {
    const result = {
      schemaVersion: "storage_error_result.v1",
      code,
      message,
      retryable: false
    } as const;
    const canonical = canonicalizeJson(result);
    const resultHash = hashFramed(
      "vdt-studio/idempotency-result",
      "idempotency_result_hash.v1",
      {
        resultSchemaVersion: result.schemaVersion,
        resultCode: code
      },
      Buffer.from(canonical, "utf8")
    );
    const finalized = this.db.prepare(`
      UPDATE idempotency_records
      SET status = 'rejected', result_code = ?, result_hash = ?,
          result_schema_version = ?, result_canonical_json = ?, completed_at = ?
      WHERE scope_id = ? AND operation = ? AND idempotency_key = ?
        AND actor_principal_id = ? AND request_hash = ? AND status = 'in_progress'
    `).run(
      code,
      resultHash,
      result.schemaVersion,
      canonical,
      timestamp.ms,
      scopeForAttempt(attempt),
      attempt.operation,
      attempt.idempotencyKey,
      attempt.actorPrincipalId,
      attempt.requestHash
    ).changes;
    if (finalized !== 1) {
      throw new VdtStorageError(
        "IDEMPOTENCY_FINALIZE_CONFLICT",
        "Idempotency rejection could not be fenced to the in-progress request."
      );
    }
  }

  private resumeExisting<T extends RevisionCommitResultV2 | CreateVdtWithInitialSnapshotResultV1>(
    record: Row,
    actorPrincipalId: string,
    requestHash: Sha256,
    resultSchemaVersion: T["schemaVersion"]
  ): T {
    if (
      record.actor_principal_id !== actorPrincipalId ||
      record.request_hash !== requestHash
    ) {
      throw new VdtStorageError(
        "IDEMPOTENCY_KEY_REUSE",
        "The idempotency key is already bound to a different actor or request."
      );
    }
    if (record.status === "succeeded") {
      return this.verifyTerminalIdempotencyResult<T>(
        record,
        "succeeded",
        resultSchemaVersion
      );
    }
    if (record.status === "rejected") {
      const parsed = this.verifyTerminalIdempotencyResult<Row>(
        record,
        "rejected",
        "storage_error_result.v1"
      );
      throw new VdtStorageError(
        String(record.result_code),
        String(parsed.message)
      );
    }
    const attemptRow = this.db.prepare(`
      SELECT * FROM revision_commit_attempts
      WHERE operation = ? AND idempotency_key = ?
        AND ${record.operation === "revision.commit" ? "vdt_id" : "project_id"} = ?
    `).get(
      String(record.operation),
      String(record.idempotency_key),
      String(record.scope_id)
    ) as Row | undefined;
    if (!attemptRow) {
      throw new VdtStorageError(
        "IDEMPOTENCY_ATTEMPT_MISSING",
        "In-progress idempotency record has no durable revision attempt."
      );
    }
    const attempt = attemptFromRow(attemptRow);
    if (Date.parse(attempt.leaseExpiresAt) > this.timestamp().ms) {
      throw new VdtStorageError(
        "REVISION_IN_PROGRESS",
        "The idempotent revision operation is already in progress.",
        true
      );
    }
    const takeover = this.takeOverAttempt(attempt);
    if (!takeover) {
      throw new VdtStorageError(
        "REVISION_IN_PROGRESS",
        "Another owner renewed the revision attempt.",
        true
      );
    }
    return this.advanceAttempt<T>(takeover);
  }

  private replaySucceeded<
    T extends RevisionCommitResultV2 | CreateVdtWithInitialSnapshotResultV1
  >(attempt: RevisionCommitAttemptV1): T {
    const record = this.findIdempotency(
      scopeForAttempt(attempt),
      attempt.operation,
      attempt.idempotencyKey
    );
    if (!record || record.status !== "succeeded") {
      throw new VdtStorageError(
        "IDEMPOTENCY_RESULT_MISSING",
        "Completed revision attempt has no succeeded idempotency result."
      );
    }
    return this.verifyTerminalIdempotencyResult<T>(
      record,
      "succeeded",
      attempt.operation === "revision.commit"
        ? "revision_commit_result.v2"
        : "create_vdt_with_initial_snapshot_result.v1"
    );
  }

  private verifyTerminalIdempotencyResult<T>(
    record: Row,
    status: "succeeded" | "rejected",
    expectedSchemaVersion: string
  ): T {
    try {
      const resultCode = record.result_code;
      const resultSchemaVersion = record.result_schema_version;
      const canonical = record.result_canonical_json;
      if (
        record.status !== status ||
        typeof resultCode !== "string" ||
        resultCode.length === 0 ||
        (status === "succeeded" ? resultCode !== "OK" : resultCode === "OK") ||
        resultSchemaVersion !== expectedSchemaVersion ||
        typeof canonical !== "string" ||
        typeof record.result_hash !== "string"
      ) {
        throw new Error("terminal result metadata is inconsistent");
      }
      const parsed: unknown = JSON.parse(canonical);
      assertDensePlainJson(parsed);
      if (
        !isPlainRecord(parsed) ||
        parsed.schemaVersion !== resultSchemaVersion ||
        (status === "rejected" &&
          (parsed.code !== resultCode ||
            typeof parsed.message !== "string" ||
            parsed.message.length === 0))
      ) {
        throw new Error("terminal result body is not bound to its metadata");
      }
      if (canonicalizeJson(parsed) !== canonical) {
        throw new Error("terminal result bytes are not canonical JSON");
      }
      const expectedHash = hashFramed(
        "vdt-studio/idempotency-result",
        "idempotency_result_hash.v1",
        { resultSchemaVersion, resultCode },
        Buffer.from(canonical, "utf8")
      );
      if (record.result_hash !== expectedHash) {
        throw new Error("terminal result hash does not match its canonical bytes");
      }
      return parsed as T;
    } catch (error) {
      if (
        error instanceof VdtStorageError &&
        error.code === "IDEMPOTENCY_RESULT_CORRUPT"
      ) {
        throw error;
      }
      throw new VdtStorageError(
        "IDEMPOTENCY_RESULT_CORRUPT",
        `Stored idempotency result failed canonical integrity verification: ${errorMessage(error)}.`
      );
    }
  }

  private takeOverAttempt(
    attempt: RevisionCommitAttemptV1
  ): RevisionCommitAttemptV1 | null {
    return this.transaction(() => {
      const timestamp = this.timestamp();
      const ownerToken = `revision_owner_${safeGeneratedId(this.ownerTokenFactory())}`;
      const nextGeneration = attempt.leaseGeneration + 1;
      const expiresAt = timestamp.ms + this.leaseMs;
      const changed = this.db.prepare(`
        UPDATE revision_commit_attempts
        SET owner_token = ?, lease_generation = ?, lease_expires_at = ?, updated_at = ?
        WHERE attempt_id = ? AND lease_generation = ? AND lease_expires_at <= ?
          AND state IN ('reserved', 'staged', 'head_reserved', 'published')
      `).run(
        ownerToken,
        nextGeneration,
        expiresAt,
        timestamp.ms,
        attempt.attemptId,
        attempt.leaseGeneration,
        timestamp.ms
      ).changes;
      if (changed !== 1) return null;
      return {
        ...attempt,
        ownerToken,
        leaseGeneration: nextGeneration,
        leaseExpiresAt: new Date(expiresAt).toISOString(),
        updatedAt: timestamp.iso
      };
    });
  }

  private assertProjectAndHeadPreflight(
    projectId: string,
    vdtId: string,
    command: RevisionCommitCommandV2
  ): void {
    this.requireWritableProject(
      projectId,
      command.expectedRuntimeGeneration,
      command.expectedGenerationVersion
    );
    const vdt = this.db.prepare(
      "SELECT project_id FROM vdts WHERE id = ?"
    ).get(vdtId) as Row | undefined;
    if (!vdt || vdt.project_id !== projectId) {
      throw new VdtStorageError("VDT_NOT_FOUND", `VDT ${vdtId} does not belong to ${projectId}.`);
    }
    const lifecycle = this.db.prepare(
      "SELECT state FROM vdt_storage_lifecycles WHERE vdt_id = ?"
    ).get(vdtId) as Row | undefined;
    if (lifecycle?.state !== "ready") {
      throw new VdtStorageError(
        "VDT_NOT_READY",
        `VDT ${vdtId} is not ready for a revision commit.`
      );
    }
    const head = this.requireHead(vdtId);
    if (
      head.pendingRevisionId !== null ||
      head.activeRevisionId !== command.expectedActiveRevisionId ||
      head.commitGeneration !== command.expectedCommitGeneration ||
      !nullableContentIdentityEqual(
        head.activeContentIdentity,
        command.expectedActiveContentIdentity
      )
    ) {
      throw new VdtStorageError(
        "REVISION_CONFLICT",
        "The supplied revision CAS does not match the current VDT head."
      );
    }
  }

  private requireWritableProject(
    projectId: string,
    expectedRuntimeGeneration: "v1" | "v2",
    expectedGenerationVersion: number
  ): ProjectRuntimeStateV1 {
    const state = this.getProjectRuntimeState(projectId);
    if (!state) {
      throw new VdtStorageError(
        "PROJECT_RUNTIME_STATE_MISSING",
        `Project runtime state is missing for ${projectId}.`
      );
    }
    if (
      state.runtimeGeneration !== expectedRuntimeGeneration ||
      state.generationVersion !== expectedGenerationVersion
    ) {
      throw new VdtStorageError(
        "PROJECT_WRITE_STATE_CHANGED",
        "Project runtime generation does not match the command CAS."
      );
    }
    if (!isWritableProjectState(state)) {
      throw new VdtStorageError(
        "PROJECT_WRITE_DISABLED",
        "Project runtime state is not one of the two writable generation tuples."
      );
    }
    return state;
  }

  private requireHead(vdtId: string): VdtRevisionHeadV2 {
    const head = this.getVdtRevisionHead(vdtId);
    if (!head) {
      throw new VdtStorageError(
        "VDT_REVISION_HEAD_MISSING",
        `VDT revision head is missing for ${vdtId}.`
      );
    }
    return head;
  }

  private findIdempotency(
    scopeId: string,
    operation: Operation,
    idempotencyKey: string
  ): Row | undefined {
    return this.db.prepare(`
      SELECT * FROM idempotency_records
      WHERE scope_id = ? AND operation = ? AND idempotency_key = ?
    `).get(scopeId, operation, idempotencyKey) as Row | undefined;
  }

  private timestamp(): { iso: string; ms: number } {
    const iso = this.now();
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms) || new Date(ms).toISOString() !== iso) {
      throw new TypeError("Storage clock must return a canonical UTC timestamp.");
    }
    return { iso, ms };
  }

  private inject(point: RevisionCommitFaultPoint, attempt: RevisionCommitAttemptV1): void {
    this.faultInjector?.(point, attempt);
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const result = fn();
      this.db.exec("COMMIT;");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }
}

function validateRevisionCommand(command: RevisionCommitCommandV2): void {
  if (!isPlainRecord(command)) throw new TypeError("RevisionCommitCommandV2 must be an object.");
  assertExactKeys(
    command,
    [
      "schemaVersion",
      "expectedActiveRevisionId",
      "expectedActiveContentIdentity",
      "expectedCommitGeneration",
      "expectedRuntimeGeneration",
      "expectedGenerationVersion",
      "idempotencyKey",
      "intent"
    ],
    "RevisionCommitCommandV2"
  );
  if (command.schemaVersion !== "revision_commit.v2") {
    throw new TypeError("RevisionCommitCommandV2.schemaVersion is invalid.");
  }
  if (command.expectedActiveRevisionId !== null) {
    assertSafeId(command.expectedActiveRevisionId, "expectedActiveRevisionId");
  }
  if (command.expectedActiveContentIdentity !== null) {
    assertRevisionContentIdentity(command.expectedActiveContentIdentity);
  }
  nonNegativeSafeInteger(command.expectedCommitGeneration, "expectedCommitGeneration");
  if (
    command.expectedRuntimeGeneration !== "v1" &&
    command.expectedRuntimeGeneration !== "v2"
  ) {
    throw new TypeError("expectedRuntimeGeneration is invalid.");
  }
  nonNegativeSafeInteger(command.expectedGenerationVersion, "expectedGenerationVersion");
  nonEmptyString(command.idempotencyKey, "idempotencyKey");
  validateIntent(command.intent);
}

function validateIntent(intent: RevisionCommitIntentV1): void {
  if (!isPlainRecord(intent)) throw new TypeError("RevisionCommitIntentV1 must be an object.");
  assertExactKeys(
    intent,
    ["source", "summary", "validation", "calculation"],
    "RevisionCommitIntentV1"
  );
  if (!REVISION_SOURCES.has(intent.source)) throw new TypeError("Revision source is invalid.");
  if (intent.summary !== null && typeof intent.summary !== "string") {
    throw new TypeError("Revision summary must be a string or null.");
  }
  if (intent.validation !== null) assertDensePlainJson(intent.validation);
  if (intent.calculation !== null) assertDensePlainJson(intent.calculation);
}

function validateActor(actor: ActorContextV1, projectId: string): void {
  if (!isPlainRecord(actor)) throw new TypeError("ActorContextV1 must be an object.");
  assertExactKeys(
    actor,
    ["schemaVersion", "principalId", "roles", "authSource", "sessionId", "issuedAt"],
    "ActorContextV1",
    ["tenantId", "workspaceId", "projectId"]
  );
  if (actor.schemaVersion !== "actor_context.v1") {
    throw new TypeError("ActorContextV1.schemaVersion is invalid.");
  }
  nonEmptyString(actor.principalId, "actor.principalId");
  nonEmptyString(actor.sessionId, "actor.sessionId");
  if (
    actor.authSource !== "desktop_local" &&
    actor.authSource !== "hosted_session"
  ) {
    throw new TypeError("ActorContextV1.authSource is invalid.");
  }
  if (actor.projectId !== undefined && actor.projectId !== projectId) {
    throw new VdtStorageError(
      "ACTOR_PROJECT_MISMATCH",
      "Server-bound actor context does not match the target project."
    );
  }
  if (
    !Array.isArray(actor.roles) ||
    actor.roles.some((role) => typeof role !== "string") ||
    actor.roles.some((role, index) => index > 0 && actor.roles[index - 1]! >= role)
  ) {
    throw new TypeError("Actor roles must be a lexicographically sorted duplicate-free string set.");
  }
  canonicalTimestamp(actor.issuedAt, "actor.issuedAt");
}

function validateCreateCommand(input: CreateVdtWithInitialSnapshotInputV1): void {
  const command = input.command;
  if (!isPlainRecord(command)) {
    throw new TypeError("CreateVdtWithInitialSnapshotCommandV1 must be an object.");
  }
  assertExactKeys(
    command,
    [
      "schemaVersion",
      "projectId",
      "expectedRuntimeGeneration",
      "expectedGenerationVersion",
      "idempotencyKey",
      "vdt",
      "revisionIntent"
    ],
    "CreateVdtWithInitialSnapshotCommandV1"
  );
  if (command.schemaVersion !== "create_vdt_with_initial_snapshot.v1") {
    throw new TypeError("Create-with-initial schemaVersion is invalid.");
  }
  if (command.expectedRuntimeGeneration !== "v1" && command.expectedRuntimeGeneration !== "v2") {
    throw new TypeError("Create-with-initial runtime generation is invalid.");
  }
  nonNegativeSafeInteger(command.expectedGenerationVersion, "expectedGenerationVersion");
  nonEmptyString(command.idempotencyKey, "idempotencyKey");
  if (!isPlainRecord(command.vdt)) throw new TypeError("Create VDT metadata must be an object.");
  assertExactKeys(
    command.vdt,
    ["requestedVdtId", "name", "rootKpi", "unit", "timePeriod", "status", "metadata"],
    "CreateVdtMetadataV1"
  );
  if (command.vdt.requestedVdtId !== null) {
    assertSafeId(command.vdt.requestedVdtId, "requestedVdtId");
  }
  nonEmptyString(command.vdt.name, "vdt.name");
  nonEmptyString(command.vdt.rootKpi, "vdt.rootKpi");
  if (command.vdt.unit !== null && typeof command.vdt.unit !== "string") {
    throw new TypeError("vdt.unit must be a string or null.");
  }
  if (command.vdt.timePeriod !== null && typeof command.vdt.timePeriod !== "string") {
    throw new TypeError("vdt.timePeriod must be a string or null.");
  }
  if (!["draft", "reviewed", "approved", "archived"].includes(command.vdt.status)) {
    throw new TypeError("vdt.status is invalid.");
  }
  if (command.vdt.metadata !== null) assertDensePlainJson(command.vdt.metadata);
  validateIntent(command.revisionIntent);
}

function revisionRequestHash(
  projectId: string,
  vdtId: string,
  actor: ActorContextV1,
  command: RevisionCommitCommandV2,
  payloadContentIdentity: RevisionContentIdentityV1,
  payloadByteLength: number
): Sha256 {
  const { idempotencyKey: _, ...commandWithoutIdempotencyKey } = command;
  return hashFramed(
    "vdt-studio/revision-commit",
    "revision_commit_request_hash.v2",
    {
      scopeId: vdtId,
      projectId,
      actorPrincipalId: actor.principalId,
      commandWithoutIdempotencyKey,
      payloadContentIdentity,
      payloadByteLength
    } as unknown as JsonValue
  );
}

function createRequestHash(
  actor: ActorContextV1,
  command: CreateVdtWithInitialSnapshotInputV1["command"],
  payloadContentIdentity: RevisionContentIdentityV1,
  payloadByteLength: number
): Sha256 {
  const { idempotencyKey: _, ...commandWithoutIdempotencyKey } = command;
  return hashFramed(
    "vdt-studio/vdt-create-with-initial",
    "vdt_create_with_initial_request_hash.v1",
    {
      scopeId: command.projectId,
      actorPrincipalId: actor.principalId,
      commandWithoutIdempotencyKey,
      payloadContentIdentity,
      payloadByteLength
    } as unknown as JsonValue
  );
}

function projectRuntimeFromRow(row: Row): ProjectRuntimeStateV1 {
  return {
    schemaVersion: "project_runtime_state.v1",
    projectId: String(row.project_id),
    runtimeGeneration: row.runtime_generation === "v2" ? "v2" : "v1",
    generationVersion: Number(row.generation_version),
    migrationState: row.migration_state as ProjectRuntimeStateV1["migrationState"],
    writeState: row.write_state === "disabled" ? "disabled" : "enabled",
    updatedAt: toIso(row.updated_at)
  };
}

function headFromRow(row: Row): VdtRevisionHeadV2 {
  const scheme = nullableString(row.active_content_scheme);
  const hash = nullableString(row.active_content_hash);
  return {
    schemaVersion: "vdt_revision_head.v2",
    projectId: String(row.project_id),
    vdtId: String(row.vdt_id),
    activeRevisionId: nullableStringOrNull(row.active_revision_id),
    activeContentIdentity:
      scheme && hash
        ? {
            scheme: scheme as RevisionContentIdentityV1["scheme"],
            hash: hash as Sha256
          }
        : null,
    pendingRevisionId: nullableStringOrNull(row.pending_revision_id),
    commitGeneration: Number(row.commit_generation)
  };
}

function attemptFromRow(row: Row): RevisionCommitAttemptV1 {
  const expectedScheme = nullableString(row.expected_active_content_scheme);
  const expectedHash = nullableString(row.expected_active_content_hash);
  const expectedRuntimeGeneration: "v1" | "v2" =
    row.expected_runtime_generation === "v2" ? "v2" : "v1";
  return defined({
    schemaVersion: "revision_commit_attempt.v1" as const,
    operation: row.operation as Operation,
    attemptId: String(row.attempt_id),
    projectId: String(row.project_id),
    vdtId: String(row.vdt_id),
    revisionId: String(row.revision_id),
    actorPrincipalId: String(row.actor_principal_id),
    idempotencyKey: String(row.idempotency_key),
    requestHash: String(row.request_hash) as Sha256,
    intent: JSON.parse(String(row.intent_json)) as RevisionCommitIntentV1,
    payloadContentIdentity: {
      scheme: row.payload_content_scheme as RevisionContentIdentityV1["scheme"],
      hash: String(row.payload_content_hash) as Sha256
    },
    payloadByteLength: Number(row.payload_byte_length),
    payloadCanonicalJson: String(row.payload_canonical_json),
    stagedPayloadRelativePath: String(row.staged_payload_relative_path),
    finalRelativePath: String(row.final_relative_path),
    expectedActiveRevisionId: nullableStringOrNull(row.expected_active_revision_id),
    expectedActiveContentIdentity:
      expectedScheme && expectedHash
        ? {
            scheme: expectedScheme as RevisionContentIdentityV1["scheme"],
            hash: expectedHash as Sha256
          }
        : null,
    expectedCommitGeneration: Number(row.expected_commit_generation),
    expectedRuntimeGeneration,
    expectedGenerationVersion: Number(row.expected_generation_version),
    ownerToken: String(row.owner_token),
    leaseGeneration: Number(row.lease_generation),
    leaseExpiresAt: toIso(row.lease_expires_at),
    state: row.state as RevisionCommitAttemptV1["state"],
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    terminalCode: nullableString(row.terminal_code),
    quarantineReason:
      nullableString(row.quarantine_reason) as RevisionQuarantineReason | undefined
  });
}

function revisionFromRow(row: Row): VdtRevisionRecord {
  return defined({
    id: String(row.id),
    vdtId: String(row.vdt_id),
    revisionNo: Number(row.revision_no),
    parentRevisionId: nullableString(row.parent_revision_id),
    source: row.source as VdtRevisionRecord["source"],
    summary: nullableString(row.summary),
    filePath: String(row.file_path),
    graphHash: String(row.graph_hash),
    validation: decodeJson(row.validation_json),
    calculation: decodeJson(row.calculation_json),
    createdAt: toIso(row.created_at)
  });
}

function vdtFromRow(row: Row): VdtRecord {
  return defined({
    id: String(row.id),
    projectId: String(row.project_id),
    name: String(row.name),
    rootKpi: String(row.root_kpi),
    unit: nullableString(row.unit),
    timePeriod: nullableString(row.time_period),
    status: row.status as VdtRecord["status"],
    activeRevisionId: nullableString(row.active_revision_id),
    metadata: decodeJson<Record<string, unknown>>(row.metadata_json),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  });
}

function scopeForAttempt(attempt: RevisionCommitAttemptV1): string {
  return attempt.operation === "revision.commit" ? attempt.vdtId : attempt.projectId;
}

function isWritableProjectState(state: ProjectRuntimeStateV1): boolean {
  return (
    state.writeState === "enabled" &&
    ((state.runtimeGeneration === "v1" && state.migrationState === "shadow_ready") ||
      (state.runtimeGeneration === "v2" && state.migrationState === "v2_active"))
  );
}

function inspectFile(
  dataDir: string,
  relativePath: string,
  expectedLength: number,
  expectedIdentity: RevisionContentIdentityV1
): "missing" | "match" | "mismatch" {
  const absolutePath = absoluteOwnedPath(dataDir, relativePath);
  if (!fs.existsSync(absolutePath)) return "missing";
  const stat = fs.lstatSync(absolutePath);
  if (stat.isSymbolicLink() || !stat.isFile()) return "mismatch";
  const bytes = fs.readFileSync(absolutePath);
  if (bytes.byteLength !== expectedLength) return "mismatch";
  const actual = hashFramed(
    "vdt-studio/vdt-revision-payload",
    "vdt_revision_payload_hash.v1",
    {
      mediaType: "application/vnd.vdt-studio.vdt-project+json",
      serialization: "rfc8785"
    },
    bytes
  );
  return actual === expectedIdentity.hash ? "match" : "mismatch";
}

function readAndFsyncVerifiedFile(
  dataDir: string,
  relativePath: string,
  expectedLength: number,
  expectedIdentity: RevisionContentIdentityV1
): { evidence: "missing" | "match" | "mismatch"; rawHash: string } {
  const absolutePath = absoluteOwnedPath(dataDir, relativePath);
  let descriptor: number;
  try {
    descriptor = fs.openSync(absolutePath, "r");
  } catch (error) {
    if (isErrno(error, "ENOENT")) return { evidence: "missing", rawHash: "" };
    throw error;
  }
  try {
    const descriptorStat = fs.fstatSync(descriptor);
    const pathStat = fs.lstatSync(absolutePath);
    if (
      descriptorStat.isSymbolicLink() ||
      !descriptorStat.isFile() ||
      pathStat.isSymbolicLink() ||
      !pathStat.isFile() ||
      descriptorStat.dev !== pathStat.dev ||
      descriptorStat.ino !== pathStat.ino
    ) {
      return { evidence: "mismatch", rawHash: "" };
    }
    const chunks: Buffer[] = [];
    const chunk = Buffer.allocUnsafe(64 * 1024);
    let byteLength = 0;
    for (;;) {
      const read = fs.readSync(descriptor, chunk, 0, chunk.byteLength, null);
      if (read === 0) break;
      byteLength += read;
      chunks.push(Buffer.from(chunk.subarray(0, read)));
    }
    fs.fsyncSync(descriptor);
    fsyncDirectory(path.dirname(absolutePath));
    const finalPathStat = fs.lstatSync(absolutePath);
    if (
      finalPathStat.dev !== descriptorStat.dev ||
      finalPathStat.ino !== descriptorStat.ino ||
      finalPathStat.size !== descriptorStat.size
    ) {
      return { evidence: "mismatch", rawHash: "" };
    }
    const bytes = Buffer.concat(chunks, byteLength);
    const framedHash = hashFramed(
      "vdt-studio/vdt-revision-payload",
      "vdt_revision_payload_hash.v1",
      {
        mediaType: "application/vnd.vdt-studio.vdt-project+json",
        serialization: "rfc8785"
      },
      bytes
    );
    if (byteLength !== expectedLength || framedHash !== expectedIdentity.hash) {
      return { evidence: "mismatch", rawHash: "" };
    }
    return {
      evidence: "match",
      rawHash: createHash("sha256").update(bytes).digest("hex")
    };
  } finally {
    fs.closeSync(descriptor);
  }
}

function publishExclusive(stagePath: string, finalPath: string): void {
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });
  const source = fs.openSync(stagePath, "r");
  let destination: number | undefined;
  try {
    destination = fs.openSync(finalPath, "wx", 0o600);
    const buffer = Buffer.allocUnsafe(64 * 1024);
    for (;;) {
      const read = fs.readSync(source, buffer, 0, buffer.byteLength, null);
      if (read === 0) break;
      writeAll(destination, buffer.subarray(0, read));
    }
    fs.fsyncSync(destination);
  } finally {
    fs.closeSync(source);
    if (destination !== undefined) fs.closeSync(destination);
  }
  fsyncDirectory(path.dirname(finalPath));
}

function writeExclusiveDurable(filePath: string, bytes: Buffer): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(filePath, "wx", 0o600);
    writeAll(descriptor, bytes);
    fs.fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  fsyncDirectory(path.dirname(filePath));
}

function removeDurable(filePath: string): boolean {
  try {
    fs.unlinkSync(filePath);
    fsyncDirectory(path.dirname(filePath));
    return true;
  } catch {
    return false;
  }
}

function probeStorageCapabilities(dataDir: string, idFactory: () => string): void {
  const probeDir = path.join(dataDir, ".storage-capabilities");
  fs.mkdirSync(probeDir, { recursive: true });
  const probe = path.join(probeDir, `exclusive-${safeGeneratedId(idFactory())}`);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(probe, "wx", 0o600);
    fs.writeSync(descriptor, Buffer.from("vdt-storage-capability-v1", "utf8"));
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    try {
      const unexpected = fs.openSync(probe, "wx", 0o600);
      fs.closeSync(unexpected);
      throw new Error("Exclusive create unexpectedly replaced an existing target.");
    } catch (error) {
      if (!isErrno(error, "EEXIST")) throw error;
    }
    fsyncDirectory(probeDir);
  } catch (error) {
    throw new VdtStorageError(
      "STORAGE_CAPABILITY_UNSUPPORTED",
      `Storage does not provide required exclusive-create/durability semantics: ${errorMessage(error)}.`
    );
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(probe)) {
      fs.unlinkSync(probe);
      fsyncDirectory(probeDir);
    }
  }
}

function fsyncDirectory(directoryPath: string): void {
  const descriptor = fs.openSync(directoryPath, "r");
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function writeAll(descriptor: number, bytes: Buffer): void {
  let offset = 0;
  while (offset < bytes.byteLength) {
    offset += fs.writeSync(descriptor, bytes, offset, bytes.byteLength - offset);
  }
}

function absoluteOwnedPath(dataDir: string, relativePath: string): string {
  const absolutePath = path.resolve(dataDir, relativePath);
  assertInside(dataDir, absolutePath);
  return absolutePath;
}

function contentIdentityEqual(
  left: RevisionContentIdentityV1,
  right: RevisionContentIdentityV1
): boolean {
  return left.scheme === right.scheme && left.hash === right.hash;
}

function nullableContentIdentityEqual(
  left: RevisionContentIdentityV1 | null,
  right: RevisionContentIdentityV1 | null
): boolean {
  return left === null || right === null
    ? left === right
    : contentIdentityEqual(left, right);
}

function nullableString(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

function nullableStringOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function safeGeneratedId(value: string): string {
  const safe = value.replace(/[^A-Za-z0-9_-]/g, "");
  if (safe.length === 0) throw new TypeError("Generated storage ID is empty or unsafe.");
  return safe;
}

function nonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
}

function nonNegativeSafeInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer.`);
  }
}

function canonicalTimestamp(value: string, label: string): void {
  if (new Date(value).toISOString() !== value) {
    throw new TypeError(`${label} must be a canonical UTC timestamp.`);
  }
}

function isErrno(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
