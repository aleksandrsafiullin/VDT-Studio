import type { DataDiscoveryFileMetadata } from "@vdt-studio/data-harness";

export const PROJECT_FILES_CHANGED = "vdt:project-files-changed";
export const DATA_FILE_ACCEPT = ".csv,.tsv,.txt,.json,.ndjson,.xlsx,.xls,.parquet";
export const MAX_PROJECT_FILE_BYTES = 50 * 1024 * 1024;

export interface ProjectFileSource {
  datasetId: string;
  file: DataDiscoveryFileMetadata;
  sourceUrl: string;
  displayName: string;
  archived: boolean;
  vdtIds: string[];
}

export type ProjectFileUpdate =
  | { action: "rename"; displayName: string }
  | { action: "archive" | "restore" }
  | { action: "attach" | "detach"; vdtId: string };

export function canAnalyzeProjectFile(source: ProjectFileSource): boolean {
  return DATA_FILE_ACCEPT.split(",").some((extension) => source.file.fileName.toLowerCase().endsWith(extension));
}

export async function listProjectFiles(projectId: string, signal?: AbortSignal): Promise<ProjectFileSource[]> {
  const response = await fetch(`/api/data/files?${new URLSearchParams({ projectId, includeArchived: "true" })}`, { cache: "no-store", ...(signal ? { signal } : {}) });
  const payload = await fileResponse<{ sources: ProjectFileSource[] }>(response);
  return payload.sources;
}

export async function uploadProjectFile(projectId: string, file: File, vdtId?: string, signal?: AbortSignal): Promise<ProjectFileSource> {
  if (file.size > MAX_PROJECT_FILE_BYTES) throw new Error(`“${file.name}” exceeds the 50 MB file limit.`);
  const form = new FormData();
  form.set("projectId", projectId);
  form.set("file", file);
  if (vdtId) form.set("vdtId", vdtId);
  const response = await fetch("/api/data/files", { method: "POST", body: form, ...(signal ? { signal } : {}) });
  const payload = await fileResponse<{ datasetId: string; file: DataDiscoveryFileMetadata; sourceUrl: string }>(response);
  notifyFilesChanged(projectId);
  return { datasetId: payload.datasetId, file: payload.file, sourceUrl: payload.sourceUrl, displayName: payload.file.fileName, archived: false, vdtIds: vdtId ? [vdtId] : [] };
}

export async function updateProjectFile(projectId: string, datasetId: string, update: ProjectFileUpdate, signal?: AbortSignal): Promise<void> {
  const response = await fetch(`/api/data/files/${encodeURIComponent(datasetId)}?${new URLSearchParams({ projectId })}`, {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(update), ...(signal ? { signal } : {})
  });
  await fileResponse(response);
  notifyFilesChanged(projectId);
}

async function fileResponse<T = object>(response: Response): Promise<T> {
  if (!(response.headers.get("content-type") ?? "").includes("application/json")) throw new Error(`File request returned an unexpected response (${response.status}).`);
  const payload = await response.json() as T & { ok?: boolean; error?: { message?: string } };
  if (!response.ok || !payload.ok) throw new Error(payload.error?.message ?? "The file operation could not be completed.");
  return payload;
}

function notifyFilesChanged(projectId: string): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(PROJECT_FILES_CHANGED, { detail: { projectId } }));
}
