import { describe, expect, it } from "vitest";
import { pnpmInvocation } from "./package-manager.mjs";

describe("portable package manager invocation", () => {
  it("keeps Windows paths and metacharacters as separate Node arguments", () => {
    const cli = "C:\\Program Files\\pnpm\\pnpm.cjs";
    const args = ["pack", "--pack-destination", "C:\\Builds\\candidate & review"];
    expect(pnpmInvocation(args, { platform: "win32", execPath: "C:\\Program Files\\nodejs\\node.exe", env: { npm_execpath: cli } }))
      .toEqual({ command: "C:\\Program Files\\nodejs\\node.exe", args: [cli, ...args] });
  });

  it("refuses a Windows shell-shim fallback when no pnpm entrypoint is available", () => {
    expect(() => pnpmInvocation(["pack"], { platform: "win32", env: {} })).toThrow(/through pnpm/);
    expect(() => pnpmInvocation(["pack"], { platform: "win32", env: { npm_execpath: "C:\\npm-cli.js" } })).toThrow(/through pnpm/);
  });
});
