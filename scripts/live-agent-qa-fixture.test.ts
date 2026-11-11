import { describe, expect, it } from "vitest";
import { answerLiveHaulageQuestion } from "./live-agent-qa-fixture.mjs";

describe("observed live haulage clarification fixtures", () => {
  it("answers every field of the actual grouped questions instead of returning fleet size for hours", () => {
    expect(answerLiveHaulageQuestion({ id: "truck_working_hours", fields: [
      { id: "scheduled_hours_per_truck_y", label: "Scheduled hours per truck", unit: "h/truck/year" },
      { id: "downtime_hours_per_truck_y", label: "Downtime hours per truck", unit: "h/truck/year" }
    ] })).toBe("scheduled_hours_per_truck_y: 6000; downtime_hours_per_truck_y: 2000");
    expect(answerLiveHaulageQuestion({ id: "cycle_times_confirm", fields: [
      { id: "loading_time_h", label: "Loading time", unit: "h/trip" },
      { id: "dumping_time_h", label: "Dumping time", unit: "h/trip" },
      { id: "queue_time_h", label: "Queue time", unit: "h/trip" }
    ] })).toBe(`loading_time_h: ${4 / 60}; dumping_time_h: ${2 / 60}; queue_time_h: ${3 / 60}`);
  });
  it("answers the asked quantity and stops for unsupported numeric fields", () => {
    expect(answerLiveHaulageQuestion({ id: "payload_factor_decimal", question: "Payload factor, not tonnes per trip?" })).toBe(1);
    expect(answerLiveHaulageQuestion({ id: "payload_per_trip", question: "Payload per trip?" })).toBe(40);
    expect(answerLiveHaulageQuestion({ id: "truck_annual_hours_numeric", question: "Scheduled and downtime hours per year?" })).toContain("4000 productive hours");
    expect(() => answerLiveHaulageQuestion({ fields: [{ id: "unknown_synthetic_field", kind: "number" }] })).toThrow(/no numeric answer/);
  });
});
