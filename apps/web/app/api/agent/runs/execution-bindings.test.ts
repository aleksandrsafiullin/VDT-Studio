import type { AgentCapabilityProfile } from "@vdt-studio/vdt-agent-runtime";
import { describe, expect, it } from "vitest";
import {
  AgentExecutionBindingError,
  AgentExecutionBindingRegistry,
  DEFAULT_MODEL_AGENT_EXECUTION_BINDING_ID,
  createDefaultModelAgentExecutionBinding,
  isLegacyModelExecutionBinding,
  isStructuredModelExecutionBinding,
  type ModelAgentExecutionBindingDefinition
} from "./execution-bindings";

const HASH = `sha256:${"a".repeat(64)}`;

const modelCapability: Extract<AgentCapabilityProfile, { executionProfile: "model_agent" }> = {
  schemaVersion: 1,
  executionProfile: "model_agent",
  engineId: "in-product-model-agent",
  engineAdapterId: "legacy-micro-cli-compat-v1",
  backendId: "mock",
  protocolVersion: "structured-turn-v1",
  sessionStrategy: "structured_turn",
  toolCatalogHash: HASH,
  toolIsolation: "permission_only",
  qualification: {
    status: "unverified",
    platform: { os: "test", arch: "test", runtimeVersion: "node-test" },
    testedAt: null,
    evidenceHash: null
  },
  supportsNativeSession: false,
  supportsResume: true,
  supportsStructuredEvents: true,
  supportsToolBridge: true,
  supportsQuestions: true,
  supportsCancellation: true,
  supportsUsageMetrics: true,
  cli: null
};

const structuredModelCapability: Extract<AgentCapabilityProfile, { executionProfile: "model_agent" }> = {
  ...modelCapability,
  engineAdapterId: "http-structured-turn-v1",
  backendId: "openai_compatible",
  supportsResume: false
};

function modelBinding(
  overrides: Partial<ModelAgentExecutionBindingDefinition> = {}
): ModelAgentExecutionBindingDefinition {
  return {
    bindingId: "model_agent_test",
    enabled: true,
    modelId: "deterministic-test-model",
    capability: modelCapability,
    legacyCompatibilityAdapter: {
      providerId: "mock",
      providerConfig: { maxTokens: 2_000 }
    },
    ...overrides
  };
}

describe("AgentExecutionBindingRegistry", () => {
  it("registers the server default but keeps the production structured-replay canary disabled without opt-in", () => {
    const definition = createDefaultModelAgentExecutionBinding({
      env: {
        NODE_ENV: "production",
        OPENAI_COMPATIBLE_MODEL: "server-model"
      },
      toolCatalogHash: HASH,
      platform: { os: "test", arch: "test", runtimeVersion: "node-test" }
    });
    const registry = new AgentExecutionBindingRegistry([definition]);

    expect(registry.has(DEFAULT_MODEL_AGENT_EXECUTION_BINDING_ID)).toBe(true);
    expect(registry.summaries()).toEqual([]);
    expect(() => registry.resolve(DEFAULT_MODEL_AGENT_EXECUTION_BINDING_ID)).toThrowError(
      expect.objectContaining({ code: "BINDING_DISABLED" })
    );
    expect(definition).toMatchObject({
      enabled: false,
      modelId: "server-model",
      capability: {
        executionProfile: "model_agent",
        engineAdapterId: "http-structured-replay-canary-v1",
        supportsNativeSession: false,
        supportsResume: false,
        qualification: { status: "unverified" }
      },
      modelEngineAdapter: { providerId: "openai_compatible" }
    });
  });

  it("enables only an explicitly opted-in server-owned Model Agent binding", () => {
    const definition = createDefaultModelAgentExecutionBinding({
      env: {
        NODE_ENV: "production",
        VDT_MODEL_AGENT_ENABLED: "true",
        VDT_MODEL_AGENT_PROVIDER: "anthropic",
        VDT_MODEL_AGENT_MODEL: "server-owned-claude",
        VDT_MODEL_AGENT_MAX_TOKENS: "4096",
        VDT_MODEL_AGENT_TEMPERATURE: "0.1"
      },
      toolCatalogHash: HASH,
      platform: { os: "test", arch: "test", runtimeVersion: "node-test" }
    });
    const registry = new AgentExecutionBindingRegistry([definition]);
    const resolved = registry.resolve(DEFAULT_MODEL_AGENT_EXECUTION_BINDING_ID);

    expect(isStructuredModelExecutionBinding(resolved)).toBe(true);
    if (!isStructuredModelExecutionBinding(resolved)) throw new Error("Expected structured Model Agent binding.");
    expect(resolved).toMatchObject({
      enabled: true,
      modelId: "server-owned-claude",
      modelEngineAdapter: {
        providerId: "anthropic",
        maxTokens: 4096,
        temperature: 0.1
      }
    });
    expect(resolved).not.toHaveProperty("legacyCompatibilityAdapter");
    expect(resolved.modelEngineAdapter).not.toHaveProperty("providerConfig");
  });

  it("uses an enabled deterministic mock default only in the test runtime", () => {
    const definition = createDefaultModelAgentExecutionBinding({
      env: { NODE_ENV: "test" },
      toolCatalogHash: HASH,
      platform: { os: "test", arch: "test", runtimeVersion: "node-test" }
    });

    expect(definition).toMatchObject({
      bindingId: DEFAULT_MODEL_AGENT_EXECUTION_BINDING_ID,
      enabled: true,
      modelId: "deterministic-test-model",
      modelEngineAdapter: { providerId: "mock" }
    });
  });

  it("resolves an immutable server-owned model binding", () => {
    const source = modelBinding();
    const registry = new AgentExecutionBindingRegistry([source]);
    const resolved = registry.resolve(source.bindingId);

    expect(resolved).toMatchObject({
      bindingId: "model_agent_test",
      capability: {
        executionProfile: "model_agent",
        engineAdapterId: "legacy-micro-cli-compat-v1"
      }
    });
    if (!isLegacyModelExecutionBinding(resolved)) throw new Error("Expected model binding.");
    (resolved.legacyCompatibilityAdapter.providerConfig as Record<string, unknown>).maxTokens = 1;
    expect(registry.resolve(source.bindingId)).toMatchObject({
      legacyCompatibilityAdapter: { providerConfig: { maxTokens: 2_000 } }
    });
  });

  it("fails closed for unknown, disabled, and reused binding IDs", () => {
    const registry = new AgentExecutionBindingRegistry();
    expect(() => registry.resolve("missing")).toThrowError(AgentExecutionBindingError);

    registry.register(modelBinding({ bindingId: "disabled", enabled: false }));
    expect(() => registry.resolve("disabled")).toThrowError(
      expect.objectContaining({ code: "BINDING_DISABLED" })
    );

    const dispose = registry.register(modelBinding({ bindingId: "immutable" }));
    dispose();
    expect(() => registry.register(modelBinding({ bindingId: "immutable" }))).toThrowError(
      expect.objectContaining({ code: "BINDING_ALREADY_REGISTERED" })
    );
  });

  it("rejects a model compatibility binding that would launch a subscription CLI", () => {
    expect(() => new AgentExecutionBindingRegistry([modelBinding({
      bindingId: "forbidden_cli",
      legacyCompatibilityAdapter: {
        providerId: "local_runner",
        providerConfig: { backendId: "cursor_subscription" }
      }
    })])).toThrowError(expect.objectContaining({
      code: "MODEL_BINDING_CLI_COMPATIBILITY_FORBIDDEN"
    }));
  });

  it("keeps structured Model Agent bindings distinct from compatibility adapters", () => {
    const registry = new AgentExecutionBindingRegistry([{
      bindingId: "structured_model",
      enabled: true,
      modelId: "server-model",
      capability: structuredModelCapability,
      modelEngineAdapter: {
        providerId: "openai_compatible",
        providerConfig: { baseUrl: "https://models.example.test/v1", model: "server-model" }
      }
    }]);

    expect(registry.resolve("structured_model")).toMatchObject({
      modelEngineAdapter: { providerId: "openai_compatible" },
      capability: { engineAdapterId: "http-structured-turn-v1" }
    });
    expect(() => new AgentExecutionBindingRegistry([{
      bindingId: "structured_with_cli_fields",
      enabled: true,
      modelId: "server-model",
      capability: structuredModelCapability,
      modelEngineAdapter: {
        providerId: "openai_compatible",
        providerConfig: { backendId: "cursor_subscription" }
      }
    }])).toThrowError(expect.objectContaining({ code: "BINDING_INVALID" }));
  });

  it("rejects crash-resume claims until the private semantic checkpoint is durable", () => {
    expect(() => new AgentExecutionBindingRegistry([{
      bindingId: "structured_with_unsafe_resume",
      enabled: true,
      modelId: "server-model",
      capability: {
        ...structuredModelCapability,
        supportsResume: true
      },
      modelEngineAdapter: {
        providerId: "openai_compatible",
        providerConfig: { baseUrl: "https://models.example.test/v1", model: "server-model" }
      }
    }])).toThrowError(expect.objectContaining({
      code: "BINDING_INVALID",
      message: expect.stringContaining("cannot advertise crash resume")
    }));
  });

  it("requires the durable backend identity to exactly match the structured provider adapter", () => {
    expect(() => new AgentExecutionBindingRegistry([{
      bindingId: "azure_adapter_with_openai_backend",
      enabled: true,
      modelId: "server-model",
      capability: structuredModelCapability,
      modelEngineAdapter: {
        providerId: "azure_openai",
        providerConfig: { baseUrl: "https://models.example.test", deployment: "server-model" }
      }
    }])).toThrowError(expect.objectContaining({
      code: "BINDING_INVALID",
      message: expect.stringContaining("backendId must exactly match")
    }));

    expect(() => new AgentExecutionBindingRegistry([{
      bindingId: "openai_adapter_with_azure_backend",
      enabled: true,
      modelId: "server-model",
      capability: {
        ...structuredModelCapability,
        backendId: "azure_openai"
      },
      modelEngineAdapter: {
        providerId: "openai_compatible",
        providerConfig: { baseUrl: "https://models.example.test/v1", model: "server-model" }
      }
    }])).toThrowError(expect.objectContaining({
      code: "BINDING_INVALID",
      message: expect.stringContaining("backendId must exactly match")
    }));

    const azureRegistry = new AgentExecutionBindingRegistry([{
      bindingId: "exact_azure_backend",
      enabled: true,
      modelId: "server-model",
      capability: {
        ...structuredModelCapability,
        backendId: "azure_openai"
      },
      modelEngineAdapter: {
        providerId: "azure_openai",
        providerConfig: { baseUrl: "https://models.example.test", deployment: "server-model" }
      }
    }]);
    expect(azureRegistry.resolve("exact_azure_backend")).toMatchObject({
      capability: { backendId: "azure_openai" },
      modelEngineAdapter: { providerId: "azure_openai" }
    });
  });

  it("does not register or expose an external binding without actual host wiring", () => {
    const externalCapability: Extract<AgentCapabilityProfile, { executionProfile: "external_cli_agent" }> = {
      ...modelCapability,
      executionProfile: "external_cli_agent",
      engineId: "cursor-acp",
      engineAdapterId: "cursor-acp-v1",
      backendId: "cursor_subscription",
      protocolVersion: "acp-v1",
      sessionStrategy: "native",
      supportsNativeSession: true,
      toolIsolation: "hard_verified",
      qualification: {
        ...modelCapability.qualification,
        status: "qualified",
        testedAt: "2026-08-26T00:00:00.000Z",
        evidenceHash: HASH
      },
      cli: { name: "cursor-agent", version: "1.0.0" }
    };
    const definition = {
      bindingId: "cursor_external",
      enabled: true,
      modelId: "grok",
      capability: externalCapability,
      currentQualification: {
        engineAdapterId: "cursor-acp-v1",
        backendId: "cursor_subscription",
        cliVersion: "1.0.0",
        protocolVersion: "acp-v1",
        toolCatalogHash: HASH,
        platform: externalCapability.qualification.platform
      }
    } as const;

    expect(() => new AgentExecutionBindingRegistry([definition])).toThrowError(
      expect.objectContaining({ code: "EXTERNAL_ENGINE_NOT_WIRED" })
    );

    const defaultOff = new AgentExecutionBindingRegistry([definition], {
      externalEngineWired: true
    });
    expect(defaultOff.summaries()).toEqual([]);
    expect(() => defaultOff.resolve("cursor_external")).toThrowError(
      expect.objectContaining({ code: "EXTERNAL_PROFILE_DISABLED" })
    );
  });
});
