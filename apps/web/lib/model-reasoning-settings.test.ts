import { describe, expect, it } from "vitest";
import { modelReasoningKey } from "@vdt-studio/ai-harness/browser";
import { DEFAULT_EXECUTION_SETTINGS, persistedExecutionSettings } from "./execution-mode-catalog";
import { resolveExecutionSettings } from "./execution-mode-resolver";
import { configureLocalReasoning, selectExecutionCategory } from "./execution-category";
import { FAST_LOCAL_REASONING } from "@vdt-studio/model-bridge/reasoning";

describe("model-specific reasoning preferences", () => {
  it("seeds Fast only for a new local model and preserves explicit or legacy Default", () => {
    const selected = selectExecutionCategory(DEFAULT_EXECUTION_SETTINGS, "local_models");
    expect(resolveExecutionSettings(selected).providerConfig?.modelReasoning).toBe(FAST_LOCAL_REASONING);
    const legacy = { ...selected, localFastDefaultsByModel: undefined, modelReasoningBySource: undefined };
    expect(resolveExecutionSettings(legacy).providerConfig).not.toHaveProperty("modelReasoning");
    const next = configureLocalReasoning(legacy, { ...legacy, localModel: "other-model" });
    expect(resolveExecutionSettings(next).providerConfig?.modelReasoning).toBe(FAST_LOCAL_REASONING);
    expect(resolveExecutionSettings(configureLocalReasoning(next, { ...next, localModel: legacy.localModel })).providerConfig)
      .not.toHaveProperty("modelReasoning");
    const current = resolveExecutionSettings(next);
    const key = modelReasoningKey(current.providerId, current.providerConfig);
    const explicit = { ...next, modelReasoningBySource: { ...next.modelReasoningBySource, [key]: null } };
    expect(resolveExecutionSettings(configureLocalReasoning(explicit, explicit)).providerConfig).not.toHaveProperty("modelReasoning");
  });
  it.each(["byok", "cli_subscriptions"] as const)("uses Fast on first Local setup after visiting %s", category => {
    const previous = selectExecutionCategory(DEFAULT_EXECUTION_SETTINGS, category);
    expect(previous.savedLocalModelSelection).toBeUndefined();
    const selected = selectExecutionCategory(previous, "local_models");
    expect(resolveExecutionSettings(selected).providerConfig?.modelReasoning).toBe(FAST_LOCAL_REASONING);
  });
  it("persists a choice separately from credentials and restores it for the exact API model/endpoint", () => {
    const settings = { ...DEFAULT_EXECUTION_SETTINGS, model: "current-model", apiKey: "private-key" };
    const execution = resolveExecutionSettings(settings);
    const key = modelReasoningKey(execution.providerId, execution.providerConfig);
    const selected = { ...settings, modelReasoningBySource: { [key]: "high" } };
    const saved = JSON.parse(JSON.stringify(persistedExecutionSettings(selected)));
    expect(JSON.stringify(saved)).not.toContain("private-key");
    expect(resolveExecutionSettings(saved).providerConfig?.modelReasoning).toBe("high");
    expect(resolveExecutionSettings({ ...selected, model: "another-model" }).providerConfig).not.toHaveProperty("modelReasoning");
    expect(resolveExecutionSettings({ ...selected, customizeBaseUrl: true, baseUrl: "https://another.test/v1" }).providerConfig).not.toHaveProperty("modelReasoning");
  });
  it("preserves local Off as a real boolean and never applies it to an API model", () => {
    const local = { ...DEFAULT_EXECUTION_SETTINGS, executionMode: "local_cli" as const, localModel: "installed-model", runnerProviderId: "local_http_stub" as const };
    const execution = resolveExecutionSettings(local);
    const key = modelReasoningKey(execution.providerId, execution.providerConfig);
    const selected = { ...local, modelReasoningBySource: { [key]: false } };
    expect(resolveExecutionSettings(selected).providerConfig?.modelReasoning).toBe(false);
    expect(resolveExecutionSettings({ ...selected, executionMode: "byok" }).providerConfig).not.toHaveProperty("modelReasoning");
    expect(resolveExecutionSettings({ ...selected, modelReasoningBySource: {} }).providerConfig).not.toHaveProperty("modelReasoning");
  });
  it("ignores malformed persisted values instead of turning them into provider arguments", () => {
    const settings = { ...DEFAULT_EXECUTION_SETTINGS, model: "current-model" };
    const execution = resolveExecutionSettings(settings);
    const key = modelReasoningKey(execution.providerId, execution.providerConfig);
    expect(resolveExecutionSettings({ ...settings, modelReasoningBySource: { [key]: "--unsafe argument" } }).providerConfig).not.toHaveProperty("modelReasoning");
  });
});
