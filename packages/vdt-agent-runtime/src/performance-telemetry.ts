/** Untrusted measurement snapshot. This type must never carry a qualification
 * grant, isolation verdict, or capability evidence hash. */

export const AGENT_RUN_PERFORMANCE_TELEMETRY_GRANT_FIELD_DENYLIST = [
  "qualificationStatus",
  "toolIsolation",
  "capabilityEvidenceHash",
  "qualificationGranted"
] as const;

export interface AgentRunPerformanceTelemetry {
  decisionLatenciesMs: number[];
  toolCallCount: number;
  outputBytes: number;
  repairCount: number;
  segmentCount: number;
  processSpawnCount: number;
  logicalSessionCount: number;
  resumeCount: number;
  opaqueSessionIdHash: string | null;
  sameOpaqueSessionAcrossSegments: boolean;
  segmentInferenceMs: number[];
}

const OPAQUE_SESSION_ID_HASH = /^sha256:[a-f0-9]{64}$/;

export function emptyAgentRunPerformanceTelemetry(): AgentRunPerformanceTelemetry {
  return {
    decisionLatenciesMs: [],
    toolCallCount: 0,
    outputBytes: 0,
    repairCount: 0,
    segmentCount: 0,
    processSpawnCount: 0,
    logicalSessionCount: 0,
    resumeCount: 0,
    opaqueSessionIdHash: null,
    sameOpaqueSessionAcrossSegments: false,
    segmentInferenceMs: []
  };
}

export function hydrateAgentRunPerformanceTelemetry(value: unknown): AgentRunPerformanceTelemetry {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return emptyAgentRunPerformanceTelemetry();
  }
  const record = value as Record<string, unknown>;
  const segmentInferenceMs = asNonNegativeNumberArray(
    record.segmentInferenceMs ?? record.decisionLatenciesMs
  );
  return {
    decisionLatenciesMs: asNonNegativeNumberArray(record.decisionLatenciesMs),
    toolCallCount: asNonNegativeInteger(record.toolCallCount),
    outputBytes: asNonNegativeInteger(record.outputBytes),
    repairCount: asNonNegativeInteger(record.repairCount),
    segmentCount: asNonNegativeInteger(record.segmentCount),
    processSpawnCount: asNonNegativeInteger(record.processSpawnCount),
    logicalSessionCount: record.logicalSessionCount === 1 ? 1 : 0,
    resumeCount: asNonNegativeInteger(record.resumeCount),
    opaqueSessionIdHash: asOpaqueSessionIdHash(record.opaqueSessionIdHash),
    sameOpaqueSessionAcrossSegments: record.sameOpaqueSessionAcrossSegments === true,
    segmentInferenceMs
  };
}

function asNonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function asNonNegativeNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is number =>
    typeof entry === "number" && Number.isFinite(entry) && entry >= 0
  );
}

function asOpaqueSessionIdHash(value: unknown): string | null {
  return typeof value === "string" && OPAQUE_SESSION_ID_HASH.test(value) ? value : null;
}
