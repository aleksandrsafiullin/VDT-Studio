import { inside, currentWorkspaceRoot } from "./subscription-cli/executable-scope";
import { cursorLaunchTarget, isOfficialWindowsCursorShim, resolveWindowsCursorShim, WindowsCursorLaunchError, WINDOWS_CURSOR_MODELS_TIMEOUT_MS, WINDOWS_CURSOR_VERSION_TIMEOUT_MS } from "./subscription-cli/cursor/windows-launch";
import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { selectCodexExecutable } from "./subscription-cli/codex/executable-selection";
import { CODEX_MODEL_CATALOG_MAX_BYTES } from "./subscription-cli/codex/constants";
import { BUILTIN_HARNESS_IDS, type HarnessId } from "./harness/catalog";
import { listHarnessDefinitions, getHarnessDefinition } from "./harness/profiles";

export const SUBSCRIPTION_CLI_IDS = BUILTIN_HARNESS_IDS;
export type SubscriptionCliId = HarnessId;

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
  cursorLaunchIssue?: "pending" | "ambiguous" | "unsupported";
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
  return Boolean(getHarnessDefinition(value));
}

const defaultExecutableCheck = async (candidate: string) => {
  try {
    await access(candidate, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const defaultVersionProbe = async (id: SubscriptionCliId, executable: string, args: readonly string[]) => {
  const target = id === "cursor-agent" ? cursorLaunchTarget(executable, args) : { executable, args: [...args], env: undefined, bundled: false };
  const result = await execFileAsync(target.executable, target.args, {
    env: target.env,
    encoding: "utf8",
    timeout: target.bundled ? WINDOWS_CURSOR_VERSION_TIMEOUT_MS : 5_000,
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
  const harness = getHarnessDefinition(id);
  const definition = definitions.get(id) ?? (harness ? { id: harness.id, backendId: harness.backendId, aliases: [harness.command] as const, versionArgs: [...(harness.custom ? harness.args : []), "--version"] } : undefined);
  if (!definition) throw new Error(`Unknown subscription CLI: ${id}`);
  if (id === "codex") {
    const selected = await selectCodexExecutable(options);
    return selected
      ? { id, backendId: definition.backendId, installed: true, ...selected }
      : { id, backendId: definition.backendId, installed: false, executable: null, alias: null, version: null };
  }
  const explicit = harness?.custom && path.isAbsolute(harness.command) ? harness.command : undefined;
  const windowsCursor = id === "cursor-agent" && (options.platform ?? process.platform) === "win32";
  const cursorPath = (options.path ?? process.env.PATH ?? "").split(";")
    .filter(directory => /^(?:[a-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/i.test(directory)).join(";");
  const workspace = windowsCursor && !options.executableCheck ? await currentWorkspaceRoot() : undefined;
  const search = windowsCursor ? {
    ...options,
    path: cursorPath,
    pathExt: ".EXE;.COM;.CMD",
    executableCheck: options.executableCheck ?? (async (candidate: string) => {
      try {
        if (workspace && (inside(workspace, candidate) || inside(workspace, await realpath(candidate)))) return false;
        return (await stat(candidate)).isFile() && await defaultExecutableCheck(candidate);
      }
      catch { return false; }
    })
  } : options;
  let match = explicit && await (options.executableCheck ?? defaultExecutableCheck)(explicit)
    ? { executable: explicit, alias: explicit }
    : await findExecutableOnPath(definition.aliases, search);
  if (windowsCursor && match?.executable.toLowerCase().endsWith(".cmd") && !isOfficialWindowsCursorShim(match.executable, process.env.LOCALAPPDATA, path.win32)) {
    const verified = await findExecutableOnPath(definition.aliases, {
      ...search,
      executableCheck: async candidate => isOfficialWindowsCursorShim(candidate, process.env.LOCALAPPDATA, path.win32) && Boolean(await search.executableCheck?.(candidate))
    });
    match = verified ?? match;
  }
  if (!match) return { id, backendId: definition.backendId, installed: false, executable: null, alias: null, version: null };
  try {
    if (id === "cursor-agent" && (options.platform ?? process.platform) === "win32" && /\.(?:cmd|bat|ps1)$/i.test(match.executable)) {
      match.executable = await resolveWindowsCursorShim(match.executable);
    }
    const result = await (options.versionProbe
      ? options.versionProbe(match.executable, definition.versionArgs)
      : defaultVersionProbe(id, match.executable, definition.versionArgs));
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
      ...(error instanceof WindowsCursorLaunchError ? { cursorLaunchIssue: error.issue } : {}),
      error: id === "cursor-agent" && (options.platform ?? process.platform) === "win32"
        ? "Cursor CLI version could not be verified. Run the official CLI, then rescan."
        : error instanceof Error ? error.message : String(error)
    };
  }
}

export async function detectSubscriptionClis(options: DetectionOptions = {}): Promise<SubscriptionCliDetectionResult[]> {
  return Promise.all(listHarnessDefinitions().map(({ id }) => detectSubscriptionCli(id, options)));
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
  const target = id === "cursor-agent" ? cursorLaunchTarget(executable, args) : { executable, args, env: undefined, bundled: false };
  const result = await execFileAsync(target.executable, target.args, {
    env: target.env,
    encoding: "utf8",
    timeout: target.bundled ? WINDOWS_CURSOR_MODELS_TIMEOUT_MS : 10_000,
    maxBuffer: id === "codex" ? CODEX_MODEL_CATALOG_MAX_BYTES : 512 * 1024,
    windowsHide: true,
    shell: false
  });
  return id === "cursor-agent" ? parseCursorModelList(result.stdout) : parseGenericModelList(`${result.stdout}\n${result.stderr}`);
}
