import { describe, expect, it, vi } from "vitest";
import { assertArgsSafe } from "../security";
import * as auth from "./auth";
import { buildClaudeDynamicArgs, claudeSubscriptionCliAdapter } from "./adapter";

describe("claudeSubscriptionCliAdapter", () => {
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
    it("builds json-schema and prompt args", () => {
      expect(
        buildClaudeDynamicArgs({
          schemaPath: "/tmp/vdt-run-abc/schema.json",
          promptText: "Return JSON for generate-tree-v1."
        })
      ).toMatchInlineSnapshot(`
        [
          "--json-schema",
          "/tmp/vdt-run-abc/schema.json",
          "Return JSON for generate-tree-v1.",
        ]
      `);
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
          schemaPath: "/private/tmp/vdt-run-xyz/schema.json",
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
