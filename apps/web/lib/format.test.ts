import { describe, expect, it } from "vitest";
import {
  countDecimalPlacesFromNumber,
  countDecimalPlacesFromString,
  getStepFromDecimalPlaces,
  getValueIncrementStep
} from "./format";

describe("getValueIncrementStep", () => {
  it("returns 1 for undefined and non-finite values", () => {
    expect(getValueIncrementStep(undefined)).toBe(1);
    expect(getValueIncrementStep(NaN)).toBe(1);
    expect(getValueIncrementStep(Infinity)).toBe(1);
    expect(getValueIncrementStep(-Infinity)).toBe(1);
  });

  it("returns 1 for integers", () => {
    expect(getValueIncrementStep(500)).toBe(1);
    expect(getValueIncrementStep(0)).toBe(1);
    expect(getValueIncrementStep(-42)).toBe(1);
  });

  it("derives step from decimal precision in string form", () => {
    expect(getValueIncrementStep(0.96)).toBe(0.01);
    expect(getValueIncrementStep(0.9)).toBe(0.1);
    expect(getValueIncrementStep(0.89)).toBe(0.01);
    expect(getValueIncrementStep(12.345)).toBe(0.001);
  });

  it("handles scientific notation", () => {
    expect(getValueIncrementStep(1e-5)).toBe(0.00001);
    expect(getValueIncrementStep(1.23e-4)).toBe(0.000001);
  });

  it("handles float noise safely", () => {
    expect(getValueIncrementStep(0.1 + 0.2)).toBe(0.000001);
    expect(getValueIncrementStep(500.0000000000001)).toBe(1);
  });

  it("caps decimal precision to avoid unusably small steps", () => {
    expect(getValueIncrementStep(1 / 3)).toBe(0.000001);
  });
});

describe("countDecimalPlacesFromString", () => {
  it("preserves trailing zero precision from user input", () => {
    expect(countDecimalPlacesFromString("0.80")).toBe(2);
    expect(countDecimalPlacesFromString("0.8")).toBe(1);
  });
});

describe("getStepFromDecimalPlaces", () => {
  it("keeps 0.01 step when two-decimal precision is retained", () => {
    expect(getStepFromDecimalPlaces(2)).toBe(0.01);
    expect(countDecimalPlacesFromNumber(0.8)).toBe(1);
    expect(getStepFromDecimalPlaces(Math.max(2, countDecimalPlacesFromNumber(0.8)))).toBe(0.01);
  });
});
