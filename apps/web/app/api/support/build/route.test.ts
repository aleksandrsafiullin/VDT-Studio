import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

afterEach(() => vi.unstubAllEnvs());

describe("local build diagnostics", () => {
  it("returns only immutable build identity and platform metadata, with no cache", async () => {
    vi.stubEnv("VDT_APP_MODE", "desktop");
    vi.stubEnv("NEXT_PUBLIC_VDT_BUILD_VERSION", "0.1.0-alpha.2");
    vi.stubEnv("NEXT_PUBLIC_VDT_BUILD_COMMIT", "a".repeat(40));
    vi.stubEnv("SECRET_TEST_VALUE", "never-export-this");
    const response = await GET(new Request("http://127.0.0.1:37541/api/support/build"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(Object.keys(body).sort()).toEqual(["architecture", "builtAt", "commit", "dirty", "nodeVersion", "osRelease", "platform", "version"]);
    expect(body).toMatchObject({ version: "0.1.0-alpha.2", commit: "a".repeat(40), platform: process.platform, architecture: process.arch });
    expect(JSON.stringify(body)).not.toContain("never-export-this");
    expect(JSON.stringify(body)).not.toContain(process.cwd());
  });

  it("denies hosted and cross-origin requests", async () => {
    vi.stubEnv("VDT_APP_MODE", "hosted_web");
    expect((await GET(new Request("http://localhost:3000/api/support/build"))).status).toBe(403);
    vi.stubEnv("VDT_APP_MODE", "desktop");
    expect((await GET(new Request("https://example.org/api/support/build"))).status).toBe(403);
    expect((await GET(new Request("http://localhost:3000/api/support/build", { headers: { origin: "https://example.org" } }))).status).toBe(403);
    expect((await GET(new Request("http://localhost:3000/api/support/build", { headers: { "sec-fetch-site": "cross-site" } }))).status).toBe(403);
  });
});
