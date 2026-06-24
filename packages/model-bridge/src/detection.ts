import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

export const SUBSCRIPTION_CLI_IDS = ["cursor-agent", "codex", "claude", "gemini", "copilot"] as const;
export type SubscriptionCliId = (typeof SUBSCRIPTION_CLI_IDS)[number];

interface SubscriptionCliDefinition {
  id: SubscriptionCliId;
  backendId: string;
  aliases: readonly [string, ...string[]];
  versionArgs: readonly string[];
}

export const SUBSCRIPTION_CLI_DEFINITIONS: readonly SubscriptionCliDefinition[] = Object.freeze([
  { id: "cursor-agent", backendId: "cursor_subscription", aliases: ["agent", "cursor-agent", "cursor"], versionArgs: ["--version"] },
  { id: "codex", backendId: "codex_subscription", aliases: ["codex"], versionArgs: ["--version"] },
  { id: "claude", backendId: "claude_subscription", aliases: ["claude"], versionArgs: ["--version"] },
  { id: "gemini", backendId: "gemini_subscription", aliases: ["gemini"], versionArgs: ["--version"] },
  { id: "copilot", backendId: "copilot_subscription", aliases: ["copilot"], versionArgs: ["--version"] }
]);

export interface SubscriptionCliDetectionResult {
  id: SubscriptionCliId;
  backendId: string;
  installed: boolean;
  executable: string | null;
  alias: string | null;
  version: string | null;
  error?: string;
}

export interface DetectionOptions {
  path?: string;
  platform?: NodeJS.Platform;
  pathExt?: string;
  executableCheck?: (candidate: string) => Promise<boolean>;
  versionProbe?: (executable: string, args: readonly string[]) => Promise<{ stdout: string; stderr: string }>;
}

const execFileAsync = promisify(execFile);
const definitions = new Map(SUBSCRIPTION_CLI_DEFINITIONS.map((definition) => [definition.id, definition]));

export function isSubscriptionCliId(value: string): value is SubscriptionCliId {
  return definitions.has(value as SubscriptionCliId);
}

const defaultExecutableCheck = async (candidate: string) => {
  try {
    await access(candidate, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const defaultVersionProbe = async (executable: string, args: readonly string[]) => {
  const result = await execFileAsync(executable, [...args], {
    encoding: "utf8",
    timeout: 5_000,
    maxBuffer: 64 * 1024,
    windowsHide: true,
    shell: false
  });
  return { stdout: result.stdout, stderr: result.stderr };
};

export async function findExecutableOnPath(
  aliases: readonly string[],
  options: Pick<DetectionOptions, "path" | "platform" | "pathExt" | "executableCheck"> = {}
): Promise<{ executable: string; alias: string } | null> {
  const platform = options.platform ?? process.platform;
  const pathValue = options.path ?? process.env.PATH ?? "";
  const pathExt = options.pathExt ?? process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD";
  const check = options.executableCheck ?? defaultExecutableCheck;
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const directories = pathValue.split(platform === "win32" ? ";" : ":").filter(Boolean);

  for (const alias of aliases) {
    if (pathApi.basename(alias) !== alias || alias === "." || alias === "..") continue;
    const extensions = platform === "win32" && pathApi.extname(alias) === ""
      ? ["", ...pathExt.split(";").map((value) => value.trim().toLowerCase()).filter(Boolean)]
      : [""];
    for (const directory of directories) {
      for (const extension of extensions) {
        const executable = pathApi.resolve(directory, `${alias}${extension}`);
        if (await check(executable)) return { executable, alias };
      }
    }
  }
  return null;
}

export async function detectSubscriptionCli(
  id: SubscriptionCliId,
  options: DetectionOptions = {}
): Promise<SubscriptionCliDetectionResult> {
  const definition = definitions.get(id);
  if (!definition) throw new Error(`Unknown subscription CLI: ${id}`);
  const match = await findExecutableOnPath(definition.aliases, options);
  if (!match) return { id, backendId: definition.backendId, installed: false, executable: null, alias: null, version: null };
  try {
    const result = await (options.versionProbe ?? defaultVersionProbe)(match.executable, definition.versionArgs);
    const version = `${result.stdout}\n${result.stderr}`.trim().split(/\r?\n/, 1)[0]?.trim() || null;
    return { id, backendId: definition.backendId, installed: true, executable: match.executable, alias: match.alias, version };
  } catch (error) {
    return {
      id,
      backendId: definition.backendId,
      installed: true,
      executable: match.executable,
      alias: match.alias,
      version: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function detectSubscriptionClis(options: DetectionOptions = {}): Promise<SubscriptionCliDetectionResult[]> {
  return Promise.all(SUBSCRIPTION_CLI_IDS.map((id) => detectSubscriptionCli(id, options)));
}

export function parseCursorModelList(output: string): string[] {
  const models: string[] = [];
  const seen = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    const text = line.trim().replace(/^[-*]\s+/, "");
    const model = text.match(/^([a-zA-Z0-9][a-zA-Z0-9._:/-]*)(?:\s+-\s+|\s{2,})/)?.[1];
    if (model && !seen.has(model)) {
      seen.add(model);
      models.push(model);
    }
  }
  return models;
}

function parseGenericModelList(output: string): string[] {
  const models: string[] = [];
  const seen = new Set<string>();
  const add = (model: unknown) => {
    if (typeof model !== "string") return;
    const trimmed = model.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      models.push(trimmed);
    }
  };
  const fromRecord = (value: unknown) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return;
    const record = value as Record<string, unknown>;
    for (const key of ["slug", "id", "model", "name"]) add(record[key]);
  };
  const trimmed = output.trim();
  if (!trimmed) return models;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      parsed.forEach((entry) => typeof entry === "string" ? add(entry) : fromRecord(entry));
      return models;
    }
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const nested = (parsed as Record<string, unknown>).models ?? (parsed as Record<string, unknown>).data;
      if (Array.isArray(nested)) {
        nested.forEach((entry) => typeof entry === "string" ? add(entry) : fromRecord(entry));
        return models;
      }
      fromRecord(parsed);
      if (models.length > 0) return models;
    }
  } catch {
    // Continue with line output.
  }
  for (const line of trimmed.split(/\r?\n/)) {
    const model = line.trim().match(/^([a-zA-Z0-9][a-zA-Z0-9._:/-]*)(?:\s+-\s+|\s{2,}|$)/)?.[1];
    if (model && !["model", "models", "name", "id"].includes(model.toLowerCase())) add(model);
  }
  return models;
}

export async function discoverSubscriptionCliModels(id: SubscriptionCliId, executable: string): Promise<string[]> {
  const args = id === "cursor-agent"
    ? ["models"]
    : id === "codex"
      ? ["debug", "models"]
      : undefined;
  if (!args) return [];
  const result = await execFileAsync(executable, args, {
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 512 * 1024,
    windowsHide: true,
    shell: false
  });
  return id === "cursor-agent" ? parseCursorModelList(result.stdout) : parseGenericModelList(`${result.stdout}\n${result.stderr}`);
}
