import { describe, expect, it } from "vitest";
import { buildCopilotDynamicArgs, copilotSubscriptionCliAdapter } from "./adapter";

describe("Copilot subscription adapter", () => {
  it("builds prompt/model args without permissive flags", () => {
    const args = buildCopilotDynamicArgs({ promptText: "{}", model: "gpt-5.4" });
    expect(args).toEqual(["--model", "gpt-5.4", "--prompt", "{}"]);
    expect(args.join(" ")).not.toMatch(/allow-all|yolo/i);
  });
  it("maps plan policy diagnostics separately", () => {
    const output = `${JSON.stringify({ type: "error", message: "Copilot CLI disabled by organization policy" })}\n`;
    expect(() => copilotSubscriptionCliAdapter.parseOutput(output, "", "connection-test-v1"))
      .toThrowError(expect.objectContaining({ code: "POLICY_DISABLED" }));
  });
});
