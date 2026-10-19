import { execFileSync } from "node:child_process";
import { basename } from "node:path";

// Re-enter the package manager through Node. Windows cannot exec a .cmd shim
// directly, and a shell would reinterpret paths and arguments containing spaces.
export function pnpmInvocation(args, { env = process.env, platform = process.platform, execPath = process.execPath } = {}) {
  const cli = env.npm_execpath;
  if (cli && /^pnpm\.(?:c?js)$/i.test(basename(cli.replaceAll("\\", "/")))) {
    return { command: execPath, args: [cli, ...args] };
  }
  if (platform === "win32") {
    throw new Error("Run this script through pnpm so its JavaScript entrypoint is available (for example: pnpm package:alpha).");
  }
  return { command: "corepack", args: ["pnpm", ...args] };
}

export function runPnpm(args, options = {}) {
  const invocation = pnpmInvocation(args, { env: options.env ?? process.env });
  return execFileSync(invocation.command, invocation.args, options);
}
