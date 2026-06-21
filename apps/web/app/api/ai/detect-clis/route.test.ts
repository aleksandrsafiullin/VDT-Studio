import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const { detectAgents, detectAgent, isCodingAgentId } = vi.hoisted(() => ({
  detectAgents: vi.fn(),
  detectAgent: vi.fn(),
  isCodingAgentId: vi.fn((value: string) =>
    [
      "claude",
      "codex",
      "opencode",
      "hermes",
      "antigravity",
      "gemini",
      "grok-build",
      "kimi",
      "cursor-agent",
      "qwen",
      "qoder",
      "copilot",
      "pi",
      "kiro",
      "kilo",
      "vibe",
      "deepseek",
      "reasonix",
      "aider",
      "devin",
      "trae"
    ].includes(value)
  )
}));

vi.mock("@vdt-studio/cli", () => ({
  detectAgents,
  detectAgent,
  isCodingAgentId
}));

async function readJson(response: Response) {
  return (await response.json()) as {
    agents?: Array<{ id: string; installed: boolean; version: string | null }>;
    error?: string;
  };
}

describe("detect CLIs API route", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns all detected agents", async () => {
    detectAgents.mockResolvedValue([
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
    expect(detectAgents).toHaveBeenCalledOnce();
    expect(detectAgent).not.toHaveBeenCalled();
  });

  it("rescans a single agent when id is provided", async () => {
    detectAgent.mockResolvedValue({
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
    expect(detectAgent).toHaveBeenCalledWith("codex");
    expect(detectAgents).not.toHaveBeenCalled();
  });

  it("rejects unknown agent ids", async () => {
    const response = await GET(new Request("http://localhost:3000/api/ai/detect-clis?id=unknown-agent"));
    const body = await readJson(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe("Unknown CLI agent: unknown-agent");
    expect(detectAgent).not.toHaveBeenCalled();
  });

  it("returns a server error when detection throws", async () => {
    detectAgents.mockRejectedValue(new Error("PATH scan failed"));

    const response = await GET(new Request("http://localhost:3000/api/ai/detect-clis"));
    const body = await readJson(response);

    expect(response.status).toBe(500);
    expect(body.error).toBe("PATH scan failed");
  });
});
