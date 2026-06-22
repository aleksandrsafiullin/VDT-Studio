import { describe, expect, it } from "vitest";
import { evaluateCopilotVersion, parseCopilotVersionOutput } from "./version";

describe("Copilot version", () => {
  it("parses GA semver", () => expect(parseCopilotVersionOutput("GitHub Copilot CLI 1.0.54")).toMatchObject({ semver: "1.0.54" }));
  it("rejects pre-GA versions", () => expect(evaluateCopilotVersion("0.0.418").status).toBe("unsupported_version"));
});
