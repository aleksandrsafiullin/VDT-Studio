import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const {
  detectSubscriptionClis,
  detectSubscriptionCli,
  discoverSubscriptionCliModels,
  enrichSubscriptionCliDetections,
  isSubscriptionCliId
} = vi.hoisted(() => ({
  detectSubscriptionClis: vi.fn(),
  detectSubscriptionCli: vi.fn(),
  discoverSubscriptionCliModels: vi.fn().mockResolvedValue([]),
  enrichSubscriptionCliDetections: vi.fn(async (agents: unknown[]) => agents),
  isSubscriptionCliId: vi.fn((value: string) =>
    ["cursor-agent", "codex", "claude", "gemini", "copilot"].includes(value)
  )
}));

vi.mock("@vdt-studio/model-bridge/node", () => ({
  detectSubscriptionClis,
  detectSubscriptionCli,
  discoverSubscriptionCliModels,
  enrichSubscriptionCliDetections,
  isSubscriptionCliId
}));

async function readJson(response: Response) {
  return (await response.json()) as {
    agents?: Array<{
      id: string;
      installed: boolean;
      version: string | null;
      status?: string;
      authSummary?: string;
    }>;
    modelsByAgent?: Record<string, string[]>;
    error?: string;
  };
}

describe("detect CLIs API route", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns all detected agents enriched with probe metadata", async () => {
    detectSubscriptionClis.mockResolvedValue([
      {
        id: "claude",
        backendId: "claude_subscription",
        installed: true,
        executable: "/usr/local/bin/claude",
        alias: "claude",
        version: "1.0.0"
      },
      {
        id: "codex",
        backendId: "codex_subscription",
        installed: false,
        executable: null,
        alias: null,
        version: null
      }
    ]);
    enrichSubscriptionCliDetections.mockResolvedValue([
      {
        id: "claude",
        backendId: "claude_subscription",
        installed: true,
        executable: "/usr/local/bin/claude",
        alias: "claude",
        version: "1.0.0",
        status: "installed"
      },
      {
        id: "codex",
        backendId: "codex_subscription",
        installed: false,
        executable: null,
        alias: null,
        version: null,
        status: "not_installed"
      }
    ]);

    const response = await GET(new Request("http://localhost:3000/api/ai/detect-clis"));
    const body = await readJson(response);

    expect(response.status).toBe(200);
    expect(body.agents).toHaveLength(2);
    expect(body.agents?.[0]?.status).toBe("installed");
    expect(detectSubscriptionClis).toHaveBeenCalledOnce();
    expect(enrichSubscriptionCliDetections).toHaveBeenCalledWith(expect.any(Array), { probeTimeoutMs: 5_000 });
    expect(detectSubscriptionCli).not.toHaveBeenCalled();
  });

  it("returns live models exposed by an installed CLI", async () => {
    const baseAgent = {
      id: "cursor-agent",
      backendId: "cursor_subscription",
      installed: true,
      executable: "/usr/local/bin/cursor-agent",
      alias: "cursor-agent",
      version: "1.0.0"
    };
    detectSubscriptionClis.mockResolvedValue([baseAgent]);
    enrichSubscriptionCliDetections.mockResolvedValue([
      {
        ...baseAgent,
        status: "ready",
        authSummary: "Cursor account is authenticated and ready."
      }
    ]);
    discoverSubscriptionCliModels.mockResolvedValue(["auto", "gpt-5.5-high"]);

    const response = await GET(new Request("http://localhost:3000/api/ai/detect-clis"));
    const body = await readJson(response);

    expect(body.modelsByAgent).toEqual({ "cursor-agent": ["auto", "gpt-5.5-high"] });
    expect(body.agents?.[0]?.authSummary).toMatch(/authenticated/i);
    expect(discoverSubscriptionCliModels).toHaveBeenCalledWith("cursor-agent", "/usr/local/bin/cursor-agent");
  });

  it("rescans a single agent when id is provided", async () => {
    const baseAgent = {
      id: "codex",
      backendId: "codex_subscription",
      installed: true,
      executable: "/usr/local/bin/codex",
      alias: "codex",
      version: "0.9.0"
    };
    detectSubscriptionCli.mockResolvedValue(baseAgent);
    enrichSubscriptionCliDetections.mockResolvedValue([{ ...baseAgent, status: "installed" }]);

    const response = await GET(new Request("http://localhost:3000/api/ai/detect-clis?id=codex"));
    const body = await readJson(response);

    expect(response.status).toBe(200);
    expect(body.agents).toEqual([{ ...baseAgent, status: "installed" }]);
    expect(detectSubscriptionCli).toHaveBeenCalledWith("codex");
    expect(detectSubscriptionClis).not.toHaveBeenCalled();
  });

  it("rejects unknown agent ids", async () => {
    const response = await GET(new Request("http://localhost:3000/api/ai/detect-clis?id=unknown-agent"));
    const body = await readJson(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe("Unknown CLI agent: unknown-agent");
    expect(detectSubscriptionCli).not.toHaveBeenCalled();
  });

  it("returns a server error when detection throws", async () => {
    detectSubscriptionClis.mockRejectedValue(new Error("PATH scan failed"));

    const response = await GET(new Request("http://localhost:3000/api/ai/detect-clis"));
    const body = await readJson(response);

    expect(response.status).toBe(500);
    expect(body.error).toBe("PATH scan failed");
  });
});
