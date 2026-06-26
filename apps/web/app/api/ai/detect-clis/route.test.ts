import { readFile } from "node:fs/promises";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const fakeCodex = fileURLToPath(new URL("../../../../../../packages/local-runner/src/server/fixtures/fake-codex.cjs", import.meta.url));
const fakeCursor = fileURLToPath(new URL("../../../../../../packages/local-runner/src/server/fixtures/fake-cursor.cjs", import.meta.url));

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

  it("scans local CLIs in development web mode", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "vdt-web-detect-clis-"));
    try {
      await symlink(fakeCodex, path.join(tempDir, "codex"));
      await symlink(fakeCursor, path.join(tempDir, "agent"));
      vi.stubEnv("VDT_APP_MODE", "development_web");
      vi.stubEnv("PATH", `${tempDir}${path.delimiter}${process.env.PATH ?? ""}`);

      const response = await GET(new Request("http://localhost:3000/api/ai/detect-clis"));
      const body = await readJson(response);

      expect(response.status).toBe(200);
      expect(body.appMode).toBe("development_web");
      expect(body.agents).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: "codex",
          installed: true,
          alias: "codex",
          status: "ready",
          authSummary: "ChatGPT subscription is authenticated and ready."
        }),
        expect.objectContaining({
          id: "cursor-agent",
          installed: true,
          alias: "agent",
          status: "ready",
          authSummary: "Cursor account is authenticated and ready."
        })
      ]));
      expect(body.modelsByAgent).toMatchObject({
        codex: ["gpt-5.5", "gpt-5.2"],
        "cursor-agent": ["auto", "gpt-5.5-high"]
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects unknown agent ids", async () => {
    const response = await GET(new Request("http://localhost:3000/api/ai/detect-clis?id=unknown-agent"));
    const body = await readJson(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe("Unknown CLI agent: unknown-agent");
  });

  it("does not statically import node-backed detection in the hosted route", async () => {
    const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");

    expect(source).not.toMatch(/^import .*@vdt-studio\/local-runner/m);
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
