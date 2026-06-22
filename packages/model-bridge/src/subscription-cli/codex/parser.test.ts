import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCodexExecJson } from "./parser";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const readFixture = (name: string) => readFileSync(path.join(fixturesDir, name), "utf8");

describe("parseCodexExecJson", () => {
  it("extracts structured JSON from agent_message JSONL events", () => {
    const parsed = parseCodexExecJson(readFixture("success-jsonl.jsonl"), "");
    expect(parsed).toEqual({ output: { ok: true }, rawText: '{"ok":true}' });
  });

  it("extracts generate-tree payloads from JSONL", () => {
    const parsed = parseCodexExecJson(readFixture("generate-tree-jsonl.jsonl"), "");
    expect(parsed.output).toMatchObject({ projectTitle: "VDT", rootNodeId: "root" });
  });

  it("parses direct structured stdout from --output-schema", () => {
    const parsed = parseCodexExecJson(readFixture("success-structured.json"), "");
    expect(parsed).toEqual({ output: { ok: true }, rawText: '{"ok":true}' });
  });

  it("returns auth errors from JSONL error events", () => {
    const parsed = parseCodexExecJson(readFixture("auth-error.jsonl"), "");
    expect(parsed.error).toMatch(/authentication required/i);
    expect(parsed.output).toBeUndefined();
  });
});
