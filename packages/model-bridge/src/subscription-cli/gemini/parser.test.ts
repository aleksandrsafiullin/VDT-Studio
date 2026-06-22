import { describe, expect, it } from "vitest";
import { parseGeminiJsonOutput } from "./parser";

describe("parseGeminiJsonOutput", () => {
  it("extracts JSON from response text", () => {
    expect(parseGeminiJsonOutput(JSON.stringify({ response: '{"ok":true}', stats: {} }), "").output).toEqual({ ok: true });
  });
  it("surfaces structured errors", () => {
    expect(parseGeminiJsonOutput(JSON.stringify({ error: { type: "quota", message: "Daily limit reached" } }), "").error).toMatch(/daily limit/i);
  });
  it("rejects prose-only responses", () => {
    expect(parseGeminiJsonOutput(JSON.stringify({ response: "Done" }), "").error).toMatch(/bounded JSON/i);
  });
});
