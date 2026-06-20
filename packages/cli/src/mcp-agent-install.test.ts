import { describe, expect, it } from "vitest";
import {
  AGENT_SLUGS,
  applyJsonInstall,
  isAgentSlug,
  planAgentInstall,
  removeJsonInstall,
  type JsonInstallPlan,
  type McpLaunchSpec
} from "./mcp-agent-install";

const SPEC: McpLaunchSpec = {
  command: "/opt/node/bin/node",
  args: ["--import", "tsx", "/repo/packages/cli/src/cli.ts", "mcp"],
  env: { VDT_STUDIO_HOME: "/tmp/vdt" }
};

const ctx = (platform: NodeJS.Platform = "linux") => ({
  home: "/home/user",
  platform,
  serverName: "vdt-studio"
});

describe("VDT MCP agent install planner", () => {
  it("matches the documented agent surface", () => {
    expect(AGENT_SLUGS).toEqual([
      "claude",
      "codex",
      "cursor",
      "copilot",
      "gemini",
      "opencode",
      "openclaw",
      "antigravity",
      "cline",
      "trae",
      "kimi",
      "pi",
      "vibe",
      "hermes"
    ]);
    expect(isAgentSlug("codex")).toBe(true);
    expect(isAgentSlug("not-an-agent")).toBe(false);
  });

  it("plans Codex and Claude installs through their own MCP CLIs", () => {
    const codex = planAgentInstall("codex", SPEC, ctx());
    const claude = planAgentInstall("claude", SPEC, ctx());

    expect(codex.kind).toBe("cli");
    expect(claude.kind).toBe("cli");
    if (codex.kind !== "cli" || claude.kind !== "cli") {
      throw new Error("expected CLI plans");
    }
    expect(codex.addArgv).toEqual([
      "mcp",
      "add",
      "vdt-studio",
      "--env",
      "VDT_STUDIO_HOME=/tmp/vdt",
      "--",
      SPEC.command,
      ...SPEC.args
    ]);
    expect(claude.addArgv).toContain("--scope");
  });

  it("plans JSON config merges for Cursor and OpenCode without dropping env", () => {
    const cursor = planAgentInstall("cursor", SPEC, ctx());
    const opencode = planAgentInstall("opencode", SPEC, ctx());

    expect(cursor.kind).toBe("json");
    expect(opencode.kind).toBe("json");
    if (cursor.kind !== "json" || opencode.kind !== "json") {
      throw new Error("expected JSON plans");
    }
    expect(cursor.configPath).toBe("/home/user/.cursor/mcp.json");
    expect(cursor.keyPath).toEqual(["mcpServers"]);
    expect(cursor.entry).toMatchObject({ command: SPEC.command, args: SPEC.args, type: "stdio", env: SPEC.env });
    expect(opencode.keyPath).toEqual(["mcp"]);
    expect(opencode.entry).toMatchObject({
      type: "local",
      command: [SPEC.command, ...SPEC.args],
      enabled: true,
      environment: SPEC.env
    });
  });

  it("keeps unverified agent formats print-only", () => {
    for (const slug of ["pi", "vibe", "hermes"] as const) {
      const plan = planAgentInstall(slug, SPEC, ctx());
      expect(plan.kind).toBe("manual");
      if (plan.kind !== "manual") {
        throw new Error("expected manual plan");
      }
      expect(plan.snippet).toContain("vdt-studio");
      expect(plan.reason).toContain("manually");
    }
  });

  it("deep-merges and removes JSON install entries idempotently", () => {
    const plan = planAgentInstall("cursor", SPEC, ctx()) as JsonInstallPlan;
    const existing = JSON.stringify({
      editor: { theme: "dark" },
      mcpServers: {
        other: { command: "other-bin" }
      }
    });

    const once = applyJsonInstall(existing, plan);
    const twice = applyJsonInstall(once, plan);
    expect(twice).toBe(once);

    const merged = JSON.parse(once) as { editor: unknown; mcpServers: Record<string, unknown> };
    expect(merged.editor).toEqual({ theme: "dark" });
    expect(merged.mcpServers.other).toEqual({ command: "other-bin" });
    expect(merged.mcpServers["vdt-studio"]).toBeDefined();

    const removed = JSON.parse(removeJsonInstall(once, plan) ?? "{}") as { mcpServers: Record<string, unknown> };
    expect(removed.mcpServers.other).toEqual({ command: "other-bin" });
    expect(removed.mcpServers["vdt-studio"]).toBeUndefined();
  });
});
