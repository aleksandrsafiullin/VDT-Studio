import { describe, expect, it } from "vitest";
import { assertArgsSafe, DANGEROUS_CLI_FLAG_PATTERNS } from "./security";

describe("subscription CLI security denylist", () => {
  it("exports a frozen reviewed denylist", () => {
    expect(Object.isFrozen(DANGEROUS_CLI_FLAG_PATTERNS)).toBe(true);
    expect(DANGEROUS_CLI_FLAG_PATTERNS.length).toBeGreaterThan(0);
  });

  it.each([
    "--force",
    "--FORCE",
    "--trust",
    "--trust-directory",
    "--yolo",
    "--allow-all",
    "--allow-all-tools",
    "--bypass-permissions",
    "bypass_permissions",
    "--dangerously",
    "--dangerously-auto-approve",
    "--dangerouslyAutoApprove",
    "dangerouslyAutoApprove",
    "--workspace-trust",
    "yolo"
  ])("rejects dangerous arg %s", (arg) => {
    expect(() => assertArgsSafe([arg])).toThrow(/Forbidden CLI argument/);
    try {
      assertArgsSafe([arg]);
    } catch (error) {
      expect(error).toMatchObject({ code: "UNSAFE_CLI_ARGS", arg });
    }
  });

  it("allows reviewed subscription CLI arg lists", () => {
    expect(() =>
      assertArgsSafe([
        "-p",
        "--output-format",
        "stream-json",
        "--stream-partial-output",
        "--model",
        "gpt-5",
        "--sandbox",
        "read-only",
        "--no-ask-user",
        "-s",
        "/tmp/vdt-prompt.txt"
      ])
    ).not.toThrow();
  });

  it("does not scan prompt file contents, only argv tokens", () => {
    expect(() => assertArgsSafe(["/tmp/prompt-about-yolo-and-force-fields.txt"])).not.toThrow();
  });

  it("rejects when any arg in a reviewed list is dangerous", () => {
    expect(() =>
      assertArgsSafe(["--output-format", "json", "--force", "/tmp/prompt.txt"])
    ).toThrow(/Forbidden CLI argument: --force/);
  });

  it("allows scoped Cursor trust but never force", () => {
    expect(() => assertArgsSafe(["--trust"])).toThrow(/Forbidden CLI argument/);
    expect(() => assertArgsSafe(["--force"])).toThrow(/Forbidden CLI argument/);
    expect(() => assertArgsSafe(["--trust"], { allowScopedTrust: true })).not.toThrow();
    expect(() => assertArgsSafe(["--force"], { allowScopedTrust: true })).toThrow(/Forbidden CLI argument/);
  });

  it("rejects NUL bytes and path traversal in argv tokens", () => {
    for (const arg of ["safe\0unsafe", "../secret", "/tmp/vdt/../secret", "nested\\..\\secret"]) {
      expect(() => assertArgsSafe([arg])).toThrow(/Forbidden CLI argument/);
      try {
        assertArgsSafe([arg]);
      } catch (error) {
        expect(error).toMatchObject({ code: "UNSAFE_CLI_ARGS", arg });
      }
    }
  });
});
