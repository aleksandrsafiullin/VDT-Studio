import os from "node:os";
import path from "node:path";

function safePathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, "_").slice(-80) || "workspace";
}

export function defaultAgentRunDataDir(projectRoot: string): string {
  if (process.env.NODE_ENV === "test") {
    return path.join(os.tmpdir(), "vdt-studio-agent-runs-test", safePathSegment(projectRoot), String(process.pid));
  }
  return path.join(projectRoot, ".vdt");
}

/** Same directory as `app.sqlite`: `VDT_DATA_DIR` or `<projectRoot>/.vdt`. */
export function resolveConfiguredDataDir(projectRoot: string = process.cwd()): string {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const configuredDataDir = process.env.VDT_DATA_DIR;
  if (!configuredDataDir) return defaultAgentRunDataDir(resolvedProjectRoot);
  return path.isAbsolute(configuredDataDir)
    ? path.resolve(configuredDataDir)
    : path.resolve(resolvedProjectRoot, configuredDataDir);
}
