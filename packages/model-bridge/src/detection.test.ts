import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { detectSubscriptionCli, findExecutableOnPath, parseCursorModelList, SUBSCRIPTION_CLI_IDS } from "./detection";

describe("subscription CLI detection", () => {
  it("ignores drive-relative and cwd-relative Windows Cursor PATH entries", async () => {
    const seen: string[] = [];
    const result = await detectSubscriptionCli("cursor-agent", {
      platform: "win32",
      path: "relative;C:relative;\\root-relative;C:\\official",
      pathExt: "\\..\\unrelated.exe",
      executableCheck: async candidate => { seen.push(candidate); return false; }
    });
    expect(result.installed).toBe(false);
    expect(seen).toContain("C:\\official\\agent.exe");
    expect(seen.some(candidate => candidate.endsWith("unrelated.exe"))).toBe(false);
    expect(seen.every(candidate => candidate.startsWith("C:\\official\\"))).toBe(true);
  });

  it("prefers the official Cursor shim over a foreign agent.cmd without running either shim", async () => {
    vi.stubEnv("LOCALAPPDATA", "C:\\Profile Data");
    try {
      const foreign = "C:\\Tools\\agent.cmd";
      const official = "C:\\Profile Data\\cursor-agent\\cursor-agent.cmd";
      const versionProbe = vi.fn();
      const result = await detectSubscriptionCli("cursor-agent", {
        platform: "win32",
        path: "C:\\Tools;C:\\Profile Data\\cursor-agent",
        executableCheck: async candidate => candidate === foreign || candidate === official,
        versionProbe
      });
      expect(result.alias).toBe("cursor-agent");
      expect(versionProbe).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("includes exactly the thirteen current harnesses", () => {
    expect(SUBSCRIPTION_CLI_IDS).toEqual(["cursor-agent", "codex", "claude", "copilot", "opencode", "hermes", "kiro", "kimi", "vibe", "kilo", "qwen", "grok-build", "pi"]);
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
