import { describe, expect, it } from "vitest";
import { CODEX_CLI_MIN_VERSION, evaluateCodexVersion } from "./version";

describe("evaluateCodexVersion", () => {
  it("accepts versions at or above the minimum", () => {
    expect(evaluateCodexVersion(CODEX_CLI_MIN_VERSION)).toEqual({
      supported: true,
      status: "installed",
      diagnostics: []
    });
  });

  it("rejects versions below the minimum", () => {
    const result = evaluateCodexVersion("0.1.0");
    expect(result.status).toBe("unsupported_version");
    expect(result.diagnostics[0]).toContain(CODEX_CLI_MIN_VERSION);
  });
});
