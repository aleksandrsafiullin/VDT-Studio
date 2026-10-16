import { describe, expect, it } from "vitest";
import { DEFAULT_EXECUTION_SETTINGS } from "./execution-mode-catalog";
import { resolveExecutionCategory, resolveSavedLocalModelSelection, selectExecutionCategory, selectLocalModelPreset } from "./execution-category";

describe("execution categories", () => {
  it("separates effective CLI, HTTP and API backends, including legacy mismatches", () => {
    expect(resolveExecutionCategory(DEFAULT_EXECUTION_SETTINGS)).toBe("byok");
    expect(resolveExecutionCategory({ ...DEFAULT_EXECUTION_SETTINGS, executionMode: "local_cli" })).toBe("local_models");
    expect(resolveExecutionCategory({ ...DEFAULT_EXECUTION_SETTINGS, executionMode: "local_cli", runnerProviderId: "cli_stub", localRunnerPresetId: "custom_cli_json" })).toBe("cli_subscriptions");
    expect(resolveExecutionCategory({ ...DEFAULT_EXECUTION_SETTINGS, executionMode: "local_cli", runnerProviderId: "cli_stub", localRunnerPresetId: "ollama_openai", selectedCliAgentId: "claude" })).toBe("local_models");
  });

  it("selects CLI explicitly without activating the default local server", () => {
    const settings = selectExecutionCategory(DEFAULT_EXECUTION_SETTINGS, "cli_subscriptions");
    expect(settings).toMatchObject({ executionMode: "local_cli", runnerProviderId: "cli_stub", localRunnerPresetId: "custom_cli_json" });
    expect(settings.selectedCliAgentId).toBeUndefined();
    expect(resolveExecutionCategory(settings)).toBe("cli_subscriptions");
  });

  it("restores the last HTTP server/model across CLI and API tab switches", () => {
    const local = { ...DEFAULT_EXECUTION_SETTINGS, executionMode: "local_cli" as const, localRunnerPresetId: "lm_studio_openai" as const, localModel: "saved-local-model", selectedCliAgentId: "codex" as const, cliModelSelection: { source: "custom" as const, customModel: "saved-cloud-model" }, memoryModelMode: "selected_cli" as const, memoryCliAgentId: "claude" as const };
    const cli = selectExecutionCategory(local, "cli_subscriptions");
    expect(cli.cliModelSelection?.customModel).toBe("saved-cloud-model");
    const api = selectExecutionCategory(cli, "byok");
    const restored = selectExecutionCategory(api, "local_models");
    expect(restored).toMatchObject({ localRunnerPresetId: "lm_studio_openai", runnerProviderId: "local_http_stub", localModel: "saved-local-model", memoryModelMode: "selected_cli", memoryCliAgentId: "claude" });
    expect(restored.selectedCliAgentId).toBe("codex");
    expect(resolveExecutionCategory(restored)).toBe("local_models");
  });

  it("preserves the chosen model on the same server and resets it when choosing a different server", () => {
    const settings = { ...DEFAULT_EXECUTION_SETTINGS, localRunnerPresetId: "ollama_openai" as const, localModel: "ollama-only-model" };
    expect(selectLocalModelPreset(settings, "ollama_openai").localModel).toBe("ollama-only-model");
    expect(selectLocalModelPreset(settings, "lm_studio_openai").localModel).toBe("local-model");
  });

  it("infers legacy saved server choices from preset or base URL before defaulting", () => {
    expect(resolveSavedLocalModelSelection({ ...DEFAULT_EXECUTION_SETTINGS, localRunnerPresetId: "vllm_openai", localModel: "legacy-vllm" })).toEqual({ presetId: "vllm_openai", model: "legacy-vllm" });
    expect(resolveSavedLocalModelSelection({ ...DEFAULT_EXECUTION_SETTINGS, localRunnerPresetId: "custom_cli_json", localBaseUrl: "http://127.0.0.1:1234/v1", localModel: "legacy-lm-model" })).toEqual({ presetId: "lm_studio_openai", model: "legacy-lm-model" });
  });

  it("never reselects removed subscriptions while switching categories", () => {
    const settings = selectExecutionCategory({ ...DEFAULT_EXECUTION_SETTINGS, selectedCliAgentId: "claude" }, "cli_subscriptions", [], ["claude"]);
    expect(settings.selectedCliAgentId).toBeUndefined();
    expect(settings.command).toBeUndefined();
  });
});
