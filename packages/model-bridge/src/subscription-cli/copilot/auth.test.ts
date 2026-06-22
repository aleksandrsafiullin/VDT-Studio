import { describe, expect, it } from "vitest";
import type { ExecFileProbe } from "../types";
import { probeCopilotAuth } from "./auth";

describe("probeCopilotAuth", () => {
  it("removes all tools and project instructions", async () => {
    const execFileImpl: ExecFileProbe = async (_executable, args) => {
      expect(args).toContain("--available-tools=");
      expect(args).toContain("--disable-builtin-mcps");
      expect(args).toContain("--no-custom-instructions");
      expect(args).not.toContain("--allow-all-tools");
      return { stdout: JSON.stringify({ type: "assistant.message", data: { content: '{"ok":true}' } }), stderr: "" };
    };
    await expect(probeCopilotAuth("/usr/bin/copilot", { execFileImpl })).resolves.toMatchObject({ status: "ready" });
  });
  it("classifies organization policy failures", async () => {
    const execFileImpl: ExecFileProbe = async () => { throw Object.assign(new Error("disabled"), { stderr: "Copilot CLI disabled by organization policy" }); };
    await expect(probeCopilotAuth("/usr/bin/copilot", { execFileImpl })).resolves.toMatchObject({ status: "unavailable" });
  });
});
