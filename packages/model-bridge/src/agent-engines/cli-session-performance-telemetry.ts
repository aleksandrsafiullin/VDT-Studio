import type { AgentRunPerformanceTelemetry } from "@vdt-studio/vdt-agent-runtime";
import { emptyAgentRunPerformanceTelemetry } from "@vdt-studio/vdt-agent-runtime";
import { hashText } from "./checkpoint-transport-common";

export function hashOpaqueSessionId(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  return hashText(value);
}

function isSessionMismatchError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && typeof error.code === "string"
    && error.code.includes("SESSION_MISMATCH")
  );
}

export class CliSessionPerformanceCounters {
  segmentCount = 0;
  processSpawnCount = 0;
  resumeCount = 0;
  toolCallCount = 0;
  outputBytes = 0;
  repairCount = 0;
  opaqueSessionIdHash: string | null = null;
  sameOpaqueSessionAcrossSegments = false;
  readonly segmentInferenceMs: number[] = [];

  hydrateExistingSession(sessionId: string | null, segmentCount: number): void {
    this.segmentCount = Math.max(0, segmentCount);
    if (sessionId) this.bindSessionId(sessionId);
  }

  bindSessionId(sessionId: string): void {
    const hash = hashOpaqueSessionId(sessionId);
    if (hash === null) {
      this.sameOpaqueSessionAcrossSegments = false;
      return;
    }
    if (this.opaqueSessionIdHash === null) {
      this.opaqueSessionIdHash = hash;
      this.sameOpaqueSessionAcrossSegments = true;
      return;
    }
    if (this.opaqueSessionIdHash !== hash) this.sameOpaqueSessionAcrossSegments = false;
  }

  noteSessionMismatch(): void {
    this.sameOpaqueSessionAcrossSegments = false;
  }

  syncProcessSpawnCount(count: number | undefined): void {
    if (typeof count === "number" && Number.isFinite(count) && count >= 0) {
      this.processSpawnCount = count;
    }
  }

  recordSuccessfulSegment(input: {
    mode: "open" | "resume";
    sessionId: string;
    processSpawnCount?: number;
    inferenceMs?: number;
    outputBytes?: number;
  }): void {
    this.segmentCount += 1;
    if (input.mode === "resume") this.resumeCount += 1;
    if (input.processSpawnCount !== undefined) {
      this.processSpawnCount += Math.max(0, input.processSpawnCount);
    }
    this.bindSessionId(input.sessionId);
    if (input.inferenceMs !== undefined) this.segmentInferenceMs.push(Math.max(0, input.inferenceMs));
    if (input.outputBytes !== undefined) this.outputBytes += Math.max(0, input.outputBytes);
  }

  snapshot(): AgentRunPerformanceTelemetry {
    const bound = this.opaqueSessionIdHash !== null;
    const sameSession = bound && this.sameOpaqueSessionAcrossSegments;
    return {
      ...emptyAgentRunPerformanceTelemetry(),
      decisionLatenciesMs: [...this.segmentInferenceMs],
      toolCallCount: this.toolCallCount,
      outputBytes: this.outputBytes,
      repairCount: this.repairCount,
      segmentCount: this.segmentCount,
      processSpawnCount: this.processSpawnCount,
      logicalSessionCount: sameSession ? 1 : 0,
      resumeCount: this.resumeCount,
      opaqueSessionIdHash: this.opaqueSessionIdHash,
      sameOpaqueSessionAcrossSegments: sameSession,
      segmentInferenceMs: [...this.segmentInferenceMs]
    };
  }
}

export function recordTransportSegmentSuccess(
  counters: CliSessionPerformanceCounters,
  transport: { readonly processSpawnCount?: number },
  input: {
    mode: "open" | "resume";
    sessionId: string;
    processSpawnCount?: number;
    inferenceMs?: number;
    outputBytes?: number;
  }
): void {
  const hasRunnerCount = typeof transport.processSpawnCount === "number";
  counters.syncProcessSpawnCount(transport.processSpawnCount);
  counters.recordSuccessfulSegment({
    mode: input.mode,
    sessionId: input.sessionId,
    ...(hasRunnerCount ? {} : { processSpawnCount: input.processSpawnCount ?? 0 }),
    ...(input.inferenceMs !== undefined ? { inferenceMs: input.inferenceMs } : {}),
    ...(input.outputBytes !== undefined ? { outputBytes: input.outputBytes } : {})
  });
}

export function recordTransportSegmentFailure(
  counters: CliSessionPerformanceCounters,
  transport: { readonly processSpawnCount?: number },
  error: unknown
): void {
  counters.syncProcessSpawnCount(transport.processSpawnCount);
  if (isSessionMismatchError(error)) counters.noteSessionMismatch();
}
