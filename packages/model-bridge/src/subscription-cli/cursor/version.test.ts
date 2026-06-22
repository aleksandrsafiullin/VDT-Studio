import { describe, expect, it } from "vitest";
import { CURSOR_CLI_MIN_VERSION, evaluateCursorVersion, parseCursorVersionOutput } from "./version";

describe("parseCursorVersionOutput", () => {
  it("parses semver from plain and prefixed version strings", () => {
    expect(parseCursorVersionOutput("0.48.2")).toEqual({
      raw: "0.48.2",
      semver: "0.48.2",
      major: 0,
      minor: 48,
      patch: 2
    });
    expect(parseCursorVersionOutput("Cursor Agent 0.48.2 (abc123)")).toMatchObject({
      semver: "0.48.2",
      major: 0,
      minor: 48,
      patch: 2
    });
  });

  it("returns raw-only output for unparseable marketing labels", () => {
    expect(parseCursorVersionOutput("nightly-canary")).toEqual({ raw: "nightly-canary" });
  });
});

describe("evaluateCursorVersion", () => {
  it("accepts supported versions", () => {
    const result = evaluateCursorVersion("0.48.0");
    expect(result).toEqual({ supported: true, status: "installed", diagnostics: [] });
  });

  it("rejects versions below the minimum", () => {
    const result = evaluateCursorVersion("0.40.0");
    expect(result.supported).toBe(false);
    expect(result.status).toBe("unsupported_version");
    expect(result.diagnostics[0]).toContain(CURSOR_CLI_MIN_VERSION);
  });

  it("treats unparseable versions as installed with diagnostics", () => {
    const result = evaluateCursorVersion("dev-build");
    expect(result).toEqual({
      supported: false,
      status: "installed",
      diagnostics: ['Cursor Agent version "dev-build" is not a recognized semver; compatibility is unknown.']
    });
  });

  it("handles probe failure when version is null", () => {
    const result = evaluateCursorVersion(null);
    expect(result.supported).toBe(false);
    expect(result.status).toBe("installed");
    expect(result.diagnostics[0]).toMatch(/could not be determined/i);
  });
});
