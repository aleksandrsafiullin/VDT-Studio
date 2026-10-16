import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_EXECUTION_SETTINGS } from "@/lib/execution-mode-catalog";
import { ExecutionModeSettings } from "./execution-mode-settings";
import { useVdtStudioStore } from "./vdt-store";

const fixture = vi.hoisted(() => ({
  snapshot: undefined as ReturnType<typeof import("./vdt-store").useVdtStudioStore.getInitialState> | undefined
}));

vi.mock("./vdt-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./vdt-store")>();
  // SSR reads an initial snapshot; setState only changes the client snapshot.
  function useFixtureStore<T>(selector: (state: ReturnType<typeof actual.useVdtStudioStore.getInitialState>) => T): T {
    return selector(fixture.snapshot ?? actual.useVdtStudioStore.getInitialState());
  }
  return { ...actual, useVdtStudioStore: Object.assign(useFixtureStore, actual.useVdtStudioStore) };
});

afterEach(() => {
  fixture.snapshot = undefined;
  vi.unstubAllEnvs();
});

describe("execution mode tabs", () => {
  it("shows API keys only on hosted web", () => {
    vi.stubEnv("NEXT_PUBLIC_VDT_APP_MODE", "hosted_web");
    const html = renderToStaticMarkup(<ExecutionModeSettings />);
    expect(html).toContain('data-testid="execution-mode-tab-byok"');
    expect(html).not.toContain('data-testid="execution-mode-tab-local-cli"');
    expect(html).not.toContain('data-testid="execution-mode-tab-local-models"');
    expect(html).not.toContain('data-testid="local-execution-options"');
  });

  it("selects the Local models panel from the effective HTTP backend despite a saved CLI", () => {
    vi.stubEnv("NEXT_PUBLIC_VDT_APP_MODE", "development_web");
    fixture.snapshot = { ...useVdtStudioStore.getInitialState(), executionSettings: { ...DEFAULT_EXECUTION_SETTINGS, executionMode: "local_cli", localRunnerPresetId: "lm_studio_openai", runnerProviderId: "local_http_stub", selectedCliAgentId: "codex", localModel: "local-choice" } };
    const html = renderToStaticMarkup(<ExecutionModeSettings />);
    expect(html).toContain('data-testid="execution-mode-panel-local-models"');
    expect(html).not.toContain('data-testid="execution-mode-panel-local-cli"');
    expect(html).toContain("Local models · On this computer");
    expect(html).not.toContain("Local AI");
    expect(html.match(/role="tab"/g)).toHaveLength(3);
  });
});
