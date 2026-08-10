import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DEFAULT_EXECUTION_SETTINGS,
  getGatewayPreset,
  type ExecutionSettings
} from "@/lib/execution-mode-catalog";
import { ByokPresetForm } from "./byok-preset-form";

function renderForm(
  executionSettings: ExecutionSettings,
  options: {
    discoveredModels?: readonly string[];
    modelListLoaded?: boolean;
    modelListError?: string;
  } = {}
) {
  const protocol = executionSettings.byokProtocol ?? "openai";
  const preset = getGatewayPreset(executionSettings.gatewayPresetId ?? "openai-default");
  return renderToStaticMarkup(
    <ByokPresetForm
      executionSettings={executionSettings}
      preset={preset}
      protocol={protocol}
      showPresetSelect
      isTesting={false}
      discoveredModels={options.discoveredModels}
      modelListLoaded={options.modelListLoaded}
      modelListError={options.modelListError}
      onPresetChange={() => undefined}
      onFieldChange={() => undefined}
      onLoadModels={() => undefined}
      onTest={() => undefined}
    />
  );
}

describe("ByokPresetForm model discovery", () => {
  it("uses manual model entry and does not render a bundled catalog before discovery", () => {
    const html = renderForm({
      ...DEFAULT_EXECUTION_SETTINGS,
      apiKey: ""
    });

    expect(html).toContain('data-testid="byok-model-custom"');
    expect(html).toContain('data-testid="byok-load-models"');
    expect(html).toMatch(/data-testid="byok-load-models"[^>]*disabled/);
    expect(html).toContain("Enter an API key to load the provider&#x27;s current model list");
    expect(html).not.toContain("gpt-4.1-mini");
  });

  it("renders only models returned by the current API key and marks an unreported selection", () => {
    const html = renderForm(
      {
        ...DEFAULT_EXECUTION_SETTINGS,
        apiKey: "session-key",
        model: "stale-default"
      },
      {
        discoveredModels: ["gpt-live-a", "gpt-live-b"],
        modelListLoaded: true
      }
    );

    expect(html).toContain('data-testid="byok-model-select"');
    expect(html).toContain("gpt-live-a");
    expect(html).toContain("gpt-live-b");
    expect(html).toContain("stale-default — not reported by provider");
    expect(html).toContain("2 models loaded from the provider");
  });

  it("uses Azure deployment input instead of presenting base models as deployments", () => {
    const html = renderForm({
      ...DEFAULT_EXECUTION_SETTINGS,
      gatewayPresetId: "azure-default",
      byokProtocol: "azure",
      endpoint: "https://example.openai.azure.com",
      deployment: "vdt-deployment",
      model: "vdt-deployment",
      apiKey: "session-key"
    });

    expect(html).toContain('data-testid="byok-deployment"');
    expect(html).toContain("Azure&#x27;s model catalog does not report deployment names");
    expect(html).not.toContain('data-testid="byok-load-models"');
    expect(html).not.toContain('data-testid="byok-model-select"');
  });
});
