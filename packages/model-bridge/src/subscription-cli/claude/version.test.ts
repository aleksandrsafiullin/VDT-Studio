import { describe, expect, it } from "vitest";
import { CLAUDE_CLI_MIN_VERSION, evaluateClaudeVersion } from "./version";

describe("evaluateClaudeVersion", () => {
  it("accepts versions at or above the minimum", () => {
    expect(evaluateClaudeVersion(CLAUDE_CLI_MIN_VERSION)).toEqual({
      supported: true,
      status: "installed",
      diagnostics: []
    });
  });

  it("rejects versions below the minimum", () => {
    const result = evaluateClaudeVersion("0.9.0");
    expect(result.status).toBe("unsupported_version");
    expect(result.diagnostics[0]).toContain(CLAUDE_CLI_MIN_VERSION);
  });
});
