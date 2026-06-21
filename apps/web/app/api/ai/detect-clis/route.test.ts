import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const { detectSubscriptionClis, detectSubscriptionCli, discoverSubscriptionCliModels, isSubscriptionCliId } = vi.hoisted(() => ({
  detectSubscriptionClis: vi.fn(),
  detectSubscriptionCli: vi.fn(),
  discoverSubscriptionCliModels: vi.fn().mockResolvedValue([]),
  isSubscriptionCliId: vi.fn((value: string) =>
    ["cursor-agent", "codex", "claude", "gemini", "copilot"].includes(value)
  )
}));

vi.mock("@vdt-studio/model-bridge/node", () => ({
  detectSubscriptionClis,
  detectSubscriptionCli,
  discoverSubscriptionCliModels,
  isSubscriptionCliId
}));

async function readJson(response: Response) {
  return (await response.json()) as {
    agents?: Array<{ id: string; installed: boolean; version: string | null }>;
    modelsByAgent?: Record<string, string[]>;
    error?: string;
  };
}

describe("detect CLIs API route", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns all detected agents", async () => {
    detectSubscriptionClis.mockResolvedValue([
      {
        id: "claude",
        installed: true,
        executable: "/usr/local/bin/claude",
        alias: "claude",
        version: "1.0.0"
      },
      {
        id: "codex",
        installed: false,
        executable: null,
        alias: null,
        version: null
      }
    ]);

    const response = await GET(new Request("http://localhost:3000/api/ai/detect-clis"));
    const body = await readJson(response);

    expect(response.status).toBe(200);
    expect(body.agents).toHaveLength(2);
    expect(body.agents?.[0]?.installed).toBe(true);
    expect(detectSubscriptionClis).toHaveBeenCalledOnce();
    expect(detectSubscriptionCli).not.toHaveBeenCalled();
  });

  it("returns live models exposed by an installed CLI", async () => {
    detectSubscriptionClis.mockResolvedValue([
      {
        id: "cursor-agent",
        installed: true,
        executable: "/usr/local/bin/cursor-agent",
        alias: "cursor-agent",
        version: "1.0.0"
      }
    ]);
    discoverSubscriptionCliModels.mockResolvedValue(["auto", "gpt-5.5-high"]);

    const response = await GET(new Request("http://localhost:3000/api/ai/detect-clis"));
    const body = await readJson(response);

    expect(body.modelsByAgent).toEqual({ "cursor-agent": ["auto", "gpt-5.5-high"] });
    expect(discoverSubscriptionCliModels).toHaveBeenCalledWith("cursor-agent", "/usr/local/bin/cursor-agent");
  });

  it("rescans a single agent when id is provided", async () => {
    detectSubscriptionCli.mockResolvedValue({
      id: "codex",
      installed: true,
      executable: "/usr/local/bin/codex",
      alias: "codex",
      version: "0.9.0"
    });

    const response = await GET(new Request("http://localhost:3000/api/ai/detect-clis?id=codex"));
    const body = await readJson(response);

    expect(response.status).toBe(200);
    expect(body.agents).toEqual([
      {
        id: "codex",
        installed: true,
        executable: "/usr/local/bin/codex",
        alias: "codex",
        version: "0.9.0"
      }
    ]);
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
