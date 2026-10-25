import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCodexExecJson } from "./parser";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const readFixture = (name: string) => readFileSync(path.join(fixturesDir, name), "utf8");

describe("parseCodexExecJson", () => {
  it("accepts a valid Skill Author decision without classifying author as auth", () => {
    const decision = { type: "call_tool", toolName: "skill.author_draft", args: { instructions: "State quota assumptions and authentication constraints." }, statusMessage: "Draft ready" };
    const stdout = JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify(decision) } });
    expect(parseCodexExecJson(stdout, "Reading prompt from stdin...").output).toEqual(decision);
    expect(parseCodexExecJson(JSON.stringify(decision), "").output).toEqual(decision);
  });
  it("still surfaces plain auth and quota diagnostics when no structured response exists", () => {
    expect(parseCodexExecJson("", "Authentication required. Please sign in.").error).toMatch(/authentication required/i);
    expect(parseCodexExecJson("Usage limit reached", "").error).toMatch(/usage limit/i);
  });
  it("does not accept earlier model text after a terminal stream failure", () => {
    const stdout = [JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: '{"ok":true}' } }), JSON.stringify({ type: "turn.failed", error: { message: "Rate limit reached" } })].join("\n");
    expect(parseCodexExecJson(stdout, "").error).toMatch(/rate limit/i);
  });
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
