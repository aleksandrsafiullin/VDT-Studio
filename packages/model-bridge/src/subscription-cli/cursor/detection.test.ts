import { describe, expect, it } from "vitest";
import { detectCursorBackend } from "./detection";

describe("detectCursorBackend", () => {
  it("maps supported versions to installed status", async () => {
    const result = await detectCursorBackend({
      path: "/tools",
      platform: "linux",
      executableCheck: async () => true,
      versionProbe: async () => ({ stdout: "0.48.0\n", stderr: "" })
    });
    expect(result).toMatchObject({
      backendId: "cursor_subscription",
      status: "installed",
      version: "0.48.0",
      diagnostics: []
    });
  });

  it("maps unsupported versions", async () => {
    const result = await detectCursorBackend({
      path: "/tools",
      platform: "linux",
      executableCheck: async () => true,
      versionProbe: async () => ({ stdout: "0.40.0\n", stderr: "" })
    });
    expect(result.status).toBe("unsupported_version");
  });

  it("reports not installed when binary is missing", async () => {
    const result = await detectCursorBackend({
      path: "/empty",
      platform: "linux",
      executableCheck: async () => false
    });
    expect(result.status).toBe("not_installed");
  });

  it("includes probe failure diagnostics while keeping installed status", async () => {
    const result = await detectCursorBackend({
      path: "/tools",
      platform: "linux",
      executableCheck: async () => true,
      versionProbe: async () => {
        throw new Error("timeout");
      }
    });
    expect(result.status).toBe("installed");
    expect(result.version).toBeUndefined();
    expect(result.diagnostics.join(" ")).toMatch(/timeout/);
  });
});
