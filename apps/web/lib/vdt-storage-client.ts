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

export interface RevisionContentIdentityV1 {
  scheme: "legacy_graph_sha256" | "vdt_revision_payload_hash.v1";
  hash: `sha256:${string}`;
}

export interface VdtRevisionHeadV2 {
  schemaVersion: "vdt_revision_head.v2";
  projectId: string;
  vdtId: string;
  activeRevisionId: string | null;
  activeContentIdentity: RevisionContentIdentityV1 | null;
  pendingRevisionId: string | null;
  commitGeneration: number;
}

export interface ProjectRuntimeStateV1 {
  schemaVersion: "project_runtime_state.v1";
  projectId: string;
  runtimeGeneration: "v1" | "v2";
  generationVersion: number;
  migrationState: "not_started" | "shadow_ready" | "migrating" | "v2_active" | "rollback_readonly";
  writeState: "enabled" | "disabled";
  updatedAt: string;
}

export interface VdtRevisionCasV1 {
  schemaVersion: "vdt_revision_cas.v1";
  activeRevisionId: string | null;
  activeContentIdentity: RevisionContentIdentityV1 | null;
  commitGeneration: number;
}

export interface ProjectRuntimeCasV1 {
  schemaVersion: "project_runtime_cas.v1";
  runtimeGeneration: "v1" | "v2";
  generationVersion: number;
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
  runtimeState: ProjectRuntimeStateV1;
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
    head: VdtRevisionHeadV2;
    revisionCount: number;
    nodeCount?: number | undefined;
    rootValue?: number | undefined;
    potentialValue?: number | undefined;
    rootUnit?: string | undefined;
  }>;
}

export interface StoredProjectExplorerSummary {
  projects: StoredProjectSummary[];
}

export interface CreateStoredVdtInput {
  idempotencyKey: string;
  expectedRuntime: ProjectRuntimeCasV1;
  requestedVdtId?: string | null | undefined;
  name: string;
  rootKpi: string;
  unit?: string | undefined;
  timePeriod?: string | undefined;
  status?: StoredVdtStatus | undefined;
  metadata?: Record<string, unknown> | undefined;
  project: VdtProject;
}

export interface SaveStoredVdtRevisionInput {
  idempotencyKey: string;
  expectedHead: VdtRevisionCasV1;
  expectedRuntime: ProjectRuntimeCasV1;
  project: VdtProject;
  summary: string | null;
}

export class VdtStorageRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly retryable: boolean
  ) {
    super(message);
    this.name = "VdtStorageRequestError";
  }
}

export function revisionCasFromHead(head: VdtRevisionHeadV2): VdtRevisionCasV1 {
  return {
    schemaVersion: "vdt_revision_cas.v1",
    activeRevisionId: head.activeRevisionId,
    activeContentIdentity: head.activeContentIdentity,
    commitGeneration: head.commitGeneration
  };
}

export function runtimeCasFromState(state: ProjectRuntimeStateV1): ProjectRuntimeCasV1 {
  return {
    schemaVersion: "project_runtime_cas.v1",
    runtimeGeneration: state.runtimeGeneration,
    generationVersion: state.generationVersion
  };
}

export async function fetchStoredProjectExplorerSummary(signal?: AbortSignal): Promise<StoredProjectExplorerSummary> {
  const payload = await requestStorage<{
    schemaVersion?: string;
    projects?: StoredProjectSummary[];
  }>("/api/vdt/projects", signal ? { signal } : undefined);
  if (payload.schemaVersion !== "project_explorer_response.v1" || !Array.isArray(payload.projects)) {
    throw new Error("Stored project explorer payload was not returned.");
  }
  return { projects: payload.projects };
}

export async function createStoredProject(input: {
  name: string;
  description?: string | undefined;
  industry?: string | undefined;
}): Promise<StoredProjectSummary> {
  const payload = await requestStorage<{
    schemaVersion?: string;
    summary?: StoredProjectSummary;
  }>("/api/vdt/projects", {
    method: "POST",
    body: JSON.stringify(input)
  });
  if (payload.schemaVersion !== "project_summary_response.v1" || !payload.summary) {
    throw new Error("Created project summary was not returned.");
  }
  return payload.summary;
}

export async function updateStoredProject(projectId: string, input: {
  name?: string | undefined;
  description?: string | null | undefined;
  industry?: string | null | undefined;
  metadata?: Record<string, unknown> | null | undefined;
}): Promise<StoredProjectSummary> {
  const payload = await requestStorage<{
    schemaVersion?: string;
    summary?: StoredProjectSummary;
  }>(
    `/api/vdt/projects/${encodeURIComponent(projectId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(input)
    }
  );
  if (payload.schemaVersion !== "project_summary_response.v1" || !payload.summary) {
    throw new Error("Updated project summary was not returned.");
  }
  return payload.summary;
}

export async function deleteStoredProject(projectId: string): Promise<void> {
  await requestStorage(`/api/vdt/projects/${encodeURIComponent(projectId)}`, {
    method: "DELETE"
  });
}

export async function createStoredVdt(projectId: string, input: CreateStoredVdtInput): Promise<{
  summary: StoredProjectSummary;
  vdt: StoredVdtRecord;
  revision: StoredVdtRevisionRecord;
  head: VdtRevisionHeadV2;
  runtimeState: ProjectRuntimeStateV1;
}> {
  const payload = await requestStorage<{
    schemaVersion?: string;
    summary?: StoredProjectSummary;
    vdt?: StoredVdtRecord;
    revision?: StoredVdtRevisionRecord;
    head?: VdtRevisionHeadV2;
    runtimeState?: ProjectRuntimeStateV1;
  }>(
    `/api/vdt/projects/${encodeURIComponent(projectId)}/vdts`,
    {
      method: "POST",
      body: JSON.stringify({
        schemaVersion: "create_vdt_with_initial_http_request.v1",
        idempotencyKey: input.idempotencyKey,
        expectedRuntime: input.expectedRuntime,
        vdt: {
          requestedVdtId: input.requestedVdtId ?? null,
          name: input.name,
          rootKpi: input.rootKpi,
          unit: input.unit ?? null,
          timePeriod: input.timePeriod ?? null,
          status: input.status ?? "draft",
          metadata: input.metadata ?? null
        },
        project: input.project
      })
    }
  );
  if (
    payload.schemaVersion !== "create_vdt_with_initial_http_response.v1" ||
    !payload.summary ||
    !payload.vdt ||
    !payload.revision ||
    !payload.head ||
    !payload.runtimeState
  ) {
    throw new Error("Created VDT payload was not returned.");
  }
  return {
    summary: payload.summary,
    vdt: payload.vdt,
    revision: payload.revision,
    head: payload.head,
    runtimeState: payload.runtimeState
  };
}

export async function loadStoredVdt(vdtId: string): Promise<{
  summary: StoredProjectSummary;
  vdt: StoredVdtRecord;
  activeProject?: VdtProject | undefined;
  revisions: StoredVdtRevisionRecord[];
  head: VdtRevisionHeadV2;
  runtimeState: ProjectRuntimeStateV1;
}> {
  const payload = await requestStorage<{
    schemaVersion?: string;
    summary?: StoredProjectSummary;
    vdt?: StoredVdtRecord;
    activeProject?: VdtProject;
    revisions?: StoredVdtRevisionRecord[];
    head?: VdtRevisionHeadV2;
    runtimeState?: ProjectRuntimeStateV1;
  }>(`/api/vdt/vdts/${encodeURIComponent(vdtId)}`);
  if (
    payload.schemaVersion !== "vdt_load_response.v1" ||
    !payload.summary ||
    !payload.vdt ||
    !Array.isArray(payload.revisions) ||
    !payload.head ||
    !payload.runtimeState
  ) {
    throw new Error("Stored VDT payload was not returned.");
  }
  return {
    summary: payload.summary,
    vdt: payload.vdt,
    activeProject: payload.activeProject,
    revisions: payload.revisions,
    head: payload.head,
    runtimeState: payload.runtimeState
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

export async function fetchStoredVdtRevisionState(vdtId: string): Promise<{
  vdt: StoredVdtRecord;
  head: VdtRevisionHeadV2;
  runtimeState: ProjectRuntimeStateV1;
}> {
  const payload = await requestStorage<{
    schemaVersion?: string;
    vdt?: StoredVdtRecord;
    head?: VdtRevisionHeadV2;
    runtimeState?: ProjectRuntimeStateV1;
  }>(`/api/vdt/vdts/${encodeURIComponent(vdtId)}/revisions`);
  if (
    payload.schemaVersion !== "vdt_revisions_response.v1" ||
    !payload.vdt ||
    !payload.head ||
    !payload.runtimeState
  ) {
    throw new Error("Stored VDT revision state was not returned.");
  }
  return { vdt: payload.vdt, head: payload.head, runtimeState: payload.runtimeState };
}

export async function saveStoredVdtRevision(vdtId: string, input: SaveStoredVdtRevisionInput): Promise<{
  vdt: StoredVdtRecord;
  revision: StoredVdtRevisionRecord;
  head: VdtRevisionHeadV2;
  runtimeState: ProjectRuntimeStateV1;
  summary: StoredProjectSummary;
}> {
  const payload = await requestStorage<{
    schemaVersion?: string;
    vdt?: StoredVdtRecord;
    revision?: StoredVdtRevisionRecord;
    head?: VdtRevisionHeadV2;
    runtimeState?: ProjectRuntimeStateV1;
    summary?: StoredProjectSummary;
  }>(
    `/api/vdt/vdts/${encodeURIComponent(vdtId)}/revisions`,
    {
      method: "POST",
      body: JSON.stringify({
        schemaVersion: "manual_vdt_revision_commit_request.v1",
        idempotencyKey: input.idempotencyKey,
        expectedHead: input.expectedHead,
        expectedRuntime: input.expectedRuntime,
        summary: input.summary,
        project: input.project
      })
    }
  );
  if (
    payload.schemaVersion !== "manual_vdt_revision_commit_response.v1" ||
    !payload.vdt ||
    !payload.revision ||
    !payload.head ||
    !payload.runtimeState ||
    !payload.summary
  ) {
    throw new Error("Saved VDT revision payload was not returned.");
  }
  return {
    vdt: payload.vdt,
    revision: payload.revision,
    head: payload.head,
    runtimeState: payload.runtimeState,
    summary: payload.summary
  };
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
    error?: { code?: string; message?: string; retryable?: boolean };
  }>(response);
  if (!response.ok || payload.ok !== true) {
    throw new VdtStorageRequestError(
      payload.error?.message ?? "VDT storage request failed.",
      response.status,
      payload.error?.code ?? "VDT_STORAGE_REQUEST_FAILED",
      payload.error?.retryable === true
    );
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
