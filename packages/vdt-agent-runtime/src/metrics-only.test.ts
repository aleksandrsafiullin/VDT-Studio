import { describe, expect, it } from "vitest";
import { AGENT_RUN_PERFORMANCE_TELEMETRY_GRANT_FIELD_DENYLIST } from "./performance-telemetry";
import { assertMetricsOnly, FORBIDDEN_METRICS_KEYS } from "./metrics-only";

describe("assertMetricsOnly", () => {
  it("rejects prompt/payload shaped keys and secret strings", () => {
    expect(() => assertMetricsOnly({ rawPrompt: "build a tree" })).toThrow(/not allowed/);
    expect(() => assertMetricsOnly({ note: "Bearer very-secret-token-value" })).toThrow(/Sensitive value/);
  });

  it("does not treat qualification grant keys as forbidden metrics keys", () => {
    for (const key of AGENT_RUN_PERFORMANCE_TELEMETRY_GRANT_FIELD_DENYLIST) {
      expect(FORBIDDEN_METRICS_KEYS.has(key.toLowerCase())).toBe(false);
    }
    expect(() => assertMetricsOnly({ qualificationStatus: "qualified" })).not.toThrow();
  });
});
