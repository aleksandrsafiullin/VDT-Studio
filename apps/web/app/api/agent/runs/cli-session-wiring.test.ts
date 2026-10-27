import { afterEach, describe, expect, it, vi } from "vitest";
import { TARGET_MODEL_AGENT_TOOLS } from "./model-agent-tool-catalog";
import { cliSessionModelBindingId } from "./cli-session-model-binding";

const detectSubscriptionCli = vi.fn();
const getSubscriptionCliAdapter = vi.fn();

vi.mock("@vdt-studio/model-bridge", async (importOriginal) => ({
  ...await importOriginal<typeof import("@vdt-studio/model-bridge")>(),
  getSubscriptionCliAdapter
}));

vi.mock("@vdt-studio/model-bridge/node", async (importOriginal) => {
  const original = await importOriginal<typeof import("@vdt-studio/model-bridge/node")>();
  return {
    ...original,
    detectSubscriptionCli
  };
});

const runtimeGlobal = globalThis as typeof globalThis & {
  __vdtAgentRuntime?: unknown;
  __vdtAgentExecutionBindingRegistry?: unknown;
  __vdtExternalAgentEngines?: unknown;
  __vdtCursorSessionBindingProbe?: unknown;
  __vdtCliSessionRegistrationOutcomes?: unknown;
  __vdtCliSessionRegistrationTimes?: Map<string, number>;
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  detectSubscriptionCli.mockReset();
  getSubscriptionCliAdapter.mockReset();
  delete runtimeGlobal.__vdtAgentRuntime;
  delete runtimeGlobal.__vdtAgentExecutionBindingRegistry;
  delete runtimeGlobal.__vdtExternalAgentEngines;
  delete runtimeGlobal.__vdtCursorSessionBindingProbe;
  delete runtimeGlobal.__vdtCliSessionRegistrationOutcomes;
  delete runtimeGlobal.__vdtCliSessionRegistrationTimes;
});

function mockAllClisInstalled() {
  detectSubscriptionCli.mockImplementation(async (id: string) => {
    const common = {
      installed: true,
      executable: `/opt/vdt-test/bin/${id}`,
      version: id === "cursor-agent" ? "2026.08.11-e8db854" : `${id}-1.0.0`
    };
    if (id === "cursor-agent") return { id, backendId: "cursor_subscription", alias: "agent", ...common };
    if (id === "codex") return { id, backendId: "codex_subscription", alias: "codex", ...common };
    if (id === "claude") return { id, backendId: "claude_subscription", alias: "claude", ...common };
    return { id, backendId: id, installed: false, executable: null, version: null, alias: id };
  });
}

describe("trusted-local CLI session wiring", { timeout: 45_000 }, () => {
  it("refreshes and coalesces host catalogs while preserving existing engines and bindings", async () => {
    vi.stubEnv("VDT_APP_MODE", "development_web");
    vi.stubEnv("VDT_CLI_SESSION_CANARY_ENABLED", "true");
    mockAllClisInstalled();
    let models = ["existing-model"];
    const listModels = vi.fn(async () => models);
    getSubscriptionCliAdapter.mockImplementation((backend: string) => ({
      probeAuth: async () => ({ status: "ready" }),
      listModels: backend === "codex_subscription" ? listModels : async () => []
    }));
    const runtime = await import("./runtime");
    await runtime.ensureServerManagedExecutionBindings();
    const existingId = cliSessionModelBindingId(runtime.CODEX_SESSION_EXECUTION_BINDING_ID, "existing-model");
    const existingEngine = runtime.externalAgentEngineForBinding(existingId);
    models = ["existing-model", "new-account-model"];
    runtimeGlobal.__vdtCliSessionRegistrationTimes?.set("codex", Date.now() - 60_001);
    await Promise.all(Array.from({ length: 3 }, () => runtime.ensureServerManagedExecutionBindings()));
    expect(listModels).toHaveBeenCalledTimes(2);
    expect(runtime.externalAgentEngineForBinding(existingId)).toBe(existingEngine);
    expect(runtime.agentExecutionBindingRegistry.resolve(cliSessionModelBindingId(runtime.CODEX_SESSION_EXECUTION_BINDING_ID, "new-account-model")))
      .toMatchObject({ modelId: "new-account-model" });
  });

  it("admits models from the authenticated Cursor catalog with its own engine", async () => {
    vi.stubEnv("VDT_APP_MODE", "development_web");
    vi.stubEnv("VDT_CLI_SESSION_CANARY_ENABLED", "true");
    mockAllClisInstalled();
    getSubscriptionCliAdapter.mockImplementation((backend: string) => ({
      probeAuth: async () => ({ status: "ready" }),
      listModels: async () => backend === "cursor_subscription" ? ["cursor-account-model", "--unsafe"] : []
    }));
    const runtime = await import("./runtime");
    await runtime.ensureServerManagedExecutionBindings();
    const bindingId = cliSessionModelBindingId(runtime.CURSOR_SESSION_EXECUTION_BINDING_ID, "cursor-account-model");
    expect(runtime.agentExecutionBindingRegistry.resolve(bindingId)).toMatchObject({ modelId: "cursor-account-model", capability: { backendId: "cursor_subscription" } });
    const { isAdmittedCliSessionCanary } = await import("./supervisor-runtime");
    expect(isAdmittedCliSessionCanary({ bindingId, modelId: "cursor-account-model", engineAdapterId: "cursor-resume-checkpoint-v1", allowUnqualifiedExternalCanary: true })).toBe(true);
    expect(runtime.agentExecutionBindingRegistry.resolve(runtime.CURSOR_SESSION_EXECUTION_BINDING_ID).modelId).toBe("auto");
    expect(runtime.agentExecutionBindingRegistry.resolve(runtime.CLAUDE_SESSION_EXECUTION_BINDING_ID).modelId).toBe("auto");
  });

  it("rechecks a previously absent CLI without restarting the host", async () => {
    vi.stubEnv("VDT_APP_MODE", "development_web");
    vi.stubEnv("VDT_CLI_SESSION_CANARY_ENABLED", "true");
    detectSubscriptionCli.mockImplementation(async (id: string) => ({ id, installed: false, executable: null, version: null }));
    const runtime = await import("./runtime");
    await runtime.ensureServerManagedExecutionBindings();
    expect(runtime.agentExecutionBindingRegistry.has(runtime.CODEX_SESSION_EXECUTION_BINDING_ID)).toBe(false);
    mockAllClisInstalled();
    getSubscriptionCliAdapter.mockReturnValue({ probeAuth: async () => ({ status: "ready" }), listModels: async () => [] });
    runtimeGlobal.__vdtCliSessionRegistrationTimes?.set("codex", Date.now() - 60_001);
    await runtime.ensureServerManagedExecutionBindings();
    expect(runtime.agentExecutionBindingRegistry.resolve(runtime.CODEX_SESSION_EXECUTION_BINDING_ID).modelId).toBe("auto");
  });

  it("admits immutable model/effort bindings only from authenticated Codex metadata", async () => {
    vi.stubEnv("VDT_APP_MODE", "development_web");
    vi.stubEnv("VDT_CLI_SESSION_CANARY_ENABLED", "true");
    mockAllClisInstalled();
    getSubscriptionCliAdapter.mockReturnValue({
      probeAuth: async () => ({ status: "ready" }),
      listModels: async () => { throw new Error("must use one metadata probe"); },
      listModelOptions: async () => [{ id: "model-a", reasoningEfforts: ["low", "high", "max", "ultra", "bad"] }, { id: "model-b" }]
    });
    const runtime = await import("./runtime");
    await runtime.ensureServerManagedExecutionBindings();
    const catalog = runtime.agentExecutionBindingRegistry.summaries().filter((binding) => binding.backendId === "codex_subscription");
    expect(catalog.filter((binding) => binding.modelId === "model-a").map((binding) => binding.reasoningEffort))
      .toEqual([undefined, "low", "high", "max"]);
    expect(catalog.filter((binding) => binding.modelId === "model-b").map((binding) => binding.reasoningEffort)).toEqual([undefined]);
    const bindingId = cliSessionModelBindingId(runtime.CODEX_SESSION_EXECUTION_BINDING_ID, "model-a", "high");
    expect(runtime.agentExecutionBindingRegistry.resolve(bindingId)).toMatchObject({ modelId: "model-a", reasoningEffort: "high" });
    expect(runtime.externalAgentEngineForBinding(bindingId)).toBeDefined();
    const { isAdmittedCliSessionCanary } = await import("./supervisor-runtime");
    const identity = { bindingId, modelId: "model-a", engineAdapterId: "codex-resume-checkpoint-v1", allowUnqualifiedExternalCanary: true };
    expect(isAdmittedCliSessionCanary({ ...identity, reasoningEffort: "high" })).toBe(true);
    expect(isAdmittedCliSessionCanary(identity)).toBe(false);
    expect(isAdmittedCliSessionCanary({ ...identity, reasoningEffort: "low" })).toBe(false);
    expect(isAdmittedCliSessionCanary({ ...identity, modelId: "model-b", reasoningEffort: "high" })).toBe(false);
    // A development hot reload may retain an older registry's summary method.
    const legacySummaries = catalog.map(({ reasoningEffort: _effort, ...summary }) => { void _effort; return summary; });
    const summarySpy = vi.spyOn(runtime.agentExecutionBindingRegistry, "summaries").mockReturnValue(legacySummaries);
    try {
      const { GET } = await import("./route");
      const response = await GET();
      const body = await response.json();
      expect(body.bindings.find((binding: { bindingId: string }) => binding.bindingId === bindingId)).toMatchObject({ reasoningEffort: "high" });
    } finally { summarySpy.mockRestore(); }
  });

  it("admits the selected Codex model from the authenticated host catalog without changing the default binding", async () => {
    vi.stubEnv("VDT_APP_MODE", "development_web");
    vi.stubEnv("VDT_CLI_SESSION_CANARY_ENABLED", "true");
    mockAllClisInstalled();
    getSubscriptionCliAdapter.mockReturnValue({
      probeAuth: async () => ({ status: "ready" }),
      listModels: async () => ["gpt-selected", "gpt-other", "gpt-selected", "--unsafe", "bad\nmodel"]
    });

    const runtime = await import("./runtime");
    await runtime.ensureServerManagedExecutionBindings();
    await runtime.ensureServerManagedExecutionBindings();
    const bindings = runtime.agentExecutionBindingRegistry.summaries()
      .filter((binding) => binding.backendId === "codex_subscription");
    expect(bindings.map((binding) => binding.modelId)).toEqual(["auto", "gpt-selected", "gpt-other"]);
    const selectedId = cliSessionModelBindingId(runtime.CODEX_SESSION_EXECUTION_BINDING_ID, "gpt-selected");
    expect(runtime.agentExecutionBindingRegistry.resolve(selectedId).modelId).toBe("gpt-selected");
    expect(runtime.externalAgentEngineForBinding(selectedId)).toBeDefined();
    const { isAdmittedCliSessionCanary } = await import("./supervisor-runtime");
    const identity = { bindingId: selectedId, engineAdapterId: "codex-resume-checkpoint-v1", modelId: "gpt-selected" };
    expect(isAdmittedCliSessionCanary({ ...identity, allowUnqualifiedExternalCanary: true })).toBe(true);
    expect(isAdmittedCliSessionCanary({ ...identity, modelId: "gpt-other", allowUnqualifiedExternalCanary: true })).toBe(false);
    expect(isAdmittedCliSessionCanary({ ...identity, engineAdapterId: "claude-resume-checkpoint-v1", allowUnqualifiedExternalCanary: true })).toBe(false);
    expect(isAdmittedCliSessionCanary({ ...identity, allowUnqualifiedExternalCanary: false })).toBe(false);
  });

  it.each(["authentication_required", "error"])("does not admit catalog models after a %s auth probe", async (status) => {
    vi.stubEnv("VDT_APP_MODE", "development_web");
    vi.stubEnv("VDT_CLI_SESSION_CANARY_ENABLED", "true");
    vi.stubEnv("VDT_CODEX_SESSION_MODEL", "host-pinned");
    mockAllClisInstalled();
    const listModels = vi.fn();
    getSubscriptionCliAdapter.mockReturnValue({ probeAuth: async () => ({ status }), listModels });
    const runtime = await import("./runtime");
    await runtime.ensureServerManagedExecutionBindings();
    expect(listModels).not.toHaveBeenCalled();
    expect(runtime.agentExecutionBindingRegistry.summaries().filter((binding) => binding.backendId === "codex_subscription")
      .map((binding) => binding.modelId)).toEqual(["host-pinned"]);
  });

  it("keeps provider-default chat available when catalog discovery fails", async () => {
    vi.stubEnv("VDT_APP_MODE", "development_web");
    vi.stubEnv("VDT_CLI_SESSION_CANARY_ENABLED", "true");
    mockAllClisInstalled();
    getSubscriptionCliAdapter.mockReturnValue({
      probeAuth: async () => ({ status: "ready" }),
      listModels: async () => { throw new Error("catalog unavailable"); }
    });
    const runtime = await import("./runtime");
    await runtime.ensureServerManagedExecutionBindings();
    expect(runtime.agentExecutionBindingRegistry.resolve(runtime.CODEX_SESSION_EXECUTION_BINDING_ID).modelId).toBe("auto");
  });

  it("registers cursor, codex, and claude bindings when each CLI is detected", async () => {
    vi.stubEnv("VDT_APP_MODE", "development_web");
    vi.stubEnv("VDT_CLI_SESSION_CANARY_ENABLED", "true");
    mockAllClisInstalled();

    const runtime = await import("./runtime");
    await runtime.ensureServerManagedExecutionBindings();

    expect(detectSubscriptionCli.mock.calls.map((call) => call[0])).toEqual(
      expect.arrayContaining(["cursor-agent", "codex", "claude"])
    );
    const summaries = runtime.agentExecutionBindingRegistry.summaries();
    expect(summaries.map((binding) => binding.bindingId)).toEqual(expect.arrayContaining([
      runtime.CURSOR_SESSION_EXECUTION_BINDING_ID,
      runtime.CODEX_SESSION_EXECUTION_BINDING_ID,
      runtime.CLAUDE_SESSION_EXECUTION_BINDING_ID
    ]));
  }, 45_000);

  it("records Claude registration as absent when the CLI is missing — expected on hosts without `claude`", async () => {
    vi.stubEnv("VDT_APP_MODE", "development_web");
    vi.stubEnv("VDT_CLI_SESSION_CANARY_ENABLED", "true");
    detectSubscriptionCli.mockImplementation(async (id: string) => {
      if (id === "claude") {
        return { id, backendId: "claude_subscription", installed: false, executable: null, version: null, alias: "claude" };
      }
      const common = { installed: true, executable: `/opt/vdt-test/bin/${id}`, version: "1.0.0" };
      if (id === "cursor-agent") return { id, backendId: "cursor_subscription", alias: "agent", ...common, version: "2026.08.11-e8db854" };
      if (id === "codex") return { id, backendId: "codex_subscription", alias: "codex", ...common };
      return { id, backendId: id, installed: false, executable: null, version: null, alias: id };
    });

    const runtime = await import("./runtime");
    await runtime.ensureServerManagedExecutionBindings();
    const bindingIds = runtime.agentExecutionBindingRegistry.summaries().map((binding) => binding.bindingId);
    const outcomes = runtimeGlobal.__vdtCliSessionRegistrationOutcomes as Map<string, string> | undefined;

    // Hosts without `claude` on PATH skip this binding. The live harness then
    // fail-fasts: exit 2, "Claude CLI not detected; see docs/provider-compatibility.md".
    expect(outcomes?.get("claude")).toBe("absent");
    expect(bindingIds).not.toContain(runtime.CLAUDE_SESSION_EXECUTION_BINDING_ID);
    expect(bindingIds).toContain(runtime.CURSOR_SESSION_EXECUTION_BINDING_ID);
    expect(bindingIds).toContain(runtime.CODEX_SESSION_EXECUTION_BINDING_ID);
  }, 45_000);

  it("skips a missing CLI without blocking the others", async () => {
    vi.stubEnv("VDT_APP_MODE", "development_web");
    vi.stubEnv("VDT_CLI_SESSION_CANARY_ENABLED", "true");
    detectSubscriptionCli.mockImplementation(async (id: string) => {
      if (id === "codex") {
        return { id, backendId: "codex_subscription", installed: false, executable: null, version: null, alias: "codex" };
      }
      const common = { installed: true, executable: `/opt/vdt-test/bin/${id}`, version: "1.0.0" };
      if (id === "cursor-agent") return { id, backendId: "cursor_subscription", alias: "agent", ...common, version: "2026.08.11-e8db854" };
      if (id === "claude") return { id, backendId: "claude_subscription", alias: "claude", ...common };
      return { id, backendId: id, installed: false, executable: null, version: null, alias: id };
    });

    const runtime = await import("./runtime");
    await runtime.ensureServerManagedExecutionBindings();
    const bindingIds = runtime.agentExecutionBindingRegistry.summaries().map((binding) => binding.bindingId);
    expect(bindingIds).toContain(runtime.CURSOR_SESSION_EXECUTION_BINDING_ID);
    expect(bindingIds).toContain(runtime.CLAUDE_SESSION_EXECUTION_BINDING_ID);
    expect(bindingIds).not.toContain(runtime.CODEX_SESSION_EXECUTION_BINDING_ID);
  }, 45_000);

  it("continues registering other CLIs when cursor registration throws", async () => {
    vi.stubEnv("VDT_APP_MODE", "development_web");
    vi.stubEnv("VDT_CLI_SESSION_CANARY_ENABLED", "true");
    detectSubscriptionCli.mockImplementation(async (id: string) => {
      if (id === "cursor-agent") throw new Error("cursor probe failed");
      const common = {
        installed: true,
        executable: `/opt/vdt-test/bin/${id}`,
        version: "1.0.0"
      };
      if (id === "codex") return { id, backendId: "codex_subscription", alias: "codex", ...common };
      if (id === "claude") return { id, backendId: "claude_subscription", alias: "claude", ...common };
      return { id, backendId: id, installed: false, executable: null, version: null, alias: id };
    });

    const runtime = await import("./runtime");
    await runtime.ensureServerManagedExecutionBindings();
    const bindingIds = runtime.agentExecutionBindingRegistry.summaries().map((binding) => binding.bindingId);
    expect(bindingIds).not.toContain(runtime.CURSOR_SESSION_EXECUTION_BINDING_ID);
    expect(bindingIds).toContain(runtime.CODEX_SESSION_EXECUTION_BINDING_ID);
    expect(bindingIds).toContain(runtime.CLAUDE_SESSION_EXECUTION_BINDING_ID);
  }, 45_000);

  it("retries a failed CLI registration without reprobing successful ones", async () => {
    vi.stubEnv("VDT_APP_MODE", "development_web");
    vi.stubEnv("VDT_CLI_SESSION_CANARY_ENABLED", "true");
    let cursorAttempts = 0;
    let codexDetectCalls = 0;
    detectSubscriptionCli.mockImplementation(async (id: string) => {
      if (id === "cursor-agent") {
        cursorAttempts += 1;
        if (cursorAttempts === 1) throw new Error("cursor probe failed");
        return {
          id,
          backendId: "cursor_subscription",
          alias: "agent",
          installed: true,
          executable: "/opt/vdt-test/bin/cursor-agent",
          version: "2026.08.11-e8db854"
        };
      }
      if (id === "codex") {
        codexDetectCalls += 1;
        return {
          id,
          backendId: "codex_subscription",
          alias: "codex",
          installed: true,
          executable: "/opt/vdt-test/bin/codex",
          version: "1.0.0"
        };
      }
      if (id === "claude") {
        return {
          id,
          backendId: "claude_subscription",
          alias: "claude",
          installed: true,
          executable: "/opt/vdt-test/bin/claude",
          version: "1.0.0"
        };
      }
      return { id, backendId: id, installed: false, executable: null, version: null, alias: id };
    });

    const runtime = await import("./runtime");
    await runtime.ensureServerManagedExecutionBindings();
    expect(runtime.agentExecutionBindingRegistry.has(runtime.CODEX_SESSION_EXECUTION_BINDING_ID)).toBe(true);
    expect(runtime.agentExecutionBindingRegistry.has(runtime.CLAUDE_SESSION_EXECUTION_BINDING_ID)).toBe(true);
    expect(runtime.agentExecutionBindingRegistry.has(runtime.CURSOR_SESSION_EXECUTION_BINDING_ID)).toBe(false);
    expect(codexDetectCalls).toBe(1);

    await runtime.ensureServerManagedExecutionBindings();
    expect(runtime.agentExecutionBindingRegistry.has(runtime.CURSOR_SESSION_EXECUTION_BINDING_ID)).toBe(true);
    expect(cursorAttempts).toBe(2);
    expect(codexDetectCalls).toBe(1);
  }, 45_000);

  it("admits codex and claude session canaries through the supervisor allowlist", async () => {
    const { isAdmittedCliSessionCanary } = await import("./supervisor-runtime");
    const runtime = await import("./runtime");
    expect(isAdmittedCliSessionCanary({
      bindingId: runtime.CODEX_SESSION_EXECUTION_BINDING_ID,
      engineAdapterId: "codex-resume-checkpoint-v1",
      allowUnqualifiedExternalCanary: true
    })).toBe(true);
    expect(isAdmittedCliSessionCanary({
      bindingId: runtime.CLAUDE_SESSION_EXECUTION_BINDING_ID,
      engineAdapterId: "claude-resume-checkpoint-v1",
      allowUnqualifiedExternalCanary: true
    })).toBe(true);
    expect(isAdmittedCliSessionCanary({
      bindingId: runtime.CODEX_SESSION_EXECUTION_BINDING_ID,
      engineAdapterId: "codex-resume-checkpoint-v1",
      allowUnqualifiedExternalCanary: false
    })).toBe(false);
  });

  it("includes research.search_web in the model agent tool catalog", () => {
    expect(TARGET_MODEL_AGENT_TOOLS).toContain("research.search_web");
    expect(TARGET_MODEL_AGENT_TOOLS).toContain("research.extract_process_drivers");
    expect(TARGET_MODEL_AGENT_TOOLS).toContain("research.propose_decomposition");
  });
});
