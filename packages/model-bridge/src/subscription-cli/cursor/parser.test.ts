import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_CURSOR_STREAM_PARSE_LIMITS, parseCursorStreamJson } from "./parser";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const readFixture = (name: string) => readFileSync(path.join(fixturesDir, name), "utf8");

describe("parseCursorStreamJson", () => {
  it("extracts structured JSON from a terminal result event", () => {
    const parsed = parseCursorStreamJson(readFixture("success-stream.jsonl"));
    expect(parsed).toEqual({ output: { ok: true }, rawText: '{"ok":true}' });
  });

  it("ignores partial assistant deltas and uses the terminal result", () => {
    const parsed = parseCursorStreamJson(readFixture("partial-stream.jsonl"));
    expect(parsed.output).toEqual({ projectTitle: "VDT", rootNodeId: "root", nodes: [], edges: [], assumptions: [], questionsForUser: [], warnings: [] });
    expect(parsed.rawText).toContain("projectTitle");
  });

  it("returns an error for terminal result failures", () => {
    const parsed = parseCursorStreamJson(readFixture("error-result.jsonl"));
    expect(parsed.error).toMatch(/rate limit/i);
    expect(parsed.output).toBeUndefined();
  });

  it("skips malformed lines and still parses a valid terminal result", () => {
    const parsed = parseCursorStreamJson(readFixture("malformed-line.jsonl"));
    expect(parsed).toEqual({ output: { ok: true }, rawText: '{"ok":true}' });
  });

  it("throws when byte limits are exceeded", () => {
    const stdout = readFixture("success-stream.jsonl");
    expect(() => parseCursorStreamJson(stdout, { maxBytes: 8, maxLines: DEFAULT_CURSOR_STREAM_PARSE_LIMITS.maxLines }))
      .toThrow(/exceeds 8 bytes/);
  });

  it("throws when line limits are exceeded", () => {
    const stdout = readFixture("success-stream.jsonl");
    expect(() => parseCursorStreamJson(stdout, { maxBytes: DEFAULT_CURSOR_STREAM_PARSE_LIMITS.maxBytes, maxLines: 1 }))
      .toThrow(/exceeds 1 lines/);
  });
});
