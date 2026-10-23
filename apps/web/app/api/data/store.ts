import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rename, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assertSafeId, projectDir } from "@vdt-studio/storage";
import type { VdtProject } from "@vdt-studio/vdt-core";
import type { DataDiscoveryFileMetadata, DataDiscoveryRunSnapshot } from "@vdt-studio/data-harness";

export interface DatasetFileOwner {
  projectId: string;
  dataDir: string;
  vdtId?: string | undefined;
}

export interface DataOwner extends DatasetFileOwner {
  vdtId: string;
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

export interface LibraryDatasetFile {
  datasetId: string;
  metadata: StoredDatasetMetadata;
  displayName: string;
  archived: boolean;
  vdtIds: string[];
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

export function sourceDownloadUrl(datasetId: string, owner: Pick<DatasetFileOwner, "projectId" | "vdtId">): string {
  requireDataId(datasetId, "datasetId");
  const query = new URLSearchParams({ projectId: owner.projectId });
  if (owner.vdtId) query.set("vdtId", owner.vdtId);
  return `/api/data/files/${datasetId}?${query}`;
}

export function assertFileIntegrity(file: StoredDatasetFile): void {
  const actualHash = `sha256:${createHash("sha256").update(file.bytes).digest("hex")}`;
  if (file.metadata.storageRef !== file.datasetId || file.metadata.contentHash !== actualHash || file.metadata.sizeBytes !== file.bytes.byteLength) {
    throw new DataApiError("The retained source failed its size or SHA-256 integrity check.", 409, "DATA_SOURCE_INTEGRITY_FAILED");
  }
}

/** New scoped sources are write-once. The original filename is metadata, never a path. */
export async function saveDatasetFile(file: StoredDatasetFile, owner?: DatasetFileOwner): Promise<void> {
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

export async function readDatasetFile(datasetId: string, owner?: DatasetFileOwner): Promise<StoredDatasetFile | undefined> {
  requireDataId(datasetId, "datasetId");
  try {
    const directory = await checkedChildDirectory(await datasetParent(owner, false), datasetId, false);
    const parsed = await readDatasetMetadata(directory, datasetId);
    assertProjectOwnership(parsed.metadata, owner);
    if (owner?.vdtId && !await hasDatasetAssociation(directory, parsed.metadata, owner.vdtId)) {
      throw new DataApiError("The source is not attached to this VDT.", 404, "DATA_OWNER_MISMATCH");
    }
    const bytes = await readRegularFile(path.join(directory, "payload.bin"));
    const file = { datasetId, metadata: scopedFileMetadata(parsed.metadata, datasetId, owner), bytes: new Uint8Array(bytes), textPreview: parsed.textPreview };
    assertFileIntegrity(file);
    getDataApiStore().files.set(cacheKey(datasetId, owner), file);
    return file;
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

export async function listDatasetFiles(owner: DataOwner): Promise<Array<Omit<StoredDatasetFile, "bytes" | "textPreview">>> {
  // Archive hides a file from new project selections, not from trees already using it.
  const files = await listLibraryDatasetFiles(owner, true);
  return files.filter((file) => file.vdtIds.includes(owner.vdtId)).map((file) => ({
    datasetId: file.datasetId, metadata: scopedFileMetadata(file.metadata, file.datasetId, owner)
  }));
}

/** Listings read metadata only; opening a source verifies its complete bytes/hash. */
export async function listLibraryDatasetFiles(owner: DatasetFileOwner, includeArchived = false): Promise<LibraryDatasetFile[]> {
  let directory: string;
  try {
    directory = await datasetParent(owner, false);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  const entries = await readdir(directory, { withFileTypes: true });
  const sources: LibraryDatasetFile[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(entry.name)) continue;
    try {
      const child = await checkedChildDirectory(directory, entry.name, false);
      const { metadata } = await readDatasetMetadata(child, entry.name);
      assertProjectOwnership(metadata, owner);
      const details = await readLibraryDetails(child, metadata);
      if (includeArchived || !details.archived) sources.push({ datasetId: entry.name, metadata, ...details });
    } catch (error) {
      // An in-flight upload publishes metadata only after its complete payload.
      if (isMissing(error)) continue;
      if (error instanceof DataApiError && error.code === "DATA_OWNER_MISMATCH") continue;
      throw error;
    }
  }
  return sources.sort((a, b) => b.metadata.uploadedAt.localeCompare(a.metadata.uploadedAt));
}

/** Library labels, archival and tree associations never rewrite original metadata/bytes. */
export async function updateLibraryDatasetFile(datasetId: string, owner: DatasetFileOwner, update:
  | { action: "rename"; displayName: string }
  | { action: "archive" | "restore" }
  | { action: "attach" | "detach"; vdtId: string }
): Promise<void> {
  requireDataId(datasetId, "datasetId");
  const directory = await (async () => checkedChildDirectory(await datasetParent(owner, false), datasetId, false))().catch((error: unknown) => {
    if (isMissing(error)) throw new DataApiError("Dataset file was not found.", 404, "DATASET_NOT_FOUND");
    throw error;
  });
  const { metadata } = await readDatasetMetadata(directory, datasetId);
  assertProjectOwnership(metadata, owner);
  if (update.action === "rename") {
    const displayName = update.displayName.trim();
    if (!displayName || displayName.length > 255 || /[\u0000-\u001f\u007f]/.test(displayName)) throw new DataApiError("File name must contain 1–255 characters without control characters.");
    await writeLibraryJson(directory, "display-name.json", { displayName });
  } else if (update.action === "archive" || update.action === "restore") {
    await writeLibraryJson(directory, "archive.json", { archived: update.action === "archive" });
  } else if (update.action === "attach" || update.action === "detach") {
    requireDataId(update.vdtId, "vdtId");
    if (update.action === "attach" && (await readLibraryDetails(directory, metadata)).archived) {
      throw new DataApiError("Restore this archived file before attaching it to another VDT.", 409, "DATA_FILE_ARCHIVED");
    }
    if (update.action === "detach" && !await hasDatasetAssociation(directory, metadata, update.vdtId)) {
      throw new DataApiError("The source is not attached to this VDT.", 404, "DATA_OWNER_MISMATCH");
    }
    const links = await checkedChildDirectory(directory, "vdts", true);
    await writeLibraryJson(links, `${update.vdtId}.json`, { attached: update.action === "attach" });
  }
}

async function readDatasetMetadata(directory: string, datasetId: string): Promise<{ metadata: StoredDatasetMetadata; textPreview: string }> {
  const parsed = JSON.parse((await readRegularFile(path.join(directory, "metadata.json"))).toString("utf8")) as { datasetId?: unknown; metadata?: StoredDatasetMetadata; textPreview?: unknown };
  const metadata = parsed.metadata;
  if (parsed.datasetId !== datasetId || !metadata || metadata.storageRef !== datasetId || typeof metadata.fileName !== "string" ||
    typeof metadata.uploadedAt !== "string" || typeof metadata.contentHash !== "string" || !Number.isSafeInteger(metadata.sizeBytes) || metadata.sizeBytes < 0) {
    throw new DataApiError("Dataset metadata does not match its source identity.", 409, "DATA_SOURCE_INTEGRITY_FAILED");
  }
  return { metadata, textPreview: typeof parsed.textPreview === "string" ? parsed.textPreview : "" };
}

function assertProjectOwnership(metadata: StoredDatasetMetadata, owner?: DatasetFileOwner): void {
  if (owner ? metadata.projectId !== owner.projectId : metadata.projectId !== undefined || metadata.vdtId !== undefined) {
    throw new DataApiError("The source does not belong to this project.", 404, "DATA_OWNER_MISMATCH");
  }
}

function scopedFileMetadata(metadata: StoredDatasetMetadata, datasetId: string, owner?: DatasetFileOwner): StoredDatasetMetadata {
  return owner ? { ...metadata, vdtId: owner.vdtId, sourceUrl: sourceDownloadUrl(datasetId, owner) } : metadata;
}

async function readLibraryJson(directory: string, filename: string): Promise<Record<string, unknown> | undefined> {
  try {
    const value: unknown = JSON.parse((await readRegularFile(path.join(directory, filename))).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new DataApiError("File library metadata is invalid.", 409, "DATA_SOURCE_INTEGRITY_FAILED");
    return value as Record<string, unknown>;
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

async function readLibraryDetails(directory: string, metadata: StoredDatasetMetadata): Promise<Pick<LibraryDatasetFile, "displayName" | "archived" | "vdtIds">> {
  const [name, archive] = await Promise.all([readLibraryJson(directory, "display-name.json"), readLibraryJson(directory, "archive.json")]);
  const ids = new Set(metadata.vdtId ? [metadata.vdtId] : []);
  try {
    const links = await checkedChildDirectory(directory, "vdts", false);
    for (const entry of await readdir(links)) {
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\.json$/.test(entry)) continue;
      const id = entry.slice(0, -5);
      const link = await readLibraryJson(links, entry);
      if (link?.attached === true) ids.add(id);
      else if (link?.attached === false) ids.delete(id);
      else throw new DataApiError("File association metadata is invalid.", 409, "DATA_SOURCE_INTEGRITY_FAILED");
    }
  } catch (error) { if (!isMissing(error)) throw error; }
  return { displayName: typeof name?.displayName === "string" ? name.displayName : metadata.fileName, archived: archive?.archived === true, vdtIds: [...ids].sort() };
}

async function hasDatasetAssociation(directory: string, metadata: StoredDatasetMetadata, vdtId: string): Promise<boolean> {
  // Detached sources stay readable by their former VDT for saved revisions and reviews.
  if (metadata.vdtId === vdtId) return true;
  try {
    const link = await readLibraryJson(await checkedChildDirectory(directory, "vdts", false), `${requireDataId(vdtId, "vdtId")}.json`);
    if (link && typeof link.attached !== "boolean") throw new DataApiError("File association metadata is invalid.", 409, "DATA_SOURCE_INTEGRITY_FAILED");
    return Boolean(link);
  } catch (error) { if (isMissing(error)) return false; throw error; }
}

async function writeLibraryJson(directory: string, filename: string, value: Record<string, unknown>): Promise<void> {
  const temporary = path.join(directory, `library_${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify(value), { flag: "wx", mode: 0o600 });
    await rename(temporary, path.join(directory, filename));
  } finally {
    await unlink(temporary).catch((error: unknown) => { if (!isMissing(error)) throw error; });
  }
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

function assertOwnership(metadata: Pick<StoredDatasetMetadata, "projectId" | "vdtId">, owner?: DatasetFileOwner): void {
  if (owner ? metadata.projectId !== owner.projectId || metadata.vdtId !== owner.vdtId : metadata.projectId !== undefined || metadata.vdtId !== undefined) {
    throw new DataApiError("The source or run does not belong to this project and VDT.", 404, "DATA_OWNER_MISMATCH");
  }
}

async function datasetParent(owner: DatasetFileOwner | undefined, create: boolean): Promise<string> {
  if (!owner) return checkedDirectory(legacyDataRoot(), ["data-discovery", "datasets"], create);
  return projectDirectory(owner, ["files"], create);
}

async function runParent(owner: DataOwner | undefined, create: boolean): Promise<string> {
  if (!owner) return checkedDirectory(legacyDataRoot(), ["data-discovery", "runs"], create);
  return projectDirectory(owner, ["data-discovery", "runs"], create);
}

async function projectDirectory(owner: DatasetFileOwner, segments: string[], create: boolean): Promise<string> {
  requireDataId(owner.projectId, "projectId");
  if (owner.vdtId !== undefined) requireDataId(owner.vdtId, "vdtId");
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

function cacheKey(id: string, owner?: DatasetFileOwner): string {
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
