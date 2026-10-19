import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../runs/runtime", async () => {
  const { AgentExecutionBindingRegistry } = await import("../../runs/execution-bindings");
  return { agentExecutionBindingRegistry: new AgentExecutionBindingRegistry(), agentRuntime: { tools: {} } };
});
vi.mock("../../runs/model-agent-tool-catalog", () => ({ modelAgentToolCatalogHash: () => `sha256:${"a".repeat(64)}` }));
vi.mock("../../runs/session-research", () => ({ admitSessionWebResearch: vi.fn() }));
import { POST } from "./route";
import { admitSessionWebResearch } from "../../runs/session-research";

function request(body: unknown = { apiKey: "test-secret", model: "gpt-6-luna" }, headers: Record<string,string> = {}) {
  return new Request("http://localhost:3000/api/agent/bindings/openai", { method: "POST", headers: {
    origin: "http://localhost:3000", "content-type": "application/json", ...headers
  }, body: typeof body === "string" ? body : JSON.stringify(body) });
}
describe("OpenAI binding admission HTTP boundary", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.stubEnv("VDT_APP_MODE", "development_web"); });
  afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); });
  it("returns a model-pinned summary without credentials", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    const text = await response.text(); expect(text).not.toContain("test-secret"); expect(text).not.toContain("apiKey");
    expect(JSON.parse(text)).toMatchObject({ ok: true, binding: { backendId: "openai_compatible", modelId: "gpt-6-luna" } });
    expect(admitSessionWebResearch).not.toHaveBeenCalled();
  });
  it("enables shared research only on explicit admission and never returns its credential", async () => {
    const response = await POST(request({ apiKey: "test-research-secret", model: "gpt-6-luna", enableResearch: true }));
    expect(response.status).toBe(200);
    expect(admitSessionWebResearch).toHaveBeenCalledWith("test-research-secret", "gpt-6-luna");
    expect(await response.text()).not.toContain("test-research-secret");
  });
  it("rejects hosted use and foreign or missing origins", async () => {
    vi.stubEnv("VDT_APP_MODE", "hosted_web"); expect((await POST(request())).status).toBe(403);
    vi.stubEnv("VDT_APP_MODE", "development_web"); expect((await POST(request(undefined, { origin: "https://foreign.example" }))).status).toBe(403);
    expect((await POST(request(undefined, { origin: "" }))).status).toBe(403);
  });
  it.each(["localhost:3000", "127.0.0.1:3000", "[::1]:3000"])("admits the browser's direct local Host %s when Next reconstructs localhost", async (host) => {
    expect((await POST(request(undefined, { host, origin: `http://${host}` }))).status).toBe(200);
  });
  it.each([
    { host: "127.0.0.1:3000", origin: "http://localhost:3000" },
    { host: "127.0.0.1:4000", origin: "http://127.0.0.1:4000" },
    { host: "foreign.example:3000", origin: "http://foreign.example:3000" },
    { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", "sec-fetch-site": "cross-site" },
    { host: "localhost:3000", origin: "http://127.0.0.1:3000", "x-forwarded-host": "127.0.0.1:3000" }
  ])("rejects mismatched or forwarded authorities %j", async (headers) => {
    expect((await POST(request(undefined, headers))).status).toBe(403);
  });
  it("requires explicit Model Agent opt-in in production and never admits during builds", async () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("VDT_MODEL_AGENT_ENABLED", "false");
    expect((await POST(request())).status).toBe(403);
    vi.stubEnv("VDT_MODEL_AGENT_ENABLED", "true"); expect((await POST(request())).status).toBe(200);
    vi.stubEnv("NEXT_PHASE", "phase-production-build"); expect((await POST(request())).status).toBe(403);
  });
  it("rejects non-JSON, invalid JSON and endpoint overrides without echoing inputs", async () => {
    expect((await POST(request(undefined, { "content-type": "text/plain" }))).status).toBe(415);
    expect((await POST(request("invalid test-secret"))).status).toBe(400);
    const response = await POST(request({ apiKey: "test-secret", model: "gpt-6-luna", baseUrl: "http://127.0.0.1" }));
    expect(response.status).toBe(400); expect(await response.text()).not.toContain("test-secret");
  });
  it("bounds declared and streamed payload bytes", async () => {
    expect((await POST(request(undefined, { "content-length": "8193" }))).status).toBe(413);
    expect((await POST(request(" ".repeat(8193)))).status).toBe(413);
  });
});
