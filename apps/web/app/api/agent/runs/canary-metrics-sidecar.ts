import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  AGENT_RUN_PERFORMANCE_TELEMETRY_GRANT_FIELD_DENYLIST,
  assertMetricsOnly,
  type AgentRunPerformanceTelemetry,
  type AgentSessionBinding
} from "@vdt-studio/vdt-agent-runtime";
import { resolveTrustedStorageWriteMode } from "../../vdt/storage-write-adapter";
import { resolveConfiguredDataDir } from "./agent-data-dir";

/** Untrusted canary measurements. Never a qualification grant. Append-only JSONL. */
export const CANARY_METRICS_SIDECAR_DIRECTORY_NAME = "canary-metrics";
export const CANARY_METRICS_SIDECAR_FILE_NAME = "counters.jsonl";
export const CANARY_METRICS_SIDECAR_RECORD_TYPE = "vdt_canary_metrics_counters";
export const CANARY_METRICS_TERMINAL_STATUSES = [
  "succeeded",
  "failed",
  "cancelled",
  "recovery_required"
] as const;

export type CanaryMetricsTerminalStatus = (typeof CANARY_METRICS_TERMINAL_STATUSES)[number];

const SHA256 = /^sha256:[a-f0-9]{64}$/;

const canaryMetricsIdentitySchema = z.object({
  executionProfile: z.literal("external_cli_agent"),
  engineAdapterId: z.string().trim().min(1).max(160),
  backendId: z.string().trim().min(1).max(160),
  protocolVersion: z.string().trim().min(1).max(120),
  cliVersion: z.string().trim().min(1).max(120).nullable(),
  toolCatalogHash: z.string().regex(SHA256),
  os: z.string().trim().min(1).max(80),
  arch: z.string().trim().min(1).max(80)
}).strict();

export const canaryMetricsSidecarRecordSchema = z.object({
  schemaVersion: z.literal(1),
  recordType: z.literal(CANARY_METRICS_SIDECAR_RECORD_TYPE),
  recordedAt: z.string().datetime({ offset: true }),
  terminalStatus: z.enum(CANARY_METRICS_TERMINAL_STATUSES),
  runIdHash: z.string().regex(SHA256),
  opaqueSessionIdHash: z.string().regex(SHA256).nullable(),
  segmentCount: z.number().int().nonnegative(),
  processSpawnCount: z.number().int().nonnegative(),
  logicalSessionCount: z.union([z.literal(0), z.literal(1)]),
  resumeCount: z.number().int().nonnegative(),
  sameOpaqueSessionAcrossSegments: z.boolean(),
  segmentInferenceMs: z.array(z.number().nonnegative()),
  decisionLatenciesMs: z.array(z.number().nonnegative()),
  toolCallCount: z.number().int().nonnegative(),
  outputBytes: z.number().int().nonnegative(),
  repairCount: z.number().int().nonnegative(),
  elapsedWallMs: z.number().int().nonnegative(),
  identity: canaryMetricsIdentitySchema,
  autoAnswered: z.boolean().optional()
}).strict().superRefine((value, ctx) => {
  for (const key of AGENT_RUN_PERFORMANCE_TELEMETRY_GRANT_FIELD_DENYLIST) {
    if (Object.prototype.hasOwnProperty.call(value, key) || Object.prototype.hasOwnProperty.call(value.identity, key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${key} is not allowed on canary metrics sidecar records.`
      });
    }
  }
  try {
    assertMetricsOnly(value);
  } catch (error) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: error instanceof Error ? error.message : "Sidecar record is not metrics-only."
    });
  }
});

export type CanaryMetricsSidecarRecord = z.infer<typeof canaryMetricsSidecarRecordSchema>;

export interface BuildCanaryMetricsSidecarRecordInput {
  runId: string;
  terminalStatus: CanaryMetricsTerminalStatus;
  telemetry: AgentRunPerformanceTelemetry;
  binding: AgentSessionBinding;
  createdAt: string;
  recordedAt?: string | undefined;
}

export interface WriteCanaryMetricsSidecarAtTerminalInput {
  runId: string;
  supervisorStatus: string;
  telemetry: AgentRunPerformanceTelemetry | undefined;
  binding: AgentSessionBinding;
  createdAt: string;
}

function isTerminalCanaryStatus(status: string): status is CanaryMetricsTerminalStatus {
  return (CANARY_METRICS_TERMINAL_STATUSES as readonly string[]).includes(status);
}

function isUnverifiedExternalCanary(binding: AgentSessionBinding): boolean {
  return binding.executionProfile === "external_cli_agent"
    && binding.qualificationStatus !== "qualified";
}

/** Sibling of `app.sqlite` under the same data dir: `.vdt/canary-metrics/counters.jsonl`. */
export function resolveCanaryMetricsSidecarPath(): string {
  const dataDir = resolveConfiguredDataDir(process.cwd());
  const filePath = path.join(dataDir, CANARY_METRICS_SIDECAR_DIRECTORY_NAME, CANARY_METRICS_SIDECAR_FILE_NAME);
  if (
    path.basename(filePath) !== CANARY_METRICS_SIDECAR_FILE_NAME
    || path.basename(path.dirname(filePath)) !== CANARY_METRICS_SIDECAR_DIRECTORY_NAME
    || filePath.endsWith(`${path.sep}app.sqlite`)
    || path.basename(filePath) === "app.sqlite"
  ) {
    throw new Error("Canary metrics sidecar path refused.");
  }
  return filePath;
}

export function hashCanaryMetricsRunId(runId: string): string {
  return `sha256:${createHash("sha256").update(runId, "utf8").digest("hex")}`;
}

export function buildCanaryMetricsSidecarRecord(
  input: BuildCanaryMetricsSidecarRecordInput
): CanaryMetricsSidecarRecord {
  if (input.binding.executionProfile !== "external_cli_agent") {
    throw new Error("Canary metrics sidecar records are for unverified external CLI canaries.");
  }
  const recordedAt = input.recordedAt ?? new Date().toISOString();
  const createdMs = Date.parse(input.createdAt);
  const recordedMs = Date.parse(recordedAt);
  const elapsedWallMs = Number.isFinite(createdMs) && Number.isFinite(recordedMs)
    ? Math.max(0, Math.round(recordedMs - createdMs))
    : 0;
  const record: CanaryMetricsSidecarRecord = {
    schemaVersion: 1,
    recordType: CANARY_METRICS_SIDECAR_RECORD_TYPE,
    recordedAt,
    terminalStatus: input.terminalStatus,
    runIdHash: hashCanaryMetricsRunId(input.runId),
    opaqueSessionIdHash: input.telemetry.opaqueSessionIdHash,
    segmentCount: input.telemetry.segmentCount,
    processSpawnCount: input.telemetry.processSpawnCount,
    logicalSessionCount: input.telemetry.logicalSessionCount === 1 ? 1 : 0,
    resumeCount: input.telemetry.resumeCount,
    sameOpaqueSessionAcrossSegments: input.telemetry.sameOpaqueSessionAcrossSegments === true,
    segmentInferenceMs: [...input.telemetry.segmentInferenceMs],
    decisionLatenciesMs: [...input.telemetry.decisionLatenciesMs],
    toolCallCount: input.telemetry.toolCallCount,
    outputBytes: input.telemetry.outputBytes,
    repairCount: input.telemetry.repairCount,
    elapsedWallMs,
    identity: {
      executionProfile: "external_cli_agent",
      engineAdapterId: input.binding.engineAdapterId,
      backendId: input.binding.backendId,
      protocolVersion: input.binding.protocolVersion,
      cliVersion: input.binding.cliVersion,
      toolCatalogHash: input.binding.toolCatalogHash,
      os: process.platform,
      arch: process.arch
    }
  };
  return canaryMetricsSidecarRecordSchema.parse(record);
}

/** Append one validated metrics-only line. Never updates or deletes. I/O errors are swallowed. */
export function appendCanaryMetricsSidecarRecord(record: CanaryMetricsSidecarRecord): void {
  try {
    if (!resolveTrustedStorageWriteMode()) return;
    const parsed = canaryMetricsSidecarRecordSchema.parse(record);
    const filePath = resolveCanaryMetricsSidecarPath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, `${JSON.stringify(parsed)}\n`, { encoding: "utf8" });
  } catch {
    // Sidecar I/O must never fail the user-visible run.
  }
}

/** Call from Supervisor terminal/release only — never per event. */
export function writeCanaryMetricsSidecarAtTerminal(input: WriteCanaryMetricsSidecarAtTerminalInput): void {
  try {
    if (!resolveTrustedStorageWriteMode()) return;
    if (!isTerminalCanaryStatus(input.supervisorStatus)) return;
    if (!input.telemetry) return;
    if (!isUnverifiedExternalCanary(input.binding)) return;
    appendCanaryMetricsSidecarRecord(buildCanaryMetricsSidecarRecord({
      runId: input.runId,
      terminalStatus: input.supervisorStatus,
      telemetry: input.telemetry,
      binding: input.binding,
      createdAt: input.createdAt
    }));
  } catch {
    // Sidecar I/O must never fail the user-visible run.
  }
}
