import { describe, expect, it } from "vitest";
import { probeCursorAuth } from "./auth";
import type { ExecFileProbe } from "../types";

type ExecResult = { stdout: string; stderr: string };

function mockExec(responses: Record<string, ExecResult | Error>): ExecFileProbe {
  return async (executable, args) => {
    const key = `${executable} ${args.join(" ")}`;
    const response = responses[key];
    if (!response) throw Object.assign(new Error(`unexpected exec: ${key}`), { code: "ENOENT" });
    if (response instanceof Error) throw response;
    return response;
  };
}

describe("probeCursorAuth", () => {
  it("short-circuits when version evaluation is unsupported", async () => {
    const result = await probeCursorAuth("/usr/bin/agent", {
      versionStatus: {
        supported: false,
        status: "unsupported_version",
        diagnostics: ["too old"]
      }
    });
    expect(result).toMatchObject({
      backendId: "cursor_subscription",
      status: "unsupported_version",
      diagnostics: ["too old"]
    });
  });

  it("maps ready status from agent status json", async () => {
    const result = await probeCursorAuth("/usr/bin/agent", {
      execFileImpl: mockExec({
        "/usr/bin/agent status --format json": { stdout: '{"loggedIn":true,"status":"ready"}', stderr: "" }
      })
    });
    expect(result.status).toBe("ready");
    expect(result.authSummary).toMatch(/authenticated/i);
  });

  it("maps login required from status stderr patterns", async () => {
    const execFileImpl: ExecFileProbe = async () => {
      throw Object.assign(new Error("login required"), { stderr: "Please login to continue", code: 1 });
    };
    const result = await probeCursorAuth("/usr/bin/agent", { execFileImpl });
    expect(result.status).toBe("authentication_required");
    expect(result.authSummary).toMatch(/sign-in/i);
  });

  it("maps rate limiting from connection test stderr", async () => {
    const execFileImpl: ExecFileProbe = async (_executable, args) => {
      if (args[0] === "status") throw Object.assign(new Error("unknown command"), { code: "ENOENT" });
      throw Object.assign(new Error("rate limited"), { stderr: "Rate limit exceeded", code: 1 });
    };
    const withRateLimit = await probeCursorAuth("/usr/bin/agent", { execFileImpl });
    expect(withRateLimit.status).toBe("rate_limited");
    expect(withRateLimit.authSummary).toMatch(/rate limit/i);
  });

  it("uses connection-test stream-json when status command is unavailable", async () => {
    const stream = [
      '{"type":"system","subtype":"init","session_id":"s1"}',
      '{"type":"result","subtype":"success","is_error":false,"result":"{\\"ok\\":true}","session_id":"s1"}'
    ].join("\n");
    const calls: string[][] = [];
    const execFileImpl: ExecFileProbe = async (_executable, args) => {
      calls.push([...args]);
      if (args[0] === "status") throw Object.assign(new Error("invalid command"), { stderr: "invalid command status" });
      return { stdout: stream, stderr: "" };
    };
    const result = await probeCursorAuth("/usr/bin/agent", { execFileImpl });
    expect(result.status).toBe("ready");
    expect(calls[1]).toEqual(expect.arrayContaining(["--mode", "ask"]));
    expect(calls[1]).not.toContain("--force");
  });

  it("returns error for generic probe failures", async () => {
    const execFileImpl: ExecFileProbe = async (_executable, args) => {
      if (args[0] === "status") throw Object.assign(new Error("invalid command"), { stderr: "invalid command status" });
      throw Object.assign(new Error("boom"), { stderr: "unexpected backend failure", code: 2 });
    };
    const result = await probeCursorAuth("/usr/bin/agent", { execFileImpl });
    expect(result.status).toBe("error");
    expect(result.diagnostics[0]).toMatch(/unexpected backend failure|boom/);
  });
});
