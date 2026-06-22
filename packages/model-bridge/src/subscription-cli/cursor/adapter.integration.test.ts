import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateRegisteredSchema } from "../../schema-registry";
import { cursorSubscriptionCliAdapter } from "./adapter";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const readFixture = (name: string) => readFileSync(path.join(fixturesDir, name), "utf8");

describe("cursorSubscriptionCliAdapter integration", () => {
  it("round-trips connection-test stream-json through schema validation", () => {
    const output = cursorSubscriptionCliAdapter.parseOutput(readFixture("success-stream.jsonl"), "", "connection-test-v1");
    expect(validateRegisteredSchema("connection-test-v1", output)).toBe(true);
    expect(output).toEqual({ ok: true });
  });

  it("round-trips generate-tree stream-json through schema validation", () => {
    const output = cursorSubscriptionCliAdapter.parseOutput(readFixture("partial-stream.jsonl"), "", "generate-tree-v1");
    expect(validateRegisteredSchema("generate-tree-v1", output)).toBe(false);
    expect(output).toMatchObject({ projectTitle: "VDT", rootNodeId: "root" });
  });

  it("throws AUTH_REQUIRED for auth-like stream errors", () => {
    const stdout = `${JSON.stringify({ type: "error", message: "Authentication required. Please sign in." })}\n`;
    try {
      cursorSubscriptionCliAdapter.parseOutput(stdout, "", "connection-test-v1");
      throw new Error("expected parseOutput to throw");
    } catch (error) {
      expect(error).toMatchObject({ code: "AUTH_REQUIRED" });
    }
  });
});
