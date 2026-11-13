import path from "node:path";
import { VdtStorageError } from "./types";
import { retainWindowsStorageForProfile, type WindowsStorageDirectory } from "./windows-storage";

function assertSkillOperations(directory: WindowsStorageDirectory): void {
  for (const method of ["createChild", "replace", "moveFile", "moveDirectory", "unlinkExpected", "acquireLock", "openEditorLeaf", "editorDirectoryPath"] as const) {
    if (typeof directory[method] !== "function") {
      throw new VdtStorageError("STORAGE_CAPABILITY_UNSUPPORTED", "The Windows runtime does not support safe skill storage.");
    }
  }
}

export function withWindowsSkillDirectory<T>(
  profilePath: string,
  segments: readonly string[],
  create: boolean,
  operation: (directory: WindowsStorageDirectory) => T,
): T {
  const scope = openWindowsSkillDirectory(profilePath, segments, create);
  try {
    return operation(scope.directory);
  } finally {
    scope.close();
  }
}

export function openWindowsSkillDirectory(
  profilePath: string,
  segments: readonly string[],
  create: boolean,
  existingSegments: readonly string[] = [],
): { directory: WindowsStorageDirectory; close(): void } {
  const lease = retainWindowsStorageForProfile(profilePath);
  const opened: WindowsStorageDirectory[] = [];
  const close = () => {
    try { while (opened.length) opened.pop()!.close(); }
    finally { lease.release(); }
  };
  try {
    let directory = lease.directory;
    assertSkillOperations(directory);
    for (const segment of segments) {
      directory = create ? directory.ensureChild(segment) : directory.openChild(segment);
      opened.push(directory);
    }
    for (const segment of existingSegments) {
      directory = directory.openChild(segment);
      opened.push(directory);
    }
    return { directory, close };
  } catch (error) {
    close();
    throw error;
  }
}

export function windowsSkillPathParts(profilePath: string, filename: string): string[] {
  const relative = path.relative(profilePath, filename);
  if (!relative) return [];
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Skill storage path escapes the admitted Windows profile.");
  }
  return relative.split(path.sep);
}
