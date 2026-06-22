import { describe, expect, it } from "vitest";
import { buildGeminiDynamicArgs, geminiSubscriptionCliAdapter } from "./adapter";

describe("Gemini subscription adapter", () => {
  it("requires a deny-all policy and never adds yolo", () => {
    const args = buildGeminiDynamicArgs({ promptText: "{}", toolPolicyPath: "/tmp/deny.toml", model: "gemini-3.1-pro-preview" });
    expect(args).toEqual(["--admin-policy", "/tmp/deny.toml", "--model", "gemini-3.1-pro-preview", "--prompt", "{}"]);
    expect(args.join(" ")).not.toMatch(/yolo/i);
  });

  it("maps policy diagnostics separately", () => {
    expect(() => geminiSubscriptionCliAdapter.parseOutput(JSON.stringify({ error: { message: "Code Assist disabled by organization policy" } }), "", "connection-test-v1"))
      .toThrowError(expect.objectContaining({ code: "POLICY_DISABLED" }));
  });
});
