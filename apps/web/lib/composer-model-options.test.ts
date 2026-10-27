import { describe, expect, it } from "vitest";
import { composerModelOptions, reasoningSliderSteps } from "./composer-model-options";
import { DEFAULT_EXECUTION_SETTINGS, type ExecutionSettings } from "./execution-mode-catalog";
import type { AgentExecutionBindingSelection } from "./agent-client";

const settings: ExecutionSettings = { ...DEFAULT_EXECUTION_SETTINGS, executionMode: "local_cli", selectedCliAgentId: "codex",
  runnerProviderId: "cli_stub", localRunnerPresetId: "custom_cli_json", cliModelSelection: { source: "custom", customModel: "luna" } };
const base = { bindingId: "luna", executionProfile: "external_cli_agent" as const, engineId: "codex", engineAdapterId: "codex-resume-checkpoint-v1", backendId: "codex_subscription", modelId: "luna" };
const catalog: AgentExecutionBindingSelection = { schemaVersion: 1, ok: true, defaultBindingId: null, bindings: [
  { ...base, bindingId: "auto", modelId: "auto" }, base,
  { ...base, bindingId: "luna-low", reasoningEffort: "low" },
  { ...base, bindingId: "luna-max", reasoningEffort: "max" },
  { ...base, bindingId: "terra", modelId: "terra" },
  { ...base, bindingId: "terra-high", modelId: "terra", reasoningEffort: "high" },
  { ...base, bindingId: "other-provider", backendId: "claude_subscription", modelId: "foreign" }
] };

describe("composer model choices", () => {
  it("deduplicates provider-owned models and shows reasoning for only the selected model", () => {
    const choices = composerModelOptions(settings, catalog, ["luna", "terra", "unbound"]);
    expect(choices.models).toEqual([
      { id: "auto", label: "Provider default", available: true }, { id: "luna", label: "luna", available: true },
      { id: "terra", label: "terra", available: true }, { id: "unbound", label: "unbound", available: false }
    ]);
    expect(choices.reasoningEfforts).toEqual(["low", "max"]);
    expect(composerModelOptions({ ...settings, cliModelSelection: { source: "custom", customModel: "terra" } }, catalog).reasoningEfforts).toEqual(["high"]);
  });

  it("retains an unavailable saved selection without inventing model capabilities", () => {
    expect(composerModelOptions(settings, undefined)).toMatchObject({ models: [{ id: "luna", available: false }], reasoningEfforts: [] });
    expect(composerModelOptions({ ...settings, cliModelSelection: { source: "agent_default" } }, catalog).reasoningEfforts).toEqual([]);
  });

  it("preserves API model choices and ignores stale CLI reasoning", () => {
    const api = { ...DEFAULT_EXECUTION_SETTINGS, model: "configured-api-model", cliModelSelection: { source: "custom" as const, reasoningEffort: "max" as const } };
    expect(composerModelOptions(api, catalog, ["luna"])).toMatchObject({ models: [{ id: "configured-api-model" }], reasoningEfforts: [] });
  });

  it("keeps Provider default selectable when the host pins it to an explicit model", () => {
    const pinned = { ...catalog, bindings: [{ ...base, modelId: "host-pinned" }] };
    const choices = composerModelOptions({ ...settings, cliModelSelection: { source: "agent_default" } }, pinned);
    expect(choices.models[0]).toEqual({ id: "auto", label: "Provider default", available: true });
  });

  it("uses the active API/local catalog without mixing it with CLI or other host models", () => {
    const api = { ...DEFAULT_EXECUTION_SETTINGS, model: "new-account-model" };
    expect(composerModelOptions(api, catalog, ["foreign-cli"], ["new-account-model", "other-account-model"]).models.map((model) => model.id))
      .toEqual(["new-account-model", "other-account-model"]);
    const local = { ...api, executionMode: "local_cli" as const, runnerProviderId: "local_http_stub" as const, localModel: "installed-model" };
    expect(composerModelOptions(local, catalog, [], ["installed-model"]).models.map((model) => model.id)).toEqual(["installed-model"]);
  });

  it("orders discrete slider positions using only the selected model's advertised reasoning levels", () => {
    expect(reasoningSliderSteps(["max", "low", "max", "high"])).toEqual([undefined, "low", "high", "max"]);
    expect(reasoningSliderSteps([])).toEqual([undefined]);
  });
});
