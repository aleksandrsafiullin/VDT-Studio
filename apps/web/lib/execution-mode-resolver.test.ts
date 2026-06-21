import { describe, expect, it } from "vitest";
import { DEFAULT_EXECUTION_SETTINGS } from "./execution-mode-catalog";
import {
  migrateLegacyProviderToExecutionSettings,
  migratePersistedStateToV2,
  reconcilePersistedExecutionSettings,
  resolveExecutionSettings,
  syncLegacyProviderFromExecutionSettings,
  validateExecutionForGenerate
} from "./execution-mode-resolver";

describe("execution-mode-resolver", () => {
  it("resolves mock BYOK execution to mock provider", () => {
    expect(
      resolveExecutionSettings({
        ...DEFAULT_EXECUTION_SETTINGS,
        executionMode: "byok",
        useMockProvider: true,
        gatewayPresetId: "mock"
      })
    ).toEqual({ providerId: "mock" });
  });

  it("routes subscription CLI execution through the local runner", () => {
    expect(
      resolveExecutionSettings({
        ...DEFAULT_EXECUTION_SETTINGS,
        executionMode: "local_cli",
        selectedCliAgentId: "claude",
        localRunnerPresetId: "custom_cli_json",
        runnerProviderId: "cli_stub",
        command: "/usr/local/bin/claude",
        runnerUrl: "http://127.0.0.1:8765",
        timeoutSec: 60
      })
    ).toEqual({
      providerId: "local_runner",
      providerConfig: {
        runnerUrl: "http://127.0.0.1:8765",
        backendId: "claude_subscription",
        model: undefined,
        timeoutMs: 60_000
      }
    });
  });

  it("resolves local_cli HTTP preset to local_runner provider", () => {
    expect(
      resolveExecutionSettings({
        ...DEFAULT_EXECUTION_SETTINGS,
        executionMode: "local_cli",
        localRunnerPresetId: "ollama_openai",
        runnerUrl: "http://127.0.0.1:8765",
        localBaseUrl: "http://127.0.0.1:11434/v1",
        localModel: "qwen3",
        localApiKey: "local-key"
      })
    ).toEqual({
      providerId: "local_runner",
      providerConfig: {
        runnerUrl: "http://127.0.0.1:8765",
        backendId: "ollama",
        model: "qwen3",
        timeoutMs: 60_000
      }
    });
  });

  it("falls back to HTTP catalog defaults when cli_stub is set on an HTTP preset", () => {
    expect(
      resolveExecutionSettings({
        ...DEFAULT_EXECUTION_SETTINGS,
        executionMode: "local_cli",
        localRunnerPresetId: "ollama_openai",
        runnerProviderId: "cli_stub",
        command: "ollama",
        localBaseUrl: "http://127.0.0.1:11434/v1",
        localModel: "qwen3"
      })
    ).toEqual({
      providerId: "local_runner",
      providerConfig: {
        runnerUrl: "http://127.0.0.1:8765",
        backendId: "ollama",
        model: "qwen3",
        timeoutMs: 60_000
      }
    });
  });

  it("blocks generation when a required CLI agent is not installed", () => {
    expect(
      validateExecutionForGenerate(
        {
          ...DEFAULT_EXECUTION_SETTINGS,
          executionMode: "local_cli",
          selectedCliAgentId: "claude",
          localRunnerPresetId: "custom_cli_json",
          runnerProviderId: "cli_stub",
          command: "claude"
        },
        [{ id: "claude", installed: false }]
      )
    ).toContain("Claude Code is not installed");
  });

  it("allows cli_stub generation when CLI detection has not run yet", () => {
    expect(
      validateExecutionForGenerate(
        {
          ...DEFAULT_EXECUTION_SETTINGS,
          executionMode: "local_cli",
          selectedCliAgentId: "claude",
          localRunnerPresetId: "custom_cli_json",
          runnerProviderId: "cli_stub",
          command: "claude"
        },
        undefined
      )
    ).toBeUndefined();
  });

  it("allows cli_stub generation when CLI scan failed with empty detection array", () => {
    expect(
      validateExecutionForGenerate(
        {
          ...DEFAULT_EXECUTION_SETTINGS,
          executionMode: "local_cli",
          selectedCliAgentId: "claude",
          localRunnerPresetId: "custom_cli_json",
          runnerProviderId: "cli_stub",
          command: "claude"
        },
        []
      )
    ).toBeUndefined();
  });

  it("allows cli_stub generation when detection scan found the agent installed", () => {
    expect(
      validateExecutionForGenerate(
        {
          ...DEFAULT_EXECUTION_SETTINGS,
          executionMode: "local_cli",
          selectedCliAgentId: "claude",
          localRunnerPresetId: "custom_cli_json",
          runnerProviderId: "cli_stub",
          command: "claude"
        },
        [{ id: "claude", installed: true }]
      )
    ).toBeUndefined();
  });

  it("allows HTTP presets when no CLI agent is installed", () => {
    expect(
      validateExecutionForGenerate(
        {
          ...DEFAULT_EXECUTION_SETTINGS,
          executionMode: "local_cli",
          localRunnerPresetId: "ollama_openai",
          runnerProviderId: "local_http_stub"
        },
        [{ id: "claude", installed: false }]
      )
    ).toBeUndefined();
  });

  it("resolves openai_compatible BYOK settings", () => {
    expect(
      resolveExecutionSettings({
        ...DEFAULT_EXECUTION_SETTINGS,
        executionMode: "byok",
        useMockProvider: false,
        gatewayPresetId: "aihubmix",
        byokProtocol: "openai",
        byokGateway: "aihubmix",
        baseUrl: "https://api.aihubmix.com/v1",
        model: "gpt-4.1-mini",
        apiKey: "byok-key"
      })
    ).toEqual({
      providerId: "openai_compatible",
      providerConfig: {
        baseUrl: "https://api.aihubmix.com/v1",
        model: "gpt-4.1-mini",
        maxTokens: 32_768,
        apiKey: "byok-key"
      }
    });
  });

  it("ignores stale baseUrl when customizeBaseUrl is false", () => {
    expect(
      resolveExecutionSettings({
        ...DEFAULT_EXECUTION_SETTINGS,
        executionMode: "byok",
        useMockProvider: false,
        gatewayPresetId: "openai-default",
        byokProtocol: "openai",
        customizeBaseUrl: false,
        baseUrl: "https://stale.example.com/v1",
        model: "gpt-4.1-mini",
        apiKey: "byok-key"
      }).providerConfig
    ).toMatchObject({
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4.1-mini",
      apiKey: "byok-key"
    });
  });

  it("uses custom maxTokens override in providerConfig", () => {
    expect(
      resolveExecutionSettings({
        ...DEFAULT_EXECUTION_SETTINGS,
        executionMode: "byok",
        useMockProvider: false,
        gatewayPresetId: "anthropic-claude",
        byokProtocol: "anthropic",
        baseUrl: "https://api.anthropic.com",
        model: "claude-sonnet-4-5",
        maxTokens: 12_000,
        apiKey: "anthropic-key"
      }).providerConfig
    ).toMatchObject({
      maxTokens: 12_000
    });
  });

  it("resolves anthropic BYOK settings", () => {
    expect(
      resolveExecutionSettings({
        ...DEFAULT_EXECUTION_SETTINGS,
        executionMode: "byok",
        useMockProvider: false,
        gatewayPresetId: "deepseek-anthropic",
        byokProtocol: "anthropic",
        byokGateway: "none",
        baseUrl: "https://api.deepseek.com/anthropic",
        model: "deepseek-chat",
        apiKey: "anthropic-key",
        anthropicVersion: "2023-06-01"
      })
    ).toEqual({
      providerId: "anthropic",
      providerConfig: {
        baseUrl: "https://api.deepseek.com/anthropic",
        model: "deepseek-chat",
        apiKey: "anthropic-key",
        anthropicVersion: "2023-06-01",
        maxTokens: 64_000
      }
    });
  });

  it("uses catalog fallback models when BYOK model is omitted", () => {
    expect(
      resolveExecutionSettings({
        ...DEFAULT_EXECUTION_SETTINGS,
        executionMode: "byok",
        useMockProvider: false,
        gatewayPresetId: "openai-default",
        byokProtocol: "openai",
        model: undefined,
        apiKey: "byok-key"
      }).providerConfig
    ).toMatchObject({
      model: "gpt-5.5"
    });

    expect(
      resolveExecutionSettings({
        ...DEFAULT_EXECUTION_SETTINGS,
        executionMode: "byok",
        useMockProvider: false,
        gatewayPresetId: "anthropic-claude",
        byokProtocol: "anthropic",
        model: undefined,
        apiKey: "anthropic-key"
      }).providerConfig
    ).toMatchObject({
      model: "claude-sonnet-4-6"
    });
  });

  it("resolves azure_openai BYOK settings", () => {
    expect(
      resolveExecutionSettings({
        ...DEFAULT_EXECUTION_SETTINGS,
        executionMode: "byok",
        useMockProvider: false,
        gatewayPresetId: "azure-default",
        byokProtocol: "azure",
        endpoint: "https://my-resource.openai.azure.com",
        deployment: "gpt-4.1",
        apiVersion: "2024-10-21",
        apiKey: "azure-key"
      })
    ).toEqual({
      providerId: "azure_openai",
      providerConfig: {
        endpoint: "https://my-resource.openai.azure.com",
        deployment: "gpt-4.1",
        model: "gpt-4.1",
        apiVersion: "2024-10-21",
        apiKey: "azure-key",
        maxTokens: 32_768
      }
    });
  });

  it("resolves gemini BYOK settings", () => {
    expect(
      resolveExecutionSettings({
        ...DEFAULT_EXECUTION_SETTINGS,
        executionMode: "byok",
        useMockProvider: false,
        gatewayPresetId: "gemini-default",
        byokProtocol: "gemini",
        baseUrl: "https://generativelanguage.googleapis.com",
        model: "gemini-2.5-pro",
        apiKey: "gemini-key"
      })
    ).toEqual({
      providerId: "gemini",
      providerConfig: {
        baseUrl: "https://generativelanguage.googleapis.com",
        model: "gemini-2.5-pro",
        apiKey: "gemini-key",
        maxTokens: 65_536
      }
    });
  });

  it("migrates legacy provider state into execution settings", () => {
    expect(migrateLegacyProviderToExecutionSettings("mock", {})).toMatchObject({
      executionMode: "byok",
      gatewayPresetId: "mock",
      useMockProvider: true
    });

    expect(
      migrateLegacyProviderToExecutionSettings("local_runner", {
        localRunnerPresetId: "vllm_openai",
        runnerUrl: "http://127.0.0.1:9000",
        localBaseUrl: "http://127.0.0.1:8000/v1",
        localModel: "local-model",
        timeoutSec: 90
      })
    ).toMatchObject({
      executionMode: "local_cli",
      localRunnerPresetId: "vllm_openai",
      runnerUrl: "http://127.0.0.1:9000",
      localBaseUrl: "http://127.0.0.1:8000/v1",
      localModel: "local-model",
      timeoutSec: 90
    });

    expect(
      migrateLegacyProviderToExecutionSettings("openai_compatible", {
        openAiBaseUrl: "https://api.aihubmix.com/v1",
        openAiModel: "gpt-4.1"
      })
    ).toMatchObject({
      executionMode: "byok",
      gatewayPresetId: "aihubmix",
      baseUrl: "https://api.aihubmix.com/v1",
      model: "gpt-4.1"
    });

    expect(
      migrateLegacyProviderToExecutionSettings("anthropic", {
        anthropicBaseUrl: "https://api.anthropic.com",
        anthropicModel: "claude-opus-4-5"
      })
    ).toMatchObject({
      executionMode: "byok",
      gatewayPresetId: "anthropic-claude",
      baseUrl: "https://api.anthropic.com",
      model: "claude-opus-4-5"
    });
  });

  it("migrates persisted v1 state to executionSettings on hydrate", () => {
    expect(
      migratePersistedStateToV2({
        providerId: "mock",
        providerConfig: {
          openAiBaseUrl: "https://api.openai.com/v1"
        }
      })
    ).toMatchObject({
      providerId: "mock",
      executionSettings: {
        executionMode: "byok",
        gatewayPresetId: "mock",
        useMockProvider: true
      }
    });
  });

  it("reconciles stale default mock execution settings from legacy providerId", () => {
    expect(
      reconcilePersistedExecutionSettings(
        "anthropic",
        { anthropicBaseUrl: "https://api.anthropic.com", anthropicModel: "claude-opus-4-5" },
        { ...DEFAULT_EXECUTION_SETTINGS }
      )
    ).toMatchObject({
      executionMode: "byok",
      gatewayPresetId: "anthropic-claude",
      baseUrl: "https://api.anthropic.com",
      model: "claude-opus-4-5"
    });
  });

  it("keeps non-stale execution settings over legacy providerId", () => {
    expect(
      reconcilePersistedExecutionSettings(
        "mock",
        {},
        {
          ...DEFAULT_EXECUTION_SETTINGS,
          useMockProvider: false,
          gatewayPresetId: "aihubmix",
          baseUrl: "https://api.aihubmix.com/v1",
          model: "gpt-4.1-mini"
        }
      )
    ).toMatchObject({
      gatewayPresetId: "aihubmix",
      baseUrl: "https://api.aihubmix.com/v1"
    });
  });

  it("syncs legacy provider command from local_cli cli_stub settings", () => {
    expect(
      syncLegacyProviderFromExecutionSettings(
        {
          ...DEFAULT_EXECUTION_SETTINGS,
          executionMode: "local_cli",
          selectedCliAgentId: "claude",
          localRunnerPresetId: "custom_cli_json",
          runnerProviderId: "cli_stub",
          command: "/opt/homebrew/bin/claude",
          runnerUrl: "http://127.0.0.1:8765",
          timeoutSec: 60
        },
        {}
      )
    ).toMatchObject({
      providerId: "local_runner",
      providerConfig: {
        localRunnerPresetId: "custom_cli_json",
        runnerProviderId: "cli_stub",
        command: "/opt/homebrew/bin/claude",
        runnerUrl: "http://127.0.0.1:8765",
        timeoutSec: 60
      }
    });
  });

  it("syncs legacy provider fields from execution settings", () => {
    expect(
      syncLegacyProviderFromExecutionSettings(
        {
          ...DEFAULT_EXECUTION_SETTINGS,
          executionMode: "local_cli",
          localRunnerPresetId: "vllm_openai",
          runnerUrl: "http://127.0.0.1:9000",
          localBaseUrl: "http://127.0.0.1:8000/v1",
          localModel: "local-model"
        },
        {}
      )
    ).toEqual({
      providerId: "local_runner",
      providerConfig: {
        localRunnerPresetId: "vllm_openai",
        runnerUrl: "http://127.0.0.1:9000",
        runnerProviderId: "local_http_stub",
        localBaseUrl: "http://127.0.0.1:8000/v1",
        localModel: "local-model",
        timeoutSec: 60
      }
    });

    expect(
      syncLegacyProviderFromExecutionSettings(
        {
          ...DEFAULT_EXECUTION_SETTINGS,
          executionMode: "byok",
          useMockProvider: false,
          gatewayPresetId: "gemini-default",
          byokProtocol: "gemini",
          baseUrl: "https://generativelanguage.googleapis.com",
          model: "gemini-2.5-pro",
          apiKey: "session-key"
        },
        { apiKey: "session-key" }
      )
    ).toMatchObject({
      providerId: "gemini",
      providerConfig: {
        geminiBaseUrl: "https://generativelanguage.googleapis.com",
        geminiModel: "gemini-2.5-pro",
        apiKey: "session-key"
      }
    });
  });

  it("migrates stale executionSettings when providerId disagrees", () => {
    expect(
      migratePersistedStateToV2({
        providerId: "openai_compatible",
        providerConfig: {
          openAiBaseUrl: "https://api.aihubmix.com/v1",
          openAiModel: "gpt-4.1"
        },
        executionSettings: { ...DEFAULT_EXECUTION_SETTINGS }
      })
    ).toMatchObject({
      providerId: "openai_compatible",
      executionSettings: {
        gatewayPresetId: "aihubmix",
        baseUrl: "https://api.aihubmix.com/v1",
        model: "gpt-4.1"
      },
      providerConfig: {
        openAiBaseUrl: "https://api.aihubmix.com/v1",
        openAiModel: "gpt-4.1"
      }
    });
  });
});
