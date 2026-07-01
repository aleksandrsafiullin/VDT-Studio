import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_EXECUTION_SETTINGS } from "@/lib/execution-mode-catalog";

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    }
  };
})();

vi.stubGlobal("localStorage", localStorageMock);

const { SetupRail } = await import("./setup-rail");
const { useVdtStudioStore } = await import("./vdt-store");

describe("SetupRail agent composer", () => {
  beforeEach(() => {
    localStorageMock.clear();
    useVdtStudioStore.setState({
      isGenerating: false,
      isRunningAiAction: false,
      generateActivity: undefined,
      aiError: undefined,
      executionSettings: {
        ...DEFAULT_EXECUTION_SETTINGS,
        executionMode: "byok",
        gatewayPresetId: "openai-default",
        byokProtocol: "openai",
        useMockProvider: false,
        apiKey: "test-key",
        model: "gpt-test"
      }
    });
  });

  it("renders the search mode toggle as Auto by default", () => {
    const html = renderToStaticMarkup(<SetupRail />);

    expect(html).toContain('data-testid="agent-research-mode-toggle"');
    expect(html).toContain('data-research-mode="auto"');
    expect(html).toContain("Agent may search when local skills are not enough.");
  });
});
