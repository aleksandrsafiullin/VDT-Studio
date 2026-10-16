import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assertSafeId, projectDir } from "@vdt-studio/storage";
import type { VdtProject } from "@vdt-studio/vdt-core";
import type { DataDiscoveryFileMetadata, DataDiscoveryRunSnapshot } from "@vdt-studio/data-harness";

export interface DataOwner {
  projectId: string;
  vdtId: string;
  dataDir: string;
  graphProjectId?: string | undefined;
}

export interface StoredDatasetMetadata extends DataDiscoveryFileMetadata {
  projectId?: string | undefined;
  vdtId?: string | undefined;
  sourceUrl?: string | undefined;
}

export interface StoredDatasetFile {
  datasetId: string;
  metadata: StoredDatasetMetadata;
  bytes: Uint8Array;
  textPreview: string;
}

interface DataApiStore {
  files: Map<string, StoredDatasetFile>;
  runs: Map<string, DataDiscoveryRunSnapshot>;
}

export class DataApiError extends Error {
  constructor(message: string, readonly status = 400, readonly code = "INVALID_DATA_REQUEST") {
    super(message);
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __vdtDataApiStore: DataApiStore | undefined;
}

export function getDataApiStore(): DataApiStore {
  globalThis.__vdtDataApiStore ??= { files: new Map(), runs: new Map() };
  return globalThis.__vdtDataApiStore;
}

/** Reject malformed IDs without sanitizing them into another resource's identity. */
export function requireDataId(value: unknown, label: string): string {
  if (typeof value !== "string") throw new DataApiError(`${label} is required.`);
  try {
    return assertSafeId(value, label);
  } catch {
    throw new DataApiError(`${label} must be a safe id using letters, numbers, underscores, or hyphens.`);
  }
}

export function sourceDownloadUrl(datasetId: string, owner: Pick<DataOwner, "projectId" | "vdtId">): string {
  requireDataId(datasetId, "datasetId");
  const query = new URLSearchParams({ projectId: owner.projectId, vdtId: owner.vdtId });
  return `/api/data/files/${datasetId}?${query}`;
}

export function assertFileIntegrity(file: StoredDatasetFile): void {
  const actualHash = `sha256:${createHash("sha256").update(file.bytes).digest("hex")}`;
  if (file.metadata.storageRef !== file.datasetId || file.metadata.contentHash !== actualHash || file.metadata.sizeBytes !== file.bytes.byteLength) {
    throw new DataApiError("The retained source failed its size or SHA-256 integrity check.", 409, "DATA_SOURCE_INTEGRITY_FAILED");
  }
}

/** New scoped sources are write-once. The original filename is metadata, never a path. */
export async function saveDatasetFile(file: StoredDatasetFile, owner?: DataOwner): Promise<void> {
  requireDataId(file.datasetId, "datasetId");
  assertOwnership(file.metadata, owner);
  assertFileIntegrity(file);
  const parent = await datasetParent(owner, true);
  const directory = path.join(parent, file.datasetId);
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new DataApiError("Dataset sources are immutable; upload a new source version instead.", 409, "DATASET_ALREADY_EXISTS");
    }
    throw error;
  }
  await writeFile(path.join(directory, "payload.bin"), file.bytes, { flag: "wx", mode: 0o600 });
  await writeFile(path.join(directory, "metadata.json"), JSON.stringify({
    schemaVersion: 1,
    datasetId: file.datasetId,
    metadata: file.metadata,
    textPreview: file.textPreview
  }, null, 2), { flag: "wx", mode: 0o600 });
  getDataApiStore().files.set(cacheKey(file.datasetId, owner), file);
}

export async function readDatasetFile(datasetId: string, owner?: DataOwner): Promise<StoredDatasetFile | undefined> {
  requireDataId(datasetId, "datasetId");
  try {
    const directory = await checkedChildDirectory(await datasetParent(owner, false), datasetId, false);
    const [metadataRaw, bytes] = await Promise.all([
      readRegularFile(path.join(directory, "metadata.json")),
      readRegularFile(path.join(directory, "payload.bin"))
    ]);
    const parsed = JSON.parse(metadataRaw.toString("utf8")) as {
      datasetId?: unknown;
      metadata?: StoredDatasetMetadata;
      textPreview?: unknown;
    };
    if (parsed.datasetId !== datasetId || !parsed.metadata) {
      throw new DataApiError("Dataset metadata does not match its source identity.", 409, "DATA_SOURCE_INTEGRITY_FAILED");
    }
    assertOwnership(parsed.metadata, owner);
    const file = { datasetId, metadata: parsed.metadata, bytes: new Uint8Array(bytes), textPreview: typeof parsed.textPreview === "string" ? parsed.textPreview : "" };
    assertFileIntegrity(file);
    getDataApiStore().files.set(cacheKey(datasetId, owner), file);
    return file;
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

export async function listDatasetFiles(owner: DataOwner): Promise<Array<Omit<StoredDatasetFile, "bytes" | "textPreview">>> {
  let directory: string;
  try {
    directory = await datasetParent(owner, false);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  const entries = await readdir(directory, { withFileTypes: true });
  const sources: Array<Omit<StoredDatasetFile, "bytes" | "textPreview">> = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(entry.name)) continue;
    // Each VDT can only list its own sources, even within the same workspace project.
    try {
      const file = await readDatasetFile(entry.name, owner);
      if (file) sources.push({ datasetId: file.datasetId, metadata: file.metadata });
    } catch (error) {
      if (error instanceof DataApiError && error.code === "DATA_OWNER_MISMATCH") continue;
      throw error;
    }
  }
  return sources.sort((a, b) => b.metadata.uploadedAt.localeCompare(a.metadata.uploadedAt));
}

export async function saveDiscoveryRun(snapshot: DataDiscoveryRunSnapshot, owner?: DataOwner, project?: VdtProject): Promise<void> {
  requireDataId(snapshot.runId, "runId");
  assertOwnership(snapshot.file, owner);
  const directory = await checkedChildDirectory(await runParent(owner, true), snapshot.runId, true);
  if (project) {
    // The initial graph basis is separate from client-visible mutable review state.
    try {
      await writeFile(path.join(directory, "context.json"), JSON.stringify({ project }), { flag: "wx", mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  const temporary = path.join(directory, `snapshot_${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(snapshot, null, 2), { flag: "wx", mode: 0o600 });
  await rename(temporary, path.join(directory, "snapshot.json"));
  getDataApiStore().runs.set(cacheKey(snapshot.runId, owner), snapshot);
}

export async function readDiscoveryRun(runId: string, owner?: DataOwner): Promise<DataDiscoveryRunSnapshot | undefined> {
  requireDataId(runId, "runId");
  try {
    const directory = await checkedChildDirectory(await runParent(owner, false), runId, false);
    const raw = await readRegularFile(path.join(directory, "snapshot.json"));
    const snapshot = JSON.parse(raw.toString("utf8")) as DataDiscoveryRunSnapshot;
    if (snapshot.runId !== runId) throw new DataApiError("Discovery run identity is invalid.", 409, "DATA_RUN_INTEGRITY_FAILED");
    assertOwnership(snapshot.file, owner);
    if (owner && (snapshot.vdtId !== owner.vdtId || snapshot.workspaceProjectId !== owner.projectId)) {
      throw new DataApiError("Discovery run does not belong to this VDT.", 404, "DATA_OWNER_MISMATCH");
    }
    if (owner) {
      const context = await readDiscoveryProject(runId, owner);
      if (!context || context.id !== snapshot.projectId || (owner.graphProjectId !== undefined && snapshot.projectId !== owner.graphProjectId)) {
        throw new DataApiError("Discovery run graph identity does not match its retained project context.", 409, "DATA_PROJECT_SNAPSHOT_MISMATCH");
      }
    }
    getDataApiStore().runs.set(cacheKey(runId, owner), snapshot);
    return snapshot;
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

export async function readDiscoveryProject(runId: string, owner?: DataOwner): Promise<VdtProject | undefined> {
  requireDataId(runId, "runId");
  try {
    const directory = await checkedChildDirectory(await runParent(owner, false), runId, false);
    const raw = await readRegularFile(path.join(directory, "context.json"));
    return (JSON.parse(raw.toString("utf8")) as { project?: VdtProject }).project;
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

function assertOwnership(metadata: Pick<StoredDatasetMetadata, "projectId" | "vdtId">, owner?: DataOwner): void {
  if (owner ? metadata.projectId !== owner.projectId || metadata.vdtId !== owner.vdtId : metadata.projectId !== undefined || metadata.vdtId !== undefined) {
    throw new DataApiError("The source or run does not belong to this project and VDT.", 404, "DATA_OWNER_MISMATCH");
  }
}

async function datasetParent(owner: DataOwner | undefined, create: boolean): Promise<string> {
  if (!owner) return checkedDirectory(legacyDataRoot(), ["data-discovery", "datasets"], create);
  return projectDirectory(owner, ["files"], create);
}

async function runParent(owner: DataOwner | undefined, create: boolean): Promise<string> {
  if (!owner) return checkedDirectory(legacyDataRoot(), ["data-discovery", "runs"], create);
  return projectDirectory(owner, ["data-discovery", "runs"], create);
}

async function projectDirectory(owner: DataOwner, segments: string[], create: boolean): Promise<string> {
  requireDataId(owner.projectId, "projectId");
  requireDataId(owner.vdtId, "vdtId");
  const directory = projectDir(owner.dataDir, owner.projectId);
  return checkedDirectory(owner.dataDir, path.relative(owner.dataDir, directory).split(path.sep).concat(segments), create);
}

async function checkedDirectory(root: string, segments: string[], create: boolean): Promise<string> {
  if (create) await mkdir(root, { recursive: true, mode: 0o700 });
  let directory = await realpath(root);
  for (const segment of segments) directory = await checkedChildDirectory(directory, segment, create);
  return directory;
}

async function checkedChildDirectory(parent: string, segment: string, create: boolean): Promise<string> {
  requireDataId(segment, "storage segment");
  const directory = path.join(parent, segment);
  if (create) await mkdir(directory, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
  const stat = await lstat(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new DataApiError("Source storage contains an unsafe directory.", 409, "DATA_STORAGE_PATH_UNSAFE");
  return directory;
}

async function readRegularFile(filePath: string): Promise<Buffer> {
  const handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!(await handle.stat()).isFile()) throw new DataApiError("Source storage contains an unsafe file.", 409, "DATA_STORAGE_PATH_UNSAFE");
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

function cacheKey(id: string, owner?: DataOwner): string {
  return `${owner?.dataDir ?? legacyDataRoot()}:${owner?.projectId ?? "legacy"}:${owner?.vdtId ?? "legacy"}:${id}`;
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

function legacyDataRoot(): string {
  if (process.env.VDT_DATA_DIR) return process.env.VDT_DATA_DIR;
  if (process.env.NODE_ENV === "test") {
    const workspace = process.cwd().replace(/[^A-Za-z0-9_.-]+/g, "_").slice(0, 160) || "workspace";
    return path.join(os.tmpdir(), "vdt-studio-storage-test", workspace, String(process.pid));
  }
  return path.join(process.cwd(), ".vdt");
}
