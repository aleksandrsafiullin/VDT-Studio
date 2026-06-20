import { createHash } from "node:crypto";
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
  serverName: string;
  expectedSpec: McpLaunchSpec;
  uninstallVerification: "get" | "force-required";
}

export interface JsonInstallPlan {
  kind: "json";
  slug: AgentSlug;
  configPath: string;
  keyPath: string[];
  serverKey: string;
  entry: unknown;
}

export interface TextInstallPlan {
  kind: "text";
  slug: AgentSlug;
  format: "toml";
  configPath: string;
  marker: string;
  content: string;
}

export type InstallPlan = CliInstallPlan | JsonInstallPlan | TextInstallPlan;

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
        getArgv: ["mcp", "get", serverName],
        serverName,
        expectedSpec: spec,
        uninstallVerification: "get"
      };
    case "codex":
      return {
        kind: "cli",
        slug,
        bin: "codex",
        addArgv: ["mcp", "add", serverName, ...envFlags(spec.env, "--env"), "--", spec.command, ...spec.args],
        removeArgv: ["mcp", "remove", serverName],
        getArgv: ["mcp", "get", serverName],
        serverName,
        expectedSpec: spec,
        uninstallVerification: "get"
      };
    case "gemini":
      return {
        kind: "cli",
        slug,
        bin: "gemini",
        addArgv: ["mcp", "add", "-s", "user", "-t", "stdio", ...envFlags(spec.env, "-e"), serverName, spec.command, ...spec.args],
        removeArgv: ["mcp", "remove", serverName],
        getArgv: ["mcp", "list"],
        serverName,
        expectedSpec: spec,
        uninstallVerification: "force-required"
      };
    case "kimi":
      return {
        kind: "cli",
        slug,
        bin: "kimi",
        addArgv: ["mcp", "add", "--transport", "stdio", ...envFlags(spec.env, "--env"), serverName, "--", spec.command, ...spec.args],
        removeArgv: ["mcp", "remove", serverName],
        getArgv: ["mcp", "get", serverName],
        serverName,
        expectedSpec: spec,
        uninstallVerification: "get"
      };
    case "hermes":
      return {
        kind: "cli",
        slug,
        bin: "hermes",
        addArgv: ["mcp", "add", serverName, "--command", spec.command, "--args", ...spec.args],
        removeArgv: ["mcp", "remove", serverName],
        getArgv: ["mcp", "list"],
        serverName,
        expectedSpec: spec,
        uninstallVerification: "force-required"
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
      return {
        kind: "json",
        slug,
        configPath: path.join(home, ".pi", "agent", "mcp.json"),
        keyPath: ["mcpServers"],
        serverKey: serverName,
        entry: jsonEntry(spec)
      };
    case "vibe":
      return {
        kind: "text",
        slug,
        format: "toml",
        configPath: path.join(home, ".vibe", "config.toml"),
        marker: `vdt-studio:mcp:${serverName}`,
        content: vibeTomlSnippet(spec, serverName)
      };
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
  const existing = cursor[plan.serverKey];
  if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(plan.entry)) {
    throw new Error(`Refusing to overwrite existing MCP server entry "${plan.serverKey}" in ${plan.configPath}.`);
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
  if (JSON.stringify(cursor[plan.serverKey]) !== JSON.stringify(plan.entry)) {
    throw new Error(`Refusing to remove MCP server entry "${plan.serverKey}" because it is not managed by this install plan.`);
  }
  delete cursor[plan.serverKey];
  return `${JSON.stringify(root, null, 2)}\n`;
}

export function applyTextInstall(existingText: string | null, plan: TextInstallPlan): string {
  const withoutManagedBlock = removeManagedBlock(existingText ?? "", plan.marker).trimEnd();
  const prefix = withoutManagedBlock.length > 0 ? `${withoutManagedBlock}\n\n` : "";
  return `${prefix}${managedBlock(plan)}\n`;
}

export function removeTextInstall(existingText: string | null, plan: TextInstallPlan): string | null {
  if (existingText === null || !existingText.includes(beginMarker(plan.marker))) {
    return null;
  }
  const next = removeManagedBlock(existingText, plan.marker).trimEnd();
  return next.length > 0 ? `${next}\n` : "";
}

export function verifyCliUninstallEntry(plan: CliInstallPlan, output: string): void {
  if (plan.uninstallVerification !== "get") {
    throw new Error(`${plan.bin} does not provide a reliable per-name MCP lookup; pass --force to remove ${plan.serverName}.`);
  }
  const expectedTokens = [
    plan.serverName,
    plan.expectedSpec.command,
    ...plan.expectedSpec.args,
    ...Object.entries(plan.expectedSpec.env).flatMap(([key, value]) => [key, value, `${key}=${value}`])
  ];
  const missing = expectedTokens.filter((token) => token.length > 0 && !output.includes(token));
  if (missing.length > 0) {
    throw new Error(`Refusing to remove MCP server "${plan.serverName}": current ${plan.bin} entry does not match this install plan. Pass --force to override.`);
  }
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

function managedBlock(plan: TextInstallPlan) {
  return `${beginMarker(plan.marker)}\n${fingerprintMarker(plan)}\n${plan.content}\n${endMarker(plan.marker)}`;
}

function removeManagedBlock(text: string, marker: string) {
  const begin = beginMarker(marker);
  const end = endMarker(marker);
  const start = text.indexOf(begin);
  if (start === -1) {
    return text;
  }
  const finish = text.indexOf(end, start + begin.length);
  if (finish === -1) {
    throw new Error(`Managed MCP block ${marker} is missing its end marker.`);
  }
  const blockEnd = finish + end.length;
  if (text.slice(blockEnd).includes(begin)) {
    throw new Error(`Managed MCP block ${marker} appears more than once.`);
  }
  const body = text.slice(start + begin.length + 1, finish);
  const newline = body.indexOf("\n");
  const fingerprintLine = newline === -1 ? body : body.slice(0, newline);
  const content = newline === -1 ? "" : body.slice(newline + 1).replace(/\n$/, "");
  const match = /^# ownership: vdt-studio sha256:([a-f0-9]{64})$/.exec(fingerprintLine);
  if (!match || match[1] !== textBlockFingerprint(marker, content)) {
    throw new Error(`Refusing to replace or remove MCP block ${marker}: ownership fingerprint is invalid.`);
  }
  return `${text.slice(0, start)}${text.slice(blockEnd)}`.replace(/\n{3,}/g, "\n\n");
}

function fingerprintMarker(plan: TextInstallPlan) {
  return `# ownership: vdt-studio sha256:${textBlockFingerprint(plan.marker, plan.content)}`;
}

function textBlockFingerprint(marker: string, content: string) {
  return createHash("sha256").update(JSON.stringify({ owner: "vdt-studio", marker, content })).digest("hex");
}

function beginMarker(marker: string) {
  return `# BEGIN ${marker}`;
}

function endMarker(marker: string) {
  return `# END ${marker}`;
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
