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
});
