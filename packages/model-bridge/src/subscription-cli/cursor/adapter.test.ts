import { describe, expect, it, vi } from "vitest";
import { assertArgsSafe } from "../security";
import { buildCursorDynamicArgs, cursorSubscriptionCliAdapter, listCursorAgentModels, parseCursorAgentModelList } from "./adapter";
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
        ]
      `);
    });

    it("adds scoped workspace trust only when explicitly enabled", () => {
      expect(
        buildCursorDynamicArgs({
          cwd: "/tmp/vdt-run-trusted",
          enableWorkspaceTrust: true
        })
      ).toMatchInlineSnapshot(`
        [
          "--trust",
          "--workspace",
          "/tmp/vdt-run-trusted",
        ]
      `);
    });

    it("passes assertArgsSafe on reviewed dynamic args", () => {
      const args = cursorSubscriptionCliAdapter.buildArgs({
        model: "auto",
        cwd: "/private/tmp/vdt-run-xyz",
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

  it("delivers prompts through stdin instead of argv", () => {
    expect(cursorSubscriptionCliAdapter.spawnHints).toEqual({ stdin: "prompt" });
    expect(buildCursorDynamicArgs({ cwd: "/tmp/vdt-run-abc", promptText: "return json" })).not.toContain("return json");
  });

  it("surfaces cursor stderr when stream-json exits before a terminal result", () => {
    expect(() =>
      cursorSubscriptionCliAdapter.parseOutput(
        "",
        "Error: EPERM: operation not permitted, mkdir '/Users/test/.cursor/projects/private-tmp-vdt'",
        "connection-test-v1"
      )
    ).toThrow(/\.cursor\/projects/);
  });

  it("returns streaming output when a Cursor stream already contains parseable assistant JSON", () => {
    const stdout = `${JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: JSON.stringify({ ok: true }) }] }
    })}\n`;
    expect(cursorSubscriptionCliAdapter.parseStreamingOutput?.(stdout, "", "connection-test-v1"))
      .toEqual({ ok: true });
  });

  it("does not fail partial Cursor streams before JSON is complete", () => {
    const stdout = `${JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "{\"ok\"" }] }
    })}\n`;
    expect(cursorSubscriptionCliAdapter.parseStreamingOutput?.(stdout, "", "connection-test-v1"))
      .toBeUndefined();
  });

  it("parses cursor-agent model output variants", () => {
    expect(parseCursorAgentModelList("auto - Cursor automatic model\ngpt-5.5-high - GPT high reasoning\nauto - duplicate\n"))
      .toEqual(["auto", "gpt-5.5-high"]);
    expect(parseCursorAgentModelList(JSON.stringify({ models: [{ id: "claude-sonnet-4-6" }, { name: "gpt-5.5-high" }] })))
      .toEqual(["claude-sonnet-4-6", "gpt-5.5-high"]);
  });

  it("lists cursor-agent models through the reviewed command", async () => {
    const execFile = vi.fn(async () => ({
      stdout: "auto - Cursor automatic model\n",
      stderr: ""
    }));

    await expect(listCursorAgentModels("/usr/bin/cursor-agent", { execFile })).resolves.toEqual(["auto"]);
    expect(execFile).toHaveBeenCalledWith("/usr/bin/cursor-agent", ["models"], expect.objectContaining({ shell: false }));
  });
});
