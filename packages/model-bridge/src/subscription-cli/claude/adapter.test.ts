import { describe, expect, it, vi } from "vitest";
import { assertArgsSafe } from "../security";
import * as auth from "./auth";
import { buildClaudeDynamicArgs, claudeSubscriptionCliAdapter } from "./adapter";

describe("claudeSubscriptionCliAdapter", () => {
  it("passes exact effort and explicit supported thinking Off without model substitution", () => {
    expect(buildClaudeDynamicArgs({ model: "claude-sonnet-4-6", modelReasoning: "high", promptText: "Return JSON" })).toContain("high");
    const args = buildClaudeDynamicArgs({ model: "claude-sonnet-4-6", modelReasoning: false, directClaudeSubscriptionVerified: true, promptText: "Return JSON" });
    const settings = JSON.parse(args[args.indexOf("--settings") + 1]!);
    expect(settings).toMatchObject({ alwaysThinkingEnabled: false, env: { MAX_THINKING_TOKENS: "0" } });
    expect(args).toContain("claude-sonnet-4-6");
  });
  it("rejects Off for unverified or third-party Claude providers even with a versioned model", () => {
    expect(() => buildClaudeDynamicArgs({ model: "claude-sonnet-4-6", modelReasoning: false, promptText: "Return JSON" })).toThrowError(expect.objectContaining({ code: "REASONING_UNSUPPORTED" }));
  });
  it.each(["auto", "opus", "claude-opus-5-5", "claude-fable-5"])("does not claim thinking Off for %s", model => {
    expect(() => buildClaudeDynamicArgs({ model, modelReasoning: false, directClaudeSubscriptionVerified: true, promptText: "Return JSON" })).toThrowError(expect.objectContaining({ code: "REASONING_UNSUPPORTED" }));
  });
  it("delegates probeAuth to probeClaudeAuth", async () => {
    const probe = vi.spyOn(auth, "probeClaudeAuth").mockResolvedValue({
      backendId: "claude_subscription",
      status: "ready",
      diagnostics: []
    });
    const result = await claudeSubscriptionCliAdapter.probeAuth?.("/usr/bin/claude");
    expect(probe).toHaveBeenCalled();
    expect(result?.status).toBe("ready");
  });

  describe("buildArgs snapshots", () => {
    it("passes the JSON schema inline and then the prompt", () => {
      const schemaJson = JSON.stringify({ type: "object", properties: { ok: { type: "boolean" } } });
      expect(
        buildClaudeDynamicArgs({
          schemaJson,
          promptText: "Return JSON for generate-tree-v1."
        })
      ).toEqual(["--json-schema", schemaJson, "Return JSON for generate-tree-v1."]);
    });

    it("uses a single tool-free turn with a schema in the prompt for Suggested KPI", () => {
      expect(buildClaudeDynamicArgs({ singleTurn: true, schemaJson: "{}", promptText: "Return KPI JSON." }))
        .toEqual(["--max-turns", "1", "--setting-sources", "", "Return KPI JSON."]);
    });

    it("passes assertArgsSafe on reviewed dynamic args including empty tools flags from manifest", () => {
      const args = [
        "-p",
        "--output-format",
        "json",
        "--no-session-persistence",
        "--tools",
        "",
        "--disallowedTools",
        "*",
        "--strict-mcp-config",
        ...claudeSubscriptionCliAdapter.buildArgs({
          schemaJson: JSON.stringify({ type: "object" }),
          promptText: "Task prompt only."
        })
      ];
      expect(() => assertArgsSafe(args)).not.toThrow();
    });
  });

  it("maps auth errors to AUTH_REQUIRED", () => {
    const stdout = JSON.stringify({
      type: "result",
      subtype: "error",
      is_error: true,
      result: "Authentication required. Please run claude login."
    });
    try {
      claudeSubscriptionCliAdapter.parseOutput(stdout, "", "connection-test-v1");
      throw new Error("expected parseOutput to throw");
    } catch (error) {
      expect(error).toMatchObject({ code: "AUTH_REQUIRED" });
    }
  });
});
