import { describe, expect, it } from "vitest";
import { hasLocalAiUi, hasStandaloneRunnerUi, resolveVdtAppMode } from "./app-mode";

describe("app mode policy", () => {
  it("accepts explicit desktop, hosted, and development modes", () => {
    expect(resolveVdtAppMode("desktop")).toBe("desktop");
    expect(resolveVdtAppMode("hosted_web")).toBe("hosted_web");
    expect(resolveVdtAppMode("development_web")).toBe("development_web");
  });

  it("hides local AI UI in hosted web mode", () => {
    expect(hasLocalAiUi("hosted_web")).toBe(false);
    expect(hasLocalAiUi("desktop")).toBe(true);
    expect(hasLocalAiUi("development_web")).toBe(true);
  });

  it("shows standalone runner controls only behind an explicit non-hosted flag", () => {
    expect(hasStandaloneRunnerUi("hosted_web", "true")).toBe(false);
    expect(hasStandaloneRunnerUi("desktop", undefined)).toBe(false);
    expect(hasStandaloneRunnerUi("development_web", "false")).toBe(false);
    expect(hasStandaloneRunnerUi("development_web", "true")).toBe(true);
  });
});
