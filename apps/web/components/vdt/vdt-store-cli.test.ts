import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_EXECUTION_SETTINGS, getCliCatalogEntry } from "@/lib/execution-mode-catalog";

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

const { useVdtStudioStore } = await import("./vdt-store");

describe("vdt-store cli rescan", () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ agents: [] })
      })
    );
    useVdtStudioStore.setState({
      cliDetectionAgents: undefined,
      cliDetectionError: undefined,
      isRescanningClis: false,
      rescanningCliId: undefined,
      executionSettings: {
        ...DEFAULT_EXECUTION_SETTINGS,
        executionMode: "local_cli",
        selectedCliAgentId: "claude",
        localRunnerPresetId: "custom_cli_json",
        runnerProviderId: "cli_stub",
        command: "claude"
      },
      providerConfig: {
        localRunnerPresetId: "custom_cli_json",
        runnerUrl: "http://127.0.0.1:8765",
        runnerProviderId: "cli_stub",
        command: "claude",
        timeoutSec: 60
      },
      providerId: "local_runner"
    });
  });

  it("sets empty detection agents on failed rescan instead of leaving undefined", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: "detection unavailable" })
      } as Response);

    await useVdtStudioStore.getState().rescanClis();

    const state = useVdtStudioStore.getState();
    expect(state.cliDetectionAgents).toEqual([]);
    expect(state.cliDetectionError).toBe("detection unavailable");
    expect(state.isRescanningClis).toBe(false);
  });

  it("updates selected command and legacy provider config after successful rescan", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
          agents: [
            {
              id: "claude",
              installed: true,
              executable: "/opt/homebrew/bin/claude",
              alias: "/opt/homebrew/bin/claude",
              version: "1.0.0"
            }
          ]
        })
      } as Response);

    await useVdtStudioStore.getState().rescanClis();

    const state = useVdtStudioStore.getState();
    expect(state.executionSettings.command).toBe("/opt/homebrew/bin/claude");
    expect(state.providerConfig.command).toBe("/opt/homebrew/bin/claude");
    expect(state.cliDetectionError).toBeUndefined();
  });

  it("stores live models returned by CLI detection", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        agents: [
          {
            id: "cursor-agent",
            installed: true,
            executable: "/usr/local/bin/cursor-agent",
            alias: "cursor-agent",
            version: "1.0.0"
          }
        ],
        modelsByAgent: { "cursor-agent": ["auto", "gpt-5.5-high"] }
      })
    } as Response);

    await useVdtStudioStore.getState().rescanClis();

    expect(useVdtStudioStore.getState().cliDiscoveredModelsByAgent["cursor-agent"]).toEqual([
      "auto",
      "gpt-5.5-high"
    ]);
  });

  it("posts a real Local CLI connection test to the application API", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/ai/generate-vdt")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true
          })
        } as Response;
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({ agents: [] })
      } as Response;
    });

    useVdtStudioStore.setState({
      cliDetectionAgents: [
        {
          id: "claude",
          installed: true,
          executable: "/usr/local/bin/claude",
          alias: "/usr/local/bin/claude",
          version: "1.0.0"
        }
      ],
      executionSettings: {
        ...DEFAULT_EXECUTION_SETTINGS,
        executionMode: "local_cli",
        selectedCliAgentId: "claude",
        localRunnerPresetId: "custom_cli_json",
        runnerProviderId: "cli_stub",
        command: "/usr/local/bin/claude"
      },
    });

    await useVdtStudioStore.getState().testCli("claude");

    const testProviderCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/api/ai/generate-vdt"));
    expect(testProviderCall).toBeDefined();

    const [, requestInit] = testProviderCall!;
    const body = JSON.parse(String(requestInit?.body)) as {
      providerId?: string;
      operation?: string;
      providerConfig?: {
        agentId?: string;
        timeoutSec?: number;
      };
    };

    expect(body.operation).toBe("connection_test");
    expect(body.providerId).toBe("local_cli");
    expect(body.providerConfig?.agentId).toBe("claude");
    expect(body.providerConfig?.timeoutSec).toBe(60);

    const state = useVdtStudioStore.getState();
    expect(state.cliTestStatusByAgent.claude?.kind).toBe("success");
  });

  it("shows a real CLI test error from the application API", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ ok: false, error: "Claude Code authentication failed." })
    } as Response);

    useVdtStudioStore.setState({
      cliDetectionAgents: [
        {
          id: "claude",
          installed: true,
          executable: "/usr/local/bin/claude",
          alias: "/usr/local/bin/claude",
          version: "1.0.0"
        }
      ]
    });

    await useVdtStudioStore.getState().testCli("claude");

    const state = useVdtStudioStore.getState();
    expect(state.cliTestStatusByAgent.claude?.kind).toBe("error");
    expect(state.cliTestStatusByAgent.claude?.message).toContain("authentication failed");
  });

  it("generateWithAi surfaces provider errors", async () => {
    const fetchMock = vi.mocked(fetch);
    const providerMessage = "Claude Code authentication failed.";

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/ai/generate-vdt")) {
        return {
          ok: false,
          status: 502,
          json: async () => ({ ok: false, error: providerMessage })
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ agents: [] })
      } as Response;
    });

    await useVdtStudioStore.getState().generateWithAi();

    const state = useVdtStudioStore.getState();
    expect(state.aiError).toContain(providerMessage);
    expect(state.isGenerating).toBe(false);

    const generateCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/api/ai/generate-vdt"));
    expect(generateCall).toBeDefined();
  });

});

describe("vdt-store cli catalog models", () => {
  it("exposes catalog suggestions for model selection without runner probe", () => {
    const claudeModels = getCliCatalogEntry("claude").suggestedModels;
    expect(claudeModels).toContain("claude-sonnet-4-6");
    expect(claudeModels.length).toBeGreaterThan(0);
  });
});
