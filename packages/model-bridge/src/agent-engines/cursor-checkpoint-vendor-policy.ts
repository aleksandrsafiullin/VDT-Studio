import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

export type CursorCheckpointVendorSandboxMode = "enabled" | "disabled";

export function cursorCheckpointPolicyJson(mode: CursorCheckpointVendorSandboxMode): string {
  return JSON.stringify({
    version: 1,
    editor: { vimMode: false },
    approvalMode: "allowlist",
    permissions: { allow: [], deny: ["Shell(*)", "Read(**)", "Read(/**)", "Write(**)", "Write(/**)", "Mcp(*:*)", "WebFetch(*)"] },
    sandbox: { mode, readBoundary: "workspace" }
  });
}

function vendorConfigHash(bytes: string | Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function cursorCheckpointVendorPolicyHash(mode: CursorCheckpointVendorSandboxMode): string {
  return vendorConfigHash(cursorCheckpointPolicyJson(mode));
}

function boundary(message: string): Error {
  return Object.assign(new Error(message), { code: "SECURITY_BOUNDARY_BREACH" });
}

/** Rechecks private policy bytes immediately before the native runner starts Cursor. */
export async function assertCursorCheckpointVendorConfig(
  request: { readonly environment: Readonly<Record<string, string>> },
  expectedHash: string
): Promise<void> {
  const state = request.environment.HOME;
  const configDir = request.environment.CURSOR_CONFIG_DIR;
  if (!state || !configDir || !path.isAbsolute(configDir) || configDir !== path.join(state, "cursor-config")
    || await realpath(configDir).catch(() => undefined) !== configDir) {
    throw boundary("Cursor vendor config escaped the qualified private state.");
  }
  const filename = path.join(configDir, "cli-config.json");
  const metadata = await lstat(filename).catch(() => undefined);
  const bytes = metadata?.isFile() && metadata.size <= 4_096
    ? await readFile(filename).catch(() => undefined)
    : undefined;
  if (!bytes || vendorConfigHash(bytes) !== expectedHash) {
    throw boundary("Cursor vendor config does not match the qualified policy.");
  }
}
