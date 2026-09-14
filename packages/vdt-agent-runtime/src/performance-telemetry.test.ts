import { describe, expect, it } from "vitest";
import {
  AGENT_RUN_PERFORMANCE_TELEMETRY_GRANT_FIELD_DENYLIST,
  emptyAgentRunPerformanceTelemetry,
  hydrateAgentRunPerformanceTelemetry
} from "./performance-telemetry";

describe("AgentRunPerformanceTelemetry", () => {
  it("starts at zeros with no grant-shaped fields", () => {
    const telemetry = emptyAgentRunPerformanceTelemetry();
    expect(telemetry).toEqual({
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
    });
    for (const key of AGENT_RUN_PERFORMANCE_TELEMETRY_GRANT_FIELD_DENYLIST) {
      expect(telemetry).not.toHaveProperty(key);
    }
  });

  it("hydrates missing fields and refuses plaintext session ids", () => {
    const telemetry = hydrateAgentRunPerformanceTelemetry({
      decisionLatenciesMs: [19, 18.4],
      toolCallCount: 93,
      opaqueSessionIdHash: "opaque-session-secret",
      qualificationStatus: "qualified",
      toolIsolation: "hard_verified",
      logicalSessionCount: 1
    });
    expect(telemetry.decisionLatenciesMs).toEqual([19, 18.4]);
    expect(telemetry.segmentInferenceMs).toEqual([19, 18.4]);
    expect(telemetry.toolCallCount).toBe(93);
    expect(telemetry.logicalSessionCount).toBe(1);
    expect(telemetry.opaqueSessionIdHash).toBeNull();
    expect(telemetry).not.toHaveProperty("qualificationStatus");
    expect(telemetry).not.toHaveProperty("toolIsolation");
  });

  it("accepts a sha256 opaque session hash and hashes empty as null", () => {
    const hash = `sha256:${"ab".repeat(32)}`;
    expect(hydrateAgentRunPerformanceTelemetry({ opaqueSessionIdHash: hash }).opaqueSessionIdHash)
      .toBe(hash);
    expect(hydrateAgentRunPerformanceTelemetry({ opaqueSessionIdHash: "" }).opaqueSessionIdHash)
      .toBeNull();
    expect(hydrateAgentRunPerformanceTelemetry({ opaqueSessionIdHash: `sha256:${"c".repeat(64)}` }).opaqueSessionIdHash)
      .toBe(`sha256:${"c".repeat(64)}`);
  });
});
