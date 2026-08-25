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

const { ExecutionReadinessDot, SetupRail } = await import("./setup-rail");
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
      },
      cliDetectionAgents: undefined,
      cliDetectionError: undefined,
      isRescanningClis: false
    });
  });

  it("renders the search mode toggle as Auto by default", () => {
    const html = renderToStaticMarkup(<SetupRail />);

    expect(html).toContain('data-testid="data-import-attachment-button"');
    expect(html).toContain('aria-label="Attach data file to create incoming KPIs"');
    expect(html).not.toContain('data-testid="data-import-wizard"');
    expect(html).toContain('data-testid="agent-research-mode-toggle"');
    expect(html).toContain('data-research-mode="auto"');
    expect(html).toContain("Agent may search when local skills are not enough.");
    expect(html).toContain("max-h-[min(40vh,20rem)]");
    expect(html).toContain('data-testid="agent-instruction-input"');
  });

  it.each([
    { state: "checking" as const, expectedClass: "bg-slate-400" },
    { state: "ready" as const, expectedClass: "bg-emerald-500" },
    { state: "warning" as const, expectedClass: "bg-amber-500" },
    { state: "not_installed" as const, expectedClass: "bg-red-500" }
  ])("renders the $state readiness color", ({ state, expectedClass }) => {
    const html = renderToStaticMarkup(<ExecutionReadinessDot state={state} />);

    expect(html).toContain(`data-readiness="${state}"`);
    expect(html).toContain(expectedClass);
  });
});
