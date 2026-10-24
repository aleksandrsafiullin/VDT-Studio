import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_EXECUTION_SETTINGS } from "@/lib/execution-mode-catalog";
import { GenerateActivityPanel } from "./generate-activity-panel";
import { WebSearchControl, researchModeTooltip } from "./web-search-control";

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

const { ExecutionReadinessDot, SetupRail, agentActivityScrollClassName, describeComposerReadiness } = await import("./setup-rail");
const { useVdtStudioStore } = await import("./vdt-store");

describe("SetupRail agent composer", () => {
  beforeEach(() => {
    localStorageMock.clear();
    useVdtStudioStore.setState({
      isGenerating: false,
      generateActivity: undefined,
      aiError: undefined,
      aiActionError: undefined,
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

  it("names the default web-search mode and makes unconfigured model setup explicit", () => {
    const html = renderToStaticMarkup(<SetupRail />);

    expect(html).toContain('data-testid="agent-context-menu-toggle"');
    expect(html).toContain('aria-label="Add context"');
    expect(html).not.toContain('data-testid="data-import-attachment-button"');
    expect(html).not.toContain('data-testid="data-import-wizard"');
    expect(html).toContain('data-testid="agent-research-mode-toggle"');
    expect(html).toContain('data-research-mode="auto"');
    expect(html).toContain("Let the agent search when it needs more context.");
    expect(html).toContain("<span>Auto</span>");
    expect(html).toContain("Setup needed");
    expect(html).toContain("max-h-[min(40vh,20rem)]");
    expect(html).toContain('data-testid="agent-instruction-input"');
    expect(html).toContain('aria-label="Message VDT Agent"');
    expect(html).not.toContain('label="Period"');
    expect(html).not.toContain(">Period<");
  });

  it("distinguishes configured API settings from live CLI checks without claiming a tested API connection", () => {
    expect(describeComposerReadiness(undefined, true)).toEqual({
      state: "ready", label: "Ready to send", message: "Provider settings are configured. Connection and model access are checked when a request starts."
    });
    expect(describeComposerReadiness(undefined, false)).toMatchObject({ state: "warning", label: "Setup needed" });
    const checking = { state: "checking" as const, canExecute: false, label: "Connecting…", message: "Checking chat availability for the selected model." };
    expect(describeComposerReadiness(checking, false)).toBe(checking);
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

  it("adds scroll padding for retryable errors in the activity scroll region", () => {
    expect(agentActivityScrollClassName(false)).toBe("min-h-0 flex-1 overflow-auto px-4 py-4");
    expect(agentActivityScrollClassName(true)).toContain("pb-48");
    expect(agentActivityScrollClassName(true)).toContain("overflow-auto");
  });

  it("separates the selected web mode from missing provider setup, and never marks Off as unavailable", () => {
    const status = { providerConfigured: false as const, providerId: "noop" };
    expect(researchModeTooltip("on", status)).toBe(
      "Use web search for missing or current information. Search provider is not configured."
    );
    expect(researchModeTooltip("auto", status)).toContain("Search provider is not configured.");
    expect(researchModeTooltip("off", status)).toBe("Web search is off. Do not search the web.");
    const off = renderToStaticMarkup(<WebSearchControl mode="off" status={status} onChange={() => undefined} />);
    const on = renderToStaticMarkup(<WebSearchControl mode="on" status={status} onChange={() => undefined} />);
    expect(off).toContain('aria-label="Web search: Off"');
    expect(off).not.toContain("needs setup");
    expect(on).toContain('aria-label="Web search: On — needs setup"');
    expect(on).toContain("<span>On</span>");
    expect(researchModeTooltip("on", { ...status, checkFailed: true })).toContain("availability could not be checked");
  });

  it("keeps retry controls inside the scroll region when activity has a retryable error", () => {
    const html = renderToStaticMarkup(
      <section className={agentActivityScrollClassName(true)} data-testid="agent-activity-scroll">
        <GenerateActivityPanel
          activity={{
            runId: "agent-run-retryable",
            requestId: "backend-request-retryable",
            status: "needs_user_input",
            phase: "waiting_provider",
            phaseStartedAt: "2026-06-24T10:00:00.000Z",
            startedAt: "2026-06-24T10:00:00.000Z",
            updatedAt: "2026-06-24T10:00:05.000Z",
            providerId: "local_runner",
            providerLabel: "Cursor Agent",
            appMode: "development_web",
            canCancel: true,
            cancelRequested: false,
            retryableError: {
              code: "TIMEOUT",
              message: "The agent step timed out before finishing.",
              retryCount: 1,
              createdAt: "2026-06-24T10:00:05.000Z"
            }
          }}
          onCancel={() => undefined}
          onAnswer={() => undefined}
        />
      </section>
    );

    expect(html).toContain('data-testid="agent-activity-scroll"');
    expect(html).toContain("pb-48");
    expect(html).toContain('data-testid="agent-retryable-error"');
    expect(html).toContain('data-testid="continue-agent-smaller-step"');
  });
});
