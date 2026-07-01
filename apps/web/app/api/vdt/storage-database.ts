import os from "node:os";
import path from "node:path";
import { openVdtDatabase, type VdtDatabase } from "@vdt-studio/storage";

export function openVdtStorageDatabase(projectRoot: string): VdtDatabase {
  const dataDir = process.env.VDT_DATA_DIR ?? defaultDataDir(projectRoot);
  return openVdtDatabase(projectRoot, { dataDir });
}

function defaultDataDir(projectRoot: string): string {
  if (process.env.NODE_ENV === "test") {
    return path.join(os.tmpdir(), "vdt-studio-storage-test", safePathSegment(projectRoot), String(process.pid));
  }
  return path.join(projectRoot, ".vdt");
}

function safePathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, "_").slice(-80) || "workspace";
}
