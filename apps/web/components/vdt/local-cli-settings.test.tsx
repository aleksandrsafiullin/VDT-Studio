import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LocalAiRuntimeErrorBanner, LocalModelCards } from "./local-cli-settings";

describe("LocalModelCards", () => {
  it("renders local model server cards without standalone runner pairing instructions", () => {
    const html = renderToStaticMarkup(
      <LocalModelCards selectedPresetId="ollama_openai" onSelectPreset={() => undefined} />
    );

    expect(html).toContain('data-testid="local-model-cards"');
    expect(html).toContain('data-testid="local-model-card-ollama_openai"');
    expect(html).toContain('data-testid="local-model-card-lm_studio_openai"');
    expect(html).toContain('data-testid="local-model-card-vllm_openai"');
    expect(html).toContain("Local model server managed by the desktop runtime.");
    expect(html).toContain("http://127.0.0.1:11434/v1");
    expect(html).not.toContain("vdt runner start");
    expect(html).not.toContain("Pairing code");
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
