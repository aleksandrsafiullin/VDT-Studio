import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateRegisteredSchema } from "../../schema-registry";
import { codexSubscriptionCliAdapter } from "./adapter";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const readFixture = (name: string) => readFileSync(path.join(fixturesDir, name), "utf8");

describe("codexSubscriptionCliAdapter integration", () => {
  it("round-trips connection-test JSONL through schema validation", () => {
    const output = codexSubscriptionCliAdapter.parseOutput(readFixture("success-jsonl.jsonl"), "", "connection-test-v1");
    expect(validateRegisteredSchema("connection-test-v1", output)).toBe(true);
    expect(output).toEqual({ ok: true });
  });

  it("round-trips generate-tree JSONL through schema validation", () => {
    const output = codexSubscriptionCliAdapter.parseOutput(readFixture("generate-tree-jsonl.jsonl"), "", "generate-tree-v1");
    expect(validateRegisteredSchema("generate-tree-v1", output)).toBe(true);
  });

  it("throws AUTH_REQUIRED for auth-like stream errors", () => {
    try {
      codexSubscriptionCliAdapter.parseOutput(readFixture("auth-error.jsonl"), "", "connection-test-v1");
      throw new Error("expected parseOutput to throw");
    } catch (error) {
      expect(error).toMatchObject({ code: "AUTH_REQUIRED" });
    }
  });
});
