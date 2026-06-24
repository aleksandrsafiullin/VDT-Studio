import { describe, expect, it } from "vitest";
import { probeCodexAuth } from "./auth";
import type { ExecFileProbe } from "../types";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type ExecResult = { stdout: string; stderr: string };

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const successJsonl = readFileSync(path.join(fixturesDir, "success-jsonl.jsonl"), "utf8");

function mockExec(responses: Record<string, ExecResult | Error>): ExecFileProbe {
  return async (executable, args) => {
    const key = `${executable} ${args.join(" ")}`;
    const response = responses[key];
    if (!response) throw Object.assign(new Error(`unexpected exec: ${key}`), { code: "ENOENT" });
    if (response instanceof Error) throw response;
    return response;
  };
}

describe("probeCodexAuth", () => {
  it("short-circuits when version evaluation is unsupported", async () => {
    const result = await probeCodexAuth("/usr/bin/codex", {
      versionStatus: {
        supported: false,
        status: "unsupported_version",
        diagnostics: ["too old"]
      }
    });
    expect(result).toMatchObject({
      backendId: "codex_subscription",
      status: "unsupported_version",
      diagnostics: ["too old"]
    });
  });

  it("maps ready status from login status json", async () => {
    const result = await probeCodexAuth("/usr/bin/codex", {
      execFileImpl: mockExec({
        "/usr/bin/codex login status --json": { stdout: '{"loggedIn":true,"status":"ready"}', stderr: "" }
      })
    });
    expect(result.status).toBe("ready");
    expect(result.authSummary).toMatch(/authenticated/i);
  });

  it("falls back to text login status when --json is unsupported", async () => {
    const result = await probeCodexAuth("/usr/bin/codex", {
      execFileImpl: mockExec({
        "/usr/bin/codex login status --json": Object.assign(new Error("unexpected argument '--json' found"), {
          stderr: "error: unexpected argument '--json' found\nUsage: codex login status [OPTIONS]",
          code: 2
        }),
        "/usr/bin/codex login status": { stdout: "Logged in using ChatGPT\n", stderr: "" }
      })
    });
    expect(result.status).toBe("ready");
  });

  it("retries status with fast service tier for legacy default config files", async () => {
    const result = await probeCodexAuth("/usr/bin/codex", {
      execFileImpl: mockExec({
        "/usr/bin/codex login status --json": Object.assign(new Error("unknown variant `default`"), {
          stderr: "Error loading configuration: unknown variant `default`, expected `fast` or `flex`",
          code: 1
        }),
        '/usr/bin/codex login status --json -c service_tier="fast"': { stdout: '{"loggedIn":true}', stderr: "" }
      })
    });
    expect(result.status).toBe("ready");
  });

  it("maps ChatGPT sign-in required from status stderr patterns", async () => {
    const execFileImpl: ExecFileProbe = async () => {
      throw Object.assign(new Error("login required"), { stderr: "Please sign in to ChatGPT", code: 1 });
    };
    const result = await probeCodexAuth("/usr/bin/codex", { execFileImpl });
    expect(result.status).toBe("authentication_required");
    expect(result.authSummary).toMatch(/sign-in|codex login/i);
  });

  it("uses exec connection test when status command is unavailable", async () => {
    const execCalls: string[][] = [];
    const execFileImpl: ExecFileProbe = async (_executable, args) => {
      execCalls.push([...args]);
      if (args[0] === "login") throw Object.assign(new Error("invalid command"), { stderr: "invalid command login" });
      return { stdout: successJsonl, stderr: "" };
    };
    const result = await probeCodexAuth("/usr/bin/codex", { execFileImpl });
    expect(result.status).toBe("ready");
    expect(execCalls.some((args) => args[0] === "exec" && args.includes("--ephemeral"))).toBe(true);
    expect(execCalls.some((args) => args[0] === "exec" && args.includes("--ignore-rules"))).toBe(true);
    expect(execCalls.some((args) => args[0] === "exec" && args.includes("--model") && args.includes("gpt-5.5"))).toBe(true);
  });
});
