import { beforeEach, describe, expect, it, vi } from "vitest";
import { localRunnerOfflineMessage } from "@vdt-studio/ai-harness";
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

function mockRunnerHealth(fetchMock: ReturnType<typeof vi.fn>, online: boolean) {
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/health")) {
      if (!online) {
        throw new TypeError("Failed to fetch");
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true })
      } as Response;
    }
    return {
      ok: false,
      status: 404,
      json: async () => ({ ok: false })
    } as Response;
  });
}

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

  it("posts expected cli_stub payload to local runner test-provider", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/health")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true })
        } as Response;
      }

      if (String(url).endsWith("/test-provider")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            models: ["claude-sonnet-4-5"]
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

    const testProviderCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/test-provider"));
    expect(testProviderCall).toBeDefined();

    const [, requestInit] = testProviderCall!;
    const body = JSON.parse(String(requestInit?.body)) as {
      providerId?: string;
      timeoutSec?: number;
      providerConfig?: {
        name?: string;
        command?: string;
        inputMode?: string;
        outputMode?: string;
        timeoutSec?: number;
      };
    };

    expect(body.providerId).toBe("cli_stub");
    expect(body.providerConfig?.command).toBe("/usr/local/bin/claude");
    expect(body.providerConfig?.name).toBe("Claude Code");
    expect(body.providerConfig?.inputMode).toBe("stdin");
    expect(body.providerConfig?.outputMode).toBe("stdout_json");
    expect(body.providerConfig?.timeoutSec).toBe(60);
    expect(body.timeoutSec).toBe(60);

    const state = useVdtStudioStore.getState();
    expect(state.cliTestStatusByAgent.claude?.kind).toBe("success");
    expect(state.cliDiscoveredModelsByAgent.claude).toEqual(["claude-sonnet-4-5"]);
  });

  it("shows setup info when local runner is offline", async () => {
    const fetchMock = vi.mocked(fetch);
    mockRunnerHealth(fetchMock, false);

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
    expect(state.cliTestStatusByAgent.claude?.kind).toBe("info");
    expect(state.cliTestStatusByAgent.claude?.message).toContain("on PATH");
    expect(state.cliTestStatusByAgent.claude?.message).not.toContain("Failed to fetch");

    const testProviderCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/test-provider"));
    expect(testProviderCall).toBeUndefined();
  });

  it("generateWithAi shows friendly error when local runner is offline", async () => {
    const fetchMock = vi.mocked(fetch);
    const offlineMessage = localRunnerOfflineMessage("http://127.0.0.1:8765");

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/ai/generate-vdt")) {
        return {
          ok: false,
          status: 503,
          json: async () => ({ ok: false, error: offlineMessage })
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
    expect(state.aiError).toContain("Local runner is offline");
    expect(state.aiError).toContain("pnpm local-runner:start");
    expect(state.aiError).not.toContain("fetch failed");
    expect(state.isGenerating).toBe(false);

    const generateCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/api/ai/generate-vdt"));
    expect(generateCall).toBeDefined();
  });

  it("shows env guidance when CLI execution is disabled on runner", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/health")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true })
        } as Response;
      }

      if (String(url).endsWith("/test-provider")) {
        return {
          ok: false,
          status: 403,
          json: async () => ({
            ok: false,
            error: {
              code: "CLI_EXECUTION_DISABLED",
              message: "CLI execution is disabled."
            }
          })
        } as Response;
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({ agents: [] })
      } as Response;
    });

    await useVdtStudioStore.getState().testCli("claude");

    const state = useVdtStudioStore.getState();
    expect(state.cliTestStatusByAgent.claude?.kind).toBe("info");
    expect(state.cliTestStatusByAgent.claude?.message).toContain("VDT_LOCAL_RUNNER_ENABLE_CLI=true");
  });
});

describe("vdt-store cli catalog models", () => {
  it("exposes catalog suggestions for model selection without runner probe", () => {
    const claudeModels = getCliCatalogEntry("claude").suggestedModels;
    expect(claudeModels).toContain("claude-sonnet-4-5");
    expect(claudeModels.length).toBeGreaterThan(0);
  });
});
