import { describe, expect, it } from "vitest";
import {
  AGENT_SLUGS,
  applyJsonInstall,
  applyTextInstall,
  isAgentSlug,
  planAgentInstall,
  removeJsonInstall,
  removeTextInstall,
  verifyCliUninstallEntry,
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

  it("provides executable install plans for Pi, Vibe and Hermes", () => {
    expect(planAgentInstall("pi", SPEC, ctx()).kind).toBe("json");
    expect(planAgentInstall("vibe", SPEC, ctx()).kind).toBe("text");
    expect(planAgentInstall("hermes", SPEC, ctx())).toMatchObject({ kind: "cli", bin: "hermes" });
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

  it("refuses to overwrite or remove a same-name foreign MCP entry", () => {
    const plan = planAgentInstall("cursor", SPEC, ctx()) as JsonInstallPlan;
    const foreign = JSON.stringify({ mcpServers: { "vdt-studio": { command: "foreign" } } });
    expect(() => applyJsonInstall(foreign, plan)).toThrow("Refusing to overwrite");
    expect(() => removeJsonInstall(foreign, plan)).toThrow("not managed");
  });

  it("installs and removes a managed Vibe TOML block idempotently", () => {
    const plan = planAgentInstall("vibe", SPEC, ctx());
    if (plan.kind !== "text") {
      throw new Error("expected text plan");
    }
    const existing = 'active_model = "devstral"\n';
    const once = applyTextInstall(existing, plan);
    expect(applyTextInstall(once, plan)).toBe(once);
    expect(once).toContain('active_model = "devstral"');
    expect(once).toContain('name = "vdt-studio"');
    expect(once).toMatch(/# ownership: vdt-studio sha256:[a-f0-9]{64}/);
    expect(removeTextInstall(once, plan)).toBe(existing);
  });

  it("refuses to replace or remove foreign or modified Vibe marker content", () => {
    const plan = planAgentInstall("vibe", SPEC, ctx());
    if (plan.kind !== "text") throw new Error("expected text plan");
    const foreign = `# BEGIN ${plan.marker}\nforeign = true\n# END ${plan.marker}\n`;
    expect(() => applyTextInstall(foreign, plan)).toThrow("ownership fingerprint is invalid");
    expect(() => removeTextInstall(foreign, plan)).toThrow("ownership fingerprint is invalid");

    const managed = applyTextInstall(null, plan).replace(SPEC.command, "/foreign/node");
    expect(() => applyTextInstall(managed, plan)).toThrow("ownership fingerprint is invalid");
    expect(() => removeTextInstall(managed, plan)).toThrow("ownership fingerprint is invalid");
  });

  it("verifies a CLI-backed same-name entry against the expected launch spec", () => {
    const plan = planAgentInstall("codex", SPEC, ctx());
    if (plan.kind !== "cli") throw new Error("expected CLI plan");
    const output = `${plan.serverName}\ncommand: ${SPEC.command}\nargs: ${SPEC.args.join(" ")}\nenv: VDT_STUDIO_HOME=/tmp/vdt`;
    expect(() => verifyCliUninstallEntry(plan, output)).not.toThrow();
    expect(() => verifyCliUninstallEntry(plan, `${plan.serverName}\ncommand: foreign`)).toThrow("does not match");
  });

  it("requires force when a CLI exposes only an unscoped list", () => {
    for (const slug of ["gemini", "hermes"] as const) {
      const plan = planAgentInstall(slug, SPEC, ctx());
      if (plan.kind !== "cli") throw new Error("expected CLI plan");
      expect(plan.uninstallVerification).toBe("force-required");
      expect(() => verifyCliUninstallEntry(plan, `${plan.serverName} ${SPEC.command}`)).toThrow("pass --force");
    }
  });
});
