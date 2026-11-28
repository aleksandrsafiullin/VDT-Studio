import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openVdtDatabase } from "@vdt-studio/storage";
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
let dataDir: string;
beforeEach(() => {
  vi.stubEnv("VDT_APP_MODE", "development_web");
  dataDir = mkdtempSync(join(tmpdir(), "vdt-provider-admit-"));
  vi.stubEnv("VDT_DATA_DIR", dataDir);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); rmSync(dataDir, { recursive: true, force: true }); });

describe("provider model admission boundary", () => {
  it("admits a selected provider from the packaged desktop without a development opt-in", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VDT_MODEL_AGENT_ENABLED", undefined);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ id: "api-model", supported_reasoning_efforts: ["low", "high"] })));
    const input = { operation: "admit", ...api };
    expect((await POST(request(input))).status).toBe(403);
    vi.stubEnv("VDT_APP_MODE", "desktop");
    const response = await POST(new Request("http://localhost:37541/api/agent/bindings/provider", {
      method: "POST",
      headers: { "content-type": "application/json", host: "127.0.0.1:37541", origin: "http://127.0.0.1:37541" },
      body: JSON.stringify(input)
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ binding: { modelId: "api-model", modelReasoning: "high" } });
    expect((await POST(request(input, { origin: "https://foreign.test" }))).status).toBe(403);
  });
  it("admits the exact API model/effort and never returns its credentials", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ id: "api-model", supported_reasoning_efforts: ["low", "high"] })));
    const response = await POST(request({ operation: "admit", ...api }));
    expect(response.status).toBe(200);
    const text = await response.text(); expect(text).not.toContain("private-test");
    const { binding } = JSON.parse(text);
    expect(binding).toMatchObject({ backendId: "openai_compatible", modelId: "api-model", modelReasoning: "high", admission: { mode: "api_keys", boundary: "provider_service", credential: { kind: "session_key" } } });
    expect(agentExecutionBindingRegistry.resolve(binding.bindingId)).toMatchObject({ modelEngineAdapter: { providerConfig: { apiKey: "private-test", reasoningEffort: "high" } } });
  });
  it("rejects forged Local/API/CLI mode and Local research before any provider request", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const local = { providerId: "local_runner", providerConfig: { backendId: "ollama", model: "installed-local" } };
    for (const input of [
      { ...api, executionMode: "local" },
      { ...api, executionMode: "cli_subscription" },
      { ...local, executionMode: "api_keys" },
      { ...local, executionMode: "local" },
      { ...local, enableResearch: true }
    ]) {
      expect((await POST(request({ operation: "admit", ...input }))).status).toBe(409);
    }
    expect(fetcher).not.toHaveBeenCalled();
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
    expect(binding).toMatchObject({ backendId: "ollama", modelReasoning: false, admission: { mode: "legacy", boundary: "unverified", research: false } });
    expect(agentExecutionBindingRegistry.resolve(binding.bindingId)).toMatchObject({ modelReasoning: false });
    expect(agentExecutionBindingRegistry.resolve(binding.bindingId)).not.toHaveProperty("modelEngineAdapter.providerConfig");
  });
  it.each([[[true, false], false], [["high", "medium", "low"], "low"], [[], undefined]])("pins the effective Fast setting for local metadata %j", async (values, effective) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ thinking: { values } })));
    const response = await POST(request({ operation: "admit", providerId: "local_runner", providerConfig: {
      backendId: "ollama", model: "installed-local", modelReasoning: "vdt-fast"
    } }));
    expect(response.status).toBe(200);
    const { binding } = await response.json();
    expect(binding.modelReasoning).toBe(effective);
    expect(binding.admission.reasoning).toBe(effective ?? null);
  });
  it("pins adaptive Ollama separately from fixed Fast and rejects unsupported or conflicting opt-ins", async () => {
    const adaptiveWorkspace = { projectId: "adaptive_project", vdtId: "adaptive_tree" };
    const database = openVdtDatabase(process.cwd(), { dataDir });
    try {
      database.createProject({ id: adaptiveWorkspace.projectId, name: "Exact local project" });
      database.createVdt({ id: adaptiveWorkspace.vdtId, projectId: adaptiveWorkspace.projectId, name: "Exact local tree", rootKpi: "Capacity" });
    } finally { database.close(); }
    const selection = { operation: "admit", providerId: "local_runner",
      providerConfig: { backendId: "ollama", model: "installed-local", modelReasoning: "vdt-fast" } };
    const fetcher = vi.fn(async () => Response.json({ thinking: { values: ["medium", true, "low", false] } }));
    vi.stubGlobal("fetch", fetcher);
    const fixed = (await (await POST(request(selection))).json()).binding;
    const response = await POST(request({ ...selection, adaptiveReasoning: true, adaptiveWorkspace }));
    expect(response.status).toBe(200);
    const { binding } = await response.json();
    expect(binding).toMatchObject({ adaptiveReasoning: { start: false, repair: "low" }, modelReasoning: false,
      admission: { mode: "legacy", boundary: "unverified", reasoning: false } });
    expect(binding.bindingId).not.toBe(fixed.bindingId);
    expect(fixed).not.toHaveProperty("adaptiveReasoning");
    expect(agentExecutionBindingRegistry.summaries().map(item => item.bindingId)).toContain(fixed.bindingId);
    expect(agentExecutionBindingRegistry.summaries().map(item => item.bindingId)).not.toContain(binding.bindingId);
    expect(() => agentExecutionBindingRegistry.resolve(binding.bindingId)).toThrow("unavailable");
    expect(agentExecutionBindingRegistry.resolveAdaptiveStart(binding.bindingId, adaptiveWorkspace, {
      mode: "legacy", providerId: "ollama", profileVersion: 1, modelId: "installed-local", modelRevision: null
    })).toMatchObject({ modelEngineAdapter: { adaptiveReasoning: { start: false, repair: "low" } } });

    const probes = fetcher.mock.calls.length;
    for (const body of [
      { ...selection, providerConfig: { ...selection.providerConfig, modelReasoning: "medium" } },
      { ...selection, providerConfig: { ...selection.providerConfig, modelReasoning: false } },
      { ...selection, providerConfig: { ...selection.providerConfig, modelReasoning: undefined } },
      { ...selection, providerConfig: { ...selection.providerConfig, backendId: "lm_studio" } },
      { operation: "admit", ...api }
    ]) {
      expect((await POST(request({ ...body, adaptiveReasoning: true, adaptiveWorkspace }))).status).toBe(400);
    }
    expect(fetcher).toHaveBeenCalledTimes(probes);
    fetcher.mockImplementation(async () => Response.json({ capabilities: ["completion", "thinking"] }));
    expect((await POST(request({ ...selection, adaptiveReasoning: true, adaptiveWorkspace }))).status).toBe(400);
  });

  it("uses Provider default when the installed local adapter does not offer a metadata endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Unknown endpoint", { status: 404 })));
    const response = await POST(request({ operation: "admit", providerId: "local_runner", providerConfig: {
      backendId: "ollama", model: "installed-local", modelReasoning: "vdt-fast"
    } }));
    expect(response.status).toBe(200);
    expect((await response.json()).binding).not.toHaveProperty("modelReasoning");
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
