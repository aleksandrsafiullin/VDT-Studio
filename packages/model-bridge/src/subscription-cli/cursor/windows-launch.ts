import { lstatSync, realpathSync } from "node:fs";
import { lstat, readdir, realpath } from "node:fs/promises";
import path from "node:path";

const versionName = /^(\d{4})\.(\d{1,2})\.(\d{1,2})(?:-\d{2}-\d{2}-\d{2})?-[a-f0-9]+$/i;
export const WINDOWS_CURSOR_VERSION_TIMEOUT_MS = 25_000;
export const WINDOWS_CURSOR_MODELS_TIMEOUT_MS = 25_000;
export const WINDOWS_CURSOR_STATUS_TIMEOUT_MS = 40_000;

export class WindowsCursorLaunchError extends Error {
  constructor(readonly issue: "pending" | "ambiguous" | "unsupported") {
    super(windowsCursorLaunchIssueMessage(issue));
  }
}

export function windowsCursorLaunchIssueMessage(issue: WindowsCursorLaunchError["issue"]): string {
  if (issue === "pending") return "Cursor has a pending update. Finish it using Cursor's official CLI, then rescan.";
  if (issue === "ambiguous") return "Cursor's latest Windows CLI version is ambiguous. Repair the official installation, then rescan.";
  return "The Windows Cursor CLI payload could not be verified. Repair the official installation, then rescan.";
}

async function regular(candidate: string): Promise<void> {
  if (!(await lstat(candidate)).isFile() || path.relative(candidate, await realpath(candidate)) !== "") {
    throw new Error("Cursor's installed Windows payload is incomplete or redirected. Repair the official Cursor CLI installation.");
  }
}

export async function resolveWindowsCursorShim(shim: string, localAppData = process.env.LOCALAPPDATA): Promise<string> {
  try {
    return await readWindowsCursorPayload(shim, localAppData);
  } catch (error) {
    if (error instanceof WindowsCursorLaunchError) throw error;
    throw new WindowsCursorLaunchError("unsupported");
  }
}

export function isOfficialWindowsCursorShim(shim: string, localAppData = process.env.LOCALAPPDATA, pathApi = path): boolean {
  return Boolean(localAppData && pathApi.isAbsolute(localAppData) &&
    pathApi.relative(pathApi.join(localAppData, "cursor-agent"), pathApi.dirname(shim)) === "" &&
    /^(?:agent|cursor-agent)\.cmd$/i.test(pathApi.basename(shim)));
}

async function readWindowsCursorPayload(shim: string, localAppData: string | undefined): Promise<string> {
  if (!localAppData || !path.isAbsolute(localAppData)) throw new Error("The official Cursor CLI installation directory could not be verified.");
  const root = path.join(localAppData, "cursor-agent");
  if (!isOfficialWindowsCursorShim(shim, localAppData)) {
    throw new Error("This Cursor command launcher is unsupported. Install the official Windows Cursor CLI.");
  }
  await regular(shim);
  const versions = path.join(root, "versions");
  if (path.relative(versions, await realpath(versions))) throw new Error("Cursor's installed Windows versions directory is redirected.");
  const entries = await readdir(versions, { withFileTypes: true });
  const pending = entries.find(entry => entry.name.toLowerCase() === "pending-launchers");
  if (entries.some(entry => /(?:\.new$|^\.promote-lock$)/i.test(entry.name)) ||
      (pending && (!pending.isDirectory() || (await readdir(path.join(versions, pending.name))).some(name => /\.pending$/i.test(name))))) {
    throw new WindowsCursorLaunchError("pending");
  }
  const releases = entries.flatMap(entry => {
    const date = versionName.exec(entry.name);
    return date ? [{ entry, date: Number(date[1]) * 10000 + Number(date[2]) * 100 + Number(date[3]) }] : [];
  }).sort((left, right) => right.date - left.date);
  const release = releases[0];
  if (!release?.entry.isDirectory() || releases[1]?.date === release.date) {
    throw new WindowsCursorLaunchError(releases[1]?.date === release?.date && release ? "ambiguous" : "unsupported");
  }
  const folder = path.join(versions, release.entry.name);
  const entrypoint = path.join(folder, "index.js");
  await regular(entrypoint);
  await regular(path.join(folder, "node.exe"));
  return entrypoint;
}

type CursorHost = { platform: NodeJS.Platform; localAppData: string | undefined };

function cursorHost(): CursorHost {
  return { platform: process.platform, localAppData: process.env.LOCALAPPDATA };
}

export function isWindowsCursorPayload(executable: string, host = cursorHost()): boolean {
  if (host.platform !== "win32" || !host.localAppData || !path.isAbsolute(host.localAppData)) return false;
  const version = path.dirname(executable);
  return path.relative(path.join(host.localAppData, "cursor-agent", "versions"), path.dirname(version)) === "" &&
    versionName.test(path.basename(version)) && path.basename(executable).toLowerCase() === "index.js";
}

export function cursorLaunchTarget(executable: string, args: readonly string[], environment?: NodeJS.ProcessEnv,
  host = cursorHost()) {
  if (!isWindowsCursorPayload(executable, host)) {
    return { executable, args: [...args], env: environment, bundled: false };
  }
  const node = path.join(path.dirname(executable), "node.exe");
  try {
    for (const candidate of [executable, node]) {
      if (!lstatSync(candidate).isFile() || path.relative(candidate, realpathSync(candidate)) !== "") {
        throw new WindowsCursorLaunchError("unsupported");
      }
    }
  } catch {
    throw new WindowsCursorLaunchError("unsupported");
  }
  const env = { ...(environment ?? process.env) };
  for (const key of Object.keys(env)) {
    if (/^(?:NODE_OPTIONS|NODE_PATH|CURSOR_INVOKED_AS)$/i.test(key)) delete env[key];
  }
  env.CURSOR_INVOKED_AS = "agent.cmd";
  if (environment === undefined && !Object.keys(env).some(key => /^NODE_COMPILE_CACHE$/i.test(key))) {
    env.NODE_COMPILE_CACHE = path.join(host.localAppData!, "cursor-compile-cache");
  }
  return { executable: node, args: [executable, ...args], env, bundled: true };
}
