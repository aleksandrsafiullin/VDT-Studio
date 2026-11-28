import { expect, it } from "vitest";
import { AdaptiveRunReasoning, adaptiveReasoningPolicy, validAdaptiveReasoningPolicy } from "./adaptive-reasoning";

const capabilities = (values: unknown[]) => ({ parameter: "think", source: "provider", values });

it("pins only a verified ordered start and next setting", () => {
  expect(adaptiveReasoningPolicy(capabilities([true, "high", false, "low"]))).toEqual({ start: false, repair: "low" });
  expect(adaptiveReasoningPolicy(capabilities(["medium", "high", "low", true]))).toEqual({ start: "low", repair: "medium" });
  expect(adaptiveReasoningPolicy(capabilities([true, false]))).toEqual({ start: false, repair: true });
  for (const unsupported of [undefined, capabilities([false]), capabilities(["low", true]), capabilities(["very_low", "very_high"]),
    { ...capabilities([false, true]), source: "documentation" },
    { ...capabilities([false, true]), parameter: "reasoning_effort" }]) {
    expect(adaptiveReasoningPolicy(unsupported)).toBeUndefined();
  }
  expect(validAdaptiveReasoningPolicy({ start: false, repair: true })).toBe(true);
  expect(validAdaptiveReasoningPolicy({ start: true, repair: false })).toBe(false);
  expect(validAdaptiveReasoningPolicy({ start: false, repair: true, fallback: "api" })).toBe(false);
});

it("keeps a one-way repair budget in each run and refuses an aborted repair", () => {
  const policy = adaptiveReasoningPolicy(capabilities([false, "low", "medium"]))!;
  const first = new AdaptiveRunReasoning(policy);
  const second = new AdaptiveRunReasoning(policy);
  const issues = ["CALCULATION_NEEDS_FACTORS: output"];
  expect(first.effective()).toBe(false);
  expect(first.beginPlanRepair(issues, AbortSignal.abort())).toBe(false);
  expect(first.effective()).toBe(false);
  expect(first.beginPlanRepair(["PLAN_INVALID_NODE: invalid syntax"])).toBe(false);
  expect(first.beginPlanRepair(issues)).toBe(true);
  expect(first.effective()).toBe("low");
  expect(first.beginPlanRepair(issues)).toBe(false);
  first.finishPlanRepair();
  expect(first.effective()).toBe(false);
  expect(first.beginPlanRepair(issues)).toBe(false);
  expect(second.effective()).toBe(false);
});
