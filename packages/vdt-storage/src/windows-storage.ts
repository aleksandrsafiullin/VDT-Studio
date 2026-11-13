import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { VdtStorageError } from "./types";

interface WindowsStorageBinding {
  open(root: string): object;
  initialize(root: string): object;
  openChild(parent: object, name: string): object;
  createChild(parent: object, name: string): object;
  editorDirectoryPath(directory: object): string;
  sqlitePath(directory: object, name: string): string;
  list(directory: object): WindowsStorageEntry[];
  removeEmptyChild(parent: object, name: string): void;
  ensureChild(parent: object, name: string): void;
  read(directory: object, name: string, buffer: Buffer, durable: boolean): number;
  createFile(directory: object, name: string): object;
  writeFile(file: object, bytes: Buffer): void;
  flushFile(file: object): void;
  fileIdentity(file: object): Buffer;
  unlinkIdentified(directory: object, name: string, identity: Buffer): void;
  writeExclusive(directory: object, name: string, bytes: Buffer): void;
  publish(directory: object, stage: string, destination: string, expected: Buffer): void;
  replace(directory: object, stage: string, destination: string, bytes: Buffer, previous: Buffer): void;
  moveFile(directory: object, name: string, target: object, targetName: string, expected: Buffer): void;
  moveDirectory(directory: object, name: string, target: object, targetName: string): void;
  unlinkExpected(directory: object, name: string, expected: Buffer): void;
  unlink(directory: object, name: string): void;
  validate(directory: object): void;
  flush(directory: object): void;
  editorPath(lease: object): string;
  openEditorLeaf(directory: object, name: string): object;
  acquireLock(directory: object, name: string): object;
  releaseLock(lock: object): void;
  close(directory: object): void;
}

export interface WindowsStorageEntry {
  name: string;
  directory: boolean;
  reparse: boolean;
}

const require = createRequire(import.meta.url);
const bindingMethods = [
  "open", "initialize", "openChild", "createChild", "ensureChild", "list", "removeEmptyChild",
  "read", "createFile", "writeFile", "flushFile", "fileIdentity", "writeExclusive",
  "publish", "replace", "moveFile", "moveDirectory", "unlink", "unlinkExpected",
  "unlinkIdentified", "validate", "flush", "sqlitePath", "editorDirectoryPath",
  "openEditorLeaf", "editorPath", "acquireLock", "releaseLock", "close"
] as const satisfies readonly (keyof WindowsStorageBinding)[];

/**
 * Adapter for the fixed installed Windows runtime resource. The desktop host
 * must validate the installed manifest before passing its own runtime directory.
 * The platform admission gate remains separate from addon availability.
 */
export function openWindowsStorage(
  trustedRuntimeDirectory: string,
  profilePath: string,
  initialize = false
): WindowsStorageDirectory {
  if (process.platform !== "win32" || process.arch !== "x64" || !path.isAbsolute(trustedRuntimeDirectory)) {
    throw new VdtStorageError("STORAGE_CAPABILITY_UNSUPPORTED", "Windows storage requires the bundled x64 native runtime.");
  }
  const binding = require(path.join(trustedRuntimeDirectory, "windows-storage.node")) as WindowsStorageBinding;
  if (!binding || !bindingMethods.every((method) => typeof binding[method] === "function")) {
    throw new VdtStorageError("STORAGE_CAPABILITY_UNSUPPORTED", "Bundled Windows storage capability has an incompatible ABI.");
  }
  const session = initialize ? binding.initialize(profilePath) : binding.open(profilePath);
  return new WindowsStorageDirectory(binding, session);
}

export class WindowsStorageDirectory {
  constructor(
    private readonly binding: WindowsStorageBinding,
    private readonly session: object
  ) {}

  openChild(name: string): WindowsStorageDirectory {
    return new WindowsStorageDirectory(this.binding, this.binding.openChild(this.session, name));
  }

  createChild(name: string): WindowsStorageDirectory {
    return new WindowsStorageDirectory(this.binding, this.binding.createChild(this.session, name));
  }

  ensureChild(name: string): WindowsStorageDirectory {
    this.binding.ensureChild(this.session, name);
    return this.openChild(name);
  }

  editorDirectoryPath(): string {
    return this.binding.editorDirectoryPath(this.session);
  }

  sqlitePath(name = "app.sqlite"): string {
    return this.binding.sqlitePath(this.session, name);
  }

  list(): WindowsStorageEntry[] {
    return this.binding.list(this.session);
  }

  removeEmptyChild(name: string): void {
    this.binding.removeEmptyChild(this.session, name);
  }

  read(name: string, maximumBytes: number, durable = false): Buffer {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0 || maximumBytes > 0xffffffff) {
      throw new RangeError("Invalid Windows storage read bound.");
    }
    const bytes = Buffer.alloc(maximumBytes);
    const length = this.binding.read(this.session, name, bytes, durable);
    return bytes.subarray(0, length);
  }

  createFile(name: string): { write(bytes: Buffer): void; flush(): void; identity(): Buffer; close(): void } {
    const file = this.binding.createFile(this.session, name);
    return {
      write: (bytes) => this.binding.writeFile(file, bytes),
      flush: () => this.binding.flushFile(file),
      identity: () => this.binding.fileIdentity(file),
      close: () => this.binding.releaseLock(file)
    };
  }

  writeExclusive(name: string, bytes: Buffer): void {
    this.binding.writeExclusive(this.session, name, bytes);
  }

  publish(stage: string, destination: string, expected: Buffer): void {
    this.binding.publish(this.session, stage, destination, expected);
  }

  replace(stage: string, destination: string, expectedDestination: Buffer, newBytes: Buffer): void {
    this.binding.replace(this.session, stage, destination, newBytes, expectedDestination);
  }

  moveFile(name: string, target: WindowsStorageDirectory, targetName: string, expected: Buffer): void {
    this.binding.moveFile(this.session, name, target.session, targetName, expected);
  }

  moveDirectory(name: string, target: WindowsStorageDirectory, targetName: string): void {
    this.binding.moveDirectory(this.session, name, target.session, targetName);
  }

  unlinkExpected(name: string, expected: Buffer): void {
    this.binding.unlinkExpected(this.session, name, expected);
  }

  unlinkIdentified(name: string, identity: Buffer): void {
    this.binding.unlinkIdentified(this.session, name, identity);
  }

  unlink(name: string): void {
    this.binding.unlink(this.session, name);
  }

  validate(): void {
    this.binding.validate(this.session);
  }

  flush(): void {
    this.binding.flush(this.session);
  }

  openEditorLeaf(name: string): { path: string; close(): void } {
    const lease = this.binding.openEditorLeaf(this.session, name);
    try {
      return { path: this.binding.editorPath(lease), close: () => this.binding.releaseLock(lease) };
    } catch (error) {
      this.binding.releaseLock(lease);
      throw error;
    }
  }

  acquireLock(name: string): { close(): void } {
    const lock = this.binding.acquireLock(this.session, name);
    return { close: () => this.binding.releaseLock(lock) };
  }

  close(): void {
    this.binding.close(this.session);
  }
}

// Only the storage admission owner may install a profile capability.
const profileRegistryKey = Symbol.for("vdt-studio.windows-storage.profiles.v1");
type ProfileRegistry = Map<string, { directory: WindowsStorageDirectory; users: number }>;
const processGlobal = globalThis as typeof globalThis & { [profileRegistryKey]?: ProfileRegistry };
const admittedProfiles = processGlobal[profileRegistryKey] ??= new Map();

function profileKey(profilePath: string): string {
  return path.win32.normalize(profilePath).toLowerCase();
}

export function acquireWindowsStorageProfile(
  profilePath: string,
  open: () => WindowsStorageDirectory
): { directory: WindowsStorageDirectory; release: () => void } {
  const key = profileKey(profilePath);
  let entry = admittedProfiles.get(key);
  if (!entry) {
    entry = { directory: open(), users: 0 };
    admittedProfiles.set(key, entry);
  }
  entry.users++;
  const acquired = entry;
  let released = false;
  return {
    directory: acquired.directory,
    release: () => {
      if (released) return;
      released = true;
      if (--acquired.users === 0) {
        admittedProfiles.delete(key);
        acquired.directory.close();
      }
    }
  };
}

export function getWindowsStorageForProfile(profilePath: string): WindowsStorageDirectory {
  const entry = admittedProfiles.get(profileKey(profilePath));
  if (!entry) {
    throw new VdtStorageError("STORAGE_CAPABILITY_UNSUPPORTED", "Windows storage profile has no admitted native session.");
  }
  return entry.directory;
}

export function retainWindowsStorageForProfile(profilePath: string): {
  directory: WindowsStorageDirectory;
  release: () => void;
} {
  return acquireWindowsStorageProfile(profilePath, () => {
    throw new VdtStorageError("STORAGE_CAPABILITY_UNSUPPORTED", "Windows storage profile has no admitted native session.");
  });
}

/**
 * Publish one immutable association under an already validated profile.
 * Parent segments must already exist. The final child is created privately
 * if absent. Returns false when another writer already owns the final name.
 */
export function publishWindowsStorageFileIfAbsent(
  profile: WindowsStorageDirectory,
  parentSegments: readonly string[],
  childDirectory: string,
  fileName: string,
  bytes: Buffer
): boolean {
  const opened: WindowsStorageDirectory[] = [];
  try {
    let parent = profile;
    for (const segment of parentSegments) {
      parent = parent.openChild(segment);
      opened.push(parent);
    }
    const directory = parent.ensureChild(childDirectory);
    opened.push(directory);
    const stage = `.vdt-stage-${randomUUID()}.tmp`;
    directory.writeExclusive(stage, bytes);
    try {
      directory.publish(stage, fileName, bytes);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;
      directory.unlink(stage);
      if (!directory.read(fileName, bytes.byteLength, true).equals(bytes)) {
        throw new Error("Existing Windows storage association differs from expected bytes.");
      }
      return false;
    }
  } finally {
    for (const directory of opened.reverse()) directory.close();
  }
}

/** Open the native parent of a storage-owned relative path for one synchronous operation. */
export function withWindowsStorageParent<T>(
  profile: WindowsStorageDirectory,
  relativePath: string,
  createParents: boolean,
  operation: (directory: WindowsStorageDirectory, name: string) => T
): T {
  const components = relativePath.split(/[\\/]/);
  const name = components.pop();
  if (!name || components.some((component) => !component)) {
    throw new TypeError("Expected a nonempty storage-relative file path.");
  }
  const opened: WindowsStorageDirectory[] = [];
  try {
    let directory = profile;
    for (const component of components) {
      if (createParents) {
        try {
          directory = directory.createChild(component);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          directory = directory.openChild(component);
        }
      } else {
        directory = directory.openChild(component);
      }
      opened.push(directory);
    }
    return operation(directory, name);
  } finally {
    for (const directory of opened.reverse()) directory.close();
  }
}

export function writeWindowsStorageFile(directory: WindowsStorageDirectory, name: string, bytes: Buffer, maxPreviousBytes: number): void {
  const lock = directory.acquireLock(".vdt-mutation.lock");
  const stage = `.vdt-stage-${randomUUID()}.tmp`;
  try {
    let previous: Buffer | undefined;
    try {
      previous = directory.read(name, maxPreviousBytes);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    directory.writeExclusive(stage, bytes);
    if (previous === undefined) directory.publish(stage, name, bytes);
    else directory.replace(stage, name, previous, bytes);
  } finally {
    lock.close();
  }
}

export function removeWindowsStorageTree(directory: WindowsStorageDirectory, name: string): void {
  let child: WindowsStorageDirectory;
  try {
    child = directory.openChild(name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  try {
    for (const entry of child.list()) {
      if (entry.reparse) throw new Error("Windows storage tree contains a reparse entry.");
      if (entry.directory) removeWindowsStorageTree(child, entry.name);
      else child.unlink(entry.name);
    }
  } finally {
    child.close();
  }
  directory.removeEmptyChild(name);
}
