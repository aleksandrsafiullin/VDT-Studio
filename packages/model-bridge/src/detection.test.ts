import { describe, expect, it } from "vitest";
import { detectSubscriptionCli, findExecutableOnPath, parseCursorModelList, SUBSCRIPTION_CLI_IDS } from "./detection";

describe("subscription CLI detection", () => {
  it("limits the product catalog to the five reviewed subscription targets", () => {
    expect(SUBSCRIPTION_CLI_IDS).toEqual(["cursor-agent", "codex", "claude", "gemini", "copilot"]);
  });

  it("rejects path-like aliases", async () => {
    const checked: string[] = [];
    const result = await findExecutableOnPath(["../codex", "codex"], {
      path: "/tools",
      platform: "linux",
      executableCheck: async (candidate) => {
        checked.push(candidate);
        return candidate === "/tools/codex";
      }
    });
    expect(result).toEqual({ executable: "/tools/codex", alias: "codex" });
    expect(checked).toEqual(["/tools/codex"]);
  });

  it("reports installed binaries even when version probing fails", async () => {
    const result = await detectSubscriptionCli("codex", {
      path: "/tools",
      platform: "linux",
      executableCheck: async () => true,
      versionProbe: async () => { throw new Error("probe failed"); }
    });
    expect(result.installed).toBe(true);
    expect(result.version).toBeNull();
    expect(result.error).toBe("probe failed");
  });

  it("parses the Cursor model listing deterministically", () => {
    expect(parseCursorModelList("auto - Auto\ngpt-5 - GPT 5\nauto - Duplicate\nnoise"))
      .toEqual(["auto", "gpt-5"]);
  });
});
