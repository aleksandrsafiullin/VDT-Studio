import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { LocalSkillFiles } from "./skill-files";
import { windowsSkillPathParts, withWindowsSkillDirectory } from "./windows-skill-files";
import type { WindowsStorageDirectory } from "./windows-storage";

/** Local V1 library. Immutable, atomically published records; no V2 migrations. */
export interface StoredSkillVersion {
  schemaVersion: "local_skill_version.v1";
  id: string;
  version: number;
  raw: string;
  contentHash: string;
  createdAt: string;
  /** Hash of the externally editable working file last admitted by the host.
   * Its frontmatter version may lag the immutable host version. */
  fileHash?: string;
  lineage?: { skillId: string; version: number; contentHash: string };
  sourceVdt?: { projectId: string; vdtId: string; rootKpi: string };
}

export interface StoredSkillSelection {
  schemaVersion: "local_skill_selection.v1";
  revision: number;
  skillId: string;
  version: number;
  contentHash: string;
  source: "auto" | "user" | "agent";
  reason: string;
  rootKpi: string;
  updatedAt: string;
}

export class SkillLibraryError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "SkillLibraryError"; }
}

export const skillContentHash = (raw: string) => `sha256:${createHash("sha256").update(raw, "utf8").digest("hex")}`;

/** The same data root is used by the web host, CLI and skill tools. */
export function localSkillDataDir(): string {
  return process.env.VDT_DATA_DIR ?? (process.env.NODE_ENV === "test"
    ? path.join(os.tmpdir(), "vdt-studio-storage-test", process.cwd().replace(/[^A-Za-z0-9_-]+/g, "_").slice(-80) || "workspace", String(process.pid))
    : path.join(process.cwd(), ".vdt"));
}

const safeSegment = (id: string) => {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,159}$/.test(id) || id.includes("..")) throw new SkillLibraryError("INVALID_SKILL_ID", "Invalid skill or VDT identifier.");
  return id;
};

export class LocalSkillRepository {
  private readonly root: string;
  private readonly dataDir: string;
  private readonly ownedWriteLocks = new Set<string>();
  readonly files: LocalSkillFiles;
  constructor(dataDir = localSkillDataDir()) {
    this.dataDir = path.resolve(dataDir);
    this.root = path.join(this.dataDir, "skill-library-v1");
    this.files = new LocalSkillFiles(path.resolve(dataDir, "skills"), () => {
      this.directory();
      this.migrateWorkingDirectory();
    });
  }

  get filesInitialized(): boolean { return this.hasMarker(this.directory(), ".files-initialized"); }
  initializeFiles(): void {
    const directory = this.directory();
    if (process.platform === "win32") {
      this.writeWindowsMarker(directory, ".files-initialized", "1\n");
      return;
    }
    try { fs.writeFileSync(path.join(directory, ".files-initialized"), "1\n", { flag: "wx", mode: 0o600 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  }

  hasSeed(id: string): boolean { return this.hasMarker(this.directory("seeded"), `${safeSegment(id)}.json`); }

  /** Install the shipped version verbatim so previously pinned hashes remain
   * readable. Seed markers prevent reinstating files the owner later removes. */
  installSeed(input: { id: string; version: number; raw: string }): void {
    safeSegment(input.id);
    if (!Number.isSafeInteger(input.version) || input.version < 1 || input.version > 999_999_999) throw new SkillLibraryError("INVALID_VERSION", "Invalid supplied skill version.");
    this.withSkillWriteLock(input.id, () => {
      if (!this.get(input.id, input.version)) {
        this.publishRecord(this.directory("skills", input.id), input.version, {
          schemaVersion: "local_skill_version.v1", ...input, createdAt: new Date().toISOString(),
          contentHash: skillContentHash(input.raw), fileHash: skillContentHash(input.raw)
        } satisfies StoredSkillVersion);
      }
    });
  }

  markSeed(id: string): void {
    const dir = this.directory("seeded"), name = `${safeSegment(id)}.json`;
    if (process.platform === "win32") {
      this.writeWindowsMarker(dir, name, JSON.stringify({ id }));
      return;
    }
    try { fs.writeFileSync(path.join(dir, name), JSON.stringify({ id }), { flag: "wx", mode: 0o600 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  }

  list(): StoredSkillVersion[] {
    const root = this.directory("skills");
    const names = process.platform === "win32"
      ? this.withWindowsDirectory(root, directory => directory.list()
          .filter(entry => entry.directory && !entry.reparse).map(entry => entry.name))
      : fs.readdirSync(root, { withFileTypes: true })
          .filter(entry => entry.isDirectory() && !entry.isSymbolicLink()).map(entry => entry.name);
    return names.map(name => this.get(name)).filter((entry): entry is StoredSkillVersion => entry !== null);
  }

  get(id: string, version?: number): StoredSkillVersion | null {
    const dir = this.directory("skills", safeSegment(id));
    const resolved = version ?? this.latest(dir);
    if (!resolved) return null;
    const record = this.read<StoredSkillVersion>(dir, resolved);
    if (!record) return null;
    if (record.schemaVersion !== "local_skill_version.v1" || record.id !== id || record.version !== resolved
      || typeof record.raw !== "string" || record.contentHash !== skillContentHash(record.raw)) throw new SkillLibraryError("SKILL_CORRUPT", "Stored skill integrity check failed.");
    return record;
  }

  publish(input: { id: string; raw: string; expectedVersion: number; fileHash?: string; lineage?: StoredSkillVersion["lineage"]; sourceVdt?: StoredSkillVersion["sourceVdt"] }): StoredSkillVersion {
    safeSegment(input.id);
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) throw new SkillLibraryError("INVALID_VERSION", "Invalid expected skill version.");
    if (Buffer.byteLength(input.raw, "utf8") > 128 * 1024) throw new SkillLibraryError("SKILL_TOO_LARGE", "Skill must be at most 128 KiB.");
    return this.withSkillWriteLock(input.id, () => {
      const dir = this.directory("skills", input.id);
      if (this.latest(dir) !== input.expectedVersion) throw new SkillLibraryError("SKILL_CONFLICT", "This skill changed. Reopen the latest version before saving.");
      const record: StoredSkillVersion = {
        schemaVersion: "local_skill_version.v1", id: input.id, version: input.expectedVersion + 1,
        raw: input.raw, contentHash: skillContentHash(input.raw), createdAt: new Date().toISOString(),
        ...(input.fileHash ? { fileHash: input.fileHash } : {}),
        ...(input.lineage ? { lineage: input.lineage } : {}), ...(input.sourceVdt ? { sourceVdt: input.sourceVdt } : {})
      };
      this.publishRecord(dir, record.version, record);
      return record;
    });
  }

  /** Fail-fast local V1 coordination between cooperating publishers. A managed
   * save holds this through its working-file swap and history publication, so
   * another host cannot synchronize intermediate bytes as an external edit.
   * This is not a crash-atomic transaction or process-loss recovery protocol. */
  withSkillWriteLock<T>(id: string, operation: () => T): T {
    safeSegment(id);
    return this.withWriteLock(this.directory("skills", id), `skill:${id}`, operation);
  }

  withSelectionWriteLock<T>(projectId: string, vdtId: string, operation: () => T): T {
    return this.withWriteLock(this.directory("selections", safeSegment(projectId), safeSegment(vdtId)), `selection:${projectId}/${vdtId}`, operation);
  }

  private withWriteLock<T>(directory: string, key: string, operation: () => T): T {
    if (this.ownedWriteLocks.has(key)) return operation();
    if (process.platform === "win32") {
      return this.withWindowsDirectory(directory, native => {
        let lock;
        try { lock = native.acquireLock(".write-lock"); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EBUSY") {
            throw new SkillLibraryError("SKILL_CONFLICT", "Another process is updating this skill. Retry after it finishes.");
          }
          throw error;
        }
        this.ownedWriteLocks.add(key);
        try { return operation(); }
        finally {
          this.ownedWriteLocks.delete(key);
          lock.close();
        }
      });
    }
    const lock = path.join(directory, ".write-lock");
    const marker = `owner-${process.pid}-${randomUUID()}.json`;
    let acquired = false;
    for (let attempt = 0; attempt < 2 && !acquired; attempt++) {
      try { fs.mkdirSync(lock, { mode: 0o700 }); acquired = true; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        try { this.recoverDeadWriteLock(lock); }
        catch (recoveryError) {
          // The prior owner may release its lock between EEXIST and inspection.
          // Retry acquisition within the same bounded loop instead of leaking a
          // transient filesystem ENOENT as a malformed-request failure.
          if ((recoveryError as NodeJS.ErrnoException).code !== "ENOENT") throw recoveryError;
        }
      }
    }
    if (!acquired) throw new SkillLibraryError("SKILL_CONFLICT", "Another process is updating this skill. Retry after it finishes.");
    const owner = path.join(lock, marker);
    try { fs.writeFileSync(owner, JSON.stringify({ pid: process.pid }), { flag: "wx", mode: 0o600 }); }
    catch (error) {
      try { if (!this.removeOwnedWriteLock(lock, marker)) fs.rmdirSync(lock); }
      catch { /* Keep an incomplete lock visible for recovery if cleanup fails. */ }
      throw error;
    }
    this.ownedWriteLocks.add(key);
    try {
      return operation();
    } finally {
      this.ownedWriteLocks.delete(key);
      this.removeOwnedWriteLock(lock, marker);
    }
  }

  private recoverDeadWriteLock(lock: string): void {
    const stat = fs.lstatSync(lock), entries = stat.isDirectory() && !stat.isSymbolicLink() ? fs.readdirSync(lock) : [];
    const owner = entries.length === 1 ? entries[0]! : "", match = /^owner-([1-9]\d*)-[a-f0-9-]+\.json$/.exec(owner);
    const pid = match ? Number(match[1]) : 0;
    if (!Number.isSafeInteger(pid) || pid <= 0 || pid > 2_147_483_647) throw new SkillLibraryError("SKILL_CONFLICT", `An incomplete skill write lock needs recovery. Close all VDT Studio instances before removing only ${lock}, then retry.`);
    try { process.kill(pid, 0); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") {
        // Only the owner-specific marker may be removed. If another recovering
        // host got here first, never rmdir a possibly replacement owner's lock.
        this.removeOwnedWriteLock(lock, owner);
        return;
      } else if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
    }
    throw new SkillLibraryError("SKILL_CONFLICT", `Another process (PID ${pid}) is updating this skill. Retry after it finishes.`);
  }

  private removeOwnedWriteLock(lock: string, marker: string): boolean {
    try { fs.unlinkSync(path.join(lock, marker)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
    try { fs.rmdirSync(lock); }
    catch (error) {
      if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
    }
    return true;
  }

  getSelection(projectId: string, vdtId: string): StoredSkillSelection | null {
    const dir = this.directory("selections", safeSegment(projectId), safeSegment(vdtId));
    return this.read<StoredSkillSelection>(dir, this.latest(dir));
  }

  select(projectId: string, vdtId: string, input: Omit<StoredSkillSelection, "schemaVersion" | "revision" | "updatedAt">, expectedRevision?: number): StoredSkillSelection {
    return this.withSelectionWriteLock(projectId, vdtId, () => {
      const dir = this.directory("selections", safeSegment(projectId), safeSegment(vdtId));
      const revision = this.latest(dir);
      if (expectedRevision !== undefined && revision !== expectedRevision) throw new SkillLibraryError("SKILL_CONFLICT", "The selected skill changed. Refresh Context before trying again.");
      const record: StoredSkillSelection = { ...input, schemaVersion: "local_skill_selection.v1", revision: revision + 1, updatedAt: new Date().toISOString() };
      this.publishRecord(dir, record.revision, record);
      return record;
    });
  }

  /** Rename the complete working tree, preserving editor bytes and companion
   * resources. Runtime history and VDT selections stay in their existing root. */
  private migrateWorkingDirectory(): void {
    if (process.platform === "win32") {
      this.withWindowsDirectory(this.root, library => {
        const legacy = library.list().find(entry => entry.name.toLowerCase() === "files");
        if (!legacy) return;
        if (!legacy.directory || legacy.reparse) {
          throw new SkillLibraryError("UNSAFE_SKILL_PATH", "The previous skills folder must be an ordinary directory.");
        }
        withWindowsSkillDirectory(this.dataDir, [], false, profile => {
          try { library.moveDirectory(legacy.name, profile, "skills"); }
          catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code === "ENOENT" && !library.list().some(entry => entry.name.toLowerCase() === "files")) {
              const migrated = profile.openChild("skills");
              migrated.close();
              return;
            }
            if (code !== "EEXIST") throw error;
            throw new SkillLibraryError("SKILL_PATH_CONFLICT", "Both skills and skill-library-v1/files exist. Move their contents into skills before removing the old empty folder.");
          }
        });
      });
      return;
    }
    const legacy = path.join(this.root, "files");
    const existing = (filename: string) => {
      try { return fs.lstatSync(filename); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    };
    const source = existing(legacy);
    if (!source) return;
    if (!source.isDirectory() || source.isSymbolicLink()) throw new SkillLibraryError("UNSAFE_SKILL_PATH", "The previous skills folder must be an ordinary directory.");
    const destination = existing(this.files.rootPath);
    if (destination) {
      if (!destination.isDirectory() || destination.isSymbolicLink()) throw new SkillLibraryError("UNSAFE_SKILL_PATH", "The skills folder must be an ordinary directory.");
      throw new SkillLibraryError("SKILL_PATH_CONFLICT", "Both skills and skill-library-v1/files exist. Move their contents into skills using your file manager before removing the old empty files folder. Neither folder was changed.");
    }
    try { fs.renameSync(legacy, this.files.rootPath); }
    catch (error) {
      // Another local host may have completed this same rename first.
      const migrated = existing(this.files.rootPath);
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && !existing(legacy) && migrated?.isDirectory() && !migrated.isSymbolicLink()) return;
      throw error;
    }
  }

  private directory(...segments: string[]): string {
    if (process.platform === "win32") {
      withWindowsSkillDirectory(this.dataDir, ["skill-library-v1", ...segments], true, () => {});
      return path.join(this.root, ...segments);
    }
    // The application owns this subtree. Reject symlinks at every level.
    fs.mkdirSync(path.dirname(this.root), { recursive: true });
    let dir = this.root;
    for (const segment of ["", ...segments]) {
      if (segment) dir = path.join(dir, segment);
      try { fs.mkdirSync(dir, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      const stat = fs.lstatSync(dir);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new SkillLibraryError("UNSAFE_SKILL_PATH", "Skill storage must use application-owned directories.");
    }
    return dir;
  }

  private hasMarker(dir: string, name: string): boolean {
    if (process.platform !== "win32") return fs.existsSync(path.join(dir, name));
    return this.withWindowsDirectory(dir, directory => {
      const entry = directory.list().find(item => item.name.toLowerCase() === name.toLowerCase());
      if (!entry) return false;
      if (entry.reparse || entry.directory) {
        throw new SkillLibraryError("UNSAFE_SKILL_PATH", "Skill markers must be ordinary files.");
      }
      directory.read(entry.name, 1024);
      return true;
    });
  }

  private writeWindowsMarker(dir: string, name: string, text: string): void {
    this.withWindowsDirectory(dir, directory => {
      try { directory.writeExclusive(name, Buffer.from(text)); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST" || !this.hasMarker(dir, name)) throw error;
        return;
      }
      directory.flush();
    });
  }

  private withWindowsDirectory<T>(dir: string, operation: (directory: WindowsStorageDirectory) => T): T {
    return withWindowsSkillDirectory(this.dataDir, windowsSkillPathParts(this.dataDir, dir), false, operation);
  }

  private latest(dir: string): number {
    const names = process.platform === "win32"
      ? this.withWindowsDirectory(dir, directory => directory.list()
          .filter(entry => !entry.reparse && !entry.directory).map(entry => entry.name))
      : fs.readdirSync(dir);
    return names.reduce((version, name) => /^\d{9}\.json$/.test(name) ? Math.max(version, Number(name.slice(0, 9))) : version, 0);
  }

  private read<T>(dir: string, version: number): T | null {
    if (!version) return null;
    if (!Number.isSafeInteger(version) || version < 1 || version > 999_999_999) throw new SkillLibraryError("INVALID_VERSION", "Invalid skill version.");
    const name = `${String(version).padStart(9, "0")}.json`;
    const filename = path.join(dir, name);
    try {
      if (process.platform === "win32") {
        return this.withWindowsDirectory(dir, directory => JSON.parse(directory.read(name, 1024 * 1024).toString("utf8")) as T);
      }
      const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try {
        if (fs.fstatSync(fd).size > 1024 * 1024) throw new SkillLibraryError("SKILL_TOO_LARGE", "Stored skill exceeds its size limit.");
        return JSON.parse(fs.readFileSync(fd, "utf8")) as T;
      } finally { fs.closeSync(fd); }
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  }

  private publishRecord(dir: string, version: number, record: unknown): void {
    const stage = `.publish-${randomUUID()}`;
    const name = `${String(version).padStart(9, "0")}.json`;
    if (process.platform === "win32") {
      this.withWindowsDirectory(dir, directory => {
        const bytes = Buffer.from(JSON.stringify(record));
        directory.writeExclusive(stage, bytes);
        try { directory.publish(stage, name, bytes); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          directory.unlinkExpected(stage, bytes);
          throw new SkillLibraryError("SKILL_CONFLICT", "A newer skill version was saved. Refresh and try again.");
        }
      });
      return;
    }
    const temporary = path.join(dir, stage);
    const filename = path.join(dir, name);
    try {
      const fd = fs.openSync(temporary, "wx", 0o600);
      try { fs.writeFileSync(fd, JSON.stringify(record), "utf8"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      try { fs.linkSync(temporary, filename); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new SkillLibraryError("SKILL_CONFLICT", "A newer skill version was saved. Refresh and try again."); throw error; }
      const fdDir = fs.openSync(dir, "r");
      try { fs.fsyncSync(fdDir); } finally { fs.closeSync(fdDir); }
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
}
