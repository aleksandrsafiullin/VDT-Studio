import { describe, expect, it } from "vitest";
import { formatNumber } from "./format";
import { parseScenarioNumberInput, stepScenarioNumberInput } from "./scenario-number-input";

describe("Scenario number entry", () => {
  it("reads Baseline-formatted pasted values without changing their magnitude", () => {
    for (const value of [0, 84000, -84000.25, 1050, 17.14, 1234567.89]) {
      expect(parseScenarioNumberInput(formatNumber(value))).toBe(value);
    }
    expect(parseScenarioNumberInput(" 84,000.123456 ")).toBe(84000.123456);
  });

  it("retains exact precision, signs, zero and scientific notation while editing", () => {
    for (const value of ["17.14285714285714", "0", "-0.123456", "+12", ".25", "12.", "1e-7", "-2.5e+6"]) {
      expect(parseScenarioNumberInput(value)).toBe(Number(value));
    }
  });

  it("does not reinterpret invalid grouping, locale commas or partial drafts as numbers", () => {
    for (const invalid of ["", " ", "-", ".", "1e", "17,14", "84,00", "1,23,456", "84,000,", "1.2.3", "NaN", "Infinity", "1e999", "0x10"]) {
      expect(parseScenarioNumberInput(invalid), invalid).toBeUndefined();
    }
  });

  it("steps on the decimal grid without binary float noise", () => {
    expect(stepScenarioNumberInput(0.8, 2, 1)).toBe(0.81);
    expect(stepScenarioNumberInput(0.8, 2, -1)).toBe(0.79);
    expect(stepScenarioNumberInput(17.14285714285714, 2, 1)).toBe(17.15);
    expect(stepScenarioNumberInput(17.14285714285714, 2, -1)).toBe(17.14);
    expect(stepScenarioNumberInput(84000, 0, 1)).toBe(84001);
    expect(stepScenarioNumberInput(-0.8, 2, -1)).toBe(-0.81);
    expect(stepScenarioNumberInput(1.123456, 6, 1)).toBe(1.123457);
  });
});
