import fs from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { LocalSkillRepository } from "./skill-library";

afterEach(() => vi.restoreAllMocks());

it("refuses an unadmitted Windows skill profile before opening or creating directories", () => {
  const mkdir = vi.spyOn(fs, "mkdirSync");
  const open = vi.spyOn(fs, "openSync");
  const original = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { ...original, value: "win32" });
  try {
    const repository = new LocalSkillRepository();
    for (const operation of [
      () => repository.list(),
      () => repository.files.scan(),
      () => repository.files.createFolder("", "Skills"),
      () => repository.withSkillWriteLock("user.test", () => {}),
    ]) {
      expect(operation).toThrow(expect.objectContaining({ code: "STORAGE_CAPABILITY_UNSUPPORTED" }));
    }
    expect(mkdir).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  } finally {
    Object.defineProperty(process, "platform", original);
  }
});

it("leaves an admitted profile untouched when its skill capabilities are incomplete", async () => {
  const { acquireWindowsStorageProfile } = await import("./windows-storage");
  const { withWindowsSkillDirectory } = await import("./windows-skill-files");
  const directory = { ensureChild: vi.fn(), close: vi.fn() };
  const profile = acquireWindowsStorageProfile("C:\\qa\\skill-profile", () => directory as never);
  try {
    expect(() => withWindowsSkillDirectory("C:\\qa\\skill-profile", ["skill-library-v1"], true, vi.fn()))
      .toThrow(expect.objectContaining({ code: "STORAGE_CAPABILITY_UNSUPPORTED" }));
    expect(directory.ensureChild).not.toHaveBeenCalled();
  } finally {
    profile.release();
  }
});

it("holds the checked Windows folder and file through editor dispatch, then releases both on failure", async () => {
  const { acquireWindowsStorageProfile } = await import("./windows-storage");
  const { LocalSkillFiles } = await import("./skill-files");
  const closeFolder = vi.fn(), closeFile = vi.fn();
  const operations = {
    createChild: vi.fn(), replace: vi.fn(), moveFile: vi.fn(), moveDirectory: vi.fn(),
    unlinkExpected: vi.fn(), acquireLock: vi.fn(), editorDirectoryPath: vi.fn(),
    openEditorLeaf: vi.fn(() => ({ path: "C:\\canonical\\SKILL.md", close: closeFile })),
  };
  const folder = { ...operations, close: closeFolder };
  const root = { ...operations, ensureChild: vi.fn(() => folder), close: vi.fn() };
  const dataDir = "/test/admitted-skill-profile";
  const profile = acquireWindowsStorageProfile(dataDir, () => root as never);
  const original = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { ...original, value: "win32" });
  try {
    const files = new LocalSkillFiles(`${dataDir}/skills`, () => {});
    await expect(files.openInEditor("SKILL.md", "file", async filename => {
      expect(filename).toBe("C:\\canonical\\SKILL.md");
      await Promise.resolve();
      expect(closeFolder).not.toHaveBeenCalled();
      expect(closeFile).not.toHaveBeenCalled();
      throw new Error("Dispatch failed");
    })).rejects.toThrow("Dispatch failed");
    expect(folder.openEditorLeaf).toHaveBeenCalledWith("SKILL.md");
    expect(closeFolder).toHaveBeenCalledOnce();
    expect(closeFile).toHaveBeenCalledOnce();
  } finally {
    Object.defineProperty(process, "platform", original);
    profile.release();
  }
});

it("uses the admitted Windows handle for immutable publication and a native write lease", async () => {
  const { acquireWindowsStorageProfile } = await import("./windows-storage");
  const dataDir = "/test/admitted-skill-records";
  const records = new Map<string, Buffer>();
  const lockClose = vi.fn();
  const directory = {
    createChild: vi.fn(), replace: vi.fn(), moveFile: vi.fn(), moveDirectory: vi.fn(),
    unlinkExpected: vi.fn(), openEditorLeaf: vi.fn(), editorDirectoryPath: vi.fn(),
    acquireLock: vi.fn(() => ({ close: lockClose })),
    ensureChild: () => directory,
    openChild: () => directory,
    close: vi.fn(),
    list: () => [...records.keys()].map(name => ({ name, directory: false, reparse: false })),
    read: (name: string) => records.get(name)!,
    writeExclusive: (name: string, bytes: Buffer) => records.set(name, bytes),
    publish: (stage: string, name: string, bytes: Buffer) => {
      expect(records.get(stage)).toEqual(bytes);
      expect(lockClose).not.toHaveBeenCalled();
      records.delete(stage);
      records.set(name, bytes);
    },
  };
  const profile = acquireWindowsStorageProfile(dataDir, () => directory as never);
  const original = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { ...original, value: "win32" });
  try {
    const repository = new LocalSkillRepository(dataDir);
    const value = repository.publish({ id: "user.test", raw: "# Skill", expectedVersion: 0 });
    expect(directory.acquireLock).toHaveBeenCalledOnce();
    expect(lockClose).toHaveBeenCalledOnce();
    expect([...records.keys()]).toEqual(["000000001.json"]);
    expect(repository.get("user.test")).toEqual(value);
  } finally {
    Object.defineProperty(process, "platform", original);
    profile.release();
  }
});
