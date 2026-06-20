import path from "node:path";

export const AGENT_SLUGS = [
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
] as const;

export type AgentSlug = (typeof AGENT_SLUGS)[number];

export interface McpLaunchSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface PlanContext {
  home: string;
  platform: NodeJS.Platform;
  serverName: string;
}

export interface CliInstallPlan {
  kind: "cli";
  slug: AgentSlug;
  bin: string;
  addArgv: string[];
  removeArgv: string[];
  getArgv: string[];
}

export interface JsonInstallPlan {
  kind: "json";
  slug: AgentSlug;
  configPath: string;
  keyPath: string[];
  serverKey: string;
  entry: unknown;
}

export interface ManualInstallPlan {
  kind: "manual";
  slug: AgentSlug;
  format: "json" | "yaml" | "toml";
  configPath: string | null;
  snippet: string;
  reason: string;
}

export type InstallPlan = CliInstallPlan | JsonInstallPlan | ManualInstallPlan;

export function isAgentSlug(value: string): value is AgentSlug {
  return (AGENT_SLUGS as readonly string[]).includes(value);
}

function envFlags(env: Record<string, string>, flag: string): string[] {
  return Object.entries(env).flatMap(([key, value]) => [flag, `${key}=${value}`]);
}

function jsonEntry(
  spec: McpLaunchSpec,
  extra: Record<string, unknown> = {},
  envKey: "env" | "environment" = "env"
) {
  const entry: Record<string, unknown> = {
    command: spec.command,
    args: spec.args,
    ...extra
  };
  if (Object.keys(spec.env).length > 0) {
    entry[envKey] = spec.env;
  }
  return entry;
}

export function planAgentInstall(slug: AgentSlug, spec: McpLaunchSpec, ctx: PlanContext): InstallPlan {
  const { home, platform, serverName } = ctx;

  switch (slug) {
    case "claude":
      return {
        kind: "cli",
        slug,
        bin: "claude",
        addArgv: ["mcp", "add", "--scope", "user", serverName, ...envFlags(spec.env, "-e"), "--", spec.command, ...spec.args],
        removeArgv: ["mcp", "remove", "--scope", "user", serverName],
        getArgv: ["mcp", "get", serverName]
      };
    case "codex":
      return {
        kind: "cli",
        slug,
        bin: "codex",
        addArgv: ["mcp", "add", serverName, ...envFlags(spec.env, "--env"), "--", spec.command, ...spec.args],
        removeArgv: ["mcp", "remove", serverName],
        getArgv: ["mcp", "get", serverName]
      };
    case "gemini":
      return {
        kind: "cli",
        slug,
        bin: "gemini",
        addArgv: ["mcp", "add", "-s", "user", "-t", "stdio", ...envFlags(spec.env, "-e"), serverName, spec.command, ...spec.args],
        removeArgv: ["mcp", "remove", serverName],
        getArgv: ["mcp", "list"]
      };
    case "kimi":
      return {
        kind: "cli",
        slug,
        bin: "kimi",
        addArgv: ["mcp", "add", "--transport", "stdio", ...envFlags(spec.env, "--env"), serverName, "--", spec.command, ...spec.args],
        removeArgv: ["mcp", "remove", serverName],
        getArgv: ["mcp", "get", serverName]
      };
    case "cursor":
      return {
        kind: "json",
        slug,
        configPath: path.join(home, ".cursor", "mcp.json"),
        keyPath: ["mcpServers"],
        serverKey: serverName,
        entry: jsonEntry(spec, { type: "stdio" })
      };
    case "copilot":
      return {
        kind: "json",
        slug,
        configPath: path.join(home, ".copilot", "mcp-config.json"),
        keyPath: ["mcpServers"],
        serverKey: serverName,
        entry: jsonEntry(spec, { type: "local", tools: ["*"] })
      };
    case "opencode":
      return {
        kind: "json",
        slug,
        configPath: path.join(home, ".config", "opencode", "opencode.json"),
        keyPath: ["mcp"],
        serverKey: serverName,
        entry: {
          type: "local",
          command: [spec.command, ...spec.args],
          enabled: true,
          ...(Object.keys(spec.env).length > 0 ? { environment: spec.env } : {})
        }
      };
    case "openclaw":
      return {
        kind: "json",
        slug,
        configPath: path.join(home, ".openclaw", "openclaw.json"),
        keyPath: ["mcp", "servers"],
        serverKey: serverName,
        entry: jsonEntry(spec)
      };
    case "antigravity":
      return {
        kind: "json",
        slug,
        configPath: path.join(home, ".gemini", "antigravity", "mcp_config.json"),
        keyPath: ["mcpServers"],
        serverKey: serverName,
        entry: jsonEntry(spec)
      };
    case "cline":
      return {
        kind: "json",
        slug,
        configPath: clineConfigPath(home, platform),
        keyPath: ["mcpServers"],
        serverKey: serverName,
        entry: jsonEntry(spec, { disabled: false, autoApprove: [] })
      };
    case "trae":
      return {
        kind: "json",
        slug,
        configPath: traeConfigPath(home, platform),
        keyPath: ["mcpServers"],
        serverKey: serverName,
        entry: jsonEntry(spec)
      };
    case "pi":
      return manualPlan(slug, "json", path.join(home, ".pi", "agent", "mcp.json"), genericMcpServersSnippet(spec, serverName));
    case "hermes":
      return manualPlan(slug, "yaml", path.join(home, ".hermes", "config.yaml"), hermesYamlSnippet(spec, serverName));
    case "vibe":
      return manualPlan(slug, "toml", path.join(home, ".vibe", "config.toml"), vibeTomlSnippet(spec, serverName));
    default: {
      const exhaustive: never = slug;
      throw new Error(`Unknown MCP agent slug: ${String(exhaustive)}`);
    }
  }
}

export function applyJsonInstall(existingText: string | null, plan: JsonInstallPlan): string {
  const root = parseJsonObject(existingText, plan.configPath);
  let cursor = root;
  for (const key of plan.keyPath) {
    const next = cursor[key];
    if (next === undefined || next === null || typeof next !== "object" || Array.isArray(next)) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[plan.serverKey] = plan.entry;
  return `${JSON.stringify(root, null, 2)}\n`;
}

export function removeJsonInstall(existingText: string | null, plan: JsonInstallPlan): string | null {
  if (existingText === null || existingText.trim() === "") {
    return null;
  }
  const root = parseJsonObject(existingText, plan.configPath);
  let cursor = root;
  for (const key of plan.keyPath) {
    const next = cursor[key];
    if (next === undefined || next === null || typeof next !== "object" || Array.isArray(next)) {
      return null;
    }
    cursor = next as Record<string, unknown>;
  }
  if (!(plan.serverKey in cursor)) {
    return null;
  }
  delete cursor[plan.serverKey];
  return `${JSON.stringify(root, null, 2)}\n`;
}

function parseJsonObject(text: string | null, configPath: string): Record<string, unknown> {
  if (text === null || text.trim() === "") {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`Existing config at ${configPath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Existing config at ${configPath} is not a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function clineConfigPath(home: string, platform: NodeJS.Platform) {
  const rel = path.join("globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json");
  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Code", "User", rel);
  }
  if (platform === "win32") {
    return path.join(process.env.APPDATA ?? path.join(home, "AppData", "Roaming"), "Code", "User", rel);
  }
  return path.join(home, ".config", "Code", "User", rel);
}

function traeConfigPath(home: string, platform: NodeJS.Platform) {
  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Trae", "User", "mcp.json");
  }
  if (platform === "win32") {
    return path.join(process.env.APPDATA ?? path.join(home, "AppData", "Roaming"), "Trae", "User", "mcp.json");
  }
  return path.join(home, ".config", "Trae", "User", "mcp.json");
}

function manualPlan(slug: AgentSlug, format: ManualInstallPlan["format"], configPath: string, snippet: string): ManualInstallPlan {
  return {
    kind: "manual",
    slug,
    format,
    configPath,
    snippet,
    reason: "This agent's MCP config schema is not stable enough to edit automatically; paste the generated snippet manually."
  };
}

function genericMcpServersSnippet(spec: McpLaunchSpec, name: string) {
  return JSON.stringify({ mcpServers: { [name]: jsonEntry(spec) } }, null, 2);
}

function hermesYamlSnippet(spec: McpLaunchSpec, name: string) {
  const lines = ["mcp_servers:", `  ${name}:`, `    command: ${JSON.stringify(spec.command)}`, `    args: ${JSON.stringify(spec.args)}`];
  if (Object.keys(spec.env).length > 0) {
    lines.push("    env:");
    for (const [key, value] of Object.entries(spec.env)) {
      lines.push(`      ${key}: ${JSON.stringify(value)}`);
    }
  }
  return lines.join("\n");
}

function vibeTomlSnippet(spec: McpLaunchSpec, name: string) {
  return [
    "[[mcp_servers]]",
    `name = ${JSON.stringify(name)}`,
    'transport = "stdio"',
    `command = ${JSON.stringify(spec.command)}`,
    `args = [${spec.args.map((arg) => JSON.stringify(arg)).join(", ")}]`
  ].join("\n");
}
