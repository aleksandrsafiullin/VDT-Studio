import fs from "node:fs";
import path from "node:path";

export function flushDirectory(directoryPath: string): void {
  const descriptor = fs.openSync(directoryPath, "r");
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

export function writeAll(descriptor: number, bytes: Buffer): void {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const written = fs.writeSync(descriptor, bytes, offset, bytes.byteLength - offset);
    if (written <= 0) throw new Error("Storage file write made no progress.");
    offset += written;
  }
}

/** POSIX implementation of the durable exclusive-create operation. */
export function writeExclusiveDurable(filePath: string, bytes: Buffer): void {
  const descriptor = fs.openSync(filePath, "wx", 0o600);
  try {
    writeAll(descriptor, bytes);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  flushDirectory(path.dirname(filePath));
}
