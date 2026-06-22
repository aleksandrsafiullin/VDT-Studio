import { describe, expect, it, vi } from "vitest";
import { assertArgsSafe } from "../security";
import * as auth from "./auth";
import { buildCodexDynamicArgs, codexSubscriptionCliAdapter } from "./adapter";

describe("codexSubscriptionCliAdapter", () => {
  it("delegates probeAuth to probeCodexAuth", async () => {
    const probe = vi.spyOn(auth, "probeCodexAuth").mockResolvedValue({
      backendId: "codex_subscription",
      status: "ready",
      diagnostics: []
    });
    const result = await codexSubscriptionCliAdapter.probeAuth?.("/usr/bin/codex");
    expect(probe).toHaveBeenCalled();
    expect(result?.status).toBe("ready");
  });

  describe("buildArgs snapshots", () => {
    it("builds schema, output, and stdin prompt args", () => {
      expect(
        buildCodexDynamicArgs({
          schemaPath: "/tmp/vdt-run-abc/schema.json",
          outputPath: "/tmp/vdt-run-abc/last-message.json"
        })
      ).toMatchInlineSnapshot(`
        [
          "--output-schema",
          "/tmp/vdt-run-abc/schema.json",
          "--output-last-message",
          "/tmp/vdt-run-abc/last-message.json",
          "-",
        ]
      `);
    });

    it("passes assertArgsSafe on reviewed dynamic args", () => {
      const args = codexSubscriptionCliAdapter.buildArgs({
        model: "gpt-5.5",
        schemaPath: "/private/tmp/vdt-run-xyz/schema.json",
        outputPath: "/private/tmp/vdt-run-xyz/last-message.json"
      });
      expect(() => assertArgsSafe(args)).not.toThrow();
    });
  });

  it("maps auth errors to AUTH_REQUIRED", () => {
    const stdout = `${JSON.stringify({ type: "error", message: "Authentication required. Please sign in." })}\n`;
    try {
      codexSubscriptionCliAdapter.parseOutput(stdout, "", "connection-test-v1");
      throw new Error("expected parseOutput to throw");
    } catch (error) {
      expect(error).toMatchObject({ code: "AUTH_REQUIRED" });
    }
  });
});
