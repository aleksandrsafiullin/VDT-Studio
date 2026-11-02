import { describe, expect, it } from "vitest";
import { modelReasoningKey } from "@vdt-studio/ai-harness/browser";
import { applyGatewayPreset, applyLocalRunnerPreset, DEFAULT_EXECUTION_SETTINGS, persistedExecutionSettings, type ExecutionSettings } from "./execution-mode-catalog";
import { reconcilePersistedExecutionSettings, resolveExecutionSettings } from "./execution-mode-resolver";
import { resolveSmartKpiSettings, smartKpiPreferences, smartKpiReasoning, smartKpiSourceKey, updateSmartKpiPreferences } from "./smart-kpi-settings";

const api = (): ExecutionSettings => ({ ...DEFAULT_EXECUTION_SETTINGS, executionMode: "byok", model: "chat-model", apiKey: "private-key" });
const resolvedSmart = (settings: ExecutionSettings) => resolveExecutionSettings(resolveSmartKpiSettings(settings));
const choose = (settings: ExecutionSettings, patch: Parameters<typeof updateSmartKpiPreferences>[1]): ExecutionSettings => ({ ...settings, smartKpiBySource: updateSmartKpiPreferences(settings, patch) });

describe("independent Suggested KPI settings", () => {
  it("follows the chat model initially but always requests reasoning off, without editing chat preferences", () => {
    const settings = api(), chat = resolveExecutionSettings(settings);
    settings.modelReasoningBySource = { [modelReasoningKey(chat.providerId, chat.providerConfig)]: "high" };
    const before = structuredClone(settings);
    expect(resolvedSmart(settings).providerConfig).toMatchObject({ model: "chat-model", modelReasoning: false });
    expect(resolveExecutionSettings(settings).providerConfig?.modelReasoning).toBe("high");
    expect(settings).toEqual(before);
  });

  it("remembers the Smart model and exact reasoning independently per model across JSON persistence", () => {
    const chat = api();
    const first = choose(choose(chat, { model: "fast-model" }), { reasoning: "low" });
    const second = choose(first, { model: "another-model" });
    expect(resolvedSmart(second).providerConfig).toMatchObject({ model: "another-model", modelReasoning: false });
    const restored = JSON.parse(JSON.stringify(persistedExecutionSettings(choose(second, { model: "fast-model" }))));
    expect(JSON.stringify(restored)).not.toContain("private-key");
    expect(resolvedSmart(restored).providerConfig).toMatchObject({ model: "fast-model", modelReasoning: "low" });
    expect(resolveExecutionSettings(restored).providerConfig?.model).toBe("chat-model");
  });

  it("does not apply one endpoint, CLI, or local runner's preferences to another connection", () => {
    const settings = choose(choose(api(), { model: "fast-model" }), { reasoning: "high" });
    const changed = { ...settings, customizeBaseUrl: true, baseUrl: "https://other.test/v1" };
    expect(smartKpiSourceKey(changed)).not.toBe(smartKpiSourceKey(settings));
    expect(resolvedSmart(changed).providerConfig).toMatchObject({ model: "chat-model", modelReasoning: false });
    const cli = choose({ ...applyLocalRunnerPreset(settings, "custom_cli_json"), selectedCliAgentId: "codex", cliModelSelection: { source: "custom", customModel: "chat-cli", reasoningEffort: "high" } }, { model: "fast-cli" });
    expect(resolvedSmart(cli).providerConfig).toMatchObject({ model: "fast-cli", modelReasoning: false });
    expect(cli.cliModelSelection).toMatchObject({ customModel: "chat-cli", reasoningEffort: "high" });
    expect(smartKpiPreferences({ ...cli, selectedCliAgentId: "kiro" }).model).toBeUndefined();
    expect(smartKpiPreferences({ ...cli, runnerUrl: "http://127.0.0.1:9876" }).model).toBeUndefined();
  });

  it("keeps Provider default as explicit saved opt-in, separate from absent default Off", () => {
    const initial = api(), selected = choose(initial, { reasoning: null });
    expect(smartKpiReasoning(initial)).toBe(false);
    expect(smartKpiReasoning(JSON.parse(JSON.stringify(selected)))).toBeUndefined();
    expect(resolvedSmart(selected).providerConfig).not.toHaveProperty("modelReasoning");
    expect(smartKpiReasoning(choose(selected, { reasoning: false }))).toBe(false);
  });

  it("restores follow-chat without changing the chat or losing the independent model's effort", () => {
    const settings = choose(choose(api(), { model: "smart-only" }), { reasoning: "medium" });
    const follow = choose(settings, { model: null });
    expect(resolvedSmart(follow).providerConfig).toMatchObject({ model: "chat-model", modelReasoning: false });
    expect(resolvedSmart(choose(follow, { model: "smart-only" })).providerConfig?.modelReasoning).toBe("medium");
  });

  it("uses an independent Azure deployment and local HTTP model", () => {
    const azure = choose({ ...applyGatewayPreset(api(), "azure-default"), endpoint: "https://example.openai.azure.com", deployment: "chat-deployment" }, { model: "smart-deployment" });
    expect(resolvedSmart(azure).providerConfig).toMatchObject({ model: "smart-deployment", deployment: "smart-deployment", modelReasoning: false });
    expect(resolveExecutionSettings(azure).providerConfig?.deployment).toBe("chat-deployment");
    const local = choose({ ...applyLocalRunnerPreset(api(), "ollama_openai"), localModel: "chat-local" }, { model: "smart-local" });
    expect(resolvedSmart(local).providerConfig).toMatchObject({ model: "smart-local", modelReasoning: false });
    expect(local.localModel).toBe("chat-local");
  });

  it("discards malformed saved choices instead of passing arbitrary arguments to the runtime", () => {
    const settings = api(), source = smartKpiSourceKey(settings);
    const broken = { ...settings, smartKpiBySource: { [source]: { model: "bad\nmodel", reasoningByModel: { "chat-model": "--unsafe option" } } } };
    expect(resolvedSmart(broken).providerConfig).toMatchObject({ model: "chat-model", modelReasoning: false });
  });

  it("retains a Smart-only choice through store reconciliation of otherwise default settings", () => {
    const settings = choose({ ...DEFAULT_EXECUTION_SETTINGS }, { model: "smart-only" });
    const restored = reconcilePersistedExecutionSettings("openai_compatible", {}, JSON.parse(JSON.stringify(persistedExecutionSettings(settings))));
    expect(smartKpiPreferences(restored).model).toBe("smart-only");
  });
});
