import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

export const CODING_AGENT_IDS = [
  "claude",
  "codex",
  "opencode",
  "hermes",
  "antigravity",
  "gemini",
  "grok-build",
  "kimi",
  "cursor-agent",
  "qwen",
  "qoder",
  "copilot",
  "pi",
  "kiro",
  "kilo",
  "vibe",
  "deepseek",
  "reasonix",
  "aider",
  "devin",
  "trae"
] as const;

export type CodingAgentId = (typeof CODING_AGENT_IDS)[number];

export type AgentStreamFormat =
  | "json-lines"
  | "json"
  | "text"
  | "text-and-json"
  | "acp-json-rpc"
  | "pi-rpc"
  | "unknown";

export type SkillInjectionStrategy =
  | "native-directory"
  | "agents-md"
  | "prompt"
  | "none";

export interface AgentCapabilities {
  readonly streaming: boolean;
  readonly structuredOutput: boolean;
  readonly mcp: boolean;
  readonly skills: boolean;
  readonly systemPrompt: boolean;
  readonly sessionResume: boolean;
}

export interface AgentDefinition {
  readonly id: CodingAgentId;
  readonly displayName: string;
  readonly executableAliases: readonly [string, ...string[]];
  readonly versionArgs: readonly string[];
  readonly configDirs: readonly string[];
  readonly skillsDirs: readonly string[];
  readonly streamFormat: AgentStreamFormat;
  readonly skillInjection: SkillInjectionStrategy;
  readonly capabilities: AgentCapabilities;
}

export interface AgentDetectionResult {
  readonly id: CodingAgentId;
  readonly installed: boolean;
  readonly executable: string | null;
  readonly alias: string | null;
  readonly version: string | null;
  readonly error?: string;
}

export interface AgentRunParams {
  readonly agentId: CodingAgentId;
  readonly prompt: string;
  readonly cwd: string;
  readonly model?: string;
  readonly sessionId?: string;
  readonly systemPrompt?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly extraArgs?: readonly string[];
}

export type AgentRunEvent =
  | { readonly type: "start"; readonly agentId: CodingAgentId; readonly command: string; readonly argv: readonly string[] }
  | { readonly type: "stdout"; readonly data: string }
  | { readonly type: "stderr"; readonly data: string }
  | { readonly type: "message"; readonly role: "assistant" | "tool" | "system"; readonly content: string }
  | { readonly type: "tool-call"; readonly name: string; readonly callId?: string; readonly input: unknown }
  | { readonly type: "tool-result"; readonly name: string; readonly callId?: string; readonly output: unknown }
  | { readonly type: "complete"; readonly exitCode: number; readonly sessionId?: string }
  | { readonly type: "error"; readonly error: Error };

const capability = (
  overrides: Partial<AgentCapabilities> = {}
): AgentCapabilities => Object.freeze({
  streaming: true,
  structuredOutput: false,
  mcp: false,
  skills: false,
  systemPrompt: false,
  sessionResume: false,
  ...overrides
});

const definition = (value: AgentDefinition): AgentDefinition => Object.freeze({
  ...value,
  executableAliases: Object.freeze([...value.executableAliases]) as unknown as AgentDefinition["executableAliases"],
  versionArgs: Object.freeze([...value.versionArgs]),
  configDirs: Object.freeze([...value.configDirs]),
  skillsDirs: Object.freeze([...value.skillsDirs]),
  capabilities: Object.freeze({ ...value.capabilities })
});

export const AGENT_DEFINITIONS: readonly AgentDefinition[] = Object.freeze([
  definition({ id: "claude", displayName: "Claude Code", executableAliases: ["claude"], versionArgs: ["--version"], configDirs: [".claude"], skillsDirs: [".claude/skills"], streamFormat: "json-lines", skillInjection: "native-directory", capabilities: capability({ structuredOutput: true, mcp: true, skills: true, systemPrompt: true, sessionResume: true }) }),
  definition({ id: "codex", displayName: "Codex CLI", executableAliases: ["codex"], versionArgs: ["--version"], configDirs: [".codex"], skillsDirs: [".codex/skills"], streamFormat: "json-lines", skillInjection: "native-directory", capabilities: capability({ structuredOutput: true, mcp: true, skills: true, systemPrompt: true, sessionResume: true }) }),
  definition({ id: "opencode", displayName: "OpenCode", executableAliases: ["opencode-cli", "opencode"], versionArgs: ["--version"], configDirs: [".config/opencode"], skillsDirs: [".config/opencode/skills"], streamFormat: "json-lines", skillInjection: "agents-md", capabilities: capability({ structuredOutput: true, mcp: true, skills: true, systemPrompt: true }) }),
  definition({ id: "hermes", displayName: "Hermes Agent", executableAliases: ["hermes"], versionArgs: ["--version"], configDirs: [".hermes"], skillsDirs: [".hermes/skills"], streamFormat: "acp-json-rpc", skillInjection: "native-directory", capabilities: capability({ structuredOutput: true, mcp: true, skills: true, systemPrompt: true, sessionResume: true }) }),
  definition({ id: "antigravity", displayName: "Antigravity", executableAliases: ["antigravity"], versionArgs: ["--version"], configDirs: [".gemini/antigravity"], skillsDirs: [".gemini/antigravity/skills"], streamFormat: "unknown", skillInjection: "prompt", capabilities: capability({ mcp: true, skills: true }) }),
  definition({ id: "gemini", displayName: "Gemini CLI", executableAliases: ["gemini"], versionArgs: ["--version"], configDirs: [".gemini"], skillsDirs: [".gemini/skills"], streamFormat: "json-lines", skillInjection: "native-directory", capabilities: capability({ structuredOutput: true, mcp: true, skills: true, systemPrompt: true }) }),
  definition({ id: "grok-build", displayName: "Grok Build", executableAliases: ["grok-build", "grok"], versionArgs: ["--version"], configDirs: [".grok"], skillsDirs: [".grok/skills"], streamFormat: "unknown", skillInjection: "prompt", capabilities: capability({ skills: true, systemPrompt: true }) }),
  definition({ id: "kimi", displayName: "Kimi CLI", executableAliases: ["kimi"], versionArgs: ["--version"], configDirs: [".kimi"], skillsDirs: [".kimi/skills"], streamFormat: "acp-json-rpc", skillInjection: "native-directory", capabilities: capability({ structuredOutput: true, mcp: true, skills: true, systemPrompt: true, sessionResume: true }) }),
  definition({ id: "cursor-agent", displayName: "Cursor Agent", executableAliases: ["cursor-agent", "cursor"], versionArgs: ["--version"], configDirs: [".cursor"], skillsDirs: [".cursor/skills"], streamFormat: "json-lines", skillInjection: "agents-md", capabilities: capability({ structuredOutput: true, mcp: true, skills: true, systemPrompt: true }) }),
  definition({ id: "qwen", displayName: "Qwen Code", executableAliases: ["qwen", "qwen-code"], versionArgs: ["--version"], configDirs: [".qwen"], skillsDirs: [".qwen/skills"], streamFormat: "text", skillInjection: "agents-md", capabilities: capability({ mcp: true, skills: true, systemPrompt: true }) }),
  definition({ id: "qoder", displayName: "Qoder CLI", executableAliases: ["qodercli", "qoder"], versionArgs: ["--version"], configDirs: [".qoder"], skillsDirs: [".qoder/skills"], streamFormat: "json-lines", skillInjection: "prompt", capabilities: capability({ structuredOutput: true, skills: true, systemPrompt: true }) }),
  definition({ id: "copilot", displayName: "GitHub Copilot CLI", executableAliases: ["copilot", "github-copilot"], versionArgs: ["--version"], configDirs: [".copilot"], skillsDirs: [".copilot/skills"], streamFormat: "text-and-json", skillInjection: "agents-md", capabilities: capability({ structuredOutput: true, mcp: true, skills: true, systemPrompt: true, sessionResume: true }) }),
  definition({ id: "pi", displayName: "Pi Coding Agent", executableAliases: ["pi"], versionArgs: ["--version"], configDirs: [".pi/agent"], skillsDirs: [".pi/agent/skills"], streamFormat: "pi-rpc", skillInjection: "native-directory", capabilities: capability({ structuredOutput: true, mcp: true, skills: true, systemPrompt: true }) }),
  definition({ id: "kiro", displayName: "Kiro CLI", executableAliases: ["kiro-cli", "kiro"], versionArgs: ["--version"], configDirs: [".kiro"], skillsDirs: [".kiro/skills"], streamFormat: "acp-json-rpc", skillInjection: "agents-md", capabilities: capability({ mcp: true, skills: true, systemPrompt: true, sessionResume: true }) }),
  definition({ id: "kilo", displayName: "Kilo Code", executableAliases: ["kilo", "kilo-code"], versionArgs: ["--version"], configDirs: [".kilo"], skillsDirs: [".kilo/skills"], streamFormat: "acp-json-rpc", skillInjection: "prompt", capabilities: capability({ mcp: true, skills: true, systemPrompt: true, sessionResume: true }) }),
  definition({ id: "vibe", displayName: "Mistral Vibe CLI", executableAliases: ["vibe-acp", "vibe"], versionArgs: ["--version"], configDirs: [".vibe"], skillsDirs: [".vibe/skills"], streamFormat: "acp-json-rpc", skillInjection: "prompt", capabilities: capability({ mcp: true, skills: true, systemPrompt: true, sessionResume: true }) }),
  definition({ id: "deepseek", displayName: "DeepSeek CLI", executableAliases: ["deepseek"], versionArgs: ["--version"], configDirs: [".deepseek"], skillsDirs: [".deepseek/skills"], streamFormat: "unknown", skillInjection: "prompt", capabilities: capability({ skills: true, systemPrompt: true }) }),
  definition({ id: "reasonix", displayName: "Reasonix", executableAliases: ["reasonix"], versionArgs: ["--version"], configDirs: [".reasonix"], skillsDirs: [".reasonix/skills"], streamFormat: "unknown", skillInjection: "prompt", capabilities: capability({ skills: true, systemPrompt: true }) }),
  definition({ id: "aider", displayName: "Aider", executableAliases: ["aider"], versionArgs: ["--version"], configDirs: [".aider"], skillsDirs: [], streamFormat: "text", skillInjection: "prompt", capabilities: capability({ skills: true, systemPrompt: true }) }),
  definition({ id: "devin", displayName: "Devin CLI", executableAliases: ["devin"], versionArgs: ["--version"], configDirs: [".devin"], skillsDirs: [".devin/skills"], streamFormat: "acp-json-rpc", skillInjection: "agents-md", capabilities: capability({ structuredOutput: true, skills: true, systemPrompt: true, sessionResume: true }) }),
  definition({ id: "trae", displayName: "Trae Agent", executableAliases: ["trae-agent", "trae"], versionArgs: ["--version"], configDirs: [".trae"], skillsDirs: [".trae/skills"], streamFormat: "unknown", skillInjection: "prompt", capabilities: capability({ mcp: true, skills: true, systemPrompt: true }) })
]);

const registry = new Map<CodingAgentId, AgentDefinition>();
for (const agent of AGENT_DEFINITIONS) {
  if (registry.has(agent.id)) {
    throw new Error(`Duplicate coding agent id: ${agent.id}`);
  }
  registry.set(agent.id, agent);
}
if (registry.size !== CODING_AGENT_IDS.length) {
  throw new Error(`Coding agent registry must contain exactly ${CODING_AGENT_IDS.length} definitions.`);
}

export function isCodingAgentId(value: string): value is CodingAgentId {
  return registry.has(value as CodingAgentId);
}

export function getAgentDefinition(id: CodingAgentId): AgentDefinition {
  const agent = registry.get(id);
  if (!agent) {
    throw new Error(`Unknown coding agent: ${id}`);
  }
  return agent;
}

export interface VersionProbeResult {
  readonly stdout: string;
  readonly stderr: string;
}

export type VersionProbe = (executable: string, args: readonly string[]) => Promise<VersionProbeResult>;
export type ExecutableCheck = (candidate: string) => Promise<boolean>;

export interface DetectionOptions {
  readonly path?: string;
  readonly platform?: NodeJS.Platform;
  readonly pathExt?: string;
  readonly executableCheck?: ExecutableCheck;
  readonly versionProbe?: VersionProbe;
}

const execFileAsync = promisify(execFile);

export const defaultVersionProbe: VersionProbe = async (executable, args) => {
  const result = await execFileAsync(executable, [...args], {
    encoding: "utf8",
    timeout: 5_000,
    maxBuffer: 64 * 1024,
    windowsHide: true,
    shell: false
  });
  return { stdout: result.stdout, stderr: result.stderr };
};

const defaultExecutableCheck: ExecutableCheck = async (candidate) => {
  try {
    await access(candidate, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
};

function executableNames(alias: string, platform: NodeJS.Platform, pathExt: string): readonly string[] {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  if (platform !== "win32" || pathApi.extname(alias) !== "") {
    return [alias];
  }
  const extensions = pathExt.split(";").map((value) => value.trim()).filter(Boolean);
  return [alias, ...extensions.map((extension) => `${alias}${extension.toLowerCase()}`)];
}

export async function findExecutableOnPath(
  aliases: readonly string[],
  options: Pick<DetectionOptions, "path" | "platform" | "pathExt" | "executableCheck"> = {}
): Promise<{ executable: string; alias: string } | null> {
  const platform = options.platform ?? process.platform;
  const pathValue = options.path ?? process.env.PATH ?? "";
  const pathExt = options.pathExt ?? process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD";
  const check = options.executableCheck ?? defaultExecutableCheck;
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const delimiter = platform === "win32" ? ";" : ":";
  const directories = pathValue.split(delimiter).filter((directory) => directory.length > 0);

  for (const alias of aliases) {
    if (pathApi.basename(alias) !== alias || alias === "." || alias === "..") {
      continue;
    }
    for (const directory of directories) {
      for (const name of executableNames(alias, platform, pathExt)) {
        const candidate = pathApi.resolve(directory, name);
        if (await check(candidate)) {
          return { executable: candidate, alias };
        }
      }
    }
  }
  return null;
}

export async function detectAgent(id: CodingAgentId, options: DetectionOptions = {}): Promise<AgentDetectionResult> {
  const agent = getAgentDefinition(id);
  const match = await findExecutableOnPath(agent.executableAliases, options);
  if (!match) {
    return { id, installed: false, executable: null, alias: null, version: null };
  }

  try {
    const probe = options.versionProbe ?? defaultVersionProbe;
    const result = await probe(match.executable, agent.versionArgs);
    const version = `${result.stdout}\n${result.stderr}`.trim().split(/\r?\n/, 1)[0]?.trim() || null;
    return { id, installed: true, executable: match.executable, alias: match.alias, version };
  } catch (error) {
    return {
      id,
      installed: true,
      executable: match.executable,
      alias: match.alias,
      version: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function detectAgents(options: DetectionOptions = {}): Promise<AgentDetectionResult[]> {
  return Promise.all(CODING_AGENT_IDS.map((id) => detectAgent(id, options)));
}
