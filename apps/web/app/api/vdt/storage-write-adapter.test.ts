import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { productionVolumeProject } from "@vdt-studio/vdt-core";
import { VdtStorageError } from "@vdt-studio/storage";
import {
  createStorageWriteActor,
  mapStorageWriteError,
  parseCreateVdtWithInitialHttpRequest,
  parseManualVdtRevisionCommitRequest,
  resolveTrustedStorageWriteMode,
  storageWriteErrorResponse
} from "./storage-write-adapter";

const runtimeCas = {
  schemaVersion: "project_runtime_cas.v1",
  runtimeGeneration: "v1",
  generationVersion: 1
} as const;

const revisionCas = {
  schemaVersion: "vdt_revision_cas.v1",
  activeRevisionId: null,
  activeContentIdentity: null,
  commitGeneration: 0
} as const;

function manualRequest() {
  return {
    schemaVersion: "manual_vdt_revision_commit_request.v1",
    idempotencyKey: "manual-save:vdt:operation",
    expectedHead: revisionCas,
    expectedRuntime: runtimeCas,
    summary: "Manual save",
    project: productionVolumeProject
  };
}

function createRequest() {
  return {
    schemaVersion: "create_vdt_with_initial_http_request.v1",
    idempotencyKey: "create-vdt:project:operation",
    expectedRuntime: runtimeCas,
    vdt: {
      requestedVdtId: "vdt_initial",
      name: "Production VDT",
      rootKpi: "Production Volume",
      unit: "tonnes",
      timePeriod: "year",
      status: "draft",
      metadata: null
    },
    project: productionVolumeProject
  };
}

describe("trusted storage write mode and actor", () => {
  it.each([
    [{ VDT_APP_MODE: "desktop" }, "desktop"],
    [{ VDT_APP_MODE: "development_web" }, "development_web"],
    [{ NEXT_PUBLIC_VDT_APP_MODE: "desktop" }, "desktop"],
    [{ NEXT_PUBLIC_VDT_APP_MODE: "development_web" }, "development_web"],
    [{ VDT_APP_MODE: "hosted_web" }, null],
    [{ VDT_APP_MODE: "" }, null],
    [{ VDT_APP_MODE: "invalid" }, null],
    [{}, null]
  ] as const)("resolves only explicit trusted modes from %o", (env, expected) => {
    expect(resolveTrustedStorageWriteMode(env)).toBe(expected);
  });

  it("does not fall through from an invalid server mode to a public local mode", () => {
    expect(resolveTrustedStorageWriteMode({
      VDT_APP_MODE: "invalid",
      NEXT_PUBLIC_VDT_APP_MODE: "desktop"
    })).toBeNull();
  });

  it("never treats Host as write authority", () => {
    expect(resolveTrustedStorageWriteMode({
      HOST: "localhost:3000"
    } as never)).toBeNull();
  });

  it("creates the exact frozen local actor", () => {
    expect(createStorageWriteActor("project_local", {
      env: { VDT_APP_MODE: "desktop" },
      now: () => "2026-07-23T12:34:56.000Z"
    })).toEqual({
      schemaVersion: "actor_context.v1",
      principalId: "vdt_studio_local_application",
      projectId: "project_local",
      roles: ["vdt_writer"],
      authSource: "desktop_local",
      sessionId: "vdt_studio_local_runtime",
      issuedAt: "2026-07-23T12:34:56.000Z"
    });
  });

  it("fails closed before constructing an actor in hosted or unknown mode", () => {
    expect(() => createStorageWriteActor("project_local", {
      env: { VDT_APP_MODE: "hosted_web" }
    })).toThrowError(expect.objectContaining({
      code: "HOSTED_REVISION_WRITES_DISABLED"
    }));
  });
});

describe("strict W0.1 write DTOs", () => {
  it("accepts the exact manual request and preserves its raw strict project", () => {
    const input = manualRequest();
    const parsed = parseManualVdtRevisionCommitRequest(input);

    expect(parsed).toEqual(input);
    expect(parsed.project).toBe(input.project);
  });

  it.each(["actor", "source", "validation", "calculation", "unexpected"])(
    "rejects caller-owned or unknown manual field %s",
    (field) => {
      expect(() => parseManualVdtRevisionCommitRequest({
        ...manualRequest(),
        [field]: field === "actor" ? {} : "forbidden"
      })).toThrow(/unknown key/);
    }
  );

  it("rejects unknown nested CAS fields and lossy project input", () => {
    expect(() => parseManualVdtRevisionCommitRequest({
      ...manualRequest(),
      expectedHead: { ...revisionCas, pendingRevisionId: null }
    })).toThrow(/unknown key/);

    expect(() => parseManualVdtRevisionCommitRequest({
      ...manualRequest(),
      project: { ...productionVolumeProject, unknown: true }
    })).toThrow(/round-trip/);
  });

  it("classifies ordinary strict-project graph validation failures as HTTP 400", () => {
    let failure: unknown;
    try {
      parseManualVdtRevisionCommitRequest({
        ...manualRequest(),
        project: {
          ...productionVolumeProject,
          rootNodeId: "missing_root"
        }
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(TypeError);
    expect(mapStorageWriteError(failure)).toMatchObject({
      status: 400,
      code: "INVALID_STORAGE_REQUEST",
      retryable: false
    });
  });

  it("accepts only the exact combined-create request", () => {
    const input = createRequest();
    expect(parseCreateVdtWithInitialHttpRequest(input)).toEqual(input);

    expect(() => parseCreateVdtWithInitialHttpRequest({
      ...input,
      source: "agent"
    })).toThrow(/unknown key/);
    expect(() => parseCreateVdtWithInitialHttpRequest({
      ...input,
      vdt: { ...input.vdt, extra: true }
    })).toThrow(/unknown key/);
    expect(() => parseCreateVdtWithInitialHttpRequest({
      ...input,
      project: null
    })).toThrow();
  });
});

describe("frozen storage error mapping", () => {
  it.each([
    ["INVALID_STORAGE_REQUEST", 400, false],
    ["HOSTED_REVISION_WRITES_DISABLED", 403, false],
    ["ACTOR_PROJECT_MISMATCH", 403, false],
    ["PROJECT_NOT_FOUND", 404, false],
    ["VDT_NOT_FOUND", 404, false],
    ["REVISION_CONFLICT", 409, false],
    ["IDEMPOTENCY_KEY_REUSE", 409, false],
    ["PROJECT_WRITE_STATE_CHANGED", 409, false],
    ["VDT_ALREADY_EXISTS", 409, false],
    ["VDT_NOT_READY", 409, false],
    ["REVISION_IN_PROGRESS", 409, true],
    ["STALE_ATTEMPT_OWNER", 409, true],
    ["MIGRATION_IN_PROGRESS", 409, true],
    ["PROJECT_WRITE_DISABLED", 423, false],
    ["MIGRATION_RECOVERY_REQUIRED", 503, false],
    ["PROJECT_RUNTIME_STATE_MISSING", 503, false],
    ["VDT_REVISION_HEAD_MISSING", 503, false],
    ["AMBIGUOUS_REVISION_RECOVERY", 503, false],
    ["IDEMPOTENCY_ATTEMPT_MISSING", 503, false],
    ["IDEMPOTENCY_FINALIZE_CONFLICT", 503, false],
    ["IDEMPOTENCY_RESULT_CORRUPT", 503, false],
    ["IDEMPOTENCY_RESULT_MISSING", 503, false],
    ["REVISION_COMMIT_REJECTED", 503, false],
    ["REVISION_FINALIZE_CONFLICT", 503, false],
    ["REVISION_FINALIZE_FAILED", 503, false],
    ["REVISION_QUARANTINED", 503, false],
    ["STORAGE_CAPABILITY_UNSUPPORTED", 503, false],
    ["VDT_LIFECYCLE_CONFLICT", 503, false]
  ] as const)("maps %s to HTTP %i", (code, status, retryable) => {
    expect(mapStorageWriteError(new VdtStorageError(code, "mapped", !retryable))).toMatchObject({
      code,
      status,
      retryable
    });
  });

  it("maps an unknown storage error to non-retryable 503", () => {
    expect(mapStorageWriteError(new VdtStorageError("FUTURE_STORAGE_ERROR", "future", true))).toEqual({
      status: 503,
      code: "FUTURE_STORAGE_ERROR",
      message: "future",
      retryable: false
    });
  });

  it("maps validation and unexpected errors to the frozen fallbacks", () => {
    expect(mapStorageWriteError(new TypeError("invalid"))).toMatchObject({
      status: 400,
      code: "INVALID_STORAGE_REQUEST",
      retryable: false
    });
    expect(mapStorageWriteError(new Error("unexpected"))).toMatchObject({
      status: 500,
      code: "VDT_STORAGE_INTERNAL_ERROR",
      retryable: false
    });
  });

  it("emits the versioned envelope and Retry-After only for retryable conflicts", async () => {
    const response = storageWriteErrorResponse(
      new VdtStorageError("REVISION_IN_PROGRESS", "busy", true)
    );

    expect(response.status).toBe(409);
    expect(response.headers.get("Retry-After")).toBe("1");
    expect(await response.json()).toEqual({
      schemaVersion: "vdt_storage_error_response.v1",
      ok: false,
      error: {
        code: "REVISION_IN_PROGRESS",
        message: "busy",
        retryable: true
      }
    });

    const terminal = storageWriteErrorResponse(
      new VdtStorageError("REVISION_CONFLICT", "stale")
    );
    expect(terminal.headers.get("Retry-After")).toBeNull();

    const migrationRecovery = storageWriteErrorResponse(
      new VdtStorageError(
        "MIGRATION_RECOVERY_REQUIRED",
        "manual recovery required",
        false
      )
    );
    expect(migrationRecovery.status).toBe(503);
    expect(migrationRecovery.headers.get("Retry-After")).toBeNull();
    expect(await migrationRecovery.json()).toMatchObject({
      error: {
        code: "MIGRATION_RECOVERY_REQUIRED",
        retryable: false
      }
    });
  });
});

describe("production writer boundary", () => {
  it("keeps the V1 compatibility writer out of non-test web sources", () => {
    const hits = sourceFiles(path.join(process.cwd(), "apps", "web"))
      .filter((filePath) => !filePath.includes(".test."))
      .filter((filePath) => fs.readFileSync(filePath, "utf8").includes("saveVdtRevision("))
      .map((filePath) => path.relative(process.cwd(), filePath));

    expect(hits).toEqual([]);
  });
});

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(filePath));
    } else if (/\.(?:[cm]?[jt]sx?)$/.test(entry.name)) {
      files.push(filePath);
    }
  }
  return files;
}
