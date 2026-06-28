import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LOCAL_RUNNER_PRESET_CATALOG } from "@/lib/execution-mode-catalog";
import { LocalAiRuntimeErrorBanner, LocalModelCards } from "./local-cli-settings";

describe("LocalModelCards", () => {
  it("renders local model server cards without standalone runner pairing instructions", () => {
    const html = renderToStaticMarkup(
      <LocalModelCards
        selectedPresetId="ollama_openai"
        selectedModel="qwen3:latest"
        modelsByBackend={{ ollama: ["qwen3:latest", "deepseek-r1:8b"] }}
        onSelectPreset={() => undefined}
        onSelectModel={() => undefined}
        onRefreshModels={() => undefined}
      />
    );

    expect(html).toContain('data-testid="local-model-cards"');
    expect(html).toContain('data-testid="local-model-card-ollama_openai"');
    expect(html).toContain('data-testid="local-model-card-lm_studio_openai"');
    expect(html).toContain('data-testid="local-model-card-vllm_openai"');
    expect(html).toContain('data-testid="local-model-model-ollama_openai"');
    expect(html).toContain("qwen3:latest");
    expect(html).toContain("deepseek-r1:8b");
    expect(html).toContain("Run open-weight models locally with Ollama");
    expect(html).toContain("Host GGUF models in LM Studio");
    expect(html).toContain("Serve high-throughput models with vLLM");
    expect(html).toContain("http://127.0.0.1:11434/v1");
    expect(html).not.toContain("vdt runner start");
    expect(html).not.toContain("Pairing code");
  });

  it("shows per-preset descriptions and base URLs for all local HTTP presets", () => {
    const html = renderToStaticMarkup(
      <LocalModelCards selectedPresetId={undefined} onSelectPreset={() => undefined} />
    );

    const localHttpPresets = LOCAL_RUNNER_PRESET_CATALOG.filter(
      (preset) => preset.runnerProviderId === "local_http_stub"
    );

    expect(localHttpPresets).toHaveLength(3);

    for (const preset of localHttpPresets) {
      expect(html.replace(/&#x27;/g, "'")).toContain(preset.description);
      expect(html).toContain(preset.baseUrl);
      expect(html).toContain(`data-testid="local-model-select-${preset.id}"`);
    }

    const descriptions = localHttpPresets.map((preset) => preset.description);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });

  it("keeps unselected cards on Select with default model and hides model controls", () => {
    const html = renderToStaticMarkup(
      <LocalModelCards selectedPresetId="ollama_openai" onSelectPreset={() => undefined} />
    );

    expect(html).toContain('data-testid="local-model-select-ollama_openai">Selected');
    expect(html).toContain('data-testid="local-model-select-lm_studio_openai">Select');
    expect(html).toContain('data-testid="local-model-select-vllm_openai">Select');
    expect(html).toContain("Default model: local-model");
    expect(html).not.toContain('data-testid="local-model-model-lm_studio_openai"');
    expect(html).not.toContain('data-testid="local-model-model-vllm_openai"');
    expect(html).not.toContain('data-testid="local-model-refresh-lm_studio_openai"');
  });

  it("shows model picker, refresh control, and detected count on the selected preset", () => {
    const html = renderToStaticMarkup(
      <LocalModelCards
        selectedPresetId="ollama_openai"
        selectedModel="qwen3:latest"
        modelsByBackend={{ ollama: ["qwen3:latest", "deepseek-r1:8b"] }}
        onSelectPreset={() => undefined}
        onSelectModel={() => undefined}
        onRefreshModels={() => undefined}
      />
    );

    expect(html).toContain('data-testid="local-model-model-ollama_openai"');
    expect(html).toContain('data-testid="local-model-refresh-ollama_openai"');
    expect(html).toContain('aria-label="Refresh Ollama models"');
    expect(html).toContain("2 models detected.");
    expect(html).toContain('value="qwen3:latest"');
  });

  it("shows loading and error states for the selected preset", () => {
    const loadingHtml = renderToStaticMarkup(
      <LocalModelCards
        selectedPresetId="lm_studio_openai"
        selectedModel="local-model"
        isLoadingModelsByBackend={{ lm_studio: true }}
        onSelectPreset={() => undefined}
      />
    );

    expect(loadingHtml).toContain("Loading available models...");
    expect(loadingHtml).toContain('data-testid="local-model-refresh-lm_studio_openai" disabled=""');

    const errorHtml = renderToStaticMarkup(
      <LocalModelCards
        selectedPresetId="vllm_openai"
        selectedModel="local-model"
        modelListErrorByBackend={{ vllm: "Could not reach vLLM at 127.0.0.1:8000." }}
        onSelectPreset={() => undefined}
      />
    );

    expect(errorHtml).toContain("Could not reach vLLM at 127.0.0.1:8000.");
    expect(errorHtml).not.toContain("Using preset default until the runtime reports models.");
  });

  it("falls back to preset default copy when the selected backend reports no models", () => {
    const html = renderToStaticMarkup(
      <LocalModelCards
        selectedPresetId="ollama_openai"
        selectedModel="qwen3"
        modelsByBackend={{ ollama: [] }}
        onSelectPreset={() => undefined}
      />
    );

    expect(html).toContain("Using preset default until the runtime reports models.");
    expect(html).not.toContain("models detected.");
  });

  it("renders a concise desktop runtime error without runner pairing instructions", () => {
    const html = renderToStaticMarkup(
      <LocalAiRuntimeErrorBanner message="SIDECAR_CRASH_LOOP: restart limit reached." appMode="desktop" />
    );

    expect(html).toContain("Desktop runtime unavailable");
    expect(html).toContain("SIDECAR_CRASH_LOOP");
    expect(html).toContain("API key providers remain available");
    expect(html).not.toContain("Could not scan installed CLIs");
    expect(html).not.toContain("vdt runner start");
    expect(html).not.toContain("Pairing code");
  });
});
