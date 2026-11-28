import { createLocalRuntimeContext } from "@vdt-studio/local-runner/server-runtime";
import { describe, expect, it, vi } from "vitest";
import { AgentExecutionBindingRegistry, executionBindingSummary } from "./execution-bindings";
import { assertAnalyticalAdmission, hostExecutionAdmission } from "./execution-binding-admission";
import {
  LocalModelAgentBindingRegistrar,
  createLocalModelAgentBinding,
  localModelAgentBindingsEnabled
} from "./local-model-bindings";

const HASH = `sha256:${"a".repeat(64)}`;

describe("server-owned local Model Agent bindings", () => {
  it("admits local chat only on a trusted host and preserves opt-out/build/test gates", () => {
    expect(localModelAgentBindingsEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(localModelAgentBindingsEnabled({ NODE_ENV: "production", VDT_LOCAL_MODEL_AGENT_ENABLED: "true" })).toBe(false);
    expect(localModelAgentBindingsEnabled({ NODE_ENV: "development", VDT_APP_MODE: "development_web" })).toBe(true);
    expect(localModelAgentBindingsEnabled({ NODE_ENV: "production", VDT_APP_MODE: "desktop" })).toBe(true);
    expect(localModelAgentBindingsEnabled({ VDT_APP_MODE: "development_web", VDT_LOCAL_MODEL_AGENT_ENABLED: "false" })).toBe(false);
    expect(localModelAgentBindingsEnabled({ VDT_APP_MODE: "development_web", NEXT_PHASE: "phase-production-build" })).toBe(false);
    expect(localModelAgentBindingsEnabled({ NODE_ENV: "test", VDT_APP_MODE: "development_web" })).toBe(false);
  });

  it("registers exact host catalog models and Ollama's untagged latest alias without a CLI or API fallback", async () => {
    const registry = new AgentExecutionBindingRegistry();
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const models = String(url).includes(":11434/")
        ? ["qwen3:8b", "qwen3:latest", "qwen3:8b", "bad\nmodel", "", "x".repeat(161)]
        : String(url).includes(":1234/") ? ["lm-local"] : [];
      return Response.json({ data: models.map((id) => ({ id })) });
    });
    const registrar = new LocalModelAgentBindingRegistrar(registry, HASH, createLocalRuntimeContext({ executor: { fetch: fetcher } }));
    await Promise.all([registrar.refresh(), registrar.refresh()]);
    await registrar.refresh();
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(registry.summaries().map(({ backendId, modelId }) => [backendId, modelId])).toEqual([
      ["ollama", "qwen3:8b"], ["ollama", "qwen3:latest"], ["ollama", "qwen3"], ["lm_studio", "lm-local"]
    ]);
    const binding = registry.resolve(createLocalModelAgentBinding("ollama", "qwen3:8b", HASH).bindingId);
    expect(binding).toMatchObject({
      capability: { backendId: "ollama", executionProfile: "model_agent", qualification: { status: "unverified" } },
      modelEngineAdapter: { providerId: "ollama" }
    });
    expect(binding).not.toHaveProperty("legacyCompatibilityAdapter");
  });

  it("discovers models installed after an empty or unavailable catalog without restarting or duplicating bindings", async () => {
    let now = 0;
    let installed = false;
    const registry = new AgentExecutionBindingRegistry();
    const context = createLocalRuntimeContext({ executor: { fetch: async (url) => {
      if (!String(url).includes(":11434/")) throw new Error("server unavailable");
      return Response.json({ models: installed ? [{ name: "qwen3:8b" }] : [] });
    } } });
    const registrar = new LocalModelAgentBindingRegistrar(registry, HASH, context, () => now);
    await registrar.refresh();
    expect(registry.summaries()).toEqual([]);
    installed = true;
    now = 10_001;
    await registrar.refresh();
    now += 10_001;
    await registrar.refresh();
    expect(registry.summaries()).toHaveLength(1);
    expect(registry.summaries()[0]?.modelId).toBe("qwen3:8b");
  });

  it("admits an exact host-installed route only while its owned transport and revision remain current", () => {
    const proof = { providerId: "ollama", modelId: "qwen3:8b", profileVersion: "installed-v1", modelRevision: HASH } as const;
    const binding = createLocalModelAgentBinding("ollama", proof.modelId, HASH, false, proof);
    const fetcher = vi.fn();
    let currentRevision = HASH;
    const registry = new AgentExecutionBindingRegistry([], {
      resolveOwnedLocalHttpRoute: (target, selection) =>
        selection.modelRevision === currentRevision ? { ...target, ...selection, fetch: fetcher } : undefined
    });
    expect(() => new AgentExecutionBindingRegistry([binding])).toThrow("cannot verify");
    registry.register(binding);
    const admitted = registry.resolve(binding.bindingId);
    const admission = hostExecutionAdmission(admitted);
    expect(executionBindingSummary(admitted)).toMatchObject({
      admission: {
        mode: "local", modelRevision: HASH, runtimeProfileVersion: "installed-v1",
        reasoning: false, boundary: "on_device", research: false, delegation: false
      }
    });
    expect(() => assertAnalyticalAdmission(admission, "agent_run", "off", admission)).not.toThrow();
    expect(() => assertAnalyticalAdmission(admission, "agent_run", "on")).toThrow("web research");
    expect(() => assertAnalyticalAdmission(admission, "generation_diagnostics")).toThrow("cannot perform");
    expect(() => assertAnalyticalAdmission(admission, "agent_run", "off", { ...admission, mode: "cli_subscription" })).toThrow("stale");
    currentRevision = `sha256:${"b".repeat(64)}`;
    expect(() => registry.resolve(binding.bindingId)).toThrow("cannot verify");
    expect(() => registry.revalidateLocalRoute(admitted)).toThrow("cannot verify");
    expect(registry.summaries()).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refuses to attach local evidence to another provider or model", () => {
    const binding = createLocalModelAgentBinding("ollama", "qwen3:8b", HASH, undefined, {
      providerId: "vllm", modelId: "qwen3:8b", profileVersion: "installed-v1", modelRevision: HASH
    });
    expect(() => new AgentExecutionBindingRegistry([binding])).toThrow("exact local structured model");
  });

  it("rejects local endpoint overrides in a binding", () => {
    const binding = createLocalModelAgentBinding("ollama", "qwen3:8b", HASH);
    expect(() => new AgentExecutionBindingRegistry([{
      ...binding,
      modelEngineAdapter: { ...binding.modelEngineAdapter, providerConfig: { baseUrl: "https://example.test/v1" } }
    }])).toThrow("endpoints are owned by the server manifest");
  });
});
