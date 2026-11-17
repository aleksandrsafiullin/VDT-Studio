import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openVdtDatabase } from "./sqlite";
import { VdtStorageError } from "./types";

const hostProcess = process;
const roots: string[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function root(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vdt-storage-platform-"));
  roots.push(directory);
  return directory;
}

function useWindowsAdmission(): void {
  // Exercise the real public entrypoint and its filesystem effects. This is
  // admission coverage, not a simulation of Windows filesystem durability.
  vi.stubGlobal("process", Object.create(hostProcess, { platform: { value: "win32" } }));
}

function expectUnsupported(action: () => unknown): void {
  expect(action).toThrowError(expect.objectContaining({
    name: "VdtStorageError",
    code: "STORAGE_CAPABILITY_UNSUPPORTED",
    retryable: false,
    message: "Sequence 3 migration requires reviewed Windows no-follow directory identity and durable directory fsync support."
  } satisfies Partial<VdtStorageError>));
}

describe("Windows storage admission before opening a profile", () => {
  it("does not create a missing profile directory or database", () => {
    const projectRoot = root();
    const dataDir = path.join(projectRoot, "missing", "profile");
    useWindowsAdmission();

    expectUnsupported(() => openVdtDatabase(projectRoot, { dataDir }));

    expect(fs.readdirSync(projectRoot)).toEqual([]);
    expect(fs.existsSync(dataDir)).toBe(false);
  });

  it("does not leave an empty database in an existing profile directory", () => {
    const dataDir = root();
    fs.writeFileSync(path.join(dataDir, "keep.bin"), Buffer.from([0, 1, 2, 255]));
    useWindowsAdmission();

    expectUnsupported(() => openVdtDatabase(dataDir, { dataDir }));

    expect(fs.readdirSync(dataDir)).toEqual(["keep.bin"]);
    expect(fs.readFileSync(path.join(dataDir, "keep.bin"))).toEqual(Buffer.from([0, 1, 2, 255]));
  });

  it("leaves an existing database and its directory byte-for-byte unchanged", () => {
    const dataDir = root();
    const databasePath = path.join(dataDir, "app.sqlite");
    const database = new DatabaseSync(databasePath);
    database.exec("CREATE TABLE sentinel(value TEXT); INSERT INTO sentinel VALUES ('retained');");
    database.close();
    const before = fs.readFileSync(databasePath);
    const entries = fs.readdirSync(dataDir);
    useWindowsAdmission();

    expectUnsupported(() => openVdtDatabase(dataDir, { dataDir }));

    expect(fs.readdirSync(dataDir)).toEqual(entries);
    expect(fs.readFileSync(databasePath)).toEqual(before);
  });
});
