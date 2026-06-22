import { describe, expect, it, vi } from "vitest";
import { assertArgsSafe } from "../security";
import { buildCursorDynamicArgs, cursorSubscriptionCliAdapter } from "./adapter";
import * as auth from "./auth";

describe("cursorSubscriptionCliAdapter", () => {
  it("delegates probeAuth to probeCursorAuth", async () => {
    const probe = vi.spyOn(auth, "probeCursorAuth").mockResolvedValue({
      backendId: "cursor_subscription",
      status: "ready",
      diagnostics: []
    });

    const result = await cursorSubscriptionCliAdapter.probeAuth?.("/usr/bin/agent");
    expect(result?.status).toBe("ready");
    expect(probe).toHaveBeenCalledWith("/usr/bin/agent", expect.objectContaining({ versionStatus: expect.any(Object) }));
    probe.mockRestore();
  });

  describe("buildArgs snapshots", () => {
    it("builds prompt-only dynamic args", () => {
      expect(buildCursorDynamicArgs({ promptPath: "/tmp/vdt-run-abc/prompt.txt", promptText: "return json" })).toMatchInlineSnapshot(`
        [
          "--workspace",
          "/tmp/vdt-run-abc",
          "return json",
        ]
      `);
    });

    it("builds model and prompt dynamic args", () => {
      expect(
        buildCursorDynamicArgs({ model: "gpt-5.5-high", promptPath: "/tmp/vdt-run-abc/prompt.txt", promptText: "return json" })
      ).toMatchInlineSnapshot(`
        [
          "--model",
          "gpt-5.5-high",
          "--workspace",
          "/tmp/vdt-run-abc",
          "return json",
        ]
      `);
    });

    it("passes assertArgsSafe on reviewed dynamic args", () => {
      const args = cursorSubscriptionCliAdapter.buildArgs({
        model: "auto",
        promptPath: "/private/tmp/vdt-run-xyz/prompt.txt",
        promptText: "return json"
      });
      expect(() => assertArgsSafe(args)).not.toThrow();
    });

    it("rejects dangerous flags if they sneak into buildArgs input paths", () => {
      expect(() =>
        cursorSubscriptionCliAdapter.buildArgs({ model: "--force", promptText: "return json" })
      ).toThrow(/Forbidden CLI argument/);
    });
  });
});
