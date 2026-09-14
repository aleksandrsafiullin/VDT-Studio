import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_RUN_PERFORMANCE_TELEMETRY_GRANT_FIELD_DENYLIST,
  assertMetricsOnly,
  emptyAgentRunPerformanceTelemetry,
  FORBIDDEN_METRICS_KEYS,
  type AgentSessionBinding
} from "@vdt-studio/vdt-agent-runtime";
import {
  appendCanaryMetricsSidecarRecord,
  buildCanaryMetricsSidecarRecord,
  CANARY_METRICS_SIDECAR_DIRECTORY_NAME,
  CANARY_METRICS_SIDECAR_FILE_NAME,
  canaryMetricsSidecarRecordSchema,
  hashCanaryMetricsRunId,
  resolveCanaryMetricsSidecarPath,
  writeCanaryMetricsSidecarAtTerminal
} from "./canary-metrics-sidecar";
import { resolveConfiguredDataDir } from "./agent-data-dir";
import {
  CanaryMetricsSidecarReadError,
  readCanaryMetricsSidecarRecords
} from "./canary-metrics-sidecar-read";

const temporaryDirectories: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function tempDataDir(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vdt-qes-02-sidecar-"));
  temporaryDirectories.push(directory);
  return directory;
}

function sampleBinding(): AgentSessionBinding {
  const hash = `sha256:${"ab".repeat(32)}`;
  return {
    schemaVersion: 2,
    bindingId: "session-binding:qes-02",
    runId: "run_qes_02",
    projectId: "project_qes_02",
    executionProfile: "external_cli_agent",
    engineId: "codex-resume-checkpoint",
    engineAdapterId: "codex-resume-checkpoint-v1",
    backendId: "codex_subscription",
    modelId: "codex",
    protocolVersion: "checkpoint-turn-v1",
    cliVersion: "0.146.0",
    toolIsolation: "unverified",
    qualificationStatus: "unverified",
    capabilityEvidenceHash: null,
    settingsHash: hash,
    capabilityProfileHash: hash,
    toolCatalogHash: hash,
    externalSessionId: null,
    sessionEpoch: 1,
    boundAt: "2026-09-13T12:00:00.000Z"
  };
}

function sampleRecord() {
  return buildCanaryMetricsSidecarRecord({
    runId: "run_qes_02",
    terminalStatus: "cancelled",
    telemetry: {
      ...emptyAgentRunPerformanceTelemetry(),
      segmentCount: 2,
      processSpawnCount: 2,
      logicalSessionCount: 1,
      resumeCount: 1,
      opaqueSessionIdHash: `sha256:${"cd".repeat(32)}`,
      sameOpaqueSessionAcrossSegments: true,
      segmentInferenceMs: [19, 18.4],
      decisionLatenciesMs: [19, 18.4],
      toolCallCount: 2
    },
    binding: sampleBinding(),
    createdAt: "2026-09-13T12:00:00.000Z",
    recordedAt: "2026-09-13T12:01:00.000Z"
  });
}

function walkTypescriptFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const next = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        visit(next);
        continue;
      }
      if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx") || entry.name.endsWith(".mjs")) {
        files.push(next);
      }
    }
  };
  visit(root);
  return files;
}

describe("canary metrics sidecar writer", () => {
  it("builds a metrics-only record with hashed ids and no grant or autoAnswered fields", () => {
    const record = sampleRecord();
    expect(record.runIdHash).toBe(hashCanaryMetricsRunId("run_qes_02"));
    expect(JSON.stringify(record)).not.toContain("run_qes_02");
    expect(record).not.toHaveProperty("runId");
    expect(record).not.toHaveProperty("autoAnswered");
    for (const key of AGENT_RUN_PERFORMANCE_TELEMETRY_GRANT_FIELD_DENYLIST) {
      expect(record).not.toHaveProperty(key);
      expect(record.identity).not.toHaveProperty(key);
    }
    expect(() => assertMetricsOnly(record)).not.toThrow();
    expect(record.elapsedWallMs).toBe(60_000);
    expect(record.identity).toMatchObject({
      executionProfile: "external_cli_agent",
      engineAdapterId: "codex-resume-checkpoint-v1",
      backendId: "codex_subscription"
    });
  });

  it("rejects grant keys, prompts, and plaintext run ids via the Zod schema", () => {
    const record = sampleRecord();
    expect(() => canaryMetricsSidecarRecordSchema.parse({
      ...record,
      qualificationStatus: "qualified"
    })).toThrow();
    expect(() => canaryMetricsSidecarRecordSchema.parse({
      ...record,
      toolIsolation: "hard_verified"
    })).toThrow();
    expect(() => canaryMetricsSidecarRecordSchema.parse({
      ...record,
      capabilityEvidenceHash: `sha256:${"ee".repeat(32)}`
    })).toThrow();
    expect(() => canaryMetricsSidecarRecordSchema.parse({
      ...record,
      qualificationGranted: true
    })).toThrow();
    expect(() => canaryMetricsSidecarRecordSchema.parse({
      ...record,
      prompt: "build a tree"
    })).toThrow();
    expect(() => canaryMetricsSidecarRecordSchema.parse({
      ...record,
      runId: "run_qes_02"
    })).toThrow();
  });

  it("appends only, never updates, and keeps the path off app.sqlite", () => {
    const dataDir = tempDataDir();
    vi.stubEnv("VDT_APP_MODE", "development_web");
    vi.stubEnv("VDT_DATA_DIR", dataDir);
    const filePath = resolveCanaryMetricsSidecarPath();
    expect(filePath).toBe(path.join(dataDir, CANARY_METRICS_SIDECAR_DIRECTORY_NAME, CANARY_METRICS_SIDECAR_FILE_NAME));
    expect(filePath.endsWith("app.sqlite")).toBe(false);
    expect(path.basename(filePath)).toBe("counters.jsonl");
    expect(filePath).toBe(path.join(
      resolveConfiguredDataDir(),
      CANARY_METRICS_SIDECAR_DIRECTORY_NAME,
      CANARY_METRICS_SIDECAR_FILE_NAME
    ));

    const first = sampleRecord();
    const second = buildCanaryMetricsSidecarRecord({
      runId: "run_qes_02_b",
      terminalStatus: "failed",
      telemetry: emptyAgentRunPerformanceTelemetry(),
      binding: sampleBinding(),
      createdAt: "2026-09-13T12:00:00.000Z",
      recordedAt: "2026-09-13T12:02:00.000Z"
    });
    appendCanaryMetricsSidecarRecord(first);
    appendCanaryMetricsSidecarRecord(second);
    const records = readCanaryMetricsSidecarRecords();
    expect(records).toHaveLength(2);
    expect(records[0]?.runIdHash).toBe(first.runIdHash);
    expect(records[1]?.runIdHash).toBe(second.runIdHash);
    expect(records[1]?.terminalStatus).toBe("failed");
  });

  it("skips writes outside trusted-local mode and swallows I/O failures", () => {
    const dataDir = tempDataDir();
    vi.stubEnv("VDT_APP_MODE", "hosted_web");
    vi.stubEnv("VDT_DATA_DIR", dataDir);
    appendCanaryMetricsSidecarRecord(sampleRecord());
    expect(fs.existsSync(path.join(dataDir, CANARY_METRICS_SIDECAR_DIRECTORY_NAME, CANARY_METRICS_SIDECAR_FILE_NAME))).toBe(false);

    vi.stubEnv("VDT_APP_MODE", "development_web");
    vi.spyOn(fs, "appendFileSync").mockImplementation(() => {
      throw new Error("disk full");
    });
    expect(() => appendCanaryMetricsSidecarRecord(sampleRecord())).not.toThrow();
    expect(() => writeCanaryMetricsSidecarAtTerminal({
      runId: "run_qes_02",
      supervisorStatus: "cancelled",
      telemetry: emptyAgentRunPerformanceTelemetry(),
      binding: sampleBinding(),
      createdAt: "2026-09-13T12:00:00.000Z"
    })).not.toThrow();
  });

  it("does not write on non-terminal statuses or qualified bindings", () => {
    const dataDir = tempDataDir();
    vi.stubEnv("VDT_APP_MODE", "development_web");
    vi.stubEnv("VDT_DATA_DIR", dataDir);
    writeCanaryMetricsSidecarAtTerminal({
      runId: "run_qes_02",
      supervisorStatus: "running",
      telemetry: emptyAgentRunPerformanceTelemetry(),
      binding: sampleBinding(),
      createdAt: "2026-09-13T12:00:00.000Z"
    });
    writeCanaryMetricsSidecarAtTerminal({
      runId: "run_qes_02",
      supervisorStatus: "cancelled",
      telemetry: emptyAgentRunPerformanceTelemetry(),
      binding: { ...sampleBinding(), qualificationStatus: "qualified", toolIsolation: "hard_verified" },
      createdAt: "2026-09-13T12:00:00.000Z"
    });
    expect(fs.existsSync(resolveCanaryMetricsSidecarPath())).toBe(false);
  });

  it("treats a missing sidecar as an evidence-channel failure, not zero segments", () => {
    const missing = path.join(tempDataDir(), "canary-metrics", "counters.jsonl");
    try {
      readCanaryMetricsSidecarRecords(missing);
      throw new Error("expected missing sidecar to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(CanaryMetricsSidecarReadError);
      expect((error as CanaryMetricsSidecarReadError).code).toBe("MISSING_SIDECAR");
    }
  });

  it("keeps .vdt gitignored and the writer free of a reader API", async () => {
    const gitignore = fs.readFileSync(path.join(process.cwd(), ".gitignore"), "utf8");
    expect(gitignore.split(/\r?\n/u).map((line) => line.trim())).toContain(".vdt");

    const writer = await import("./canary-metrics-sidecar");
    expect(Object.keys(writer).filter((key) => /^(read|load)/u.test(key))).toEqual([]);

    const supervisorSource = fs.readFileSync(path.join(process.cwd(), "apps/web/app/api/agent/runs/supervisor-runtime.ts"), "utf8");
    expect(supervisorSource).toMatch(/from ["']\.\/canary-metrics-sidecar["']/u);
    expect(supervisorSource).not.toMatch(/canary-metrics-sidecar-read/u);
    expect(supervisorSource).not.toMatch(/readCanaryMetricsSidecarRecords/u);

    const deniedRoots = [
      path.join(process.cwd(), "packages/vdt-agent-runtime"),
      path.join(process.cwd(), "packages/vdt-storage"),
      path.join(process.cwd(), "packages/vdt-agent-runtime/src/tool-gateway.ts"),
      path.join(process.cwd(), "packages/vdt-agent-runtime/src/finish-verifier.ts"),
      path.join(process.cwd(), "apps/web/app/api/agent/runs/sqlite-supervisor-persistence.ts")
    ];
    for (const root of deniedRoots) {
      const files = fs.statSync(root).isDirectory() ? walkTypescriptFiles(root) : [root];
      for (const file of files) {
        const source = fs.readFileSync(file, "utf8");
        expect(source, file).not.toMatch(/canary-metrics-sidecar/u);
      }
    }

    expect(FORBIDDEN_METRICS_KEYS.has("qualificationstatus")).toBe(false);

    const sidecarSource = fs.readFileSync(
      path.join(process.cwd(), "apps/web/app/api/agent/runs/canary-metrics-sidecar.ts"),
      "utf8"
    );
    expect(sidecarSource).not.toMatch(/import\.meta\.url/u);
    expect(sidecarSource).not.toMatch(/new URL\(/u);
    expect(sidecarSource).toMatch(/from ["']\.\/agent-data-dir["']/u);
  });

  it("defaults to cwd/.vdt/canary-metrics/counters.jsonl like app.sqlite", () => {
    vi.stubEnv("NODE_ENV", "development");
    const previousDataDir = process.env.VDT_DATA_DIR;
    delete process.env.VDT_DATA_DIR;
    try {
      expect(resolveCanaryMetricsSidecarPath()).toBe(path.join(
        process.cwd(),
        ".vdt",
        CANARY_METRICS_SIDECAR_DIRECTORY_NAME,
        CANARY_METRICS_SIDECAR_FILE_NAME
      ));
      expect(resolveCanaryMetricsSidecarPath().endsWith("app.sqlite")).toBe(false);
    } finally {
      if (previousDataDir === undefined) delete process.env.VDT_DATA_DIR;
      else process.env.VDT_DATA_DIR = previousDataDir;
    }
  });
});
