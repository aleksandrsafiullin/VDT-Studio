import { describe, expect, it } from "vitest";
import { probeClaudeAuth } from "./auth";
import type { ExecFileProbe } from "../types";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type ExecResult = { stdout: string; stderr: string };

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const successJson = readFileSync(path.join(fixturesDir, "success.json"), "utf8");

function mockExec(responses: Record<string, ExecResult | Error>): ExecFileProbe {
  return async (executable, args) => {
    const key = `${executable} ${args.join(" ")}`;
    const response = responses[key];
    if (!response) throw Object.assign(new Error(`unexpected exec: ${key}`), { code: "ENOENT" });
    if (response instanceof Error) throw response;
    return response;
  };
}

describe("probeClaudeAuth", () => {
  it("short-circuits when version evaluation is unsupported", async () => {
    const result = await probeClaudeAuth("/usr/bin/claude", {
      versionStatus: {
        supported: false,
        status: "unsupported_version",
        diagnostics: ["too old"]
      }
    });
    expect(result).toMatchObject({
      backendId: "claude_subscription",
      status: "unsupported_version",
      diagnostics: ["too old"]
    });
  });

  it("maps ready status from auth status json", async () => {
    const result = await probeClaudeAuth("/usr/bin/claude", {
      execFileImpl: mockExec({
        "/usr/bin/claude auth status --json": { stdout: '{"loggedIn":true,"status":"ready"}', stderr: "" }
      })
    });
    expect(result.status).toBe("ready");
    expect(result.authSummary).toMatch(/authenticated/i);
  });

  it("maps Claude Pro sign-in required from status stderr patterns", async () => {
    const execFileImpl: ExecFileProbe = async () => {
      throw Object.assign(new Error("login required"), { stderr: "Please run claude login", code: 1 });
    };
    const result = await probeClaudeAuth("/usr/bin/claude", { execFileImpl });
    expect(result.status).toBe("authentication_required");
    expect(result.authSummary).toMatch(/sign-in|claude login/i);
  });

  it("uses -p connection test when status command is unavailable", async () => {
    const execFileImpl: ExecFileProbe = async (_executable, args) => {
      if (args[0] === "auth") throw Object.assign(new Error("invalid command"), { stderr: "invalid command auth" });
      return { stdout: successJson, stderr: "" };
    };
    const result = await probeClaudeAuth("/usr/bin/claude", { execFileImpl });
    expect(result.status).toBe("ready");
  });
});
