import type { VdtProject } from "@vdt-studio/vdt-core";

export type StoredVdtStatus = "draft" | "reviewed" | "approved" | "archived";

export interface StoredProjectRecord {
  id: string;
  name: string;
  description?: string | undefined;
  industry?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface StoredVdtRecord {
  id: string;
  projectId: string;
  name: string;
  rootKpi: string;
  unit?: string | undefined;
  timePeriod?: string | undefined;
  status: StoredVdtStatus;
  activeRevisionId?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface StoredVdtRevisionRecord {
  id: string;
  vdtId: string;
  revisionNo: number;
  parentRevisionId?: string | undefined;
  source: "user" | "agent" | "import" | "scenario" | "repair";
  summary?: string | undefined;
  createdAt: string;
}

export interface StoredProjectSummary {
  project: StoredProjectRecord;
  counts: {
    vdts: number;
    revisions: number;
    conversations: number;
    agentRuns: number;
    mutationProposals: number;
    comparisons: number;
  };
  vdts: Array<{
    vdt: StoredVdtRecord;
    revisionCount: number;
    nodeCount?: number | undefined;
    rootValue?: number | undefined;
    rootUnit?: string | undefined;
  }>;
}

export interface StoredProjectExplorerSummary {
  projects: StoredProjectSummary[];
}

export async function fetchStoredProjectExplorerSummary(signal?: AbortSignal): Promise<StoredProjectExplorerSummary> {
  const response = await fetch("/api/vdt/projects", {
    cache: "no-store",
    ...(signal ? { signal } : {})
  });
  const payload = await readStoragePayload<{
    ok?: boolean;
    projects?: StoredProjectSummary[];
    error?: { message?: string };
  }>(response);
  if (!response.ok || !payload.ok || !Array.isArray(payload.projects)) {
    throw new Error(payload.error?.message ?? "Stored projects could not be loaded.");
  }
  return { projects: payload.projects };
}

export async function createStoredProject(input: {
  name: string;
  description?: string | undefined;
  industry?: string | undefined;
}): Promise<StoredProjectSummary> {
  const payload = await requestStorage<{ summary?: StoredProjectSummary }>("/api/vdt/projects", {
    method: "POST",
    body: JSON.stringify(input)
  });
  if (!payload.summary) throw new Error("Created project summary was not returned.");
  return payload.summary;
}

export async function updateStoredProject(projectId: string, input: {
  name?: string | undefined;
  description?: string | null | undefined;
  industry?: string | null | undefined;
  metadata?: Record<string, unknown> | null | undefined;
}): Promise<StoredProjectSummary> {
  const payload = await requestStorage<{ summary?: StoredProjectSummary }>(`/api/vdt/projects/${encodeURIComponent(projectId)}`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
  if (!payload.summary) throw new Error("Updated project summary was not returned.");
  return payload.summary;
}

export async function deleteStoredProject(projectId: string): Promise<void> {
  await requestStorage(`/api/vdt/projects/${encodeURIComponent(projectId)}`, {
    method: "DELETE"
  });
}

export async function createStoredVdt(projectId: string, input: {
  name: string;
  rootKpi?: string | undefined;
  unit?: string | undefined;
  timePeriod?: string | undefined;
  project: VdtProject;
}): Promise<{ summary: StoredProjectSummary; vdt: StoredVdtRecord }> {
  const payload = await requestStorage<{ summary?: StoredProjectSummary; vdt?: StoredVdtRecord }>(
    `/api/vdt/projects/${encodeURIComponent(projectId)}/vdts`,
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
  if (!payload.summary || !payload.vdt) throw new Error("Created VDT payload was not returned.");
  return { summary: payload.summary, vdt: payload.vdt };
}

export async function loadStoredVdt(vdtId: string): Promise<{
  summary: StoredProjectSummary;
  vdt: StoredVdtRecord;
  activeProject?: VdtProject | undefined;
  revisions: StoredVdtRevisionRecord[];
}> {
  const payload = await requestStorage<{
    summary?: StoredProjectSummary;
    vdt?: StoredVdtRecord;
    activeProject?: VdtProject;
    revisions?: StoredVdtRevisionRecord[];
  }>(`/api/vdt/vdts/${encodeURIComponent(vdtId)}`);
  if (!payload.summary || !payload.vdt || !Array.isArray(payload.revisions)) {
    throw new Error("Stored VDT payload was not returned.");
  }
  return {
    summary: payload.summary,
    vdt: payload.vdt,
    activeProject: payload.activeProject,
    revisions: payload.revisions
  };
}

export async function updateStoredVdt(vdtId: string, input: {
  name?: string | undefined;
  rootKpi?: string | undefined;
  unit?: string | null | undefined;
  timePeriod?: string | null | undefined;
  status?: StoredVdtStatus | undefined;
}): Promise<StoredVdtRecord> {
  const payload = await requestStorage<{ vdt?: StoredVdtRecord }>(`/api/vdt/vdts/${encodeURIComponent(vdtId)}`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
  if (!payload.vdt) throw new Error("Updated VDT payload was not returned.");
  return payload.vdt;
}

export async function deleteStoredVdt(vdtId: string): Promise<void> {
  await requestStorage(`/api/vdt/vdts/${encodeURIComponent(vdtId)}`, {
    method: "DELETE"
  });
}

export async function saveStoredVdtRevision(vdtId: string, input: {
  project: VdtProject;
  summary?: string | undefined;
  source?: StoredVdtRevisionRecord["source"] | undefined;
}): Promise<StoredVdtRecord> {
  const payload = await requestStorage<{ vdt?: StoredVdtRecord }>(
    `/api/vdt/vdts/${encodeURIComponent(vdtId)}/revisions`,
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
  if (!payload.vdt) throw new Error("Saved VDT revision payload was not returned.");
  return payload.vdt;
}

async function requestStorage<T extends Record<string, unknown> = Record<string, unknown>>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    },
    ...init
  });
  const payload = await readStoragePayload<T & {
    ok?: boolean;
    error?: { message?: string };
  }>(response);
  if (!response.ok || payload.ok !== true) {
    throw new Error(payload.error?.message ?? "VDT storage request failed.");
  }
  return payload;
}

async function readStoragePayload<T extends Record<string, unknown>>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      return await response.json() as T;
    } catch {
      throw new Error(`VDT storage API returned invalid JSON (${response.status}).`);
    }
  }

  const text = await response.text().catch(() => "");
  const htmlError = text.includes("<!DOCTYPE") || text.includes("<html");
  const status = response.status ? `${response.status} ${response.statusText}`.trim() : "non-JSON";
  throw new Error(
    htmlError
      ? `VDT storage API returned an HTML error page (${status}). Check the server error log.`
      : `VDT storage API returned a non-JSON response (${status}).`
  );
}
