import { describe, expect, it } from "vitest";
import type { AgentExecutionBindingSelection } from "@/lib/agent-client";
import { DEFAULT_EXECUTION_SETTINGS } from "@/lib/execution-mode-catalog";
import { resolveExecutionSettings } from "@/lib/execution-mode-resolver";
import {
  NO_EXECUTION_BINDING_MESSAGE,
  buildAgentPublicStartRequest,
  formatNoExternalExecutionBindingMessage,
  formatNoLocalModelExecutionBindingMessage,
  resolveExecutionBindingId
} from "./agent-start-resolver";

const commonRequest = {
  mode: "generate_vdt" as const,
  input: { rootKpi: "Ore haulage", prompt: "Build a model" },
  options: {
    autoApplyPatches: true,
    continueWithAssumptions: false,
    maxSteps: 40
  }
};

const byokSettings = {
  ...DEFAULT_EXECUTION_SETTINGS,
  executionMode: "byok" as const,
  gatewayPresetId: "openai-default" as const,
  byokProtocol: "openai" as const,
  useMockProvider: false,
  apiKey: "test-key",
  model: "gpt-test"
};

const cursorCliSettings = {
  ...DEFAULT_EXECUTION_SETTINGS,
  executionMode: "local_cli" as const,
  selectedCliAgentId: "cursor-agent" as const,
  localRunnerPresetId: "custom_cli_json" as const,
  runnerProviderId: "cli_stub" as const,
  timeoutSec: 60
};

function bindingsFixture(
  overrides: Partial<AgentExecutionBindingSelection> & {
    bindings?: AgentExecutionBindingSelection["bindings"];
  } = {}
): AgentExecutionBindingSelection {
  return {
    schemaVersion: 1,
    ok: true,
    defaultBindingId: "model_agent_default",
    bindings: [
      {
        bindingId: "model_agent_default",
        executionProfile: "model_agent",
        engineId: "in-product-model-agent",
        engineAdapterId: "http-structured-replay-canary-v1",
        backendId: "openai_compatible",
        modelId: "gpt-test"
      }
    ],
    ...overrides
  };
}

describe("agent-start-resolver", () => {
  const localSettings = {
    ...DEFAULT_EXECUTION_SETTINGS,
    executionMode: "local_cli" as const,
    runnerProviderId: "local_http_stub" as const,
    localRunnerPresetId: "ollama_openai" as const,
    selectedCliAgentId: "codex" as const,
    localModel: "qwen3"
  };
  const localBinding = {
    bindingId: "ollama_exact_model",
    executionProfile: "model_agent" as const,
    engineId: "in-product-model-agent",
    engineAdapterId: "server-owned-local-adapter",
    backendId: "ollama",
    modelId: "qwen3"
  };

  it("matches Local models only to an exact server-owned Model Agent backend/model", () => {
    const resolved = resolveExecutionSettings(localSettings);
    const bindings = bindingsFixture({ bindings: [localBinding] });
    expect(resolveExecutionBindingId(bindings, localSettings, resolved.providerId, resolved.providerConfig)).toBe("ollama_exact_model");
    const request = buildAgentPublicStartRequest(commonRequest, localSettings, bindings, resolved);
    expect(request).toEqual({ ...commonRequest, executionBindingId: "ollama_exact_model" });
    expect(request).not.toHaveProperty("providerConfig");
  });

  it.each([
    { ...localBinding, modelId: "a-different-model" },
    { ...localBinding, backendId: "local_runner" },
    { ...localBinding, backendId: "openai_compatible" },
    { ...localBinding, executionProfile: "external_cli_agent" as const }
  ])("rejects incompatible Local models bindings without default or generic fallback: %j", (binding) => {
    const resolved = resolveExecutionSettings(localSettings);
    const bindings = bindingsFixture({ defaultBindingId: binding.bindingId, bindings: [binding] });
    expect(resolveExecutionBindingId(bindings, localSettings, resolved.providerId, resolved.providerConfig)).toBeNull();
    expect(() => buildAgentPublicStartRequest(commonRequest, localSettings, bindings, resolved)).toThrow(formatNoLocalModelExecutionBindingMessage("ollama"));
  });

  it("requires a local backend ID and matches the backend when no model was supplied", () => {
    const bindings = bindingsFixture({ bindings: [localBinding] });
    expect(resolveExecutionBindingId(bindings, localSettings, "local_runner", { model: "qwen3" })).toBeNull();
    expect(resolveExecutionBindingId(bindings, localSettings, "local_runner", { backendId: "ollama" })).toBe("ollama_exact_model");
  });

  it.each(["local_runner", "openai_compatible"])("rejects a generic/API backend even when Local models config and binding both match %s", (backendId) => {
    const bindings = bindingsFixture({ bindings: [{ ...localBinding, backendId }], defaultBindingId: localBinding.bindingId });
    const providerConfig = { backendId, model: "qwen3" };
    expect(resolveExecutionBindingId(bindings, localSettings, "local_runner", providerConfig)).toBeNull();
    expect(() => buildAgentPublicStartRequest(commonRequest, localSettings, bindings, { providerId: "local_runner", providerConfig })).toThrow(formatNoLocalModelExecutionBindingMessage(backendId));
  });

  it("keeps explicit binding authority and reports local-specific unavailable errors", () => {
    const resolved = resolveExecutionSettings(localSettings);
    const bindings = bindingsFixture({ bindings: [], defaultBindingId: null });
    expect(buildAgentPublicStartRequest(commonRequest, localSettings, bindings, { ...resolved, explicitBindingId: "explicit-server-binding" })).toEqual({ ...commonRequest, executionBindingId: "explicit-server-binding" });
    expect(() => buildAgentPublicStartRequest(commonRequest, localSettings, bindings, resolved)).toThrow("install or load the model");
    expect(() => buildAgentPublicStartRequest(commonRequest, localSettings, bindings, resolved)).not.toThrow("CLI is installed");
  });

  it("uses explicit executionBindingId without provider authority", () => {
    const request = buildAgentPublicStartRequest(
      commonRequest,
      byokSettings,
      bindingsFixture({ bindings: [] }),
      {
        explicitBindingId: "model_agent_default",
        providerId: "openai_compatible",
        providerConfig: { apiKey: "test-key" }
      }
    );

    expect(request).toEqual({
      ...commonRequest,
      executionBindingId: "model_agent_default"
    });
    expect(request).not.toHaveProperty("providerId");
    expect(request).not.toHaveProperty("providerConfig");
  });

  it("resolves BYOK to a model_agent binding with an exact backendId match", () => {
    const bindings = bindingsFixture();
    const bindingId = resolveExecutionBindingId(
      bindings,
      byokSettings,
      "openai_compatible",
      { apiKey: "test-key" }
    );

    expect(bindingId).toBe("model_agent_default");

    const request = buildAgentPublicStartRequest(
      commonRequest,
      byokSettings,
      bindings,
      {
        providerId: "openai_compatible",
        providerConfig: { apiKey: "test-key" }
      }
    );

    expect(request).toEqual({
      ...commonRequest,
      executionBindingId: "model_agent_default"
    });
    expect(request).not.toHaveProperty("providerId");
  });

  it("returns null for BYOK when bindings exist but backendId does not match providerId", () => {
    const bindings = bindingsFixture({
      bindings: [
        {
          bindingId: "model_agent_default",
          executionProfile: "model_agent",
          engineId: "in-product-model-agent",
          engineAdapterId: "http-structured-replay-canary-v1",
          backendId: "mock",
          modelId: "deterministic-test-model"
        }
      ]
    });

    expect(
      resolveExecutionBindingId(bindings, byokSettings, "openai_compatible", { apiKey: "test-key" })
    ).toBeNull();

    expect(() =>
      buildAgentPublicStartRequest(commonRequest, byokSettings, bindings, {
        providerId: "openai_compatible",
        providerConfig: { apiKey: "test-key" }
      })
    ).toThrow(NO_EXECUTION_BINDING_MESSAGE);
  });

  it("does not silently substitute another API model on the same backend", () => {
    expect(resolveExecutionBindingId(bindingsFixture(), byokSettings, "openai_compatible", { model: "gpt-6-luna" })).toBeNull();
  });

  it("does not fall back to defaultBindingId when BYOK backendId does not match", () => {
    const bindings = bindingsFixture({
      defaultBindingId: "model_agent_default",
      bindings: [
        {
          bindingId: "model_agent_default",
          executionProfile: "model_agent",
          engineId: "in-product-model-agent",
          engineAdapterId: "http-structured-replay-canary-v1",
          backendId: "mock",
          modelId: "deterministic-test-model"
        }
      ]
    });

    expect(
      resolveExecutionBindingId(bindings, byokSettings, "openai_compatible", undefined)
    ).toBeNull();
  });

  it("fails locally for BYOK when bindings are empty", () => {
    const bindings = bindingsFixture({ defaultBindingId: null, bindings: [] });

    expect(
      resolveExecutionBindingId(bindings, byokSettings, "openai_compatible", undefined)
    ).toBeNull();

    expect(() =>
      buildAgentPublicStartRequest(commonRequest, byokSettings, bindings, {
        providerId: "openai_compatible",
        providerConfig: { apiKey: "test-key" }
      })
    ).toThrow(NO_EXECUTION_BINDING_MESSAGE);
  });

  it("resolves local_cli Cursor to a matching external_cli_agent binding", () => {
    const { providerId, providerConfig } = resolveExecutionSettings(cursorCliSettings);
    const bindings = bindingsFixture({
      bindings: [
        {
          bindingId: "cursor_agent_binding",
          executionProfile: "external_cli_agent",
          engineId: "cursor-cli",
          engineAdapterId: "cursor-cli-v1",
          backendId: "cursor_subscription",
          modelId: "cursor-default"
        },
        {
          bindingId: "model_agent_default",
          executionProfile: "model_agent",
          engineId: "in-product-model-agent",
          engineAdapterId: "http-structured-replay-canary-v1",
          backendId: "openai_compatible",
          modelId: "gpt-test"
        }
      ]
    });

    const bindingId = resolveExecutionBindingId(
      bindings,
      cursorCliSettings,
      providerId,
      providerConfig
    );
    expect(bindingId).toBe("cursor_agent_binding");

    const request = buildAgentPublicStartRequest(commonRequest, cursorCliSettings, bindings, {
      providerId,
      providerConfig
    });

    expect(request).toEqual({
      ...commonRequest,
      executionBindingId: "cursor_agent_binding"
    });
    expect(request).not.toHaveProperty("providerId");
  });

  it("fails closed for local_cli when no external binding matches", () => {
    const { providerId, providerConfig } = resolveExecutionSettings(cursorCliSettings);
    const bindings = bindingsFixture({
      bindings: [
        {
          bindingId: "model_agent_default",
          executionProfile: "model_agent",
          engineId: "in-product-model-agent",
          engineAdapterId: "http-structured-replay-canary-v1",
          backendId: "openai_compatible",
          modelId: "gpt-test"
        }
      ]
    });

    expect(
      resolveExecutionBindingId(bindings, cursorCliSettings, providerId, providerConfig)
    ).toBeNull();

    expect(() => buildAgentPublicStartRequest(commonRequest, cursorCliSettings, bindings, {
      providerId,
      providerConfig
    })).toThrow(formatNoExternalExecutionBindingMessage("cursor_subscription"));
  });
});
