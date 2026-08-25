import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { VdtProject } from "@vdt-studio/vdt-core";
import { AtomicRevisionStore } from "./atomic-revisions";
import { defined, decodeJson, encodeJson, toIso, toMillis } from "./json";
import { runStorageMigrations } from "./migrations";
import {
  assertInside,
  assertSafeId,
  createProjectDir,
  ensureProjectLocation,
  projectDir,
  readProjectManifest,
  vdtPreviewDir,
  vdtRevisionDir,
  writeProjectManifest
} from "./project-files";
import type {
  AgentEventRecord,
  AgentRunRecord,
  CreateVdtWithInitialSnapshotInputV1,
  CreateVdtWithInitialSnapshotResultV1,
  ConversationRecord,
  CreateProjectInput,
  CreateVdtInput,
  CreateVdtRevisionInput,
  MessageRecord,
  MutationProposalRecord,
  OpenVdtDatabaseOptions,
  ProjectRuntimeStateV1,
  ProjectManifest,
  ProjectRecord,
  UpdateProjectInput,
  UpdateVdtInput,
  VdtComparisonRecord,
  VdtDatabase,
  VdtRecord,
  RevisionCommitAttemptV1,
  RevisionCommitInputV2,
  RevisionCommitResultV2,
  VdtRevisionHeadV2,
  VdtRevisionRecord
} from "./types";

type Row = Record<string, unknown>;

export function openVdtDatabase(projectRoot: string, options: OpenVdtDatabaseOptions = {}): VdtDatabase {
  const dataDir = ensureProjectLocation(options.dataDir ?? process.env.VDT_DATA_DIR ?? path.join(projectRoot, ".vdt"));
  const databasePath = path.join(dataDir, "app.sqlite");
  assertInside(dataDir, databasePath);
  const db = new DatabaseSync(databasePath, { timeout: options.busyTimeoutMs ?? 5_000 });
  try {
    runStorageMigrations(db, dataDir, {
      now: options.now ?? (() => new Date().toISOString()),
      busyTimeoutMs: options.busyTimeoutMs ?? 5_000,
      leaseMs: options.migrationLeaseMs ?? 30_000,
      idFactory: options.idFactory,
      ownerTokenFactory: options.ownerTokenFactory,
      faultInjector: options.migrationFaultInjector
    });
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA foreign_keys = ON;");
    const result = new SqliteVdtDatabase(db, dataDir, databasePath, options);
    result.recoverRevisionCommits();
    return result;
  } catch (error) {
    db.close();
    throw error;
  }
}

export class SqliteVdtDatabase implements VdtDatabase {
  private readonly now: () => string;
  private readonly atomicRevisions: AtomicRevisionStore;

  constructor(
    private readonly db: DatabaseSync,
    readonly dataDir: string,
    readonly databasePath: string,
    options: OpenVdtDatabaseOptions
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.atomicRevisions = new AtomicRevisionStore(db, dataDir, options);
  }

  close(): void {
    this.db.close();
  }

  createProject(input: CreateProjectInput): ProjectRecord {
    assertSafeId(input.id, "projectId");
    const createdAt = this.now();
    const record: ProjectRecord = defined({
      id: input.id,
      name: input.name,
      description: input.description,
      industry: input.industry,
      metadata: input.metadata,
      createdAt,
      updatedAt: createdAt
    });
    this.transaction(() => {
      this.db.prepare(`
        INSERT INTO projects (id, name, description, industry, metadata_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.id,
        record.name,
        record.description ?? null,
        record.industry ?? null,
        encodeJson(record.metadata),
        toMillis(record.createdAt),
        toMillis(record.updatedAt)
      );
      this.db.prepare(`
        INSERT INTO project_runtime_states
        (project_id, schema_version, runtime_generation, generation_version, migration_state, write_state, updated_at)
        VALUES (?, 'project_runtime_state.v1', 'v1', 1, 'shadow_ready', 'enabled', ?)
      `).run(record.id, toMillis(record.createdAt));
    });
    const dir = createProjectDir(this.dataDir, record.id);
    writeProjectManifest(dir, manifestFromProject(record));
    return record;
  }

  getProject(projectId: string): ProjectRecord | null {
    assertSafeId(projectId, "projectId");
    const row = this.db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as Row | undefined;
    return row ? projectFromRow(row) : null;
  }

  updateProject(projectId: string, patch: UpdateProjectInput): ProjectRecord {
    assertSafeId(projectId, "projectId");
    const current = this.getProject(projectId);
    if (!current) throw new Error(`Project not found: ${projectId}`);
    const updatedAt = this.now();
    const next: ProjectRecord = defined({
      ...current,
      ...patch,
      updatedAt
    });
    this.db.prepare(`
      UPDATE projects
      SET name = ?, description = ?, industry = ?, metadata_json = ?, updated_at = ?
      WHERE id = ?
    `).run(
      next.name,
      next.description ?? null,
      next.industry ?? null,
      encodeJson(next.metadata),
      toMillis(next.updatedAt),
      next.id
    );
    writeProjectManifest(projectDir(this.dataDir, next.id), manifestFromProject(next));
    return next;
  }

  deleteProject(projectId: string): boolean {
    assertSafeId(projectId, "projectId");
    const current = this.getProject(projectId);
    if (!current) return false;
    const deleted = this.transaction(() => {
      const vdtRows = this.db.prepare("SELECT id FROM vdts WHERE project_id = ?").all(projectId) as Row[];
      for (const row of vdtRows) {
        const vdtId = string(row.id);
        this.db.prepare("DELETE FROM legacy_revision_attestations WHERE vdt_id = ?").run(vdtId);
        this.db.prepare("DELETE FROM revision_commit_records WHERE vdt_id = ?").run(vdtId);
        this.db.prepare("DELETE FROM revision_commit_attempts WHERE vdt_id = ?").run(vdtId);
        this.db.prepare("DELETE FROM idempotency_records WHERE scope_id = ? AND operation = 'revision.commit'").run(vdtId);
        this.db.prepare("DELETE FROM vdt_storage_lifecycles WHERE vdt_id = ?").run(vdtId);
        this.db.prepare("DELETE FROM vdt_revision_heads WHERE vdt_id = ?").run(vdtId);
      }
      this.db.prepare(
        "DELETE FROM idempotency_records WHERE scope_id = ? AND operation = 'vdt.create_with_initial'"
      ).run(projectId);
      this.db.prepare("DELETE FROM project_runtime_states WHERE project_id = ?").run(projectId);
      return this.db.prepare("DELETE FROM projects WHERE id = ?").run(projectId).changes > 0;
    });
    if (deleted) {
      const dir = projectDir(this.dataDir, projectId);
      assertInside(this.dataDir, dir);
      fs.rmSync(dir, { recursive: true, force: true });
    }
    return deleted;
  }

  listProjects(): ProjectRecord[] {
    return (this.db.prepare("SELECT * FROM projects ORDER BY updated_at DESC, name ASC").all() as Row[]).map(projectFromRow);
  }

  createVdt(input: CreateVdtInput): VdtRecord {
    assertSafeId(input.id, "vdtId");
    assertSafeId(input.projectId, "projectId");
    const createdAt = this.now();
    const status = input.status ?? "draft";
    const record: VdtRecord = defined({
      id: input.id,
      projectId: input.projectId,
      name: input.name,
      rootKpi: input.rootKpi,
      unit: input.unit,
      timePeriod: input.timePeriod,
      status,
      metadata: input.metadata,
      createdAt,
      updatedAt: createdAt
    });
    this.transaction(() => {
      const runtime = this.atomicRevisions.getProjectRuntimeState(record.projectId);
      if (!runtime) throw new Error(`Project runtime state not found: ${record.projectId}`);
      this.db.prepare(`
        INSERT INTO vdts (id, project_id, name, root_kpi, unit, time_period, status, active_revision_id, metadata_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
      `).run(
        record.id,
        record.projectId,
        record.name,
        record.rootKpi,
        record.unit ?? null,
        record.timePeriod ?? null,
        record.status,
        encodeJson(record.metadata),
        toMillis(record.createdAt),
        toMillis(record.updatedAt)
      );
      this.db.prepare(`
        INSERT INTO vdt_revision_heads
        (vdt_id, schema_version, project_id, active_revision_id, active_content_scheme, active_content_hash, pending_revision_id, commit_generation)
        VALUES (?, 'vdt_revision_head.v2', ?, NULL, NULL, NULL, NULL, 0)
      `).run(record.id, record.projectId);
      this.db.prepare(`
        INSERT INTO vdt_storage_lifecycles
        (vdt_id, project_id, state, initial_attempt_id, updated_at)
        VALUES (?, ?, 'ready', NULL, ?)
      `).run(record.id, record.projectId, toMillis(record.createdAt));
    });
    vdtRevisionDir(this.dataDir, record.projectId, record.id);
    vdtPreviewDir(this.dataDir, record.projectId, record.id);
    return record;
  }

  getVdt(vdtId: string): VdtRecord | null {
    assertSafeId(vdtId, "vdtId");
    const row = this.db.prepare(`
      SELECT v.* FROM vdts v
      JOIN vdt_storage_lifecycles l ON l.vdt_id = v.id AND l.state = 'ready'
      WHERE v.id = ?
    `).get(vdtId) as Row | undefined;
    return row ? vdtFromRow(row) : null;
  }

  updateVdt(vdtId: string, patch: UpdateVdtInput): VdtRecord {
    assertSafeId(vdtId, "vdtId");
    const current = this.getVdt(vdtId);
    if (!current) throw new Error(`VDT not found: ${vdtId}`);
    const updatedAt = this.now();
    const next: VdtRecord = defined({
      ...current,
      ...patch,
      updatedAt
    });
    this.transaction(() => {
      this.db.prepare(`
        UPDATE vdts
        SET name = ?, root_kpi = ?, unit = ?, time_period = ?, status = ?, metadata_json = ?, updated_at = ?
        WHERE id = ?
      `).run(
        next.name,
        next.rootKpi,
        next.unit ?? null,
        next.timePeriod ?? null,
        next.status,
        encodeJson(next.metadata),
        toMillis(next.updatedAt),
        next.id
      );
      this.db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(toMillis(next.updatedAt), next.projectId);
    });
    return next;
  }

  private deleteVdtAgentData(vdtId: string): void {
    assertSafeId(vdtId, "vdtId");
    this.db.prepare(`
      DELETE FROM legacy_agent_run_adoptions_v1
      WHERE vdt_id = ?
         OR run_id IN (SELECT id FROM agent_runs WHERE vdt_id = ?)
         OR conversation_id IN (SELECT id FROM conversations WHERE vdt_id = ?)
    `).run(vdtId, vdtId, vdtId);
    const conversationRows = this.db.prepare(`
      SELECT id FROM conversations WHERE vdt_id = ?
      UNION
      SELECT conversation_id AS id FROM agent_runs WHERE vdt_id = ? AND conversation_id IS NOT NULL
    `).all(vdtId, vdtId) as Row[];
    const conversationIds = conversationRows
      .map((row) => string(row.id))
      .filter((id) => id.length > 0);
    this.db.prepare("DELETE FROM agent_runs WHERE vdt_id = ?").run(vdtId);
    if (conversationIds.length > 0) {
      const placeholders = conversationIds.map(() => "?").join(", ");
      this.db.prepare(`DELETE FROM conversations WHERE vdt_id = ? OR id IN (${placeholders})`).run(vdtId, ...conversationIds);
    } else {
      this.db.prepare("DELETE FROM conversations WHERE vdt_id = ?").run(vdtId);
    }
  }

  deleteVdt(vdtId: string): boolean {
    assertSafeId(vdtId, "vdtId");
    const current = this.getVdt(vdtId);
    if (!current) return false;
    const deleted = this.transaction(() => {
      this.deleteVdtAgentData(vdtId);
      this.db.prepare("DELETE FROM legacy_revision_attestations WHERE vdt_id = ?").run(vdtId);
      this.db.prepare("DELETE FROM revision_commit_records WHERE vdt_id = ?").run(vdtId);
      this.db.prepare("DELETE FROM revision_commit_attempts WHERE vdt_id = ?").run(vdtId);
      this.db.prepare(
        "DELETE FROM idempotency_records WHERE scope_id = ? AND operation = 'revision.commit'"
      ).run(vdtId);
      this.db.prepare("DELETE FROM vdt_storage_lifecycles WHERE vdt_id = ?").run(vdtId);
      this.db.prepare("DELETE FROM vdt_revision_heads WHERE vdt_id = ?").run(vdtId);
      return this.db.prepare("DELETE FROM vdts WHERE id = ?").run(vdtId).changes > 0;
    });
    if (deleted) {
      const dir = path.join(projectDir(this.dataDir, current.projectId), "vdts", current.id);
      assertInside(this.dataDir, dir);
      fs.rmSync(dir, { recursive: true, force: true });
      const updatedAt = this.now();
      this.db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(toMillis(updatedAt), current.projectId);
    }
    return deleted;
  }

  listVdts(projectId: string): VdtRecord[] {
    assertSafeId(projectId, "projectId");
    return (this.db.prepare(`
      SELECT v.* FROM vdts v
      JOIN vdt_storage_lifecycles l ON l.vdt_id = v.id AND l.state = 'ready'
      WHERE v.project_id = ?
      ORDER BY v.updated_at DESC, v.name ASC
    `).all(projectId) as Row[]).map(vdtFromRow);
  }

  /** @deprecated Internal compatibility primitive for unmigrated V1 callers. */
  saveVdtRevision(input: CreateVdtRevisionInput): VdtRevisionRecord {
    assertSafeId(input.id, "revisionId");
    assertSafeId(input.projectId, "projectId");
    assertSafeId(input.vdtId, "vdtId");
    const createdAt = this.now();
    const revisionFile = path.join(vdtRevisionDir(this.dataDir, input.projectId, input.vdtId), `${String(input.revisionNo).padStart(6, "0")}.vdt.json`);
    assertInside(this.dataDir, revisionFile);
    const payload = `${JSON.stringify(input.project, null, 2)}\n`;
    const filePath = path.relative(this.dataDir, revisionFile);
    const graphHash = createHash("sha256").update(payload).digest("hex");
    const record: VdtRevisionRecord = defined({
      id: input.id,
      vdtId: input.vdtId,
      revisionNo: input.revisionNo,
      parentRevisionId: input.parentRevisionId,
      source: input.source,
      summary: input.summary,
      filePath,
      graphHash,
      validation: input.validation,
      calculation: input.calculation,
      createdAt
    });

    let createdFile = false;
    try {
      this.transaction(() => {
        const existing = this.db.prepare(
          "SELECT 1 FROM vdt_revisions WHERE id = ? OR (vdt_id = ? AND revision_no = ?)"
        ).get(record.id, record.vdtId, record.revisionNo);
        if (existing) throw new Error(`Revision identity or number already exists: ${record.id}.`);
        const owner = this.db.prepare(
          "SELECT project_id FROM vdts WHERE id = ?"
        ).get(record.vdtId) as Row | undefined;
        if (owner?.project_id !== input.projectId) {
          throw new Error(
            `VDT ${record.vdtId} does not belong to project ${input.projectId}.`
          );
        }
        const head = this.atomicRevisions.getVdtRevisionHead(record.vdtId);
        if (!head || head.pendingRevisionId !== null) {
          throw new Error(`VDT revision head is unavailable or pending: ${record.vdtId}.`);
        }
        const descriptor = fs.openSync(revisionFile, "wx", 0o600);
        try {
          fs.writeFileSync(descriptor, payload, "utf8");
          fs.fsyncSync(descriptor);
        } finally {
          fs.closeSync(descriptor);
        }
        fsyncDirectory(path.dirname(revisionFile));
        createdFile = true;
        this.db.prepare(`
          INSERT INTO vdt_revisions (id, vdt_id, revision_no, parent_revision_id, source, summary, file_path, graph_hash, validation_json, calculation_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          record.id,
          record.vdtId,
          record.revisionNo,
          record.parentRevisionId ?? null,
          record.source,
          record.summary ?? null,
          record.filePath,
          record.graphHash,
          encodeJson(record.validation),
          encodeJson(record.calculation),
          toMillis(record.createdAt)
        );
        this.db.prepare(`
          INSERT INTO legacy_revision_attestations
          (revision_id, schema_version, project_id, vdt_id, revision_no, file_relative_path,
           content_scheme, content_hash, payload_byte_length, verified_at)
          VALUES (?, 'legacy_revision_attestation.v1', ?, ?, ?, ?,
                  'legacy_graph_sha256', ?, ?, ?)
        `).run(
          record.id,
          input.projectId,
          input.vdtId,
          record.revisionNo,
          record.filePath,
          `sha256:${graphHash}`,
          Buffer.byteLength(payload, "utf8"),
          toMillis(record.createdAt)
        );
        this.db.prepare("UPDATE vdts SET active_revision_id = ?, updated_at = ? WHERE id = ?").run(record.id, toMillis(createdAt), input.vdtId);
        const updatedHead = this.db.prepare(`
          UPDATE vdt_revision_heads
          SET active_revision_id = ?, active_content_scheme = 'legacy_graph_sha256',
              active_content_hash = ?, commit_generation = MAX(commit_generation, ?)
          WHERE vdt_id = ? AND pending_revision_id IS NULL
        `).run(record.id, `sha256:${graphHash}`, record.revisionNo, input.vdtId).changes;
        if (updatedHead !== 1) {
          throw new Error(`VDT revision head changed during compatibility save: ${record.vdtId}.`);
        }
        this.db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(toMillis(createdAt), input.projectId);
      });
    } catch (error) {
      if (createdFile && fs.existsSync(revisionFile)) {
        fs.unlinkSync(revisionFile);
        fsyncDirectory(path.dirname(revisionFile));
      }
      throw error;
    }
    return record;
  }

  commitVdtRevision(input: RevisionCommitInputV2): RevisionCommitResultV2 {
    return this.atomicRevisions.commitVdtRevision(input);
  }

  createVdtWithInitialSnapshot(
    input: CreateVdtWithInitialSnapshotInputV1
  ): CreateVdtWithInitialSnapshotResultV1 {
    return this.atomicRevisions.createVdtWithInitialSnapshot(input);
  }

  recoverRevisionCommits(): void {
    this.atomicRevisions.recoverRevisionCommits();
  }

  getProjectRuntimeState(projectId: string): ProjectRuntimeStateV1 | null {
    return this.atomicRevisions.getProjectRuntimeState(projectId);
  }

  getVdtRevisionHead(vdtId: string): VdtRevisionHeadV2 | null {
    return this.atomicRevisions.getVdtRevisionHead(vdtId);
  }

  getRevisionCommitAttempt(attemptId: string): RevisionCommitAttemptV1 | null {
    return this.atomicRevisions.getRevisionCommitAttempt(attemptId);
  }

  readVdtRevision(record: VdtRevisionRecord): VdtProject {
    const file = path.resolve(this.dataDir, record.filePath);
    assertInside(this.dataDir, file);
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`Revision file is not a regular file: ${record.filePath}`);
    }
    const raw = fs.readFileSync(file, "utf8");
    const hash = createHash("sha256").update(raw).digest("hex");
    if (hash !== record.graphHash) {
      throw new Error(`Revision graph hash mismatch for ${record.id}.`);
    }
    return JSON.parse(raw) as VdtProject;
  }

  getVdtRevision(revisionId: string): VdtRevisionRecord | null {
    assertSafeId(revisionId, "revisionId");
    const row = this.db.prepare("SELECT * FROM vdt_revisions WHERE id = ?").get(revisionId) as Row | undefined;
    return row ? revisionFromRow(row) : null;
  }

  listVdtRevisions(vdtId: string): VdtRevisionRecord[] {
    assertSafeId(vdtId, "vdtId");
    return (this.db.prepare("SELECT * FROM vdt_revisions WHERE vdt_id = ? ORDER BY revision_no ASC").all(vdtId) as Row[])
      .map(revisionFromRow);
  }

  createConversation(input: {
    id: string;
    projectId: string;
    vdtId?: string | undefined;
    title?: string | undefined;
    mode?: string | undefined;
  }): ConversationRecord {
    assertSafeId(input.id, "conversationId");
    assertSafeId(input.projectId, "projectId");
    if (input.vdtId) assertSafeId(input.vdtId, "vdtId");
    const createdAt = this.now();
    const record: ConversationRecord = defined({
      id: input.id,
      projectId: input.projectId,
      vdtId: input.vdtId,
      title: input.title,
      mode: input.mode ?? "vdt_build",
      createdAt,
      updatedAt: createdAt
    });
    this.db.prepare(`
      INSERT INTO conversations (id, project_id, vdt_id, title, mode, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(record.id, record.projectId, record.vdtId ?? null, record.title ?? null, record.mode, toMillis(createdAt), toMillis(createdAt));
    return record;
  }

  updateConversation(
    conversationId: string,
    patch: Pick<Partial<ConversationRecord>, "vdtId" | "title" | "mode">
  ): ConversationRecord {
    assertSafeId(conversationId, "conversationId");
    if (patch.vdtId) assertSafeId(patch.vdtId, "vdtId");
    const current = this.getConversation(conversationId);
    if (!current) throw new Error(`Conversation not found: ${conversationId}`);
    const updatedAt = this.now();
    const next: ConversationRecord = defined({
      ...current,
      ...patch,
      updatedAt
    });
    this.db.prepare(`
      UPDATE conversations
      SET vdt_id = ?, title = ?, mode = ?, updated_at = ?
      WHERE id = ?
    `).run(
      next.vdtId ?? null,
      next.title ?? null,
      next.mode,
      toMillis(next.updatedAt),
      next.id
    );
    return next;
  }

  appendMessage(input: Omit<MessageRecord, "createdAt" | "position"> & { position?: number | undefined }): MessageRecord {
    assertSafeId(input.id, "messageId");
    assertSafeId(input.conversationId, "conversationId");
    const createdAt = this.now();
    const position = input.position ?? nextMessagePosition(this.db, input.conversationId);
    const record: MessageRecord = defined({
      ...input,
      position,
      createdAt
    });
    this.db.prepare(`
      INSERT INTO messages (id, conversation_id, role, content, agent_run_id, events_json, attachments_json, produced_files_json, run_context_json, position, created_at, started_at, ended_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.conversationId,
      record.role,
      record.content,
      record.agentRunId ?? null,
      encodeJson(record.events),
      encodeJson(record.attachments),
      encodeJson(record.producedFiles),
      encodeJson(redactSecrets(record.runContext)),
      record.position,
      toMillis(record.createdAt),
      record.startedAt ? toMillis(record.startedAt) : null,
      record.endedAt ? toMillis(record.endedAt) : null
    );
    this.db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(toMillis(createdAt), record.conversationId);
    return record;
  }

  getConversation(conversationId: string): ConversationRecord | null {
    assertSafeId(conversationId, "conversationId");
    const row = this.db.prepare("SELECT * FROM conversations WHERE id = ?").get(conversationId) as Row | undefined;
    return row ? conversationFromRow(row) : null;
  }

  listConversations(projectId: string): ConversationRecord[] {
    assertSafeId(projectId, "projectId");
    return (this.db.prepare("SELECT * FROM conversations WHERE project_id = ? ORDER BY updated_at DESC, id ASC").all(projectId) as Row[])
      .map(conversationFromRow);
  }

  listMessages(conversationId: string): MessageRecord[] {
    assertSafeId(conversationId, "conversationId");
    return (this.db.prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY position ASC, created_at ASC, id ASC").all(conversationId) as Row[])
      .map(messageFromRow);
  }

  createAgentRun(input: Omit<AgentRunRecord, "createdAt" | "updatedAt">): AgentRunRecord {
    assertSafeId(input.id, "agentRunId");
    assertSafeId(input.projectId, "projectId");
    if (input.vdtId) assertSafeId(input.vdtId, "vdtId");
    if (input.conversationId) assertSafeId(input.conversationId, "conversationId");
    const createdAt = this.now();
    const record: AgentRunRecord = defined({
      ...input,
      request: redactSecrets(input.request) as Record<string, unknown>,
      publicSnapshot: redactSecrets(input.publicSnapshot) as Record<string, unknown> | undefined,
      internalState: redactSecrets(input.internalState) as Record<string, unknown> | undefined,
      createdAt,
      updatedAt: createdAt
    });
    this.db.prepare(`
      INSERT INTO agent_runs (id, project_id, vdt_id, conversation_id, status, phase, request_json, public_snapshot_json, internal_state_json, created_at, updated_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.projectId,
      record.vdtId ?? null,
      record.conversationId ?? null,
      record.status,
      record.phase,
      encodeJson(record.request),
      encodeJson(record.publicSnapshot),
      encodeJson(record.internalState),
      toMillis(record.createdAt),
      toMillis(record.updatedAt),
      record.completedAt ? toMillis(record.completedAt) : null
    );
    return record;
  }

  updateAgentRun(runId: string, patch: Partial<Omit<AgentRunRecord, "id" | "projectId" | "createdAt">>): AgentRunRecord {
    assertSafeId(runId, "agentRunId");
    const current = this.getAgentRun(runId);
    if (!current) throw new Error(`Agent run not found: ${runId}`);
    const updatedAt = this.now();
    const next: AgentRunRecord = defined({
      ...current,
      ...patch,
      request: redactSecrets(patch.request ?? current.request) as Record<string, unknown>,
      publicSnapshot: redactSecrets(patch.publicSnapshot ?? current.publicSnapshot) as Record<string, unknown> | undefined,
      internalState: redactSecrets(patch.internalState ?? current.internalState) as Record<string, unknown> | undefined,
      updatedAt
    });
    this.db.prepare(`
      UPDATE agent_runs
      SET vdt_id = ?, conversation_id = ?, status = ?, phase = ?, request_json = ?, public_snapshot_json = ?, internal_state_json = ?, updated_at = ?, completed_at = ?
      WHERE id = ?
    `).run(
      next.vdtId ?? null,
      next.conversationId ?? null,
      next.status,
      next.phase,
      encodeJson(next.request),
      encodeJson(next.publicSnapshot),
      encodeJson(next.internalState),
      toMillis(next.updatedAt),
      next.completedAt ? toMillis(next.completedAt) : null,
      next.id
    );
    return next;
  }

  getAgentRun(runId: string): AgentRunRecord | null {
    assertSafeId(runId, "agentRunId");
    const row = this.db.prepare("SELECT * FROM agent_runs WHERE id = ?").get(runId) as Row | undefined;
    return row ? agentRunFromRow(row) : null;
  }

  listAgentRuns(projectId: string): AgentRunRecord[] {
    assertSafeId(projectId, "projectId");
    return (this.db.prepare("SELECT * FROM agent_runs WHERE project_id = ? ORDER BY updated_at DESC, id ASC").all(projectId) as Row[])
      .map(agentRunFromRow);
  }

  appendAgentEvent(input: Omit<AgentEventRecord, "id" | "createdAt"> & { id?: string | undefined }): AgentEventRecord {
    assertSafeId(input.runId, "agentRunId");
    const createdAt = this.now();
    const id = input.id ?? `${input.runId}_${input.seq}`;
    assertSafeId(id, "agentEventId");
    const record: AgentEventRecord = defined({
      ...input,
      id,
      metadata: redactSecrets(input.metadata) as Record<string, unknown> | undefined,
      createdAt
    });
    this.db.prepare(`
      INSERT INTO agent_events (id, run_id, seq, type, phase, title, message, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.runId,
      record.seq,
      record.type,
      record.phase,
      record.title,
      record.message,
      encodeJson(record.metadata),
      toMillis(record.createdAt)
    );
    return record;
  }

  listAgentEvents(runId: string): AgentEventRecord[] {
    assertSafeId(runId, "agentRunId");
    return (this.db.prepare("SELECT * FROM agent_events WHERE run_id = ? ORDER BY seq ASC").all(runId) as Row[]).map(agentEventFromRow);
  }

  createMutationProposal(input: Omit<MutationProposalRecord, "createdAt"> & { createdAt?: string | undefined }): MutationProposalRecord {
    assertSafeId(input.id, "mutationProposalId");
    assertSafeId(input.runId, "agentRunId");
    assertSafeId(input.projectId, "projectId");
    assertSafeId(input.vdtId, "vdtId");
    assertSafeId(input.baseRevisionId, "revisionId");
    const record: MutationProposalRecord = defined({
      ...input,
      createdAt: input.createdAt ?? this.now()
    });
    this.db.prepare(`
      INSERT INTO mutation_proposals (id, run_id, project_id, vdt_id, base_revision_id, status, title, summary, change_set_json, preview_file_path, validation_json, calculation_json, created_at, applied_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.runId,
      record.projectId,
      record.vdtId,
      record.baseRevisionId,
      record.status,
      record.title,
      record.summary ?? null,
      encodeJson(record.changeSet),
      record.previewFilePath ?? null,
      encodeJson(record.validation),
      encodeJson(record.calculation),
      toMillis(record.createdAt),
      record.appliedAt ? toMillis(record.appliedAt) : null
    );
    return record;
  }

  updateMutationProposal(proposalId: string, patch: Pick<Partial<MutationProposalRecord>, "status" | "appliedAt" | "validation" | "calculation" | "previewFilePath">): MutationProposalRecord {
    assertSafeId(proposalId, "mutationProposalId");
    const current = this.db.prepare("SELECT * FROM mutation_proposals WHERE id = ?").get(proposalId) as Row | undefined;
    if (!current) throw new Error(`Mutation proposal not found: ${proposalId}`);
    const next = {
      ...mutationProposalFromRow(current),
      ...patch
    };
    this.db.prepare(`
      UPDATE mutation_proposals
      SET status = ?, preview_file_path = ?, validation_json = ?, calculation_json = ?, applied_at = ?
      WHERE id = ?
    `).run(
      next.status,
      next.previewFilePath ?? null,
      encodeJson(next.validation),
      encodeJson(next.calculation),
      next.appliedAt ? toMillis(next.appliedAt) : null,
      proposalId
    );
    const row = this.db.prepare("SELECT * FROM mutation_proposals WHERE id = ?").get(proposalId) as Row | undefined;
    if (!row) throw new Error(`Mutation proposal not found after update: ${proposalId}`);
    return mutationProposalFromRow(row);
  }

  getMutationProposal(proposalId: string): MutationProposalRecord | null {
    assertSafeId(proposalId, "mutationProposalId");
    const row = this.db.prepare("SELECT * FROM mutation_proposals WHERE id = ?").get(proposalId) as Row | undefined;
    return row ? mutationProposalFromRow(row) : null;
  }

  listMutationProposals(runId: string): MutationProposalRecord[] {
    assertSafeId(runId, "agentRunId");
    return (this.db.prepare("SELECT * FROM mutation_proposals WHERE run_id = ? ORDER BY created_at ASC, id ASC").all(runId) as Row[])
      .map(mutationProposalFromRow);
  }

  listProjectMutationProposals(projectId: string): MutationProposalRecord[] {
    assertSafeId(projectId, "projectId");
    return (this.db.prepare("SELECT * FROM mutation_proposals WHERE project_id = ? ORDER BY created_at DESC, id ASC").all(projectId) as Row[])
      .map(mutationProposalFromRow);
  }

  createComparison(input: Omit<VdtComparisonRecord, "createdAt">): VdtComparisonRecord {
    assertSafeId(input.id, "comparisonId");
    assertSafeId(input.projectId, "projectId");
    assertSafeId(input.leftVdtId, "leftVdtId");
    assertSafeId(input.rightVdtId, "rightVdtId");
    assertSafeId(input.leftRevisionId, "leftRevisionId");
    assertSafeId(input.rightRevisionId, "rightRevisionId");
    const createdAt = this.now();
    const record: VdtComparisonRecord = defined({ ...input, createdAt });
    this.db.prepare(`
      INSERT INTO vdt_comparisons (id, project_id, left_vdt_id, right_vdt_id, left_revision_id, right_revision_id, result_json, summary, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.projectId,
      record.leftVdtId,
      record.rightVdtId,
      record.leftRevisionId,
      record.rightRevisionId,
      encodeJson(record.result),
      record.summary ?? null,
      toMillis(record.createdAt)
    );
    return record;
  }

  getComparison(comparisonId: string): VdtComparisonRecord | null {
    assertSafeId(comparisonId, "comparisonId");
    const row = this.db.prepare("SELECT * FROM vdt_comparisons WHERE id = ?").get(comparisonId) as Row | undefined;
    return row ? comparisonFromRow(row) : null;
  }

  listComparisons(projectId: string): VdtComparisonRecord[] {
    assertSafeId(projectId, "projectId");
    return (this.db.prepare("SELECT * FROM vdt_comparisons WHERE project_id = ? ORDER BY created_at DESC, id ASC").all(projectId) as Row[])
      .map(comparisonFromRow);
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

function manifestFromProject(record: ProjectRecord): ProjectManifest {
  return defined({
    schemaVersion: 1 as const,
    id: record.id,
    name: record.name,
    industry: record.industry,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  });
}

function projectFromRow(row: Row): ProjectRecord {
  return defined({
    id: string(row.id),
    name: string(row.name),
    description: nullableString(row.description),
    industry: nullableString(row.industry),
    metadata: decodeJson<Record<string, unknown>>(row.metadata_json),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  });
}

function vdtFromRow(row: Row): VdtRecord {
  return defined({
    id: string(row.id),
    projectId: string(row.project_id),
    name: string(row.name),
    rootKpi: string(row.root_kpi),
    unit: nullableString(row.unit),
    timePeriod: nullableString(row.time_period),
    status: vdtStatus(row.status),
    activeRevisionId: nullableString(row.active_revision_id),
    metadata: decodeJson<Record<string, unknown>>(row.metadata_json),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  });
}

function revisionFromRow(row: Row): VdtRevisionRecord {
  return defined({
    id: string(row.id),
    vdtId: string(row.vdt_id),
    revisionNo: number(row.revision_no),
    parentRevisionId: nullableString(row.parent_revision_id),
    source: revisionSource(row.source),
    summary: nullableString(row.summary),
    filePath: string(row.file_path),
    graphHash: string(row.graph_hash),
    validation: decodeJson(row.validation_json),
    calculation: decodeJson(row.calculation_json),
    createdAt: toIso(row.created_at)
  });
}

function conversationFromRow(row: Row): ConversationRecord {
  return defined({
    id: string(row.id),
    projectId: string(row.project_id),
    vdtId: nullableString(row.vdt_id),
    title: nullableString(row.title),
    mode: string(row.mode),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  });
}

function messageFromRow(row: Row): MessageRecord {
  return defined({
    id: string(row.id),
    conversationId: string(row.conversation_id),
    role: messageRole(row.role),
    content: string(row.content),
    agentRunId: nullableString(row.agent_run_id),
    events: decodeJson<unknown[]>(row.events_json),
    attachments: decodeJson<unknown[]>(row.attachments_json),
    producedFiles: decodeJson<unknown[]>(row.produced_files_json),
    runContext: decodeJson<Record<string, unknown>>(row.run_context_json),
    position: number(row.position),
    createdAt: toIso(row.created_at),
    startedAt: row.started_at === null || row.started_at === undefined ? undefined : toIso(row.started_at),
    endedAt: row.ended_at === null || row.ended_at === undefined ? undefined : toIso(row.ended_at)
  });
}

function agentRunFromRow(row: Row): AgentRunRecord {
  return defined({
    id: string(row.id),
    projectId: string(row.project_id),
    vdtId: nullableString(row.vdt_id),
    conversationId: nullableString(row.conversation_id),
    status: string(row.status),
    phase: string(row.phase),
    request: decodeJson<Record<string, unknown>>(row.request_json) ?? {},
    publicSnapshot: decodeJson<Record<string, unknown>>(row.public_snapshot_json),
    internalState: decodeJson<Record<string, unknown>>(row.internal_state_json),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    completedAt: row.completed_at === null || row.completed_at === undefined ? undefined : toIso(row.completed_at)
  });
}

function agentEventFromRow(row: Row): AgentEventRecord {
  return defined({
    id: string(row.id),
    runId: string(row.run_id),
    seq: number(row.seq),
    type: string(row.type),
    phase: string(row.phase),
    title: string(row.title),
    message: string(row.message),
    metadata: decodeJson<Record<string, unknown>>(row.metadata_json),
    createdAt: toIso(row.created_at)
  });
}

function mutationProposalFromRow(row: Row): MutationProposalRecord {
  const changeSet = decodeJson<MutationProposalRecord["changeSet"]>(row.change_set_json);
  if (!changeSet) throw new Error(`Mutation proposal ${string(row.id)} has no change set payload.`);
  return defined({
    id: string(row.id),
    runId: string(row.run_id),
    projectId: string(row.project_id),
    vdtId: string(row.vdt_id),
    baseRevisionId: string(row.base_revision_id),
    status: proposalStatus(row.status),
    title: string(row.title),
    summary: nullableString(row.summary),
    changeSet,
    previewFilePath: nullableString(row.preview_file_path),
    validation: decodeJson(row.validation_json),
    calculation: decodeJson(row.calculation_json),
    createdAt: toIso(row.created_at),
    appliedAt: row.applied_at === null || row.applied_at === undefined ? undefined : toIso(row.applied_at)
  });
}

function comparisonFromRow(row: Row): VdtComparisonRecord {
  return defined({
    id: string(row.id),
    projectId: string(row.project_id),
    leftVdtId: string(row.left_vdt_id),
    rightVdtId: string(row.right_vdt_id),
    leftRevisionId: string(row.left_revision_id),
    rightRevisionId: string(row.right_revision_id),
    result: decodeJson(row.result_json),
    summary: nullableString(row.summary),
    createdAt: toIso(row.created_at)
  });
}

function nextMessagePosition(db: DatabaseSync, conversationId: string): number {
  const row = db.prepare("SELECT COALESCE(MAX(position), 0) + 1 AS next_position FROM messages WHERE conversation_id = ?").get(conversationId) as Row | undefined;
  return number(row?.next_position ?? 1);
}

function string(value: unknown): string {
  if (typeof value !== "string") throw new Error(`Expected string, received ${String(value)}`);
  return value;
}

function nullableString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Expected number, received ${String(value)}`);
  return value;
}

function vdtStatus(value: unknown): VdtRecord["status"] {
  if (value === "draft" || value === "reviewed" || value === "approved" || value === "archived") return value;
  throw new Error(`Invalid VDT status: ${String(value)}`);
}

function revisionSource(value: unknown): VdtRevisionRecord["source"] {
  if (value === "user" || value === "agent" || value === "import" || value === "scenario" || value === "repair") return value;
  throw new Error(`Invalid revision source: ${String(value)}`);
}

function messageRole(value: unknown): MessageRecord["role"] {
  if (value === "user" || value === "assistant" || value === "system") return value;
  throw new Error(`Invalid message role: ${String(value)}`);
}

function proposalStatus(value: unknown): MutationProposalRecord["status"] {
  if (value === "proposed" || value === "approved" || value === "rejected" || value === "applied" || value === "failed") return value;
  throw new Error(`Invalid mutation proposal status: ${String(value)}`);
}

function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => redactSecrets(entry));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      isSecretKey(key) ? "[redacted]" : redactSecrets(entry)
    ])
  );
}

function fsyncDirectory(directoryPath: string): void {
  const descriptor = fs.openSync(directoryPath, "r");
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function isSecretKey(key: string): boolean {
  return /api[_-]?key|pairing[_-]?token|authorization|password|secret|access[_-]?token|refresh[_-]?token/i.test(key);
}

export function readProjectManifestFromDatabaseLocation(dataDir: string, projectId: string): ProjectManifest {
  return readProjectManifest(path.join(ensureProjectLocation(dataDir), "projects", assertSafeId(projectId, "projectId")));
}
