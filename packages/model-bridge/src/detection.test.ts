import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
    const directory = await mkdtemp(path.join(os.tmpdir(), "vdt-detect-codex-failed-"));
    try {
      await writeFile(path.join(directory, "codex"), "unused", { mode: 0o700 });
      const result = await detectSubscriptionCli("codex", {
        path: directory,
        executableCheck: async () => true,
        versionProbe: async () => { throw new Error("probe failed"); }
      });
      expect(result.installed).toBe(true);
      expect(result.version).toBeNull();
      expect(result.error).toBe("Codex CLI version probe failed.");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("parses the Cursor model listing deterministically", () => {
    expect(parseCursorModelList("auto - Auto\ngpt-5 - GPT 5\nauto - Duplicate\nnoise"))
      .toEqual(["auto", "gpt-5"]);
  });
});
