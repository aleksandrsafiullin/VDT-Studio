import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { productionVolumeProject } from "@vdt-studio/vdt-core";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";
import { __openWindowsVdtDatabaseForTests, admitPackagedWindowsStorage, openVdtDatabase, readProjectManifestFromDatabaseLocation } from "./sqlite";
import { openWindowsStorage } from "./windows-storage";
import { scanProjectLocation } from "./project-files";

function observedOpen(workspace: string, dataDir: string, label: string) {
  const started = performance.now();
  const database = __openWindowsVdtDatabaseForTests(workspace, { dataDir }, runtime!);
  console.log(JSON.stringify({ storageOpen: label, elapsedMs: Math.round(performance.now() - started) }));
  return database;
}

const runtime = process.env.VDT_WINDOWS_DATA_TEST_RUNTIME;
const parent = process.env.VDT_WINDOWS_DATA_TEST_PRIVATE_PARENT;

test.runIf(process.platform === "win32" && Boolean(runtime && parent))(
  "opens, migrates, writes and reopens a standard-user NTFS storage profile while production admission stays guarded",
  () => {
    const workspace = fs.mkdtempSync(path.join(parent!, "core-storage-"));
    const profile = path.join(workspace, "profile");
    try {
      expect(() => openVdtDatabase(workspace, { dataDir: profile })).toThrow(/reviewed Windows/);
      expect(fs.existsSync(profile)).toBe(false);
      const first = observedOpen(workspace, profile, "fresh");
      try {
        first.createProject({ id: "native", name: "Native storage" });
        first.createVdt({ id: "tree", projectId: "native", name: "Tree", rootKpi: "Production" });
        first.saveVdtRevision({
          id: "revision_native", projectId: "native", vdtId: "tree", revisionNo: 1,
          source: "user", project: productionVolumeProject
        });
        const create = {
          actor: {
            schemaVersion: "actor_context.v1" as const, principalId: "desktop_native_test",
            projectId: "native", roles: ["vdt_writer"], authSource: "desktop_local" as const,
            sessionId: "native_test", issuedAt: "2026-11-13T00:00:00.000Z"
          },
          command: {
            schemaVersion: "create_vdt_with_initial_snapshot.v1" as const, projectId: "native",
            expectedRuntimeGeneration: "v1" as const, expectedGenerationVersion: 1,
            idempotencyKey: "native-initial",
            vdt: { requestedVdtId: "atomic_tree", name: "Atomic tree", rootKpi: "Production",
              unit: null, timePeriod: null, status: "draft" as const, metadata: null },
            revisionIntent: { source: "user" as const, summary: null, validation: null, calculation: null }
          },
          project: productionVolumeProject
        };
        const initial = first.createVdtWithInitialSnapshot(create);
        expect(first.createVdtWithInitialSnapshot(create)).toEqual(initial);
        expect(first.readVdtRevision(initial.revision)).toEqual(productionVolumeProject);
        const second = observedOpen(workspace, profile, "concurrent");
        try { expect(second.getProject("native")?.name).toBe("Native storage"); }
        finally { second.close(); }
      } finally { first.close(); }
      const reopened = observedOpen(workspace, profile, "reopen");
      try {
        expect(reopened.getVdt("tree")?.activeRevisionId).toBe("revision_native");
        expect(reopened.readVdtRevision(reopened.getVdtRevision("revision_native")!)).toEqual(productionVolumeProject);
        expect(reopened.getVdt("atomic_tree")).not.toBeNull();
        expect(readProjectManifestFromDatabaseLocation(profile, "native").name).toBe("Native storage");
        expect(scanProjectLocation(profile)).toHaveLength(1);
        expect(reopened.deleteVdt("atomic_tree")).toBe(true);
        expect(reopened.deleteProject("native")).toBe(true);
      } finally { reopened.close(); }
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  }, 60_000
);


async function pauseAtFault(workspace: string, profile: string, fault: string): Promise<() => Promise<void>> {
  const ready = path.join(workspace, "fault-ready");
  const child = spawn(process.execPath, [
    "--import", "tsx", fileURLToPath(new URL("./windows-storage-crash-child.ts", import.meta.url)),
    runtime!, profile, fault, ready
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  const exit = once(child, "exit");
  const terminate = async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exit;
  };
  try {
    const deadline = Date.now() + 30_000;
    while (!fs.existsSync(ready)) {
      if (child.exitCode !== null || child.signalCode !== null || Date.now() > deadline) {
        throw new Error(`Child did not reach ${fault}: ${stderr}`);
      }
      await delay(20);
    }
    expect(fs.readFileSync(ready, "utf8")).toBe(fault);
    return terminate;
  } catch (error) {
    await terminate();
    throw error;
  }
}

async function terminateAtFault(workspace: string, profile: string, fault: string): Promise<void> {
  const terminate = await pauseAtFault(workspace, profile, fault);
  await terminate();
}

test.runIf(process.platform === "win32" && Boolean(runtime && parent)).each([
  "after_attempt_reserved", "after_stage_fsynced", "after_head_reserved", "after_final_published", "before_finalize"
])("recovers atomic revision after Windows process termination at %s", async (fault) => {
  const workspace = fs.mkdtempSync(path.join(parent!, "revision-crash-"));
  const profile = path.join(workspace, "profile");
  try {
    const first = __openWindowsVdtDatabaseForTests(workspace, { dataDir: profile, revisionLeaseMs: 0 }, runtime!);
    try {
      first.createProject({ id: "native", name: "Native storage" });
      first.createVdt({ id: "tree", projectId: "native", name: "Tree", rootKpi: "Production" });
      first.saveVdtRevision({
        id: "revision_native", projectId: "native", vdtId: "tree", revisionNo: 1,
        source: "user", project: productionVolumeProject
      });
    } finally { first.close(); }
    await terminateAtFault(workspace, profile, fault);
    const reopened = __openWindowsVdtDatabaseForTests(workspace, { dataDir: profile, revisionLeaseMs: 0 }, runtime!);
    try {
      expect(reopened.listVdtRevisions("tree")).toHaveLength(2);
      expect(reopened.getVdtRevisionHead("tree")).toMatchObject({ pendingRevisionId: null, commitGeneration: 2 });
      expect(reopened.readVdtRevision(reopened.getVdtRevision("revision_native")!)).toEqual(productionVolumeProject);
    } finally { reopened.close(); }
  } finally { fs.rmSync(workspace, { recursive: true, force: true }); }
}, 60_000);

test.runIf(process.platform === "win32" && Boolean(runtime && parent)).each([
  ["sequence3_before_foreign_key_pending_create", "recover"],
  ["sequence3_before_foreign_key_pending_file_fsync", "block"],
  ["sequence3_before_foreign_key_pending_directory_fsync", "block"],
  ["sequence3_before_foreign_key_check", "block"],
  ["sequence3_before_foreign_key_pending_unlink", "block"],
  ["sequence3_before_foreign_key_pending_unlink_directory_fsync", "recover"],
  ["sequence3_after_foreign_key_pending_unlink_directory_fsynced", "recover"],
  ["sequence3_before_post_commit_cleanup", "recover"],
  ["sequence3_after_post_commit_cleanup", "recover"]
] as const)("preserves migration state after Windows process termination at %s", async (fault, outcome) => {
  const workspace = fs.mkdtempSync(path.join(parent!, "migration-crash-"));
  const profile = path.join(workspace, "profile");
  try {
    await terminateAtFault(workspace, profile, fault);
    if (outcome === "block") {
      expect(() => __openWindowsVdtDatabaseForTests(workspace, { dataDir: profile, migrationLeaseMs: 0, now: () => "2026-11-13T00:00:01.000Z" }, runtime!))
        .toThrow(expect.objectContaining({ code: "MIGRATION_RECOVERY_REQUIRED" }));
      const db = new DatabaseSync(path.join(profile, "app.sqlite"), { readOnly: true });
      try { expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 2 }); }
      finally { db.close(); }
    } else {
      const reopened = __openWindowsVdtDatabaseForTests(workspace, { dataDir: profile, migrationLeaseMs: 0, now: () => "2026-11-13T00:00:01.000Z" }, runtime!);
      try {
        const db = new DatabaseSync(reopened.databasePath, { readOnly: true });
        try { expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 5 }); }
        finally { db.close(); }
      } finally { reopened.close(); }
    }
  } finally { fs.rmSync(workspace, { recursive: true, force: true }); }
}, 60_000);

test.runIf(process.platform === "win32" && Boolean(runtime && parent))(
  "rejects unsafe pre-existing SQLite leaves and ancestor junctions without changing their targets",
  () => {
    const workspace = fs.mkdtempSync(path.join(parent!, "storage-reject-"));
    const profile = path.join(workspace, "profile");
    try {
      const db = __openWindowsVdtDatabaseForTests(workspace, { dataDir: profile }, runtime!);
      db.close();
      const sqlite = path.join(profile, "app.sqlite");
      const before = fs.readFileSync(sqlite);
      for (const name of ["app.sqlite-wal", "app.sqlite-shm", "app.sqlite-journal"]) {
        const artifact = path.join(profile, name);
        fs.linkSync(sqlite, artifact);
        try {
          expect(() => __openWindowsVdtDatabaseForTests(workspace, { dataDir: profile }, runtime!))
            .toThrow(expect.objectContaining({ code: "EACCES" }));
          expect(fs.readFileSync(sqlite)).toEqual(before);
        } finally { fs.unlinkSync(artifact); }
      }
      const junction = path.join(workspace, "alias");
      fs.symlinkSync(workspace, junction, "junction");
      try {
        expect(() => __openWindowsVdtDatabaseForTests(workspace, { dataDir: path.join(junction, "profile") }, runtime!))
          .toThrow();
        expect(fs.readFileSync(sqlite)).toEqual(before);
      } finally { fs.unlinkSync(junction); }
    } finally { fs.rmSync(workspace, { recursive: true, force: true }); }
  }, 60_000
);

test.runIf(process.platform === "win32" && Boolean(runtime && parent)).each([
  "after_foreign_key_violation_rollback",
  "after_foreign_key_evidence_created",
  "after_foreign_key_evidence_file_fsynced",
  "after_foreign_key_evidence_fsynced",
  "before_foreign_key_block_commit",
  "after_foreign_key_block_committed"
])("preserves foreign-key failure evidence after Windows process termination at %s", async (fault) => {
  const workspace = fs.mkdtempSync(path.join(parent!, "foreign-key-crash-"));
  const profile = path.join(workspace, "profile");
  try {
    await terminateAtFault(workspace, profile, `invalid:${fault}`);
    expect(() => __openWindowsVdtDatabaseForTests(workspace, { dataDir: profile, migrationLeaseMs: 0, now: () => "2026-11-13T00:00:01.000Z" }, runtime!))
      .toThrow(expect.objectContaining({ code: "MIGRATION_RECOVERY_REQUIRED" }));
    const db = new DatabaseSync(path.join(profile, "app.sqlite"), { readOnly: true });
    try {
      expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 2 });
      expect(db.prepare("SELECT name FROM sqlite_schema WHERE name = 'migration_fk_child'").get()).toBeUndefined();
    } finally { db.close(); }
  } finally { fs.rmSync(workspace, { recursive: true, force: true }); }
}, 60_000);

test.runIf(process.platform === "win32" && Boolean(runtime && parent))(
  "fences a concurrent migration and recovers the admitted profile after owner termination",
  async () => {
    const workspace = fs.mkdtempSync(path.join(parent!, "migration-contention-"));
    const profile = path.join(workspace, "profile");
    try {
      const terminate = await pauseAtFault(workspace, profile, "after_admission_fence_acquired");
      try {
        expect(() => __openWindowsVdtDatabaseForTests(workspace, { dataDir: profile, busyTimeoutMs: 100 }, runtime!))
          .toThrow(expect.objectContaining({ code: "MIGRATION_IN_PROGRESS", retryable: true }));
      } finally { await terminate(); }
      const recovered = __openWindowsVdtDatabaseForTests(workspace, { dataDir: profile, migrationLeaseMs: 0, now: () => "2026-11-13T00:00:01.000Z" }, runtime!);
      try { expect(recovered.listProjects()).toEqual([]); }
      finally { recovered.close(); }
    } finally { fs.rmSync(workspace, { recursive: true, force: true }); }
  }, 60_000
);

test.runIf(process.platform === "win32" && Boolean(runtime && parent))(
  "adopts frozen legacy v1 schema and preserves its project rows",
  () => {
    const workspace = fs.mkdtempSync(path.join(parent!, "legacy-storage-"));
    const profile = path.join(workspace, "profile");
    try {
      const capability = openWindowsStorage(runtime!, profile, true);
      try {
        const legacy = new DatabaseSync(capability.sqlitePath());
        try {
          legacy.exec(fs.readFileSync(new URL("./migrations/001-legacy-v1-bootstrap.sql", import.meta.url), "utf8"));
          legacy.exec("INSERT INTO schema_migrations(version, applied_at) VALUES (1, 1); PRAGMA user_version=1;");
          legacy.exec(`INSERT INTO projects (id,name,created_at,updated_at) VALUES ('legacy','Legacy project',1,1);`);
        } finally { legacy.close(); }
      } finally { capability.close(); }
      const database = observedOpen(workspace, profile, "legacy-v1-adoption");
      try { expect(database.getProject("legacy")?.name).toBe("Legacy project"); }
      finally { database.close(); }
    } finally { fs.rmSync(workspace, { recursive: true, force: true }); }
  }, 60_000
);

test.runIf(process.platform === "win32" && Boolean(runtime && parent))(
  "admits only a verified packaged profile and rejects environment-only and tampered runtime requests",
  () => {
    const workspace = fs.mkdtempSync(path.join(parent!, "packaged-storage-"));
    const profile = path.join(workspace, "profile");
    const otherProfile = path.join(workspace, "other");
    const runtimeCopy = runtime!;
    const oldRuntime = process.env.VDT_WINDOWS_STORAGE_RUNTIME_DIR;
    const oldMode = process.env.VDT_APP_MODE;
    try {
      const filename = "windows-storage.node";
      const addon = path.join(runtimeCopy, filename);
      const sha256 = createHash("sha256").update(fs.readFileSync(addon)).digest("hex");
      const manifestPath = path.join(runtimeCopy, "windows-storage.manifest.json");
      const manifest = { schemaVersion: 1, fileName: filename, architecture: "x64", nodeApiVersion: 8,
        nodeVersion: process.versions.node, sha256 };
      fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, sha256: "0".repeat(64) }));
      process.env.VDT_WINDOWS_STORAGE_RUNTIME_DIR = runtimeCopy;
      process.env.VDT_APP_MODE = "desktop";
      expect(() => openVdtDatabase(workspace, { dataDir: profile })).toThrow(/reviewed Windows/);
      expect(() => admitPackagedWindowsStorage(runtimeCopy, profile)).toThrow(/resource verification failed/);
      expect(fs.existsSync(profile)).toBe(false);
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));
      const admission = admitPackagedWindowsStorage(runtimeCopy, profile);
      try {
        const database = openVdtDatabase(workspace, { dataDir: profile });
        try { expect(database.listProjects()).toEqual([]); }
        finally { database.close(); }
        expect(() => openVdtDatabase(workspace, { dataDir: otherProfile })).toThrow(/reviewed Windows/);
        expect(fs.existsSync(otherProfile)).toBe(false);
      } finally { admission.close(); }
      expect(() => openVdtDatabase(workspace, { dataDir: profile })).toThrow(/reviewed Windows/);
    } finally {
      if (oldRuntime === undefined) delete process.env.VDT_WINDOWS_STORAGE_RUNTIME_DIR;
      else process.env.VDT_WINDOWS_STORAGE_RUNTIME_DIR = oldRuntime;
      if (oldMode === undefined) delete process.env.VDT_APP_MODE;
      else process.env.VDT_APP_MODE = oldMode;
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  }, 60_000
);
