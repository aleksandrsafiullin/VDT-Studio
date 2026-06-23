import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

async function readJson(response: Response) {
  return (await response.json()) as {
    appMode?: string;
    agents?: Array<{
      id: string;
      backendId: string;
      installed: boolean;
      executable: string | null;
      alias: string | null;
      version: string | null;
      status?: string;
      authSummary?: string;
      diagnostics?: string[];
    }>;
    modelsByAgent?: Record<string, string[]>;
    error?: string;
  };
}

describe("detect CLIs API route", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails closed for hosted web without scanning server PATH", async () => {
    const response = await GET(new Request("http://localhost:3000/api/ai/detect-clis"));
    const body = await readJson(response);

    expect(response.status).toBe(200);
    expect(body.appMode).toBe("hosted_web");
    expect(body.modelsByAgent).toEqual({});
    expect(body.agents).toHaveLength(5);
    expect(body.agents?.map((agent) => agent.id)).toEqual([
      "cursor-agent",
      "codex",
      "claude",
      "gemini",
      "copilot"
    ]);
    expect(body.agents?.every((agent) => agent.installed === false)).toBe(true);
    expect(body.agents?.every((agent) => agent.executable === null)).toBe(true);
    expect(body.agents?.[0]?.status).toBe("unavailable");
    expect(body.agents?.[0]?.authSummary).toContain("VDT Studio Desktop");
  });

  it("returns one hosted-web placeholder when id is provided", async () => {
    const response = await GET(new Request("http://localhost:3000/api/ai/detect-clis?id=codex"));
    const body = await readJson(response);

    expect(response.status).toBe(200);
    expect(body.agents).toEqual([
      expect.objectContaining({
        id: "codex",
        backendId: "codex_subscription",
        installed: false,
        executable: null,
        status: "unavailable"
      })
    ]);
  });

  it("rejects unknown agent ids", async () => {
    const response = await GET(new Request("http://localhost:3000/api/ai/detect-clis?id=unknown-agent"));
    const body = await readJson(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe("Unknown CLI agent: unknown-agent");
  });

  it("does not import node-backed model bridge detection from the hosted route", async () => {
    const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");

    expect(source).not.toContain("@vdt-studio/model-bridge/node");
    expect(source).not.toContain("node:child_process");
    expect(source).not.toContain("execFile");
  });

  it("keeps desktop mode delegated to the desktop bridge instead of scanning from Next.js", async () => {
    vi.stubEnv("VDT_APP_MODE", "desktop");

    const response = await GET(new Request("http://localhost:3000/api/ai/detect-clis?id=claude"));
    const body = await readJson(response);

    expect(response.status).toBe(200);
    expect(body.appMode).toBe("desktop");
    expect(body.agents).toEqual([
      expect.objectContaining({
        id: "claude",
        installed: false,
        executable: null,
        authSummary: "Desktop CLI detection must use the VDT Studio desktop bridge."
      })
    ]);
    expect(body.agents?.[0]?.diagnostics?.[0]).toContain("not allowed to scan PATH");
  });
});
