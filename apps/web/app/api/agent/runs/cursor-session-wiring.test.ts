import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExternalCliExecutionBindingDefinition } from "./execution-bindings";

vi.mock("@vdt-studio/model-bridge/node", async (importOriginal) => {
  const original = await importOriginal<typeof import("@vdt-studio/model-bridge/node")>();
  return {
    ...original,
    detectSubscriptionCli: vi.fn(async () => ({
      id: "cursor-agent" as const,
      backendId: "cursor_subscription",
      installed: true,
      executable: "/opt/vdt-test/bin/agent",
      alias: "agent",
      version: "2026.08.11-e8db854"
    }))
  };
});

const runtimeGlobal = globalThis as typeof globalThis & {
  __vdtAgentRuntime?: unknown;
  __vdtAgentExecutionBindingRegistry?: unknown;
  __vdtExternalAgentEngines?: unknown;
  __vdtCursorSessionBindingProbe?: unknown;
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  delete runtimeGlobal.__vdtAgentRuntime;
  delete runtimeGlobal.__vdtAgentExecutionBindingRegistry;
  delete runtimeGlobal.__vdtExternalAgentEngines;
  delete runtimeGlobal.__vdtCursorSessionBindingProbe;
});

describe("trusted-local Cursor session wiring", { timeout: 45_000 }, () => {
  it("publishes one server-managed external binding and resolves it without legacy fallback", async () => {
    vi.stubEnv("VDT_APP_MODE", "development_web");
    vi.stubEnv("VDT_CURSOR_SESSION_CANARY_ENABLED", "true");
    vi.stubEnv("VDT_CURSOR_SESSION_MODEL", "cursor-grok-4.6-medium");
    const runtime = await import("./runtime");

    await runtime.ensureServerManagedExecutionBindings();

    const summary = runtime.agentExecutionBindingRegistry.summaries().find(
      (binding) => binding.bindingId === runtime.CURSOR_SESSION_EXECUTION_BINDING_ID
    );
    expect(summary).toEqual({
      bindingId: "cursor_session_canary",
      executionProfile: "external_cli_agent",
      engineId: "cursor-resume-checkpoint",
      engineAdapterId: "cursor-resume-checkpoint-v1",
      backendId: "cursor_subscription",
      modelId: "cursor-grok-4.6-medium"
    });
    expect(runtime.externalAgentEngineForBinding("cursor_session_canary")?.capability).toMatchObject({
      executionProfile: "external_cli_agent",
      sessionStrategy: "checkpoint_resume",
      toolIsolation: "unverified"
    });

    const resolved = runtime.resolveAgentStartRequest({
      mode: "generate_vdt",
      input: { rootKpi: "Ore hauled" },
      executionBindingId: "cursor_session_canary"
    });
    expect(resolved.request).toMatchObject({
      executionBindingId: "cursor_session_canary",
      providerId: "external_cli_agent"
    });
    expect(resolved.binding?.capability.executionProfile).toBe("external_cli_agent");

    const { startExternalCliAgentRun } = await import("./supervisor-runtime");
    await expect(startExternalCliAgentRun({
      request: resolved.request,
      bindingDefinition: resolved.binding as ExternalCliExecutionBindingDefinition,
      engine: runtime.externalAgentEngineForBinding("cursor_session_canary")!
    })).rejects.toMatchObject({
      code: "AGENT_EXTERNAL_CAPABILITY_UNQUALIFIED",
      status: 409
    });
  });
});
