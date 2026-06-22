import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseClaudeJsonOutput } from "./parser";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const readFixture = (name: string) => readFileSync(path.join(fixturesDir, name), "utf8");

describe("parseClaudeJsonOutput", () => {
  it("extracts structured_output from JSON envelope", () => {
    const parsed = parseClaudeJsonOutput(readFixture("success.json"), "");
    expect(parsed.output).toEqual({ ok: true });
  });

  it("extracts generate-tree structured_output", () => {
    const parsed = parseClaudeJsonOutput(readFixture("generate-tree.json"), "");
    expect(parsed.output).toMatchObject({ projectTitle: "VDT", rootNodeId: "root" });
  });

  it("returns auth errors from error envelopes", () => {
    const parsed = parseClaudeJsonOutput(readFixture("auth-error.json"), "");
    expect(parsed.error).toMatch(/authentication required/i);
    expect(parsed.output).toBeUndefined();
  });

  it("returns structured_output even when schema validation would fail downstream", () => {
    const parsed = parseClaudeJsonOutput(readFixture("schema-failure.json"), "");
    expect(parsed.output).toEqual({ invalid: true });
  });
});
