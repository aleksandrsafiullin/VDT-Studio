import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyRetainedBackup } from "./verified-backup-cache";

const owned: string[] = [];
function backup() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vdt-backup-cache-test-"));
  owned.push(directory);
  const file = path.join(directory, "backup.sqlite");
  fs.writeFileSync(file, "verified bytes");
  return file;
}
afterEach(() => { for (const directory of owned.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

describe("immutable backup verification retention", () => {
  it("reuses only a successful verification of the same file generation and proof", () => {
    const file = backup(), verify = vi.fn();
    verifyRetainedBackup(file, "proof1", verify);
    verifyRetainedBackup(file, "proof1", verify);
    expect(verify).toHaveBeenCalledTimes(1);
    verifyRetainedBackup(file, "proof2", verify);
    expect(verify).toHaveBeenCalledTimes(2);
  });

  it("rechecks same-size tampering even when the modification time is restored", () => {
    const file = backup(), verify = vi.fn(), before = fs.statSync(file);
    verifyRetainedBackup(file, "proof", verify);
    fs.writeFileSync(file, "tampered bytes");
    fs.utimesSync(file, before.atime, before.mtime);
    verifyRetainedBackup(file, "proof", verify);
    expect(verify).toHaveBeenCalledTimes(2);
  });

  it("rechecks replacement files at the same path", () => {
    const file = backup(), verify = vi.fn();
    verifyRetainedBackup(file, "proof", verify);
    fs.writeFileSync(file + ".replacement", "verified bytes");
    fs.renameSync(file + ".replacement", file);
    verifyRetainedBackup(file, "proof", verify);
    expect(verify).toHaveBeenCalledTimes(2);
  });

  it.each(["-wal", "-shm", "-journal"])("never reuses verification with a %s sidecar", suffix => {
    const file = backup(), verify = vi.fn();
    verifyRetainedBackup(file, "proof", verify);
    fs.writeFileSync(file + suffix, "journal");
    verifyRetainedBackup(file, "proof", verify);
    verifyRetainedBackup(file, "proof", verify);
    expect(verify).toHaveBeenCalledTimes(3);
  });

  it("does not cache failures or files changed during verification", () => {
    const file = backup(), failure = vi.fn(() => { throw new Error("invalid backup"); });
    expect(() => verifyRetainedBackup(file, "proof", failure)).toThrow("invalid backup");
    expect(() => verifyRetainedBackup(file, "proof", failure)).toThrow("invalid backup");
    expect(failure).toHaveBeenCalledTimes(2);
    const change = vi.fn(() => fs.appendFileSync(file, "."));
    verifyRetainedBackup(file, "proof", change);
    verifyRetainedBackup(file, "proof", change);
    expect(change).toHaveBeenCalledTimes(2);
  });

  it("bounds retained entries", () => {
    const file = backup(), verify = vi.fn();
    for (let index = 0; index < 33; index++) verifyRetainedBackup(file, String(index), verify);
    verifyRetainedBackup(file, "0", verify);
    expect(verify).toHaveBeenCalledTimes(34);
  });
});
