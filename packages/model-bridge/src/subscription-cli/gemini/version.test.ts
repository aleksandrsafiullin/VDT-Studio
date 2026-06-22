import { describe, expect, it } from "vitest";
import { evaluateGeminiVersion, parseGeminiVersionOutput } from "./version";

describe("Gemini version", () => {
  it("parses prefixed semver", () => expect(parseGeminiVersionOutput("gemini 0.43.1")).toMatchObject({ semver: "0.43.1" }));
  it("rejects versions below the current enterprise compatibility gate", () => expect(evaluateGeminiVersion("0.42.9").status).toBe("unsupported_version"));
});
