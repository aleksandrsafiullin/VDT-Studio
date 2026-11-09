import { describe, expect, it, vi } from "vitest";
import { enrichSubscriptionCliDetection } from "./enrich-detection";

vi.mock("./subscription-cli/registry", () => ({
  getSubscriptionCliAdapter: vi.fn()
}));

const { getSubscriptionCliAdapter } = await import("./subscription-cli/registry");

describe("enrichSubscriptionCliDetection", () => {
  it("marks missing installs as not_installed", async () => {
    const result = await enrichSubscriptionCliDetection({
      id: "cursor-agent",
      backendId: "cursor_subscription",
      installed: false,
      executable: null,
      alias: null,
      version: null
    });

    expect(result.status).toBe("not_installed");
    expect(result.diagnostics).toEqual([]);
  });

  it("delegates to adapter probeAuth when available", async () => {
    vi.mocked(getSubscriptionCliAdapter).mockReturnValue({
      id: "cursor-agent",
      backendId: "cursor_subscription",
      buildArgs: () => [],
      parseOutput: () => ({}),
      probeAuth: vi.fn().mockResolvedValue({
        backendId: "cursor_subscription",
        status: "ready",
        authSummary: "Cursor account is authenticated and ready.",
        diagnostics: []
      })
    });

    const result = await enrichSubscriptionCliDetection({
      id: "cursor-agent",
      backendId: "cursor_subscription",
      installed: true,
      executable: "/usr/bin/agent",
      alias: "agent",
      version: "0.46.0"
    });

    expect(result.status).toBe("ready");
    expect(result.authSummary).toMatch(/authenticated/i);
  });

  it("falls back to installed when adapter has no probeAuth", async () => {
    vi.mocked(getSubscriptionCliAdapter).mockReturnValue({
      id: "codex",
      backendId: "codex_subscription",
      buildArgs: () => [],
      parseOutput: () => ({})
    });

    const result = await enrichSubscriptionCliDetection({
      id: "codex",
      backendId: "codex_subscription",
      installed: true,
      executable: "/usr/bin/codex",
      alias: "codex",
      version: "0.9.0"
    });

    expect(result.status).toBe("installed");
  });

  it("does not expose subprocess commands, credentials or environment guidance", async () => {
    const probeAuth = vi.fn().mockResolvedValue({
      backendId: "cursor_subscription",
      status: "authentication_required",
      authSummary: "Cursor sign-in required. Sign in with the Cursor CLI.",
      diagnostics: ["Command failed: agent --prompt private-prompt\nSet CURSOR_API_KEY=private-token"]
    });
    vi.mocked(getSubscriptionCliAdapter).mockReturnValue({
      id: "cursor-agent",
      backendId: "cursor_subscription",
      buildArgs: () => [],
      parseOutput: () => ({}),
      probeAuth
    });

    const result = await enrichSubscriptionCliDetection({
      id: "cursor-agent",
      backendId: "cursor_subscription",
      installed: true,
      executable: "/usr/bin/agent",
      alias: "agent",
      version: null,
      error: "Command failed with PRIVATE_SECRET=private-token"
    });

    expect(probeAuth).toHaveBeenCalledOnce();
    expect(result.status).toBe("authentication_required");
    expect(result.diagnostics).toEqual([expect.stringContaining("Complete provider sign-in")]);
    expect(JSON.stringify(result)).not.toMatch(/private-token|private-prompt|PRIVATE_SECRET|CURSOR_API_KEY/);
  });

  it("sanitizes thrown authentication probe failures", async () => {
    vi.mocked(getSubscriptionCliAdapter).mockReturnValue({
      id: "cursor-agent",
      backendId: "cursor_subscription",
      buildArgs: () => [],
      parseOutput: () => ({}),
      probeAuth: vi.fn().mockRejectedValue(new Error("Command failed with private-credential"))
    });

    const result = await enrichSubscriptionCliDetection({
      id: "cursor-agent", backendId: "cursor_subscription", installed: true,
      executable: "/usr/bin/agent", alias: "agent", version: null
    });
    expect(result.status).toBe("error");
    expect(JSON.stringify(result)).not.toContain("private-credential");
  });
});
