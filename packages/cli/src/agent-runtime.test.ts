import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  AGENT_DEFINITIONS,
  CODING_AGENT_IDS,
  detectAgent,
  detectAgents,
  findExecutableOnPath,
  getAgentDefinition,
  isCodingAgentId,
  type AgentCapabilities
} from "./agent-runtime";

const EXPECTED_IDS = [
  "claude", "codex", "opencode", "hermes", "antigravity", "gemini", "grok-build",
  "kimi", "cursor-agent", "qwen", "qoder", "copilot", "pi", "kiro", "kilo", "vibe",
  "deepseek", "reasonix", "aider", "devin", "trae"
] as const;

describe("coding agent runtime registry", () => {
  it("contains exactly the 21 requested definitions", () => {
    expect(CODING_AGENT_IDS).toEqual(EXPECTED_IDS);
    expect(AGENT_DEFINITIONS).toHaveLength(21);
    expect(AGENT_DEFINITIONS.map((agent) => agent.id)).toEqual(EXPECTED_IDS);
  });

  it("has unique ids and aliases within each definition", () => {
    expect(new Set(AGENT_DEFINITIONS.map((agent) => agent.id)).size).toBe(21);
    for (const agent of AGENT_DEFINITIONS) {
      expect(new Set(agent.executableAliases).size).toBe(agent.executableAliases.length);
      expect(agent.executableAliases.length).toBeGreaterThan(0);
      expect(agent.versionArgs.length).toBeGreaterThan(0);
    }
  });

  it("looks up every definition and rejects unknown ids", () => {
    for (const id of EXPECTED_IDS) {
      expect(isCodingAgentId(id)).toBe(true);
      expect(getAgentDefinition(id).id).toBe(id);
    }
    expect(isCodingAgentId("not-an-agent")).toBe(false);
  });

  it("provides complete capability and integration metadata for every agent", () => {
    const capabilityKeys: readonly (keyof AgentCapabilities)[] = [
      "streaming", "structuredOutput", "mcp", "skills", "systemPrompt", "sessionResume"
    ];
    for (const agent of AGENT_DEFINITIONS) {
      expect(agent.displayName.length).toBeGreaterThan(0);
      expect(agent.configDirs).toBeInstanceOf(Array);
      expect(agent.skillsDirs).toBeInstanceOf(Array);
      expect(["json-lines", "json", "text", "text-and-json", "acp-json-rpc", "pi-rpc", "unknown"]).toContain(agent.streamFormat);
      expect(["native-directory", "agents-md", "prompt", "none"]).toContain(agent.skillInjection);
      expect(Object.keys(agent.capabilities).sort()).toEqual([...capabilityKeys].sort());
      for (const key of capabilityKeys) {
        expect(typeof agent.capabilities[key]).toBe("boolean");
      }
      expect(agent.capabilities.skills).toBe(agent.skillInjection !== "none");
    }
  });

  it("finds aliases on PATH without accepting path traversal aliases", async () => {
    const check = vi.fn(async (candidate: string) => candidate === path.resolve("/tools", "cursor"));
    await expect(findExecutableOnPath(["../cursor", "cursor-agent", "cursor"], {
      path: "/bin:/tools",
      platform: "linux",
      executableCheck: check
    })).resolves.toEqual({ executable: path.resolve("/tools", "cursor"), alias: "cursor" });
    expect(check).not.toHaveBeenCalledWith(expect.stringContaining(".."));
  });

  it("uses Windows PATH and PATHEXT rules when requested", async () => {
    await expect(findExecutableOnPath(["kiro-cli"], {
      path: "C:\\Windows;C:\\Tools",
      pathExt: ".EXE;.CMD",
      platform: "win32",
      executableCheck: async (candidate) => candidate === "C:\\Tools\\kiro-cli.exe"
    })).resolves.toEqual({ executable: "C:\\Tools\\kiro-cli.exe", alias: "kiro-cli" });
  });

  it("detects an installed agent and injects the version probe", async () => {
    const versionProbe = vi.fn(async () => ({ stdout: "Codex CLI 1.2.3\n", stderr: "" }));
    const result = await detectAgent("codex", {
      path: "/usr/local/bin",
      platform: "linux",
      executableCheck: async (candidate) => candidate === "/usr/local/bin/codex",
      versionProbe
    });

    expect(result).toEqual({
      id: "codex",
      installed: true,
      executable: "/usr/local/bin/codex",
      alias: "codex",
      version: "Codex CLI 1.2.3"
    });
    expect(versionProbe).toHaveBeenCalledWith("/usr/local/bin/codex", ["--version"]);
  });

  it("reports missing executables without probing a version", async () => {
    const versionProbe = vi.fn();
    await expect(detectAgent("claude", {
      path: "/empty",
      platform: "linux",
      executableCheck: async () => false,
      versionProbe
    })).resolves.toEqual({
      id: "claude",
      installed: false,
      executable: null,
      alias: null,
      version: null
    });
    expect(versionProbe).not.toHaveBeenCalled();
  });

  it("keeps a discovered executable installed when version probing fails", async () => {
    const result = await detectAgent("aider", {
      path: "/tools",
      platform: "linux",
      executableCheck: async () => true,
      versionProbe: async () => { throw new Error("probe timed out"); }
    });

    expect(result).toMatchObject({
      id: "aider",
      installed: true,
      executable: "/tools/aider",
      alias: "aider",
      version: null,
      error: "probe timed out"
    });
  });

  it("detects the complete registry in stable catalog order", async () => {
    const results = await detectAgents({
      path: "/empty",
      platform: "linux",
      executableCheck: async () => false
    });
    expect(results.map((result) => result.id)).toEqual(EXPECTED_IDS);
    expect(results.every((result) => !result.installed)).toBe(true);
  });
});
