import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../runs/runtime", async () => {
  const { AgentExecutionBindingRegistry } = await import("../../runs/execution-bindings");
  return { agentExecutionBindingRegistry: new AgentExecutionBindingRegistry(), agentRuntime: { tools: { definitions: () => [] } } };
});
vi.mock("../../runs/model-agent-tool-catalog", () => ({ modelAgentToolCatalogHash: () => `sha256:${"a".repeat(64)}` }));
vi.mock("@vdt-studio/local-runner/server-runtime", async (original) => ({
  ...await original<typeof import("@vdt-studio/local-runner/server-runtime")>(),
  listRuntimeModels: async () => ({ statusCode: 200, payload: { models: ["installed-local"] } })
}));
import { POST } from "./route";
import { agentExecutionBindingRegistry } from "../../runs/runtime";
const request = (body: unknown, headers: Record<string, string> = {}) => new Request("http://localhost:3000/api/agent/bindings/provider", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000", host: "localhost:3000", ...headers }, body: JSON.stringify(body) });
const api = { providerId: "openai_compatible", providerConfig: { model: "api-model", apiKey: "private-test", modelReasoning: "high" } };
beforeEach(() => vi.stubEnv("VDT_APP_MODE", "development_web"));
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("provider model admission boundary", () => {
  it("admits the exact API model/effort and never returns its credentials", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ id: "api-model", supported_reasoning_efforts: ["low", "high"] })));
    const response = await POST(request({ operation: "admit", ...api }));
    expect(response.status).toBe(200);
    const text = await response.text(); expect(text).not.toContain("private-test");
    const { binding } = JSON.parse(text);
    expect(binding).toMatchObject({ backendId: "openai_compatible", modelId: "api-model", modelReasoning: "high" });
    expect(agentExecutionBindingRegistry.resolve(binding.bindingId)).toMatchObject({ modelEngineAdapter: { providerConfig: { apiKey: "private-test", reasoningEffort: "high" } } });
  });
  it("rejects unsupported effort without falling back to Default", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ id: "api-model", supported_reasoning_efforts: ["low"] })));
    const response = await POST(request({ operation: "admit", ...api }));
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("not supported");
  });
  it("admits an installed Ollama switch while retaining manifest-owned endpoints", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ thinking: { values: [false, true], default: true } })));
    const response = await POST(request({ operation: "admit", providerId: "local_runner", providerConfig: { backendId: "ollama", model: "installed-local", modelReasoning: false } }));
    expect(response.status).toBe(200);
    const { binding } = await response.json();
    expect(binding).toMatchObject({ backendId: "ollama", modelReasoning: false });
    expect(agentExecutionBindingRegistry.resolve(binding.bindingId)).toMatchObject({ modelReasoning: false });
    expect(agentExecutionBindingRegistry.resolve(binding.bindingId)).not.toHaveProperty("modelEngineAdapter.providerConfig");
  });
  it("rejects a local model not in the host catalog", async () => {
    const response = await POST(request({ operation: "admit", providerId: "local_runner", providerConfig: { backendId: "ollama", model: "not-installed" } }));
    expect(response.status).toBe(400);
  });
  it("returns only validated capability metadata", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ thinking: { values: [false, true], default: true }, modelfile: "private-host-data", system: "untrusted instructions" })));
    const response = await POST(request({ operation: "capabilities", providerId: "local_runner", providerConfig: { backendId: "ollama", model: "installed-local" } }));
    expect(await response.json()).toEqual({ ok: true, modelId: "installed-local", capabilities: { parameter: "think", values: [false, true], defaultValue: true, source: "provider" } });
  });
  it("keeps provider error bodies out of client diagnostics", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "echoed-secret" }, { status: 401 })));
    const response = await POST(request({ operation: "capabilities", ...api }));
    expect(response.status).toBe(401); expect(await response.text()).not.toContain("echoed-secret");
  });
  it("rejects hosted, foreign-origin, oversized and injected requests", async () => {
    vi.stubEnv("VDT_APP_MODE", "hosted_web"); expect((await POST(request({ operation: "admit", ...api }))).status).toBe(403);
    vi.stubEnv("VDT_APP_MODE", "development_web"); expect((await POST(request({ operation: "admit", ...api }, { origin: "https://foreign.test" }))).status).toBe(403);
    expect((await POST(request({ operation: "admit", ...api, padding: "x".repeat(10000) }))).status).toBe(400);
    expect((await POST(request({ operation: "admit", providerId: "local_runner", providerConfig: { backendId: "ollama", model: "installed-local", baseUrl: "http://evil" } }))).status).toBe(400);
  });
});
