import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DataDiscoveryFileMetadata, DataDiscoveryRunSnapshot } from "@vdt-studio/data-harness";

export interface StoredDatasetFile {
  datasetId: string;
  metadata: DataDiscoveryFileMetadata;
  bytes: Uint8Array;
  textPreview: string;
}

interface DataApiStore {
  files: Map<string, StoredDatasetFile>;
  runs: Map<string, DataDiscoveryRunSnapshot>;
}

declare global {
  // eslint-disable-next-line no-var
  var __vdtDataApiStore: DataApiStore | undefined;
}

export function getDataApiStore(): DataApiStore {
  globalThis.__vdtDataApiStore ??= {
    files: new Map<string, StoredDatasetFile>(),
    runs: new Map<string, DataDiscoveryRunSnapshot>()
  };
  return globalThis.__vdtDataApiStore;
}

export async function saveDatasetFile(file: StoredDatasetFile): Promise<void> {
  getDataApiStore().files.set(file.datasetId, file);
  const directory = datasetDirectory(file.datasetId);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "metadata.json"), JSON.stringify({
    datasetId: file.datasetId,
    metadata: file.metadata,
    textPreview: file.textPreview
  }, null, 2));
  await writeFile(path.join(directory, "payload.bin"), file.bytes);
}

export async function readDatasetFile(datasetId: string): Promise<StoredDatasetFile | undefined> {
  const store = getDataApiStore();
  const cached = store.files.get(datasetId);
  if (cached) return cached;

  try {
    const directory = datasetDirectory(datasetId);
    const [metadataRaw, bytes] = await Promise.all([
      readFile(path.join(directory, "metadata.json"), "utf8"),
      readFile(path.join(directory, "payload.bin"))
    ]);
    const parsed = JSON.parse(metadataRaw) as {
      datasetId?: unknown;
      metadata?: DataDiscoveryFileMetadata;
      textPreview?: unknown;
    };
    if (parsed.datasetId !== datasetId || !parsed.metadata) return undefined;
    const file: StoredDatasetFile = {
      datasetId,
      metadata: parsed.metadata,
      bytes: new Uint8Array(bytes),
      textPreview: typeof parsed.textPreview === "string" ? parsed.textPreview : ""
    };
    store.files.set(datasetId, file);
    return file;
  } catch {
    return undefined;
  }
}

export async function saveDiscoveryRun(snapshot: DataDiscoveryRunSnapshot): Promise<void> {
  getDataApiStore().runs.set(snapshot.runId, snapshot);
  const directory = runDirectory(snapshot.runId);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "snapshot.json"), JSON.stringify(snapshot, null, 2));
}

export async function readDiscoveryRun(runId: string): Promise<DataDiscoveryRunSnapshot | undefined> {
  const store = getDataApiStore();
  const cached = store.runs.get(runId);
  if (cached) return cached;
  try {
    const raw = await readFile(path.join(runDirectory(runId), "snapshot.json"), "utf8");
    const snapshot = JSON.parse(raw) as DataDiscoveryRunSnapshot;
    if (snapshot.runId !== runId) return undefined;
    store.runs.set(runId, snapshot);
    return snapshot;
  } catch {
    return undefined;
  }
}

function datasetDirectory(datasetId: string): string {
  return path.join(dataDiscoveryRoot(), "datasets", safePathSegment(datasetId));
}

function runDirectory(runId: string): string {
  return path.join(dataDiscoveryRoot(), "runs", safePathSegment(runId));
}

function dataDiscoveryRoot(): string {
  const dataDir = process.env.VDT_DATA_DIR ?? defaultDataDir(process.cwd());
  return path.join(dataDir, "data-discovery");
}

function defaultDataDir(projectRoot: string): string {
  if (process.env.NODE_ENV === "test") {
    return path.join(os.tmpdir(), "vdt-studio-storage-test", safePathSegment(projectRoot), String(process.pid));
  }
  return path.join(projectRoot, ".vdt");
}

function safePathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]+/g, "_").slice(0, 160) || "item";
}
