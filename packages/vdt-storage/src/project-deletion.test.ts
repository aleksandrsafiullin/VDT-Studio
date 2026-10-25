import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { productionVolumeProject } from "@vdt-studio/vdt-core";
import { openVdtDatabase, SqliteVdtDatabase } from "./sqlite";
import {
  __runBootstrapStorageMigrationsForTests,
  __runSequence4StorageMigrationsForTests,
  computeSchemaHash,
  runStorageMigrations
} from "./migrations";
import { insertProjectDeletionSession } from "./project-deletion-test-fixtures";
import { SEQUENCE_5_MANIFEST_HASH, SEQUENCE_5_SCHEMA_HASH } from "./sequence-5-assets";
import type { VdtDatabase } from "./types";

const roots: string[] = [];
const NOW = "2026-10-25T10:00:00.000Z";
const migrationOptions = { now: () => NOW, busyTimeoutMs: 5_000, leaseMs: 1_000 };

afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("project deletion with durable AI history", () => {
  it("deletes the whole project and its project-level sessions, preserves other projects, and reopens", () => {
    const { root, dataDir } = fixture();
    let db = openVdtDatabase(root, { dataDir, now: () => NOW });
    try {
      seedProject(db, "delete");
      seedProject(db, "keep");
      const sql = new DatabaseSync(db.databasePath);
      try {
        sql.exec("PRAGMA foreign_keys = ON;");
        insertProjectDeletionSession(sql, "run_delete", "project_delete");
        insertProjectDeletionSession(sql, "run_keep", "project_keep");
        db.createAgentRun({ id: "run_without_vdt", projectId: "project_delete", status: "failed", phase: "reporting", request: {} });
        insertProjectDeletionSession(sql, "run_without_vdt", "project_delete");
        const retained = sql.prepare("SELECT * FROM agent_run_event_outbox_v2 WHERE run_id = 'run_keep'").all();
        expect(db.deleteProject("project_delete")).toBe(true);
        expect(db.getProject("project_delete")).toBeNull();
        expect(db.getVdt("vdt_delete")).toBeNull();
        expect(db.listVdtRevisions("vdt_delete")).toEqual([]);
        expect(db.getConversation("conversation_delete")).toBeNull();
        expect(db.listMessages("conversation_delete")).toEqual([]);
        expect(db.listAgentRuns("project_delete")).toEqual([]);
        expect(db.listAgentEvents("run_delete")).toEqual([]);
        for (const table of ["agent_session_bindings_v2", "agent_session_epochs_v2", "agent_run_event_outbox_v2"]) {
          expect(sql.prepare(`SELECT DISTINCT run_id FROM ${table}`).all()).toEqual([{ run_id: "run_keep" }]);
        }
        expect(sql.prepare("SELECT * FROM agent_run_event_outbox_v2 WHERE run_id = 'run_keep'").all()).toEqual(retained);
        expect(sql.prepare("SELECT * FROM project_deletion_runs_v1").all()).toEqual([]);
        expect(sql.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
        expect(fs.existsSync(path.join(dataDir, "projects", "project_delete"))).toBe(false);
        expect(fs.existsSync(path.join(dataDir, "projects", "project_keep", "vdts", "vdt_keep"))).toBe(true);
        expect(db.readVdtRevision(db.listVdtRevisions("vdt_keep")[0]!)).toMatchObject({ id: productionVolumeProject.id });
        expect(db.deleteProject("project_delete")).toBe(false);
      } finally { sql.close(); }
      db.close();
      db = openVdtDatabase(root, { dataDir });
      expect(db.listProjects().map((project) => project.id)).toEqual(["project_keep"]);
      expect(db.getAgentRun("run_keep")).not.toBeNull();
      // Reusing an explicitly deleted project ID must not inherit a purge scope.
      db.createProject({ id: "project_delete", name: "New project" });
      expect(db.getProject("project_delete")?.name).toBe("New project");
    } finally { db.close(); }
  });

  it("rolls back all rows and purge scopes on a late failure, retaining revision files", () => {
    const { root, dataDir } = fixture();
    const db = openVdtDatabase(root, { dataDir, now: () => NOW });
    const sql = new DatabaseSync(db.databasePath);
    try {
      seedProject(db, "delete");
      insertProjectDeletionSession(sql, "run_delete", "project_delete");
      const before = snapshot(sql);
      sql.exec(`CREATE TRIGGER test_delete_failure BEFORE DELETE ON projects BEGIN SELECT RAISE(ABORT, 'injected_delete_failure'); END;`);
      expect(() => db.deleteProject("project_delete")).toThrow(/injected_delete_failure/);
      expect(snapshot(sql)).toEqual(before);
      expect(sql.prepare("SELECT * FROM project_deletion_runs_v1").all()).toEqual([]);
      expect(db.readVdtRevision(db.listVdtRevisions("vdt_delete")[0]!)).toMatchObject({ id: productionVolumeProject.id });
      sql.exec("DROP TRIGGER test_delete_failure;");
      expect(db.deleteProject("project_delete")).toBe(true);
    } finally { sql.close(); db.close(); }
  });

  it("continues to reject ordinary audit deletes and a scope for another project's run", () => {
    const { root, dataDir } = fixture();
    const db = openVdtDatabase(root, { dataDir });
    const sql = new DatabaseSync(db.databasePath);
    try {
      seedProject(db, "keep");
      db.createProject({ id: "project_other", name: "Other" });
      insertProjectDeletionSession(sql, "run_keep", "project_keep");
      expect(() => sql.prepare("DELETE FROM agent_run_event_outbox_v2 WHERE run_id = ?").run("run_keep")).toThrow(/append_only/);
      expect(() => sql.prepare("DELETE FROM agent_session_bindings_v2 WHERE run_id = ?").run("run_keep")).toThrow(/append_only/);
      expect(() => sql.prepare("INSERT INTO project_deletion_runs_v1 VALUES (?, ?)").run("run_keep", "project_other")).toThrow(/owner_mismatch/);
      expect(sql.prepare("SELECT * FROM project_deletion_runs_v1").all()).toEqual([]);
    } finally { sql.close(); db.close(); }
  });

  it("still enforces foreign keys at COMMIT and restores the project if a reference survives", () => {
    const { root, dataDir } = fixture();
    const db = openVdtDatabase(root, { dataDir, now: () => NOW });
    const sql = new DatabaseSync(db.databasePath);
    try {
      seedProject(db, "delete");
      insertProjectDeletionSession(sql, "run_delete", "project_delete");
      sql.exec(`
        CREATE TABLE test_retained_reference (project_id TEXT REFERENCES projects(id) ON DELETE RESTRICT);
        INSERT INTO test_retained_reference VALUES ('project_delete');
      `);
      const before = snapshot(sql);
      expect(() => db.deleteProject("project_delete")).toThrow(/FOREIGN KEY/);
      expect(snapshot(sql)).toEqual(before);
      expect(fs.existsSync(path.join(dataDir, "projects", "project_delete"))).toBe(true);
      sql.exec("DROP TABLE test_retained_reference;");
      expect(db.deleteProject("project_delete")).toBe(true);
    } finally { sql.close(); db.close(); }
  });

  it("preserves the original migration result hash when deleting adopted legacy runs", () => {
    const { root, dataDir, databasePath } = fixture();
    const bootstrap = new DatabaseSync(databasePath);
    __runBootstrapStorageMigrationsForTests(bootstrap, dataDir, migrationOptions);
    const legacy = new SqliteVdtDatabase(bootstrap, dataDir, databasePath, { now: () => NOW });
    try {
      for (const suffix of ["delete", "keep"]) {
        legacy.createProject({ id: `project_${suffix}`, name: suffix });
        legacy.createAgentRun({ id: `run_${suffix}`, projectId: `project_${suffix}`, status: "succeeded", phase: "reporting", request: { privateRequest: suffix }, completedAt: NOW });
      }
    } finally { legacy.close(); }
    let db = openVdtDatabase(root, { dataDir, now: () => NOW });
    try {
      const sql = new DatabaseSync(databasePath);
      try {
        const original = sql.prepare("SELECT * FROM migration_transform_applications_v1").all();
        expect(sql.prepare("SELECT COUNT(*) AS count FROM legacy_agent_run_adoptions_v1").get()).toEqual({ count: 2 });
        expect(() => sql.exec("DELETE FROM legacy_agent_run_adoptions_v1")).toThrow(/immutable/);
        expect(db.deleteProject("project_delete")).toBe(true);
        expect(sql.prepare("SELECT * FROM migration_transform_applications_v1").all()).toEqual(original);
        expect(sql.prepare("SELECT run_id FROM project_deleted_legacy_adoptions_v1").all()).toEqual([{ run_id: "run_delete" }]);
        expect(sql.prepare("SELECT run_id FROM legacy_agent_run_adoptions_v1").all()).toEqual([{ run_id: "run_keep" }]);
        expect(() => sql.exec("DELETE FROM project_deleted_legacy_adoptions_v1")).toThrow(/immutable/);
        expect(sql.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      } finally { sql.close(); }
      db.close();
      db = openVdtDatabase(root, { dataDir });
      expect(db.getAgentRun("run_delete")).toBeNull();
      expect(db.getAgentRun("run_keep")).not.toBeNull();
      expect(db.deleteProject("project_keep")).toBe(true);
      db.close();
      db = openVdtDatabase(root, { dataDir });
      expect(db.listProjects()).toEqual([]);
    } finally { db.close(); }
  });
});

describe("Sequence 5 project deletion migration", () => {
  it("extends the exact Sequence 4 boundary and reopens without another backup or attempt", () => {
    const { dataDir, databasePath } = fixture();
    const sql = new DatabaseSync(databasePath);
    try {
      __runSequence4StorageMigrationsForTests(sql, dataDir, migrationOptions);
      const prefix = sql.prepare("SELECT * FROM applied_migrations ORDER BY sequence").all();
      runStorageMigrations(sql, dataDir, migrationOptions);
      expect(sql.prepare("PRAGMA user_version").get()).toEqual({ user_version: 5 });
      expect(computeSchemaHash(sql, 5)).toBe(SEQUENCE_5_SCHEMA_HASH);
      expect(sql.prepare("SELECT * FROM applied_migrations WHERE sequence < 5 ORDER BY sequence").all()).toEqual(prefix);
      expect(sql.prepare("SELECT manifest_hash FROM applied_migrations WHERE sequence = 5").get()).toEqual({ manifest_hash: SEQUENCE_5_MANIFEST_HASH });
      const before = snapshot(sql);
      runStorageMigrations(sql, dataDir, migrationOptions);
      expect(snapshot(sql)).toEqual(before);
    } finally { sql.close(); }
  });

  it("recovers its fenced migration attempt after an interruption before commit", () => {
    const { dataDir, databasePath } = fixture();
    const sql = new DatabaseSync(databasePath);
    try {
      __runSequence4StorageMigrationsForTests(sql, dataDir, migrationOptions);
      expect(() => runStorageMigrations(sql, dataDir, {
        ...migrationOptions,
        faultInjector(point, context) {
          if (point === "before_later_migration_commit" && context?.sequence === 5) throw new Error("injected_sequence5_interruption");
        }
      })).toThrow();
      expect(sql.prepare("PRAGMA user_version").get()).toEqual({ user_version: 4 });
      const attempt = sql.prepare("SELECT attempt_id FROM migration_attempts WHERE target_manifest_hash = ?").get(SEQUENCE_5_MANIFEST_HASH);
      runStorageMigrations(sql, dataDir, { ...migrationOptions, now: () => "2026-10-25T10:00:02.000Z" });
      expect(sql.prepare("SELECT attempt_id, status FROM migration_attempts WHERE target_manifest_hash = ?").get(SEQUENCE_5_MANIFEST_HASH)).toEqual({ ...attempt, status: "completed" });
      expect(sql.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { sql.close(); }
  });
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vdt-project-deletion-test-"));
  roots.push(root);
  const dataDir = path.join(root, "data");
  fs.mkdirSync(dataDir);
  return { root, dataDir, databasePath: path.join(dataDir, "app.sqlite") };
}

function seedProject(db: VdtDatabase, suffix: string): void {
  const projectId = `project_${suffix}`;
  const vdtId = `vdt_${suffix}`;
  db.createProject({ id: projectId, name: suffix });
  db.createVdt({ id: vdtId, projectId, name: suffix, rootKpi: "Production Volume" });
  db.saveVdtRevision({ id: `revision_${suffix}`, projectId, vdtId, revisionNo: 1, source: "user", project: structuredClone(productionVolumeProject) });
  db.createConversation({ id: `conversation_${suffix}`, projectId, vdtId });
  db.appendMessage({ id: `message_${suffix}`, conversationId: `conversation_${suffix}`, role: "user", content: "Build a VDT" });
  db.createAgentRun({ id: `run_${suffix}`, projectId, vdtId, conversationId: `conversation_${suffix}`, status: "succeeded", phase: "reporting", request: {}, completedAt: NOW });
  db.appendAgentEvent({ runId: `run_${suffix}`, seq: 1, type: "classification", phase: "classifying_request", title: "Classified", message: "Classified" });
}

function snapshot(sql: DatabaseSync) {
  const tables = sql.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>;
  return Object.fromEntries(tables.map(({ name }) => [name, sql.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()]));
}
