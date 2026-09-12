import { afterEach, describe, expect, it, vi } from "vitest";
import { TARGET_MODEL_AGENT_TOOLS } from "./model-agent-tool-catalog";

const detectSubscriptionCli = vi.fn();

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
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  detectSubscriptionCli.mockReset();
  delete runtimeGlobal.__vdtAgentRuntime;
  delete runtimeGlobal.__vdtAgentExecutionBindingRegistry;
  delete runtimeGlobal.__vdtExternalAgentEngines;
  delete runtimeGlobal.__vdtCursorSessionBindingProbe;
  delete runtimeGlobal.__vdtCliSessionRegistrationOutcomes;
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

describe("trusted-local CLI session wiring", () => {
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
  }, 15_000);

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
  }, 15_000);

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
  }, 15_000);

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
  }, 15_000);

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
