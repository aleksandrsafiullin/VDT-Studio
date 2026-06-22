import { describe, expect, it } from "vitest";
import type { ExecFileProbe } from "../types";
import { probeGeminiAuth } from "./auth";

describe("probeGeminiAuth", () => {
  it("uses a deny-all admin policy for the connection probe", async () => {
    const execFileImpl: ExecFileProbe = async (_executable, args) => {
      expect(args).toContain("--admin-policy");
      expect(args).not.toContain("--yolo");
      return { stdout: JSON.stringify({ response: '{"ok":true}' }), stderr: "" };
    };
    await expect(probeGeminiAuth("/usr/bin/gemini", { execFileImpl })).resolves.toMatchObject({ status: "ready" });
  });
  it("classifies account limits", async () => {
    const execFileImpl: ExecFileProbe = async () => { throw Object.assign(new Error("quota"), { stderr: "RESOURCE_EXHAUSTED daily limit" }); };
    await expect(probeGeminiAuth("/usr/bin/gemini", { execFileImpl })).resolves.toMatchObject({ status: "rate_limited" });
  });
});
