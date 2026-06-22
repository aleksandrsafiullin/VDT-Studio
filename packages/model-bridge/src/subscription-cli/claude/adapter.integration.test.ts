import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateRegisteredSchema } from "../../schema-registry";
import { claudeSubscriptionCliAdapter } from "./adapter";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const readFixture = (name: string) => readFileSync(path.join(fixturesDir, name), "utf8");

describe("claudeSubscriptionCliAdapter integration", () => {
  it("round-trips connection-test JSON through schema validation", () => {
    const output = claudeSubscriptionCliAdapter.parseOutput(readFixture("success.json"), "", "connection-test-v1");
    expect(validateRegisteredSchema("connection-test-v1", output)).toBe(true);
    expect(output).toEqual({ ok: true });
  });

  it("round-trips generate-tree JSON through schema validation", () => {
    const output = claudeSubscriptionCliAdapter.parseOutput(readFixture("generate-tree.json"), "", "generate-tree-v1");
    expect(validateRegisteredSchema("generate-tree-v1", output)).toBe(true);
  });

  it("throws AUTH_REQUIRED for auth-like errors", () => {
    try {
      claudeSubscriptionCliAdapter.parseOutput(readFixture("auth-error.json"), "", "connection-test-v1");
      throw new Error("expected parseOutput to throw");
    } catch (error) {
      expect(error).toMatchObject({ code: "AUTH_REQUIRED" });
    }
  });
});
