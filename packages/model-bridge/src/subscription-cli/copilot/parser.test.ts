import { describe, expect, it } from "vitest";
import { parseCopilotJsonlOutput } from "./parser";

describe("parseCopilotJsonlOutput", () => {
  it("extracts the terminal assistant JSON", () => {
    const stdout = [
      { type: "assistant.message_delta", data: { content: "partial" } },
      { type: "assistant.message", data: { content: '{"ok":true}' } },
      { type: "result", status: "success" }
    ].map((event) => JSON.stringify(event)).join("\n");
    expect(parseCopilotJsonlOutput(stdout, "").output).toEqual({ ok: true });
  });
  it("surfaces error events", () => {
    expect(parseCopilotJsonlOutput(JSON.stringify({ type: "error", message: "premium request limit" }), "").error).toMatch(/premium request/i);
  });
});
