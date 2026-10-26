import fs from "node:fs";

// Ready-state admission may retain a completed verification of an immutable
// backup's exact filesystem generation. Migration/recovery never use this cache.
// This retains no backup contents and never applies to the live database.
const verified = new Map<string, string>();
const LIMIT = 32;

function fingerprint(backupPath: string): string | undefined {
  if (["-wal", "-shm", "-journal"].some(suffix => fs.lstatSync(backupPath + suffix, { throwIfNoEntry: false }) !== undefined)) return;
  const stat = fs.lstatSync(backupPath, { bigint: true, throwIfNoEntry: false });
  if (!stat?.isFile() || stat.isSymbolicLink()) return;
  return [stat.dev, stat.ino, stat.mode, stat.uid, stat.gid, stat.nlink, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");
}

export function verifyRetainedBackup(
  backupPath: string,
  proofKey: string,
  verify: () => void
): void {
  const key = `${backupPath}\u0000${proofKey}`;
  const before = fingerprint(backupPath);
  if (before && verified.get(key) === before) {
    verified.delete(key);
    verified.set(key, before);
    return;
  }
  verified.delete(key);
  verify();
  if (before && fingerprint(backupPath) === before) {
    verified.set(key, before);
    while (verified.size > LIMIT) verified.delete(verified.keys().next().value!);
  }
}
