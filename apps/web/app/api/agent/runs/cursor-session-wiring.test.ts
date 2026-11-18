import { afterEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { CURSOR_CHECKPOINT_PROTOCOL_VERSION, cursorCheckpointVendorPolicyHash } from "@vdt-studio/model-bridge/node";
import type { ExternalCliExecutionBindingDefinition } from "./execution-bindings";
import { modelAgentToolCatalogHash } from "./model-agent-tool-catalog";

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

const cursorIsolationActivationKey = Symbol.for("vdt-studio.packaged-cursor-isolation.activation.v1");
const cursorHostKey = Symbol.for("vdt-studio.packaged-web-host.v1");
const runtimeGlobal = globalThis as typeof globalThis & {
  __vdtAgentRuntime?: unknown;
  __vdtAgentExecutionBindingRegistry?: unknown;
  __vdtExternalAgentEngines?: unknown;
  __vdtCursorSessionBindingProbe?: unknown;
  __vdtPackagedCursorConnection?: unknown;
  __vdtSqliteBackedAgentRunStores?: unknown;
  __vdtAgentSupervisorReadAuthorities?: unknown;
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  delete runtimeGlobal.__vdtAgentRuntime;
  delete runtimeGlobal.__vdtAgentExecutionBindingRegistry;
  delete runtimeGlobal.__vdtExternalAgentEngines;
  delete runtimeGlobal.__vdtCursorSessionBindingProbe;
  delete runtimeGlobal.__vdtPackagedCursorConnection;
  delete runtimeGlobal.__vdtSqliteBackedAgentRunStores;
  delete runtimeGlobal.__vdtAgentSupervisorReadAuthorities;
  Reflect.deleteProperty(globalThis, cursorIsolationActivationKey);
  Reflect.deleteProperty(globalThis, cursorHostKey);
});

describe("trusted-local Cursor session wiring", { timeout: 45_000 }, () => {
  it("does not admit Cursor in production from desktop mode and canary environment flags", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VDT_APP_MODE", "desktop");
    vi.stubEnv("VDT_CLI_SESSION_CANARY_ENABLED", "true");
    vi.stubEnv("VDT_CURSOR_SESSION_CANARY_ENABLED", "true");
    vi.stubEnv("VDT_CURSOR_SESSION_MODEL", "grok-4.7-low");
    const runtime = await import("./runtime");
    await runtime.ensureServerManagedExecutionBindings();
    expect(runtime.agentExecutionBindingRegistry.summaries().filter((binding) =>
      binding.backendId === "cursor_subscription"
    )).toEqual([]);
  });

  it.skipIf(process.platform !== "darwin" && process.platform !== "win32").each(["legacy", "standard"])(
    "admits each matching exact Grok model and rejects mismatched evidence from the same %s package",
    async (profileType) => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("VDT_APP_MODE", "desktop");
      const baseline = await import("./runtime");
      const toolCatalogHash = modelAgentToolCatalogHash(baseline.agentRuntime.tools);
      vi.resetModules();

      const identity = {
        cliVersion: "2026.11.11-b912975",
        payloadHash: `sha256:${"a".repeat(64)}`,
        policyHash: `sha256:${"b".repeat(64)}`,
        vendorPolicyHash: cursorCheckpointVendorPolicyHash("disabled")
      };
      const measureIdentity = vi.fn(async () => identity);
      const runQualified = vi.fn(async () => { throw new Error("Binding listing must never spawn inference."); });
      function activation(modelId: string, effort: string, policyHash = identity.policyHash) {
        return {
          executable: path.resolve("test-cursor-payload"),
          evidence: {
            ...identity,
            policyHash,
            evidenceHash: `sha256:${"c".repeat(64)}`,
            testedAt: "2026-11-16T10:00:00.000Z",
            protocolVersion: CURSOR_CHECKPOINT_PROTOCOL_VERSION,
            toolCatalogHash,
            platform: { os: process.platform, arch: process.arch, runtimeVersion: process.version },
            modelId,
            catalogModelDisplayName: `Grok 4.7  ${effort}`,
            runtimeModelDisplayName: `Grok 4.7 256K ${effort}`
          },
          runner: { measureIdentity, runQualified },
          sessionEnvironmentFactory: () => { throw new Error("Binding listing must never initialize a session."); }
        };
      }
      const eligible = [
        activation("grok-4.7-low", "Low"),
        activation("grok-4.7-xhigh", "Extra High"),
        activation("grok-4.7-high", "High", `sha256:${"d".repeat(64)}`)
      ];
      let activations = eligible;
      let status: "ready" | "sign_in_required" = "sign_in_required";
      const authStatus = vi.fn(async () => status);
      const getActivations = vi.fn(async () => activations);
      const signIn = vi.fn(async () => { status = "ready"; });
      Object.defineProperty(globalThis, cursorIsolationActivationKey, {
        configurable: true,
        value: profileType === "legacy" ? { activations } : { authStatus, getActivations, signIn }
      });

      const runtime = await import("./runtime");
      await Promise.all([runtime.ensureServerManagedExecutionBindings(), runtime.ensureServerManagedExecutionBindings()]);
      if (profileType === "standard") {
        const { GET } = await import("./route");
        const unrelatedCatalog = await GET(new Request("http://localhost/api/agent/runs", {
          headers: { "x-vdt-skip-packaged-cursor-discovery": "1" }
        }));
        expect((await unrelatedCatalog.json()).bindings).not.toContainEqual(expect.objectContaining({ backendId: "cursor_subscription" }));
        expect(authStatus).not.toHaveBeenCalled();
        expect(getActivations).not.toHaveBeenCalled();
        expect(() => runtime.resolveAgentStartRequest({
          mode: "generate_vdt",
          providerId: "local_runner",
          providerConfig: { backendId: " cursor_subscription " },
          input: { prompt: "Prepare a tree." }
        })).toThrow("Packaged Cursor Agent runs require an exact managed profile binding.");
        expect(await runtime.refreshPackagedCursorConnection()).toEqual({ status: "sign_in_required", models: [] });
        expect(getActivations).not.toHaveBeenCalled();
        const [connected, duplicate] = await Promise.all([runtime.signInPackagedCursor(), runtime.signInPackagedCursor()]);
        expect(connected).toBe(duplicate);
        expect(connected.status).toBe("ready");
        expect(connected.models.map(model => model.id).sort()).toEqual(["grok-4.7-low", "grok-4.7-xhigh"]);
        expect(signIn).toHaveBeenCalledOnce();
        expect(getActivations).toHaveBeenCalledOnce();
        expect(await runtime.refreshPackagedCursorConnection()).toBe(connected);
      }
      const bindings = runtime.agentExecutionBindingRegistry.summaries().filter((binding) =>
        binding.backendId === "cursor_subscription"
      );
      expect(bindings.map(binding => binding.modelId).sort()).toEqual(["grok-4.7-low", "grok-4.7-xhigh"]);
      expect(new Set(bindings.map(binding => binding.bindingId)).size).toBe(2);
      for (const binding of bindings) {
        expect(binding).toMatchObject({
          bindingId: expect.stringMatching(/^cursor_desktop_/), executionProfile: "external_cli_agent"
        });
        expect(runtime.agentExecutionBindingRegistry.resolve(binding.bindingId).capability).toMatchObject({
          toolIsolation: "hard_verified",
          qualification: { status: "qualified" }
        });
        expect(runtime.externalAgentEngineForBinding(binding.bindingId)).toBeDefined();
      }
      expect(measureIdentity).toHaveBeenCalledTimes(3);
      expect(runQualified).not.toHaveBeenCalled();
      if (profileType === "standard") {
        const low = bindings.find(binding => binding.modelId === "grok-4.7-low")!;
        const lowEngine = runtime.externalAgentEngineForBinding(low.bindingId);
        activations = eligible.filter(candidate => candidate.evidence.modelId !== low.modelId);
        expect((await runtime.refreshPackagedCursorConnection(true)).models.map(model => model.id)).toEqual(["grok-4.7-xhigh"]);
        expect(runtime.isCurrentPackagedCursorBinding(low.bindingId)).toBe(false);
        expect(runtime.externalAgentEngineForBinding(low.bindingId)).toBe(lowEngine);
        status = "sign_in_required";
        expect(await runtime.refreshPackagedCursorConnection(true)).toEqual({ status: "sign_in_required", models: [] });
        expect(bindings.every(binding => !runtime.isCurrentPackagedCursorBinding(binding.bindingId))).toBe(true);
      }
    }
  );

  it("protects the native sign-in route and fails closed when packaged activation is missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VDT_APP_MODE", "desktop");
    const { POST } = await import("../../ai/packaged-cursor/route");
    const request = (origin = "http://127.0.0.1:37541", body = JSON.stringify({ operation: "status" })) => new Request(
      "http://localhost:37541/api/ai/packaged-cursor",
      { method: "POST", body, headers: { host: "127.0.0.1:37541", origin, "content-type": "application/json" } }
    );
    expect(await (await POST(request())).json()).toEqual({ ok: false, legacy: true });
    Object.defineProperty(globalThis, cursorHostKey, { configurable: true, value: true });
    expect((await POST(request("http://127.0.0.1:37542"))).status).toBe(403);
    expect((await POST(request("", JSON.stringify({ operation: "sign_in" })))).status).toBe(403);
    expect((await POST(request(undefined, JSON.stringify({ operation: "sign_in", executable: "/other" })))).status).toBe(400);
    expect((await POST(request(undefined, " ".repeat(129)))).status).toBe(413);
    const response = await POST(request());
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true, status: "unsupported", models: [] });
  });

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
