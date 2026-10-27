import { describe, expect, it, vi } from "vitest";
import { assertArgsSafe } from "../security";
import * as auth from "./auth";
import { buildCodexDynamicArgs, codexSubscriptionCliAdapter, listCodexModels, parseCodexModelList, parseCodexModelOptions } from "./adapter";

describe("codexSubscriptionCliAdapter", () => {
  it("keeps only provider-reported model reasoning metadata and omits hidden instructions", () => {
    const catalog = JSON.stringify({ models: [
      { slug: "model-a", display_name: "Model A", default_reasoning_level: "medium", supported_reasoning_levels: [
        { effort: "low" }, { effort: "medium" }, { effort: "max" }, { effort: "max" }, { effort: "--unsafe" }
      ], base_instructions: "not public metadata" },
      { slug: "hidden", visibility: "hide", supported_reasoning_levels: [{ effort: "high" }] },
      { slug: "model-b", default_reasoning_level: "high", supported_reasoning_levels: [{ effort: "low" }] }
    ] });
    expect(parseCodexModelOptions(catalog)).toEqual([
      { id: "model-a", label: "Model A", defaultReasoningEffort: "medium", reasoningEfforts: ["low", "medium", "max"] },
      { id: "model-b", reasoningEfforts: ["low"] }
    ]);
  });

  it("does not invent reasoning levels for string or text catalogs", () => {
    expect(parseCodexModelOptions('["model-a"]')).toEqual([{ id: "model-a" }]);
    expect(parseCodexModelOptions("model-a\nmodel-b\n")).toEqual([{ id: "model-a" }, { id: "model-b" }]);
  });

  it("retains reasoning metadata in JSONL catalogs", () => {
    expect(parseCodexModelOptions(JSON.stringify({ slug: "model-a", supported_reasoning_levels: [{ effort: "high" }] }) + "\nWarning: catalog refreshed"))
      .toContainEqual({ id: "model-a", reasoningEfforts: ["high"] });
  });
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
          cwd: "/tmp/vdt-run-abc",
          schemaPath: "/tmp/vdt-run-abc/schema.json",
          outputPath: "/tmp/vdt-run-abc/last-message.json"
        })
      ).toMatchInlineSnapshot(`
        [
          "-C",
          "/tmp/vdt-run-abc",
          "--output-schema",
          "/tmp/vdt-run-abc/schema.json",
          "--output-last-message",
          "/tmp/vdt-run-abc/last-message.json",
        ]
      `);
    });

    it("passes assertArgsSafe on reviewed dynamic args", () => {
      const args = codexSubscriptionCliAdapter.buildArgs({
        model: "gpt-5.5",
        cwd: "/private/tmp/vdt-run-xyz",
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

  it("parses codex debug model output variants", () => {
    expect(parseCodexModelList(JSON.stringify({
      models: [
        { slug: "gpt-5.5", visibility: "list" },
        { id: "gpt-5.3-codex", visibility: "list" },
        { id: "codex-auto-review", visibility: "hide" },
        { id: "gpt-5.5", visibility: "list" }
      ]
    })))
      .toEqual(["gpt-5.5", "gpt-5.3-codex"]);
    expect(parseCodexModelList('{"model":"o4-mini"}\ngpt-5.2 default\n')).toEqual(["o4-mini", "gpt-5.2"]);
    expect(parseCodexModelList("WARNING: proceeding with cached models\ngpt-5.5\nERROR failed to refresh remote models\n"))
      .toEqual(["gpt-5.5"]);
  });

  it("lists codex models through the reviewed command", async () => {
    const execFile = vi.fn(async () => ({
      stdout: JSON.stringify({
        models: [
          { slug: "gpt-5.5", visibility: "list" },
          { id: "gpt-5.3-codex", visibility: "list" },
          { id: "codex-auto-review", visibility: "hide" }
        ]
      }),
      stderr: ""
    }));

    await expect(listCodexModels("/usr/bin/codex", { execFile })).resolves.toEqual(["gpt-5.5", "gpt-5.3-codex"]);
    expect(execFile).toHaveBeenCalledWith("/usr/bin/codex", ["debug", "models"], expect.objectContaining({ shell: false }));
  });

  it("retries model listing with fast service tier for legacy default config files", async () => {
    const execFile = vi.fn(async (_executable: string, args: readonly string[]) => {
      if (args.length === 2) {
        throw new Error("unknown variant `default`, expected `fast` or `flex` in service_tier");
      }
      return { stdout: JSON.stringify({ models: [{ slug: "gpt-5.5" }] }), stderr: "" };
    });

    await expect(listCodexModels("/usr/bin/codex", { execFile })).resolves.toEqual(["gpt-5.5"]);
    expect(execFile).toHaveBeenLastCalledWith(
      "/usr/bin/codex",
      ["debug", "models", "-c", 'service_tier="fast"'],
      expect.objectContaining({ shell: false })
    );
  });
});
