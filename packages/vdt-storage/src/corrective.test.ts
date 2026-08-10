import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { productionVolumeProject, type VdtProject } from "@vdt-studio/vdt-core";
import {
  ATOMIC_REVISION_SCHEMA_HASH,
  STORAGE_MIGRATION_MANIFEST,
  computeSchemaHash,
  hashFramed,
  openVdtDatabase,
  resolveStorageMigrationAssetPath,
  validateStrictVdtProjectCommit,
  VdtStorageError
} from "./index";
import * as storageApi from "./index";
import { openBootstrapVdtDatabaseForTests } from "./sqlite-test-support";
import type {
  ActorContextV1,
  RevisionCommitFaultPoint,
  RevisionCommitInputV2,
  StorageMigrationFaultPoint,
  VdtDatabase
} from "./types";

const tempDirs: string[] = [];
const LEGACY_SQL = fs.readFileSync(
  new URL("./migrations/001-legacy-v1-bootstrap.sql", import.meta.url),
  "utf8"
);

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("StrictVdtProjectCommitV1 and canonical framing", () => {
  it("publishes a stable cross-package golden hash vector", () => {
    expect(
      hashFramed(
        "vdt-studio/test-vector",
        "test_vector.v1",
        { z: 1, a: "é" },
        Buffer.from([0, 1, 2, 255])
      )
    ).toBe("sha256:6082e9661509cbcc9ae95b0d9238e629b853c417307271e9bd57b82456204288");
  });

  it("strictly validates version metadata and every nested snapshot round-trip", () => {
    const snapshot = cleanProject();
    const project = cleanProject();
    project.versions = [
      {
        id: "version_1",
        name: "Reviewed snapshot",
        description: "Strict nested project",
        taskType: "review_model",
        projectSnapshot: snapshot,
        createdAt: "2026-07-23T00:00:00.000Z"
      }
    ];
    expect(validateStrictVdtProjectCommit(project).canonicalJson).toContain(
      '"taskType":"review_model"'
    );

    const malformed = cleanProject() as unknown as Record<string, unknown>;
    malformed.versions = [
      {
        id: 1,
        name: {},
        taskType: "not_registered",
        createdAt: 3,
        projectSnapshot: { ...cleanProject(), unknownNestedKey: true, versions: [] }
      }
    ];
    expect(() => validateStrictVdtProjectCommit(malformed)).toThrow(
      /canonical UTC timestamp string|non-empty string|registered task type|round-trip/
    );
  });

  it("rejects sparse, non-plain, lossy, and non-canonical timestamp inputs", () => {
    const sparse = cleanProject() as unknown as Record<string, unknown>;
    sparse.versions = new Array(1);
    expect(() => validateStrictVdtProjectCommit(sparse)).toThrow(/sparse array hole/);

    const unknown = { ...cleanProject(), unknown: true };
    expect(() => validateStrictVdtProjectCommit(unknown)).toThrow(/round-trip/);

    const timestamp = cleanProject();
    (timestamp as unknown as Record<string, unknown>).updatedAt = 123;
    expect(() => validateStrictVdtProjectCommit(timestamp)).toThrow(
      /canonical UTC timestamp string/
    );

    const withToJson = cleanProject() as unknown as Record<string, unknown>;
    withToJson.extra = { toJSON: () => "lossy" };
    expect(() => validateStrictVdtProjectCommit(withToJson)).toThrow(/toJSON|plain JSON/);
  });
});

describe("atomic revision boundary", () => {
  it("returns the exact terminal idempotency result without rechecking the changed head", () => {
    const { db, input } = setupCommit();
    const first = db.commitVdtRevision(input);
    const replay = db.commitVdtRevision(input);
    expect(JSON.stringify(replay)).toBe(JSON.stringify(first));
    expect(replay.revision.id).toBe(first.revision.id);
    expect(db.listVdtRevisions("vdt_atomic")).toHaveLength(1);
    db.close();
  });

  it.each([
    ["result_hash", "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    [
      "result_canonical_json",
      '{"status":"committed","schemaVersion":"revision_commit_result.v2"}'
    ],
    ["result_code", "NOT_OK"]
  ])("rejects terminal idempotency replay with corrupted %s", (column, value) => {
    const { db, input } = setupCommit();
    db.commitVdtRevision(input);
    const raw = new DatabaseSync(db.databasePath);
    raw.prepare(`
      UPDATE idempotency_records SET ${column} = ?
      WHERE scope_id = 'vdt_atomic' AND operation = 'revision.commit'
        AND idempotency_key = 'commit_key'
    `).run(value);
    raw.close();
    expectStorageCode(() => db.commitVdtRevision(input), "IDEMPOTENCY_RESULT_CORRUPT");
    db.close();
  });

  it("rejects every stale head/runtime CAS without reserving a revision", () => {
    const { db, input } = setupCommit();
    const validHead = db.getVdtRevisionHead("vdt_atomic")!;
    const cases: Array<Partial<RevisionCommitInputV2["command"]>> = [
      { expectedActiveRevisionId: "revision_wrong" },
      {
        expectedActiveContentIdentity: {
          scheme: "legacy_graph_sha256",
          hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        }
      },
      { expectedCommitGeneration: validHead.commitGeneration + 1 },
      { expectedRuntimeGeneration: "v2" },
      { expectedGenerationVersion: 2 }
    ];
    cases.forEach((patch, index) => {
      const command = {
        ...input.command,
        ...patch,
        idempotencyKey: `cas_${index}`
      };
      expectStorageCode(
        () => db.commitVdtRevision({ ...input, command }),
        "REVISION_CONFLICT",
        "PROJECT_WRITE_STATE_CHANGED"
      );
    });
    expect(db.listVdtRevisions("vdt_atomic")).toEqual([]);
    db.close();
  });

  it("revalidates exact framed bytes after before_finalize and quarantines replacement", () => {
    let database: VdtDatabase;
    const { db, input } = setupCommit({
      faultInjector(point, attempt) {
        if (point === "before_finalize") {
          fs.writeFileSync(path.join(database.dataDir, attempt.finalRelativePath), "{}", "utf8");
        }
      }
    });
    database = db;
    expectStorageCode(
      () => db.commitVdtRevision(input),
      "REVISION_QUARANTINED"
    );
    expect(db.getVdtRevisionHead("vdt_atomic")).toMatchObject({
      activeRevisionId: null,
      pendingRevisionId: null,
      commitGeneration: 0
    });
    expect(db.listVdtRevisions("vdt_atomic")).toEqual([]);
    db.close();
  });

  it("never overwrites a conflicting pre-existing final path", () => {
    let database: VdtDatabase;
    const conflictingBytes = Buffer.from('{"conflict":true}', "utf8");
    const { db, input } = setupCommit({
      faultInjector(point, attempt) {
        if (point !== "after_head_reserved") return;
        const finalPath = path.join(database.dataDir, attempt.finalRelativePath);
        fs.mkdirSync(path.dirname(finalPath), { recursive: true });
        fs.writeFileSync(finalPath, conflictingBytes, { flag: "wx" });
      }
    });
    database = db;
    expectStorageCode(() => db.commitVdtRevision(input), "REVISION_QUARANTINED");
    const raw = new DatabaseSync(db.databasePath);
    const attempt = raw.prepare(`
      SELECT final_relative_path, state, quarantine_reason
      FROM revision_commit_attempts
    `).get() as Record<string, unknown>;
    raw.close();
    expect(attempt).toMatchObject({
      state: "quarantined",
      quarantine_reason: "published_hash_mismatch"
    });
    expect(
      fs.readFileSync(path.join(db.dataDir, String(attempt.final_relative_path)))
    ).toEqual(conflictingBytes);
    expect(db.getVdtRevisionHead("vdt_atomic")).toMatchObject({
      activeRevisionId: null,
      pendingRevisionId: null,
      commitGeneration: 0
    });
    expect(db.listVdtRevisions("vdt_atomic")).toEqual([]);
    db.close();
  });

  it.each<RevisionCommitFaultPoint>([
    "after_attempt_reserved",
    "after_stage_fsynced",
    "after_head_reserved",
    "after_final_published"
  ])("recovers deterministically after %s", (faultPoint) => {
    const root = tempRoot();
    const dataDir = path.join(root, "data");
    const db = openVdtDatabase(root, {
      dataDir,
      revisionLeaseMs: 0,
      faultInjector(point) {
        if (point === faultPoint) throw new Error(`fault:${point}`);
      }
    });
    const input = prepareCommit(db);
    expect(() => db.commitVdtRevision(input)).toThrow(`fault:${faultPoint}`);
    db.close();

    const recovered = openVdtDatabase(root, { dataDir, revisionLeaseMs: 0 });
    expect(recovered.getVdtRevisionHead("vdt_atomic")).toMatchObject({
      activeRevisionId: expect.any(String),
      pendingRevisionId: null,
      commitGeneration: 1
    });
    expect(recovered.listVdtRevisions("vdt_atomic")).toHaveLength(1);
    recovered.close();
  });

  it.each<RevisionCommitFaultPoint>([
    "after_attempt_reserved",
    "after_stage_fsynced",
    "after_head_reserved",
    "after_final_published",
    "before_finalize"
  ])(
    "recovers after abrupt child termination at %s without changing prior revision bytes",
    async (faultPoint) => {
      const { db, input } = setupCommit();
      const root = path.dirname(db.dataDir);
      const dataDir = db.dataDir;
      const prior = db.commitVdtRevision(input);
      const priorPath = path.join(dataDir, prior.revision.filePath);
      const priorBytes = fs.readFileSync(priorPath);
      const priorRawHash = createHash("sha256").update(priorBytes).digest("hex");
      expect(priorRawHash).toBe(prior.revision.graphHash);
      db.close();

      const helper = fileURLToPath(
        new URL("./revision-crash-child.ts", import.meta.url)
      );
      await runCrashChild(
        helper,
        [dataDir, faultPoint],
        `revision crash child ${faultPoint}`
      );

      const recovered = openVdtDatabase(root, {
        dataDir,
        revisionLeaseMs: 0
      });
      const revisions = recovered.listVdtRevisions("vdt_atomic");
      expect(revisions).toHaveLength(2);
      const preserved = revisions.find(
        (revision) => revision.id === prior.revision.id
      );
      expect(preserved?.graphHash).toBe(priorRawHash);
      expect(fs.readFileSync(priorPath)).toEqual(priorBytes);
      expect(
        createHash("sha256").update(fs.readFileSync(priorPath)).digest("hex")
      ).toBe(priorRawHash);
      const recoveredHead = recovered.getVdtRevisionHead("vdt_atomic");
      expect(recoveredHead).toMatchObject({
        activeRevisionId: expect.any(String),
        pendingRevisionId: null,
        commitGeneration: 2
      });
      expect(recoveredHead?.activeRevisionId).not.toBe(prior.revision.id);
      recovered.close();
    },
    30_000
  );

  it.each(
    (["after_head_reserved", "after_final_published"] as RevisionCommitFaultPoint[])
      .flatMap((faultPoint) => [
        [
          faultPoint,
          "migrationState",
          "migration_state = 'migrating'"
        ] as const,
        [faultPoint, "writeState", "write_state = 'disabled'"] as const,
        [faultPoint, "runtimeGeneration", "runtime_generation = 'v2'"] as const,
        [
          faultPoint,
          "generationVersion",
          "generation_version = generation_version + 1"
        ] as const
      ])
  )(
    "quarantines a post-reserve %s change to %s and preserves the old active head",
    (faultPoint, field, mutation) => {
      let databasePath = "";
      const idempotencyKey = `post_reserve_${faultPoint}_${field}`;
      const { db, input } = setupCommit({
        faultInjector(point, attempt) {
          if (
            point !== faultPoint ||
            attempt.idempotencyKey !== idempotencyKey
          ) {
            return;
          }
          const external = new DatabaseSync(databasePath, { timeout: 5_000 });
          external.exec(`
            UPDATE project_runtime_states
            SET ${mutation}, updated_at = updated_at + 1
            WHERE project_id = 'project_atomic';
          `);
          external.close();
        }
      });
      databasePath = db.databasePath;
      const prior = db.commitVdtRevision(input);
      const priorBytes = fs.readFileSync(
        path.join(db.dataDir, prior.revision.filePath)
      );
      const nextInput: RevisionCommitInputV2 = {
        ...input,
        command: {
          ...input.command,
          expectedActiveRevisionId: prior.head.activeRevisionId,
          expectedActiveContentIdentity: prior.head.activeContentIdentity,
          expectedCommitGeneration: prior.head.commitGeneration,
          idempotencyKey
        }
      };
      expectStorageCode(
        () => db.commitVdtRevision(nextInput),
        "PROJECT_WRITE_STATE_CHANGED"
      );
      expect(db.getVdtRevisionHead("vdt_atomic")).toEqual(prior.head);
      const revisions = db.listVdtRevisions("vdt_atomic");
      expect(revisions).toHaveLength(1);
      expect(revisions[0]?.id).toBe(prior.revision.id);
      expect(
        fs.readFileSync(path.join(db.dataDir, prior.revision.filePath))
      ).toEqual(priorBytes);
      expect(createHash("sha256").update(priorBytes).digest("hex")).toBe(
        prior.revision.graphHash
      );
      const raw = new DatabaseSync(db.databasePath);
      expect(
        raw.prepare(`
          SELECT state, quarantine_reason FROM revision_commit_attempts
          WHERE idempotency_key = ?
        `).get(idempotencyKey)
      ).toMatchObject({
        state: "quarantined",
        quarantine_reason: "project_write_state_changed"
      });
      raw.close();
      db.close();
    }
  );

  it("fences a stale finalize owner and allows only an expired takeover to recover", () => {
    let databasePath = "";
    const { db, input } = setupCommit({
      revisionLeaseMs: 0,
      faultInjector(point, attempt) {
        if (point !== "before_finalize") return;
        const external = new DatabaseSync(databasePath, { timeout: 5_000 });
        external.prepare(`
          UPDATE revision_commit_attempts
          SET owner_token = 'takeover_owner', lease_generation = lease_generation + 1,
              lease_expires_at = 0
          WHERE attempt_id = ?
        `).run(attempt.attemptId);
        external.close();
      }
    });
    databasePath = db.databasePath;
    expectStorageCode(() => db.commitVdtRevision(input), "STALE_ATTEMPT_OWNER");
    expect(db.getVdtRevisionHead("vdt_atomic")).toMatchObject({
      activeRevisionId: null,
      pendingRevisionId: expect.any(String),
      commitGeneration: 0
    });
    db.close();

    const recovered = openVdtDatabase(path.dirname(path.dirname(databasePath)), {
      dataDir: path.dirname(databasePath),
      revisionLeaseMs: 0
    });
    expect(recovered.getVdtRevisionHead("vdt_atomic")).toMatchObject({
      activeRevisionId: expect.any(String),
      pendingRevisionId: null,
      commitGeneration: 1
    });
    recovered.close();
  });

  it("creates an initial snapshot atomically, hides creating state, and replays", () => {
    const root = tempRoot();
    const dataDir = path.join(root, "data");
    let injected = false;
    const db = openVdtDatabase(root, {
      dataDir,
      revisionLeaseMs: 0,
      faultInjector(point) {
        if (!injected && point === "after_attempt_reserved") {
          injected = true;
          throw new Error("initial-create-crash");
        }
      }
    });
    db.createProject({ id: "project_create", name: "Create" });
    const command = {
      schemaVersion: "create_vdt_with_initial_snapshot.v1" as const,
      projectId: "project_create",
      expectedRuntimeGeneration: "v1" as const,
      expectedGenerationVersion: 1,
      idempotencyKey: "create_key",
      vdt: {
        requestedVdtId: "vdt_create",
        name: "Created VDT",
        rootKpi: "Production",
        unit: "t",
        timePeriod: null,
        status: "draft" as const,
        metadata: { source: "test" }
      },
      revisionIntent: {
        source: "user" as const,
        summary: null,
        validation: null,
        calculation: null
      }
    };
    const createInput = { actor: actor("project_create"), command, project: cleanProject() };
    expect(() => db.createVdtWithInitialSnapshot(createInput)).toThrow(
      "initial-create-crash"
    );
    expect(db.getVdt("vdt_create")).toBeNull();
    expect(db.listVdts("project_create")).toEqual([]);
    db.close();

    const recovered = openVdtDatabase(root, { dataDir, revisionLeaseMs: 0 });
    expect(recovered.getVdt("vdt_create")).toMatchObject({ id: "vdt_create" });
    const replay = recovered.createVdtWithInitialSnapshot(createInput);
    expect(replay).toMatchObject({
      schemaVersion: "create_vdt_with_initial_snapshot_result.v1",
      vdt: { id: "vdt_create" },
      head: { commitGeneration: 1, pendingRevisionId: null }
    });
    expect(recovered.listVdtRevisions("vdt_create")).toHaveLength(1);
    recovered.close();
  });

  it("creates and exactly replays a trusted agent-sourced initial snapshot", () => {
    const root = tempRoot();
    const db = openVdtDatabase(root);
    db.createProject({ id: "project_agent_create", name: "Agent create" });
    const input = {
      actor: actor("project_agent_create"),
      command: {
        schemaVersion: "create_vdt_with_initial_snapshot.v1" as const,
        projectId: "project_agent_create",
        expectedRuntimeGeneration: "v1" as const,
        expectedGenerationVersion: 1,
        idempotencyKey: "agent-run:run_123:initial-v1",
        vdt: {
          requestedVdtId: "vdt_agent_create",
          name: "Agent VDT",
          rootKpi: "Production",
          unit: "t",
          timePeriod: "year",
          status: "draft" as const,
          metadata: { sourceRunId: "run_123" }
        },
        revisionIntent: {
          source: "agent" as const,
          summary: "Initial agent VDT draft",
          validation: { valid: true },
          calculation: { calculated: true }
        }
      },
      project: cleanProject()
    };
    const first = db.createVdtWithInitialSnapshot(input);
    const replay = db.createVdtWithInitialSnapshot(input);
    expect(JSON.stringify(replay)).toBe(JSON.stringify(first));
    expect(first.revision).toMatchObject({
      source: "agent",
      summary: "Initial agent VDT draft",
      validation: { valid: true },
      calculation: { calculated: true }
    });
    expect(db.listVdtRevisions("vdt_agent_create")).toHaveLength(1);
    const raw = new DatabaseSync(db.databasePath);
    expect(
      raw.prepare(`
        SELECT intent_json FROM revision_commit_attempts
        WHERE idempotency_key = 'agent-run:run_123:initial-v1'
      `).get()
    ).toEqual({
      intent_json:
        '{"calculation":{"calculated":true},"source":"agent","summary":"Initial agent VDT draft","validation":{"valid":true}}'
    });
    raw.close();
    db.close();
  });

  it("terminally rejects initial creation, removes only the hidden row, and replays rejection", () => {
    const root = tempRoot();
    const dataDir = path.join(root, "data");
    let databasePath = "";
    const db = openVdtDatabase(root, {
      dataDir,
      revisionLeaseMs: 0,
      faultInjector(point, attempt) {
        if (
          point !== "after_stage_fsynced" ||
          attempt.idempotencyKey !== "create_reject_key"
        ) {
          return;
        }
        const external = new DatabaseSync(databasePath, { timeout: 5_000 });
        external.prepare(`
          UPDATE project_runtime_states
          SET write_state = 'disabled', updated_at = updated_at + 1
          WHERE project_id = 'project_create_reject'
        `).run();
        external.close();
      }
    });
    databasePath = db.databasePath;
    db.createProject({
      id: "project_create_reject",
      name: "Create rejection"
    });
    db.createVdt({
      id: "vdt_ready_sibling",
      projectId: "project_create_reject",
      name: "Ready sibling",
      rootKpi: "Production"
    });
    const createInput = {
      actor: actor("project_create_reject"),
      command: {
        schemaVersion: "create_vdt_with_initial_snapshot.v1" as const,
        projectId: "project_create_reject",
        expectedRuntimeGeneration: "v1" as const,
        expectedGenerationVersion: 1,
        idempotencyKey: "create_reject_key",
        vdt: {
          requestedVdtId: "vdt_hidden_rejected",
          name: "Rejected hidden VDT",
          rootKpi: "Production",
          unit: null,
          timePeriod: null,
          status: "draft" as const,
          metadata: null
        },
        revisionIntent: {
          source: "user" as const,
          summary: null,
          validation: null,
          calculation: null
        }
      },
      project: cleanProject()
    };
    const first = captureStorageError(() =>
      db.createVdtWithInitialSnapshot(createInput)
    );
    expect(first.code).toBe("PROJECT_WRITE_DISABLED");
    expect(db.getVdt("vdt_hidden_rejected")).toBeNull();
    expect(db.listVdts("project_create_reject")).toEqual([
      expect.objectContaining({ id: "vdt_ready_sibling" })
    ]);

    const raw = new DatabaseSync(db.databasePath);
    expect(
      raw.prepare(`
        SELECT
          (SELECT COUNT(*) FROM vdts WHERE id = 'vdt_hidden_rejected') AS vdts,
          (SELECT COUNT(*) FROM vdt_revision_heads WHERE vdt_id = 'vdt_hidden_rejected') AS heads,
          (SELECT COUNT(*) FROM vdt_storage_lifecycles WHERE vdt_id = 'vdt_hidden_rejected') AS lifecycles
      `).get()
    ).toEqual({ vdts: 0, heads: 0, lifecycles: 0 });
    const terminal = raw.prepare(`
      SELECT a.state, a.staged_payload_relative_path, i.status, i.result_code
      FROM revision_commit_attempts a
      JOIN idempotency_records i
        ON i.scope_id = a.project_id
       AND i.operation = a.operation
       AND i.idempotency_key = a.idempotency_key
      WHERE a.idempotency_key = 'create_reject_key'
    `).get() as Record<string, unknown>;
    expect(terminal).toMatchObject({
      state: "rejected",
      status: "rejected",
      result_code: "PROJECT_WRITE_DISABLED"
    });
    expect(
      fs.existsSync(
        path.join(dataDir, String(terminal.staged_payload_relative_path))
      )
    ).toBe(false);
    raw.close();

    const replay = captureStorageError(() =>
      db.createVdtWithInitialSnapshot(createInput)
    );
    expect(replay.code).toBe(first.code);
    expect(replay.message).toBe(first.message);
    expect(db.getVdt("vdt_ready_sibling")).toMatchObject({
      id: "vdt_ready_sibling"
    });
    db.close();
  });

  it(
    "accepts exactly one of 100 same-base writes across real child processes and independent connections",
    async () => {
      const root = tempRoot();
      const dataDir = path.join(root, "data");
      const payloadPath = path.join(root, "payload.json");
      fs.writeFileSync(payloadPath, JSON.stringify(cleanProject()), "utf8");
      const seed = openVdtDatabase(root, { dataDir, busyTimeoutMs: 30_000 });
      seed.createProject({ id: "project_concurrent", name: "Concurrent" });
      seed.createVdt({
        id: "vdt_concurrent",
        projectId: "project_concurrent",
        name: "Concurrent VDT",
        rootKpi: "Production"
      });
      seed.close();

      const helper = fileURLToPath(
        new URL("./revision-concurrency-child.ts", import.meta.url)
      );
      const counts = Array.from({ length: 100 }, () => 1);
      const startAt = Date.now() + 5_000;
      const outcomes = await Promise.all(
        counts.map((count, worker) =>
          runConcurrencyChild(helper, dataDir, payloadPath, worker, count, startAt)
        )
      );
      expect(outcomes.reduce((sum, result) => sum + result.count, 0)).toBe(100);
      expect(outcomes.reduce((sum, result) => sum + result.committed, 0)).toBe(1);
      expect(outcomes.reduce((sum, result) => sum + result.conflicts, 0)).toBe(99);

      const verify = openVdtDatabase(root, { dataDir });
      expect(verify.listVdtRevisions("vdt_concurrent")).toHaveLength(1);
      const revisionsDir = path.join(
        dataDir,
        "projects",
        "project_concurrent",
        "vdts",
        "vdt_concurrent",
        "revisions"
      );
      expect(
        fs.readdirSync(revisionsDir).filter((entry) => entry.endsWith(".vdt.json"))
      ).toHaveLength(1);
      expect(verify.getVdtRevisionHead("vdt_concurrent")).toMatchObject({
        pendingRevisionId: null,
        commitGeneration: 1
      });
      verify.close();
    },
    180_000
  );
});

describe("ordered storage migrations", () => {
  const openBootstrapVdtDatabase = openBootstrapVdtDatabaseForTests;

  it("does not expose the bootstrap-only opener through the package API", () => {
    expect("__openBootstrapVdtDatabaseForTests" in storageApi).toBe(false);
    expect("openBootstrapVdtDatabaseForTests" in storageApi).toBe(false);
  });

  it("resolves Webpack URL-shaped SQL assets without relying on URL identity", () => {
    const bundledModuleDirectory = path.join(
      tempRoot(),
      ".next",
      "server",
      "chunks"
    );
    const webpackUrlWithoutNodeSlots = {
      toString: () =>
        "/_next/static/media/001-legacy-v1-bootstrap.41551498.sql"
    };

    expect(
      resolveStorageMigrationAssetPath(
        webpackUrlWithoutNodeSlots,
        bundledModuleDirectory
      )
    ).toBe(
      path.join(
        bundledModuleDirectory,
        "static",
        "media",
        "001-legacy-v1-bootstrap.41551498.sql"
      )
    );
  });

  it("resolves App Router deep module dirs to server-root static/media", () => {
    const serverRoot = path.join(tempRoot(), ".next", "server");
    const assetName = "001-legacy-v1-bootstrap.41551498.sql";
    const mediaPath = path.join(serverRoot, "static", "media", assetName);
    fs.mkdirSync(path.dirname(mediaPath), { recursive: true });
    fs.writeFileSync(mediaPath, "-- fixture\n");
    const routeModuleDirectory = path.join(
      serverRoot,
      "app",
      "api",
      "vdt",
      "projects"
    );

    expect(
      resolveStorageMigrationAssetPath(
        {
          toString: () => `/_next/static/media/${assetName}`
        },
        routeModuleDirectory
      )
    ).toBe(mediaPath);
  });

  it("applies the immutable fresh manifest and verifies the post-W0.1 fingerprint", () => {
    const root = tempRoot();
    const db = openBootstrapVdtDatabase(root);
    const raw = new DatabaseSync(db.databasePath);
    expect(raw.prepare("PRAGMA user_version").get()).toEqual({ user_version: 2 });
    expect(computeSchemaHash(raw, 2)).toBe(ATOMIC_REVISION_SCHEMA_HASH);
    expect(
      raw.prepare("SELECT sequence, migration_id FROM applied_migrations ORDER BY sequence").all()
    ).toEqual(
      STORAGE_MIGRATION_MANIFEST.entries.map((entry) => ({
        sequence: entry.sequence,
        migration_id: entry.migrationId
      }))
    );
    const backup = raw.prepare(
      "SELECT backup_relative_path FROM migration_backup_evidence"
    ).get() as Record<string, unknown>;
    expect(fs.existsSync(path.join(db.dataDir, String(backup.backup_relative_path)))).toBe(true);
    raw.close();
    db.close();
  });

  it(
    "serializes fresh migration across independent child processes",
    async () => {
      const root = tempRoot();
      const dataDir = path.join(root, "data");
      fs.mkdirSync(dataDir, { recursive: true });
      const helper = fileURLToPath(
        new URL("./migration-concurrency-child.ts", import.meta.url)
      );
      const startAt = Date.now() + 500;
      await Promise.all(
        Array.from({ length: 2 }, (_, worker) =>
          runRawChild(
            helper,
            [root, dataDir, String(startAt)],
            `migration child ${worker}`
          )
        )
      );
      const db = openBootstrapVdtDatabase(root, { dataDir });
      const raw = new DatabaseSync(db.databasePath);
      expect(raw.prepare("PRAGMA user_version").get()).toEqual({ user_version: 2 });
      expect(raw.prepare("SELECT COUNT(*) AS count FROM applied_migrations").get()).toEqual({
        count: 2
      });
      expect(raw.prepare("SELECT COUNT(*) AS count FROM migration_backup_evidence").get()).toEqual({
        count: 1
      });
      raw.close();
      db.close();
    },
    60_000
  );

  it("ignores but preserves a malformed legacy admission file", () => {
    const root = tempRoot();
    const dataDir = path.join(root, "data");
    fs.mkdirSync(dataDir, { recursive: true });
    const legacyAdmissionPath = path.join(
      dataDir,
      ".migration-admission.lock"
    );
    const partialBytes = Buffer.from('{"schemaVersion":"migration_admission');
    fs.writeFileSync(legacyAdmissionPath, partialBytes);
    const similarlyNamedPath = path.join(
      dataDir,
      ".migration-admission.lock.unrelated"
    );
    const unrelatedBytes = Buffer.from("unrelated-admission-bytes");
    fs.writeFileSync(similarlyNamedPath, unrelatedBytes);

    const opened = openBootstrapVdtDatabase(root, { dataDir });
    expect(fs.readFileSync(legacyAdmissionPath)).toEqual(partialBytes);
    expect(fs.readFileSync(similarlyNamedPath)).toEqual(unrelatedBytes);
    const raw = new DatabaseSync(opened.databasePath);
    expect(raw.prepare("PRAGMA user_version").get()).toEqual({
      user_version: 2
    });
    raw.close();
    opened.close();
  });

  it("adopts an exact legacy database, verifies bytes, and preserves tagged heads", () => {
    const root = tempRoot();
    const dataDir = path.join(root, "data");
    const databasePath = createLegacyDatabase(dataDir, { revision: "valid" });
    const db = openBootstrapVdtDatabase(root, { dataDir });
    expect(db.getVdtRevisionHead("legacy_vdt")).toMatchObject({
      activeRevisionId: "legacy_revision",
      activeContentIdentity: {
        scheme: "legacy_graph_sha256",
        hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/)
      },
      pendingRevisionId: null,
      commitGeneration: 1
    });
    const raw = new DatabaseSync(databasePath);
    expect(
      raw.prepare("SELECT COUNT(*) AS count FROM legacy_revision_attestations").get()
    ).toEqual({ count: 1 });
    raw.close();
    db.close();
  });

  it.each<StorageMigrationFaultPoint>([
    "after_admission_fence_acquired",
    "after_backup_fsynced",
    "after_bootstrap_journal_fsynced",
    "after_sequence_1_committed",
    "before_sequence_2_commit",
    "after_sequence_2_committed"
  ])("restarts safely after migration fault %s", (faultPoint) => {
    const root = tempRoot();
    const dataDir = path.join(root, "data");
    expect(() =>
      openBootstrapVdtDatabase(root, {
        dataDir,
        migrationLeaseMs: 0,
        migrationFaultInjector(point) {
          if (point === faultPoint) throw new Error(`migration-fault:${point}`);
        }
      })
    ).toThrow(`migration-fault:${faultPoint}`);
    const recovered = openBootstrapVdtDatabase(root, {
      dataDir,
      migrationLeaseMs: 0
    });
    const raw = new DatabaseSync(recovered.databasePath);
    expect(raw.prepare("PRAGMA user_version").get()).toEqual({ user_version: 2 });
    expect(computeSchemaHash(raw, 2)).toBe(ATOMIC_REVISION_SCHEMA_HASH);
    raw.close();
    recovered.close();
  });

  it.each<StorageMigrationFaultPoint>([
    "after_admission_fence_acquired",
    "after_backup_fsynced",
    "after_bootstrap_journal_fsynced",
    "after_sequence_1_committed",
    "before_sequence_2_commit",
    "after_sequence_2_committed"
  ])(
    "recovers after abrupt migration termination at %s and preserves every legacy revision byte",
    async (faultPoint) => {
      const root = tempRoot();
      const dataDir = path.join(root, "data");
      const usesLegacyFixture = faultPoint !== "after_sequence_1_committed";
      let legacy:
        | {
            filePath: string;
            bytes: Buffer;
            graphHash: string;
          }
        | undefined;
      if (usesLegacyFixture) {
        const databasePath = createLegacyDatabase(dataDir, {
          revision: "valid"
        });
        const raw = new DatabaseSync(databasePath);
        const row = raw.prepare(`
          SELECT file_path, graph_hash FROM vdt_revisions
          WHERE id = 'legacy_revision'
        `).get() as Record<string, unknown>;
        raw.close();
        const filePath = path.join(dataDir, String(row.file_path));
        legacy = {
          filePath,
          bytes: fs.readFileSync(filePath),
          graphHash: String(row.graph_hash)
        };
      } else {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      const helper = fileURLToPath(
        new URL("./migration-crash-child.ts", import.meta.url)
      );
      await runCrashChild(
        helper,
        [root, dataDir, faultPoint],
        `migration crash child ${faultPoint}`
      );
      if (faultPoint === "after_admission_fence_acquired") {
        expect(
          fs.existsSync(path.join(dataDir, ".migration-admission.lock"))
        ).toBe(false);
        expect(
          fs.existsSync(path.join(dataDir, ".migration-admission.sqlite"))
        ).toBe(false);
      }

      const recovered = openBootstrapVdtDatabase(root, {
        dataDir,
        migrationLeaseMs: 0
      });
      const raw = new DatabaseSync(recovered.databasePath);
      expect(raw.prepare("PRAGMA user_version").get()).toEqual({
        user_version: 2
      });
      expect(computeSchemaHash(raw, 2)).toBe(ATOMIC_REVISION_SCHEMA_HASH);
      raw.close();
      if (legacy) {
        expect(fs.readFileSync(legacy.filePath)).toEqual(legacy.bytes);
        expect(
          createHash("sha256")
            .update(fs.readFileSync(legacy.filePath))
            .digest("hex")
        ).toBe(legacy.graphHash);
        expect(recovered.listVdtRevisions("legacy_vdt")).toEqual([
          expect.objectContaining({
            id: "legacy_revision",
            graphHash: legacy.graphHash
          })
        ]);
        expect(recovered.getVdtRevisionHead("legacy_vdt")).toMatchObject({
          activeRevisionId: "legacy_revision",
          activeContentIdentity: {
            scheme: "legacy_graph_sha256",
            hash: `sha256:${legacy.graphHash}`
          },
          pendingRevisionId: null,
          commitGeneration: 1
        });
      }
      recovered.close();
    },
    30_000
  );

  it("never takes over an unexpired bootstrap lease and advances only after expiry", () => {
    const root = tempRoot();
    const dataDir = path.join(root, "data");
    const firstTime = "2026-07-23T00:00:00.000Z";
    expect(() =>
      openBootstrapVdtDatabase(root, {
        dataDir,
        now: () => firstTime,
        migrationLeaseMs: 30_000,
        migrationFaultInjector(point) {
          if (point === "after_bootstrap_journal_fsynced") {
            throw new Error("crash-after-journal");
          }
        }
      })
    ).toThrow("crash-after-journal");
    try {
      openBootstrapVdtDatabase(root, {
        dataDir,
        now: () => "2026-07-23T00:00:29.999Z",
        migrationLeaseMs: 30_000
      });
      throw new Error("Expected active migration lease rejection.");
    } catch (error) {
      expect(error).toBeInstanceOf(VdtStorageError);
      expect((error as VdtStorageError).code).toBe("MIGRATION_IN_PROGRESS");
      expect((error as VdtStorageError).retryable).toBe(true);
    }
    const recovered = openBootstrapVdtDatabase(root, {
      dataDir,
      now: () => "2026-07-23T00:00:30.000Z",
      migrationLeaseMs: 30_000
    });
    const raw = new DatabaseSync(recovered.databasePath);
    expect(raw.prepare("PRAGMA user_version").get()).toEqual({ user_version: 2 });
    expect(
      raw.prepare(
        "SELECT MAX(lease_generation) AS generation FROM migration_attempts"
      ).get()
    ).toEqual({ generation: 2 });
    raw.close();
    recovered.close();
  });

  it.each(["deleted", "tampered"] as const)(
    "blocks before DDL when the journaled backup is %s",
    (mode) => {
      const root = tempRoot();
      const dataDir = path.join(root, "data");
      expect(() =>
        openBootstrapVdtDatabase(root, {
          dataDir,
          migrationFaultInjector(point) {
            if (point !== "after_bootstrap_journal_fsynced") return;
            const backupDir = path.join(dataDir, "migrations", "backups");
            const backupPath = path.join(backupDir, fs.readdirSync(backupDir)[0]!);
            if (mode === "deleted") fs.unlinkSync(backupPath);
            else fs.writeFileSync(backupPath, "tampered", "utf8");
          }
        })
      ).toThrow(/MIGRATION_BLOCKED.*backup/i);
      const raw = new DatabaseSync(path.join(dataDir, "app.sqlite"));
      expect(raw.prepare("PRAGMA user_version").get()).toEqual({ user_version: 0 });
      expect(
        raw.prepare(
          "SELECT COUNT(*) AS count FROM sqlite_schema WHERE name = 'applied_migrations'"
        ).get()
      ).toEqual({ count: 0 });
      raw.close();
    }
  );

  it("blocks ready-state restart after durable backup or applied-prefix tampering", () => {
    for (const mode of ["backup", "prefix"] as const) {
      const root = tempRoot();
      const dataDir = path.join(root, "data");
      const db = openBootstrapVdtDatabase(root, { dataDir });
      const databasePath = db.databasePath;
      if (mode === "backup") {
        const raw = new DatabaseSync(databasePath);
        const evidence = raw.prepare(
          "SELECT backup_relative_path FROM migration_backup_evidence"
        ).get() as Record<string, unknown>;
        raw.close();
        fs.appendFileSync(
          path.join(dataDir, String(evidence.backup_relative_path)),
          "tamper",
          "utf8"
        );
      } else {
        const raw = new DatabaseSync(databasePath);
        raw.prepare(
          "UPDATE applied_migrations SET sql_checksum = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' WHERE sequence = 1"
        ).run();
        raw.close();
      }
      db.close();
      expect(() => openBootstrapVdtDatabase(root, { dataDir })).toThrow(
        /MIGRATION_BLOCKED/
      );
    }
  });

  it("blocks ready-state restart with extra orphan backup evidence", () => {
    const root = tempRoot();
    const db = openBootstrapVdtDatabase(root);
    const databasePath = db.databasePath;
    db.close();
    const raw = new DatabaseSync(databasePath);
    const fakeHash =
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    raw.prepare(`
      INSERT INTO migration_backup_evidence
      (backup_evidence_id, schema_version, database_id, from_user_version,
       manifest_hash, source_database_hash, backup_hash, backup_relative_path,
       created_at)
      VALUES
      ('extra_backup', 'migration_backup_evidence.v1', 'foreign_database', 0,
       ?, ?, ?, 'migrations/backups/does-not-exist.sqlite', 1)
    `).run(STORAGE_MIGRATION_MANIFEST.manifestHash, fakeHash, fakeHash);
    raw.close();
    expect(() => openBootstrapVdtDatabase(root)).toThrow(/MIGRATION_BLOCKED/);
  });

  it("blocks schema drift, tampered legacy bytes, and orphan legacy rows before additive DDL", () => {
    for (const mode of ["drift", "tampered", "orphan"] as const) {
      const root = tempRoot();
      const dataDir = path.join(root, "data");
      const databasePath = createLegacyDatabase(dataDir, {
        revision: mode === "orphan" ? "orphan" : "valid"
      });
      if (mode === "drift") {
        const raw = new DatabaseSync(databasePath);
        raw.exec("CREATE TABLE unexpected_drift(id TEXT PRIMARY KEY);");
        raw.close();
      }
      if (mode === "tampered") {
        fs.appendFileSync(
          path.join(dataDir, "projects", "legacy_project", "vdts", "legacy_vdt", "revisions", "000001.vdt.json"),
          "tamper",
          "utf8"
        );
      }
      expect(() => openBootstrapVdtDatabase(root, { dataDir })).toThrow(
        /MIGRATION_BLOCKED/
      );
      const verify = new DatabaseSync(databasePath);
      expect(verify.prepare("PRAGMA user_version").get()).toEqual({ user_version: 1 });
      expect(
        verify.prepare(
          "SELECT COUNT(*) AS count FROM sqlite_schema WHERE name = 'applied_migrations'"
        ).get()
      ).toEqual({ count: 0 });
      verify.close();
    }
  });
});

function setupCommit(
  options: Parameters<typeof openVdtDatabase>[1] = {}
): { db: VdtDatabase; input: RevisionCommitInputV2 } {
  const root = tempRoot();
  const db = openVdtDatabase(root, { revisionLeaseMs: 0, ...options });
  return { db, input: prepareCommit(db) };
}

function prepareCommit(db: VdtDatabase): RevisionCommitInputV2 {
  db.createProject({ id: "project_atomic", name: "Atomic project" });
  db.createVdt({
    id: "vdt_atomic",
    projectId: "project_atomic",
    name: "Atomic VDT",
    rootKpi: "Production"
  });
  return {
    projectId: "project_atomic",
    vdtId: "vdt_atomic",
    actor: actor("project_atomic"),
    command: {
      schemaVersion: "revision_commit.v2",
      expectedActiveRevisionId: null,
      expectedActiveContentIdentity: null,
      expectedCommitGeneration: 0,
      expectedRuntimeGeneration: "v1",
      expectedGenerationVersion: 1,
      idempotencyKey: "commit_key",
      intent: {
        source: "user",
        summary: null,
        validation: null,
        calculation: null
      }
    },
    project: cleanProject()
  };
}

function actor(projectId: string): ActorContextV1 {
  return {
    schemaVersion: "actor_context.v1",
    principalId: "desktop_local_principal",
    projectId,
    roles: [],
    authSource: "desktop_local",
    sessionId: "desktop_session",
    issuedAt: "2026-07-23T00:00:00.000Z"
  };
}

function cleanProject(): VdtProject {
  return JSON.parse(JSON.stringify(productionVolumeProject)) as VdtProject;
}

function createLegacyDatabase(
  dataDir: string,
  options: { revision: "valid" | "orphan" }
): string {
  fs.mkdirSync(dataDir, { recursive: true });
  const databasePath = path.join(dataDir, "app.sqlite");
  const db = new DatabaseSync(databasePath);
  db.exec(LEGACY_SQL);
  db.exec("PRAGMA foreign_keys = OFF;");
  db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(1, ?)").run(1);
  db.exec("PRAGMA user_version = 1;");
  db.prepare(`
    INSERT INTO projects(id, name, created_at, updated_at)
    VALUES('legacy_project', 'Legacy', 1, 1)
  `).run();
  if (options.revision === "valid") {
    db.prepare(`
      INSERT INTO vdts
      (id, project_id, name, root_kpi, status, active_revision_id, created_at, updated_at)
      VALUES('legacy_vdt', 'legacy_project', 'Legacy VDT', 'Production', 'draft', 'legacy_revision', 1, 1)
    `).run();
  }
  const relativePath =
    options.revision === "valid"
      ? path.join(
          "projects",
          "legacy_project",
          "vdts",
          "legacy_vdt",
          "revisions",
          "000001.vdt.json"
        )
      : path.join("orphan", "000001.vdt.json");
  const absolutePath = path.join(dataDir, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  const payload = `${JSON.stringify(cleanProject(), null, 2)}\n`;
  fs.writeFileSync(absolutePath, payload, "utf8");
  const rawHash = createHash("sha256").update(payload).digest("hex");
  db.prepare(`
    INSERT INTO vdt_revisions
    (id, vdt_id, revision_no, source, file_path, graph_hash, created_at)
    VALUES('legacy_revision', ?, 1, 'user', ?, ?, 1)
  `).run(
    options.revision === "valid" ? "legacy_vdt" : "missing_vdt",
    relativePath,
    rawHash
  );
  db.close();
  return databasePath;
}

function expectStorageCode(
  fn: () => unknown,
  ...codes: string[]
): void {
  try {
    fn();
    throw new Error("Expected VdtStorageError.");
  } catch (error) {
    expect(error).toBeInstanceOf(VdtStorageError);
    expect(codes).toContain((error as VdtStorageError).code);
  }
}

function captureStorageError(fn: () => unknown): VdtStorageError {
  try {
    fn();
    throw new Error("Expected VdtStorageError.");
  } catch (error) {
    expect(error).toBeInstanceOf(VdtStorageError);
    return error as VdtStorageError;
  }
}

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vdt-corrective-"));
  tempDirs.push(root);
  return root;
}

function runConcurrencyChild(
  helper: string,
  dataDir: string,
  payloadPath: string,
  worker: number,
  count: number,
  startAt: number
): Promise<{ committed: number; conflicts: number; count: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        helper,
        dataDir,
        payloadPath,
        String(worker),
        String(count),
        String(startAt)
      ],
      {
        cwd: path.resolve(fileURLToPath(new URL("../../..", import.meta.url))),
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`Concurrency child ${worker} exited ${code}: ${stderr || stdout}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()) as {
          committed: number;
          conflicts: number;
          count: number;
        });
      } catch (error) {
        reject(
          new Error(
            `Concurrency child ${worker} returned invalid JSON: ${stdout}; ${String(error)}`
          )
        );
      }
    });
  });
}

function runRawChild(
  helper: string,
  args: string[],
  label: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", helper, ...args],
      {
        cwd: path.resolve(fileURLToPath(new URL("../../..", import.meta.url))),
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} exited ${code}: ${stderr}`));
    });
  });
}

function runCrashChild(
  helper: string,
  args: string[],
  label: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", helper, ...args],
      {
        cwd: path.resolve(fileURLToPath(new URL("../../..", import.meta.url))),
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === null && signal === "SIGKILL") {
        resolve();
        return;
      }
      reject(
        new Error(
          `${label} did not terminate via SIGKILL (code=${String(code)}, signal=${String(
            signal
          )}): ${stderr || stdout}`
        )
      );
    });
  });
}
