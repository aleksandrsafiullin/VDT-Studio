import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

function request(body: unknown, origin = "http://localhost:3000", url = "http://localhost:3000/api/speech") {
  return new Request(url, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) });
}

afterEach(() => vi.unstubAllEnvs());
describe("local voice API", () => {
  it("rejects hosted mode and non-local hosts even with a local-mode flag", async () => {
    vi.stubEnv("VDT_APP_MODE", "hosted_web");
    expect((await POST(request({ operation: "status" }))).status).toBe(403);
    vi.stubEnv("VDT_APP_MODE", "development_web");
    expect((await POST(request({ operation: "status" }, "https://example.com", "https://example.com/api/speech"))).status).toBe(403);
  });
  it("rejects cross-origin installation before any download can start", async () => {
    vi.stubEnv("VDT_APP_MODE", "development_web");
    expect((await POST(request({ operation: "install", modelId: "base", confirmed: true }, "https://attacker.test"))).status).toBe(403);
  });
  it("rejects an unconfirmed download and arbitrary executable fields", async () => {
    vi.stubEnv("VDT_APP_MODE", "development_web");
    expect((await POST(request({ operation: "install", modelId: "base", confirmed: false }))).status).toBe(400);
    expect((await POST(request({ operation: "status", executable: "sh" }))).status).toBe(400);
  });
  it("applies ingress size limits without materializing an oversized audio body", async () => {
    vi.stubEnv("VDT_APP_MODE", "development_web");
    const value = request({ operation: "status" });
    value.headers.set("content-length", "9999999");
    expect((await POST(value)).status).toBe(413);
  });
});
