import { describe, expect, it } from "vitest";
import { CODING_AGENT_IDS } from "../../../packages/cli/src/agent-runtime";
import {
  BYOK_GATEWAY_PRESETS,
  CLI_AGENT_IDS,
  CLI_CATALOG,
  DEFAULT_EXECUTION_SETTINGS,
  applyGatewayPreset,
  applyLocalRunnerPreset,
  getCliCatalogEntry,
  getCustomGatewayPresetForProtocol,
  getGatewayPreset,
  listPresetsForProtocol,
  mergeCliModelOptions,
  persistedExecutionSettings
} from "./execution-mode-catalog";

describe("execution-mode-catalog", () => {
  it("covers all 21 CLI agents with required display metadata", () => {
    expect(CLI_CATALOG).toHaveLength(21);
    expect([...CLI_AGENT_IDS]).toEqual([...CODING_AGENT_IDS]);

    const ids = CLI_CATALOG.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(21);

    for (const entry of CLI_CATALOG) {
      expect(entry.displayName.trim().length).toBeGreaterThan(0);
      expect(entry.subtitle.trim().length).toBeGreaterThan(0);
      expect(entry.primaryCommand.trim().length).toBeGreaterThan(0);
      expect(entry.docsUrl.startsWith("http")).toBe(true);
      expect(entry.installHint.trim().length).toBeGreaterThan(0);
      expect(Array.isArray(entry.badges)).toBe(true);
      expect(entry.suggestedModels.length).toBeGreaterThan(0);
    }
  });

  it("includes suggested models for priority CLI agents", () => {
    expect(getCliCatalogEntry("claude").suggestedModels).toContain("claude-sonnet-4-5");
    expect(getCliCatalogEntry("codex").suggestedModels.length).toBeGreaterThan(0);
    expect(getCliCatalogEntry("gemini").suggestedModels).toContain("gemini-2.5-pro");
    expect(getCliCatalogEntry("cursor-agent").suggestedModels.length).toBeGreaterThan(0);
    expect(getCliCatalogEntry("opencode").suggestedModels.length).toBeGreaterThan(0);
    expect(getCliCatalogEntry("copilot").suggestedModels.length).toBeGreaterThan(0);
  });

  it("uses current default models and refreshed lists per BYOK preset", () => {
    const anthropic = getGatewayPreset("anthropic-claude");
    expect(anthropic.model).toBe("claude-sonnet-4-6");
    expect(anthropic.models[0]).toBe("claude-sonnet-4-6");
    expect(anthropic.models).toHaveLength(7);
    expect(anthropic.models).not.toContain("claude-sonnet-4-20250514");
    expect(anthropic.models).not.toContain("claude-opus-4-20250514");

    const openai = getGatewayPreset("openai-default");
    expect(openai.model).toBe("gpt-5.4-mini");
    expect(openai.models[0]).toBe("gpt-5.4");
    expect(openai.models).toHaveLength(16);
    expect(openai.models).toContain("gpt-5.2");
    expect(openai.models).toContain("codex-mini-latest");

    const azure = getGatewayPreset("azure-default");
    expect(azure.model).toBe("gpt-5.4-mini");
    expect(azure.deployment).toBe("gpt-5.4-mini");
    expect(azure.models).toEqual([
      "gpt-5.4-mini",
      "gpt-5.2",
      "gpt-5-mini",
      "gpt-4.1",
      "gpt-4.1-mini",
      "o4-mini",
      "o3"
    ]);

    const gemini = getGatewayPreset("gemini-default");
    expect(gemini.model).toBe("gemini-2.5-pro");
    expect(gemini.models).toContain("gemini-2.5-flash-lite");
    expect(gemini.models).toContain("gemini-3.1-pro-preview");
    expect(gemini.models).not.toContain("gemini-2.0-flash");

    const deepseek = getGatewayPreset("deepseek-anthropic");
    expect(deepseek.model).toBe("deepseek-v4-pro");
    expect(deepseek.models).toEqual(["deepseek-v4-pro", "deepseek-v4-flash"]);
    expect(deepseek.models).not.toContain("deepseek-chat");

    const minimax = getGatewayPreset("minimax-anthropic");
    expect(minimax.model).toBe("MiniMax-M3");
    expect(minimax.models[0]).toBe("MiniMax-M3");
    expect(minimax.models).toHaveLength(8);

    const aihubmix = getGatewayPreset("aihubmix");
    expect(aihubmix.model).toBe("gpt-5.4-mini");
    expect(aihubmix.models).toContain("claude-sonnet-4-6");
    expect(aihubmix.models).toContain("deepseek-v4-pro");
    expect(aihubmix.models).not.toContain("deepseek-chat");
  });

  it("merges suggested and discovered models with deduplication", () => {
    expect(
      mergeCliModelOptions(
        ["claude-sonnet-4-5", "claude-opus-4-5"],
        ["claude-sonnet-4-5", "claude-haiku-4-5"]
      )
    ).toEqual(["claude-sonnet-4-5", "claude-opus-4-5", "claude-haiku-4-5"]);
  });

  it("includes anthropic vendor presets and gateway presets", () => {
    const presetIds = BYOK_GATEWAY_PRESETS.map((preset) => preset.id);
    expect(presetIds).toEqual(
      expect.arrayContaining([
        "anthropic-claude",
        "custom",
        "deepseek-anthropic",
        "minimax-anthropic",
        "mimo-anthropic",
        "openai-default",
        "azure-default",
        "gemini-default",
        "ollama-cloud",
        "senseaudio",
        "aihubmix",
        "mock"
      ])
    );

    for (const preset of BYOK_GATEWAY_PRESETS) {
      expect(preset.label.trim().length).toBeGreaterThan(0);
      expect(preset.models.length).toBeGreaterThan(0);
      if (preset.id !== "mock") {
        expect(preset.model.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("provides default baseUrl, model, and optional maxTokens per preset", () => {
    const anthropic = getGatewayPreset("anthropic-claude");
    expect(anthropic.baseUrl).toBe("https://api.anthropic.com");
    expect(anthropic.model).toBe("claude-sonnet-4-6");
    expect(anthropic.maxTokens).toBe(64_000);

    const aihubmix = getGatewayPreset("aihubmix");
    expect(aihubmix.baseUrl).toBe("https://api.aihubmix.com/v1");
    expect(aihubmix.proxyProvider).toBe("openai");
    expect(aihubmix.gateway).toBe("aihubmix");
  });

  it("strips secret fields from persisted execution settings", () => {
    const persisted = persistedExecutionSettings({
      ...DEFAULT_EXECUTION_SETTINGS,
      apiKey: "secret",
      localApiKey: "local-secret"
    });
    expect(persisted).not.toHaveProperty("apiKey");
    expect(persisted).not.toHaveProperty("localApiKey");
    expect(persisted.executionMode).toBe(DEFAULT_EXECUTION_SETTINGS.executionMode);
  });

  it("applies gateway and local runner presets", () => {
    expect(applyGatewayPreset(DEFAULT_EXECUTION_SETTINGS, "anthropic-claude")).toMatchObject({
      executionMode: "byok",
      gatewayPresetId: "anthropic-claude",
      byokProtocol: "anthropic",
      baseUrl: "https://api.anthropic.com",
      model: "claude-sonnet-4-6"
    });

    expect(applyLocalRunnerPreset(DEFAULT_EXECUTION_SETTINGS, "custom_cli_json")).toMatchObject({
      executionMode: "local_cli",
      localRunnerPresetId: "custom_cli_json",
      runnerProviderId: "cli_stub",
      command: "vdt-model-adapter"
    });
  });

  it("preserves unrelated fields when switching presets", () => {
    const withLocalCliFields = {
      ...DEFAULT_EXECUTION_SETTINGS,
      executionMode: "local_cli" as const,
      selectedCliAgentId: "codex" as const,
      localRunnerPresetId: "ollama_openai" as const,
      runnerUrl: "http://127.0.0.1:8765",
      localBaseUrl: "http://127.0.0.1:11434/v1",
      localModel: "qwen3",
      memoryModelMode: "selected_cli" as const,
      memoryCliAgentId: "claude" as const
    };

    expect(applyGatewayPreset(withLocalCliFields, "aihubmix")).toMatchObject({
      executionMode: "byok",
      gatewayPresetId: "aihubmix",
      selectedCliAgentId: "codex",
      localRunnerPresetId: "ollama_openai",
      runnerUrl: "http://127.0.0.1:8765",
      memoryModelMode: "selected_cli",
      memoryCliAgentId: "claude"
    });

    const withByokFields = {
      ...DEFAULT_EXECUTION_SETTINGS,
      executionMode: "byok" as const,
      gatewayPresetId: "mock" as const,
      apiKey: "byok-key",
      memoryModelMode: "same_as_chat" as const
    };

    expect(applyLocalRunnerPreset(withByokFields, "vllm_openai")).toMatchObject({
      executionMode: "local_cli",
      localRunnerPresetId: "vllm_openai",
      gatewayPresetId: "mock",
      apiKey: "byok-key",
      memoryModelMode: "same_as_chat"
    });
  });

  it("applies protocol-specific defaults for custom preset", () => {
    expect(
      applyGatewayPreset(
        {
          ...DEFAULT_EXECUTION_SETTINGS,
          byokProtocol: "openai"
        },
        "custom"
      )
    ).toMatchObject({
      gatewayPresetId: "custom",
      byokProtocol: "openai",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-5.4-mini",
      customizeBaseUrl: true
    });

    expect(getCustomGatewayPresetForProtocol("anthropic")).toMatchObject({
      id: "custom",
      protocol: "anthropic",
      gateway: "none",
      baseUrl: "https://api.anthropic.com",
      model: "claude-sonnet-4-6",
      models: ["claude-sonnet-4-6"],
      anthropicVersion: "2023-06-01"
    });

    expect(getCustomGatewayPresetForProtocol("azure")).toMatchObject({
      id: "custom",
      protocol: "azure",
      gateway: "none",
      endpoint: "https://your-resource.openai.azure.com",
      deployment: "gpt-5.4-mini",
      model: "gpt-5.4-mini",
      models: ["gpt-5.4-mini"],
      apiVersion: "2024-10-21"
    });

    expect(getCustomGatewayPresetForProtocol("gemini")).toMatchObject({
      id: "custom",
      protocol: "gemini",
      gateway: "none",
      baseUrl: "https://generativelanguage.googleapis.com",
      model: "gemini-2.5-pro",
      models: ["gemini-2.5-pro"]
    });
  });

  it("lists custom provider preset for every direct protocol", () => {
    for (const protocol of ["anthropic", "openai", "azure", "gemini"] as const) {
      const presetIds = listPresetsForProtocol(protocol).map((preset) => preset.id);
      expect(presetIds).toContain("custom");
    }
  });
});
