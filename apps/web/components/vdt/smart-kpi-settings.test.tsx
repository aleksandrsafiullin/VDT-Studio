import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { applyLocalRunnerPreset, DEFAULT_EXECUTION_SETTINGS } from "@/lib/execution-mode-catalog";
import { updateSmartKpiPreferences } from "@/lib/smart-kpi-settings";
import { SmartKpiSettings } from "./smart-kpi-settings";
import { useVdtStudioStore } from "./vdt-store";

const fixture = vi.hoisted(() => ({ snapshot: undefined as ReturnType<typeof import("./vdt-store").useVdtStudioStore.getInitialState> | undefined }));
vi.mock("./vdt-store", async importOriginal => {
  const actual = await importOriginal<typeof import("./vdt-store")>();
  function useFixtureStore<T>(selector: (state: ReturnType<typeof actual.useVdtStudioStore.getInitialState>) => T): T { return selector(fixture.snapshot ?? actual.useVdtStudioStore.getInitialState()); }
  return { ...actual, useVdtStudioStore: Object.assign(useFixtureStore, actual.useVdtStudioStore) };
});
afterEach(() => { fixture.snapshot = undefined; });

describe("Suggested KPI settings surface", () => {
  it.each(["byok", "local_models"])("never shows remembered CLI models while the %s catalog is loading", category => {
    const settings = category === "local_models" ? applyLocalRunnerPreset(DEFAULT_EXECUTION_SETTINGS, "ollama_openai") : { ...DEFAULT_EXECUTION_SETTINGS };
    fixture.snapshot = { ...useVdtStudioStore.getInitialState(), executionSettings: { ...settings, selectedCliAgentId: "codex" }, cliDiscoveredModelsByAgent: { codex: ["private-cli-only-model"] } };
    expect(renderToStaticMarkup(<SmartKpiSettings />)).not.toContain("private-cli-only-model");
  });
  it("does not show this machine's remembered CLI catalog for a paired runner", () => {
    fixture.snapshot = { ...useVdtStudioStore.getInitialState(), executionSettings: { ...applyLocalRunnerPreset(DEFAULT_EXECUTION_SETTINGS, "custom_cli_json"), selectedCliAgentId: "codex", runnerUrl: "http://127.0.0.1:9876" },
      runnerPairingToken: "paired-token", cliDiscoveredModelsByAgent: { codex: ["this-machine-only-model"] } };
    expect(renderToStaticMarkup(<SmartKpiSettings />)).not.toContain("this-machine-only-model");
  });
  it("shows independent model and reasoning controls with Off requested by default", () => {
    fixture.snapshot = { ...useVdtStudioStore.getInitialState(), executionSettings: { ...DEFAULT_EXECUTION_SETTINGS, model: "chat-model" } };
    const html = renderToStaticMarkup(<SmartKpiSettings />);
    expect(html).toContain('aria-label="Suggested KPI model"');
    expect(html).toContain('aria-label="Suggested KPI reasoning"');
    expect(html).toContain('value="false" selected="">Off (requested)');
    expect(html).toContain("Same as chat · chat-model");
    expect(html).toContain("separate from chat");
    expect(html).toContain("Add an API key in provider settings above");
  });
  it("renders saved Smart choices and an explicit Provider default without changing chat", () => {
    const settings = { ...DEFAULT_EXECUTION_SETTINGS, model: "chat-model" };
    const model = { ...settings, smartKpiBySource: updateSmartKpiPreferences(settings, { model: "smart-model" }) };
    fixture.snapshot = { ...useVdtStudioStore.getInitialState(), executionSettings: { ...model, smartKpiBySource: updateSmartKpiPreferences(model, { reasoning: null }) } };
    const html = renderToStaticMarkup(<SmartKpiSettings />);
    expect(html).toContain('value="smart-model" selected="">smart-model');
    expect(html).toContain('value="null" selected="">Provider default');
    expect(html).toContain("Same as chat · chat-model");
  });
});
