import type { VdtProject } from "@vdt-studio/vdt-core";
import {
  assertDensePlainJson,
  assertExactKeys,
  assertRevisionContentIdentity,
  assertSafeId,
  isPlainRecord,
  validateStrictVdtProjectCommit,
  VdtStorageError,
  type ActorContextV1,
  type CreateVdtMetadataV1,
  type RevisionContentIdentityV1
} from "@vdt-studio/storage";

export type TrustedStorageWriteMode = "desktop" | "development_web";

export interface StorageWriteEnvironment {
  VDT_APP_MODE?: string | undefined;
  NEXT_PUBLIC_VDT_APP_MODE?: string | undefined;
}

export interface CreateStorageWriteActorOptions {
  env?: StorageWriteEnvironment | undefined;
  now?: (() => string) | undefined;
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

export interface ManualVdtRevisionCommitRequestV1 {
  schemaVersion: "manual_vdt_revision_commit_request.v1";
  idempotencyKey: string;
  expectedHead: VdtRevisionCasV1;
  expectedRuntime: ProjectRuntimeCasV1;
  summary: string | null;
  project: VdtProject;
}

export interface CreateVdtWithInitialHttpRequestV1 {
  schemaVersion: "create_vdt_with_initial_http_request.v1";
  idempotencyKey: string;
  expectedRuntime: ProjectRuntimeCasV1;
  vdt: CreateVdtMetadataV1;
  project: VdtProject;
}

export interface MappedStorageWriteError {
  status: number;
  code: string;
  message: string;
  retryable: boolean;
  retryAfterSeconds?: number | undefined;
}

const STORAGE_ERROR_STATUS = new Map<string, { status: number; retryable: boolean; retryAfterSeconds?: number }>([
  ["INVALID_STORAGE_REQUEST", { status: 400, retryable: false }],
  ["HOSTED_REVISION_WRITES_DISABLED", { status: 403, retryable: false }],
  ["ACTOR_PROJECT_MISMATCH", { status: 403, retryable: false }],
  ["PROJECT_NOT_FOUND", { status: 404, retryable: false }],
  ["VDT_NOT_FOUND", { status: 404, retryable: false }],
  ["REVISION_CONFLICT", { status: 409, retryable: false }],
  ["IDEMPOTENCY_KEY_REUSE", { status: 409, retryable: false }],
  ["PROJECT_WRITE_STATE_CHANGED", { status: 409, retryable: false }],
  ["VDT_ALREADY_EXISTS", { status: 409, retryable: false }],
  ["VDT_NOT_READY", { status: 409, retryable: false }],
  ["REVISION_IN_PROGRESS", { status: 409, retryable: true, retryAfterSeconds: 1 }],
  ["STALE_ATTEMPT_OWNER", { status: 409, retryable: true, retryAfterSeconds: 1 }],
  ["MIGRATION_IN_PROGRESS", { status: 409, retryable: true, retryAfterSeconds: 1 }],
  ["PROJECT_WRITE_DISABLED", { status: 423, retryable: false }],
  ["MIGRATION_RECOVERY_REQUIRED", { status: 503, retryable: false }],
  ["PROJECT_RUNTIME_STATE_MISSING", { status: 503, retryable: false }],
  ["VDT_REVISION_HEAD_MISSING", { status: 503, retryable: false }],
  ["AMBIGUOUS_REVISION_RECOVERY", { status: 503, retryable: false }],
  ["IDEMPOTENCY_ATTEMPT_MISSING", { status: 503, retryable: false }],
  ["IDEMPOTENCY_FINALIZE_CONFLICT", { status: 503, retryable: false }],
  ["IDEMPOTENCY_RESULT_CORRUPT", { status: 503, retryable: false }],
  ["IDEMPOTENCY_RESULT_MISSING", { status: 503, retryable: false }],
  ["REVISION_COMMIT_REJECTED", { status: 503, retryable: false }],
  ["REVISION_FINALIZE_CONFLICT", { status: 503, retryable: false }],
  ["REVISION_FINALIZE_FAILED", { status: 503, retryable: false }],
  ["REVISION_QUARANTINED", { status: 503, retryable: false }],
  ["STORAGE_CAPABILITY_UNSUPPORTED", { status: 503, retryable: false }],
  ["VDT_LIFECYCLE_CONFLICT", { status: 503, retryable: false }]
]);

export function resolveTrustedStorageWriteMode(
  env: StorageWriteEnvironment = {
    VDT_APP_MODE: process.env.VDT_APP_MODE,
    NEXT_PUBLIC_VDT_APP_MODE: process.env.NEXT_PUBLIC_VDT_APP_MODE
  }
): TrustedStorageWriteMode | null {
  const configured = env.VDT_APP_MODE !== undefined
    ? env.VDT_APP_MODE
    : env.NEXT_PUBLIC_VDT_APP_MODE;
  return configured === "desktop" || configured === "development_web"
    ? configured
    : null;
}

export function createStorageWriteActor(
  projectId: string,
  options: CreateStorageWriteActorOptions = {}
): ActorContextV1 {
  if (!resolveTrustedStorageWriteMode(options.env)) {
    throw new VdtStorageError(
      "HOSTED_REVISION_WRITES_DISABLED",
      "VDT revision writes are disabled outside an explicitly trusted local application mode."
    );
  }

  const issuedAt = (options.now ?? (() => new Date().toISOString()))();
  if (new Date(issuedAt).toISOString() !== issuedAt) {
    throw new TypeError("Storage actor issuedAt must be a canonical UTC timestamp.");
  }

  return {
    schemaVersion: "actor_context.v1",
    principalId: "vdt_studio_local_application",
    projectId: assertSafeId(projectId, "projectId"),
    roles: ["vdt_writer"],
    authSource: "desktop_local",
    sessionId: "vdt_studio_local_runtime",
    issuedAt
  };
}

export function parseManualVdtRevisionCommitRequest(
  input: unknown
): ManualVdtRevisionCommitRequestV1 {
  const body = requireRecord(input, "ManualVdtRevisionCommitRequestV1");
  assertExactKeys(
    body,
    ["schemaVersion", "idempotencyKey", "expectedHead", "expectedRuntime", "summary", "project"],
    "ManualVdtRevisionCommitRequestV1"
  );
  if (body.schemaVersion !== "manual_vdt_revision_commit_request.v1") {
    throw new TypeError("Manual revision request schemaVersion is invalid.");
  }
  const idempotencyKey = requireNonEmptyString(body.idempotencyKey, "idempotencyKey");
  if (body.summary !== null && typeof body.summary !== "string") {
    throw new TypeError("summary must be a string or null.");
  }
  const expectedHead = parseRevisionCas(body.expectedHead);
  const expectedRuntime = parseRuntimeCas(body.expectedRuntime);
  validateStrictProjectRequest(body.project);

  return {
    schemaVersion: "manual_vdt_revision_commit_request.v1",
    idempotencyKey,
    expectedHead,
    expectedRuntime,
    summary: body.summary,
    project: body.project as VdtProject
  };
}

export function parseCreateVdtWithInitialHttpRequest(
  input: unknown
): CreateVdtWithInitialHttpRequestV1 {
  const body = requireRecord(input, "CreateVdtWithInitialHttpRequestV1");
  assertExactKeys(
    body,
    ["schemaVersion", "idempotencyKey", "expectedRuntime", "vdt", "project"],
    "CreateVdtWithInitialHttpRequestV1"
  );
  if (body.schemaVersion !== "create_vdt_with_initial_http_request.v1") {
    throw new TypeError("Create VDT request schemaVersion is invalid.");
  }
  const idempotencyKey = requireNonEmptyString(body.idempotencyKey, "idempotencyKey");
  const expectedRuntime = parseRuntimeCas(body.expectedRuntime);
  const vdt = parseCreateVdtMetadata(body.vdt);
  validateStrictProjectRequest(body.project);

  return {
    schemaVersion: "create_vdt_with_initial_http_request.v1",
    idempotencyKey,
    expectedRuntime,
    vdt,
    project: body.project as VdtProject
  };
}

export function mapStorageWriteError(
  error: unknown,
  fallbackMessage = "VDT storage request failed."
): MappedStorageWriteError {
  if (error instanceof VdtStorageError) {
    const mapping = STORAGE_ERROR_STATUS.get(error.code) ?? { status: 503, retryable: false };
    return {
      ...mapping,
      code: error.code,
      message: error.message || fallbackMessage
    };
  }
  if (error instanceof TypeError || error instanceof SyntaxError) {
    return {
      status: 400,
      code: "INVALID_STORAGE_REQUEST",
      message: error.message || fallbackMessage,
      retryable: false
    };
  }
  return {
    status: 500,
    code: "VDT_STORAGE_INTERNAL_ERROR",
    message: error instanceof Error && error.message ? error.message : fallbackMessage,
    retryable: false
  };
}

export function storageWriteErrorResponse(
  error: unknown,
  fallbackMessage?: string
): Response {
  const mapped = mapStorageWriteError(error, fallbackMessage);
  const headers = mapped.retryAfterSeconds === undefined
    ? undefined
    : { "Retry-After": String(mapped.retryAfterSeconds) };
  return Response.json({
    schemaVersion: "vdt_storage_error_response.v1",
    ok: false,
    error: {
      code: mapped.code,
      message: mapped.message,
      retryable: mapped.retryable
    }
  }, {
    status: mapped.status,
    ...(headers ? { headers } : {})
  });
}

function parseRevisionCas(input: unknown): VdtRevisionCasV1 {
  const value = requireRecord(input, "VdtRevisionCasV1");
  assertExactKeys(
    value,
    ["schemaVersion", "activeRevisionId", "activeContentIdentity", "commitGeneration"],
    "VdtRevisionCasV1"
  );
  if (value.schemaVersion !== "vdt_revision_cas.v1") {
    throw new TypeError("VdtRevisionCasV1.schemaVersion is invalid.");
  }
  const rawActiveRevisionId = value.activeRevisionId;
  let activeRevisionId: string | null = null;
  if (rawActiveRevisionId !== null) {
    if (typeof rawActiveRevisionId !== "string") {
      throw new TypeError("activeRevisionId must be a string or null.");
    }
    activeRevisionId = assertSafeId(rawActiveRevisionId, "activeRevisionId");
  }
  const rawActiveContentIdentity = value.activeContentIdentity;
  let activeContentIdentity: RevisionContentIdentityV1 | null = null;
  if (rawActiveContentIdentity !== null) {
    assertRevisionContentIdentity(rawActiveContentIdentity, "activeContentIdentity");
    activeContentIdentity = rawActiveContentIdentity;
  }
  const commitGeneration = requireNonNegativeSafeInteger(value.commitGeneration, "commitGeneration");
  return {
    schemaVersion: "vdt_revision_cas.v1",
    activeRevisionId,
    activeContentIdentity,
    commitGeneration
  };
}

function parseRuntimeCas(input: unknown): ProjectRuntimeCasV1 {
  const value = requireRecord(input, "ProjectRuntimeCasV1");
  assertExactKeys(
    value,
    ["schemaVersion", "runtimeGeneration", "generationVersion"],
    "ProjectRuntimeCasV1"
  );
  if (value.schemaVersion !== "project_runtime_cas.v1") {
    throw new TypeError("ProjectRuntimeCasV1.schemaVersion is invalid.");
  }
  if (value.runtimeGeneration !== "v1" && value.runtimeGeneration !== "v2") {
    throw new TypeError("runtimeGeneration is invalid.");
  }
  return {
    schemaVersion: "project_runtime_cas.v1",
    runtimeGeneration: value.runtimeGeneration,
    generationVersion: requireNonNegativeSafeInteger(value.generationVersion, "generationVersion")
  };
}

function parseCreateVdtMetadata(input: unknown): CreateVdtMetadataV1 {
  const value = requireRecord(input, "CreateVdtMetadataV1");
  assertExactKeys(
    value,
    ["requestedVdtId", "name", "rootKpi", "unit", "timePeriod", "status", "metadata"],
    "CreateVdtMetadataV1"
  );
  const rawRequestedVdtId = value.requestedVdtId;
  let requestedVdtId: string | null = null;
  if (rawRequestedVdtId !== null) {
    if (typeof rawRequestedVdtId !== "string") {
      throw new TypeError("requestedVdtId must be a string or null.");
    }
    requestedVdtId = assertSafeId(rawRequestedVdtId, "requestedVdtId");
  }
  const name = requireNonEmptyString(value.name, "vdt.name");
  const rootKpi = requireNonEmptyString(value.rootKpi, "vdt.rootKpi");
  const unit = value.unit;
  if (unit !== null && typeof unit !== "string") {
    throw new TypeError("vdt.unit must be a string or null.");
  }
  const timePeriod = value.timePeriod;
  if (timePeriod !== null && typeof timePeriod !== "string") {
    throw new TypeError("vdt.timePeriod must be a string or null.");
  }
  if (
    value.status !== "draft" &&
    value.status !== "reviewed" &&
    value.status !== "approved" &&
    value.status !== "archived"
  ) {
    throw new TypeError("vdt.status is invalid.");
  }
  const metadata = value.metadata;
  if (metadata !== null) assertDensePlainJson(metadata, "vdt.metadata");
  return {
    requestedVdtId,
    name,
    rootKpi,
    unit,
    timePeriod,
    status: value.status,
    metadata
  };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isPlainRecord(value)) throw new TypeError(`${label} must be a JSON object.`);
  return value;
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

function requireNonNegativeSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer.`);
  }
  return value as number;
}

function validateStrictProjectRequest(value: unknown): void {
  try {
    validateStrictVdtProjectCommit(value);
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new TypeError(
      error instanceof Error
        ? error.message
        : "Project snapshot failed strict validation."
    );
  }
}
