import { beforeEach, describe, expect, it, vi } from "vitest";
import { cloneProject, productionVolumeProject, type VdtChangeSet } from "@vdt-studio/vdt-core";
import { productionVolumeReviewOutput } from "@vdt-studio/ai-harness";
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

function mockDeepenChangeSet(): VdtChangeSet {
  return {
    id: "changeset_deepen_unplanned_downtime",
    taskType: "deepen_node",
    backendId: "mock",
    createdAt: "2026-01-01T00:00:00.000Z",
    additions: [
      {
        id: "add_equipment_failure_downtime",
        nodeId: "equipment_failure_downtime",
        parentNodeId: "unplanned_downtime",
        relation: "negative_driver",
        name: "Equipment Failure Downtime",
        unit: "hours/month",
        baselineValue: 12
      },
      {
        id: "add_process_interruption_downtime",
        nodeId: "process_interruption_downtime",
        parentNodeId: "unplanned_downtime",
        relation: "negative_driver",
        name: "Process Interruption Downtime",
        unit: "hours/month",
        baselineValue: 8
      }
    ],
    updates: [],
    deletions: [],
    edgeChanges: [],
    assumptions: [],
    questions: [],
    warnings: []
  };
}

describe("vdt-store change-set workflow", () => {
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
      project: cloneProject(productionVolumeProject),
      selectedNodeId: "unplanned_downtime",
      changeSetSelection: new Set<string>(),
      pendingChangeSet: undefined,
      pendingAdvisoryResult: undefined,
      pendingExplanation: undefined,
      isRunningAiAction: false,
      aiActionError: undefined,
      providerId: "mock",
      executionSettings: {
        ...DEFAULT_EXECUTION_SETTINGS,
        useMockProvider: true,
        gatewayPresetId: "mock"
      }
    });
  });

  it("runAiAction posts deepen_node to /api/ai/run-task and stores pending change set", async () => {
    const changeSet = mockDeepenChangeSet();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/ai/run-task")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            result: { kind: "change_set", changeSet }
          })
        } as Response;
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({ agents: [] })
      } as Response;
    });

    await useVdtStudioStore.getState().runAiAction("deepen_node", { nodeId: "unplanned_downtime" });

    const runTaskCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/api/ai/run-task"));
    expect(runTaskCall).toBeDefined();

    const [, requestInit] = runTaskCall!;
    const body = JSON.parse(String(requestInit?.body)) as {
      taskType?: string;
      input?: { nodeId?: string; project?: { id?: string } };
      providerId?: string;
    };

    expect(body.taskType).toBe("deepen_node");
    expect(body.input?.nodeId).toBe("unplanned_downtime");
    expect(body.input?.project?.id).toBe(productionVolumeProject.id);
    expect(body.providerId).toBe("mock");

    const state = useVdtStudioStore.getState();
    expect(state.pendingChangeSet?.id).toBe(changeSet.id);
    expect(state.changeSetSelection).toEqual(
      new Set(["add_equipment_failure_downtime", "add_process_interruption_downtime"])
    );
    expect(state.isRunningAiAction).toBe(false);
    expect(state.selectedPanelTab).toBe("ai");
  });

  it("toggleChangeSelection updates selected change entry ids", () => {
    const changeSet = mockDeepenChangeSet();
    useVdtStudioStore.setState({
      pendingChangeSet: changeSet,
      changeSetSelection: new Set(["add_equipment_failure_downtime", "add_process_interruption_downtime"])
    });

    useVdtStudioStore.getState().toggleChangeSelection("add_equipment_failure_downtime");

    expect(useVdtStudioStore.getState().changeSetSelection).toEqual(
      new Set(["add_process_interruption_downtime"])
    );

    useVdtStudioStore.getState().toggleChangeSelection("add_equipment_failure_downtime");

    expect(useVdtStudioStore.getState().changeSetSelection).toEqual(
      new Set(["add_process_interruption_downtime", "add_equipment_failure_downtime"])
    );
  });

  it("applyPendingChangeSet appends a version snapshot and applies selected additions", () => {
    const changeSet = mockDeepenChangeSet();
    useVdtStudioStore.setState({
      pendingChangeSet: changeSet,
      changeSetSelection: new Set(["add_equipment_failure_downtime"])
    });

    const initialVersionCount = useVdtStudioStore.getState().project.versions.length;
    const initialNodeCount = useVdtStudioStore.getState().project.graph.nodes.length;

    useVdtStudioStore.getState().applyPendingChangeSet();

    const state = useVdtStudioStore.getState();
    expect(state.pendingChangeSet).toBeUndefined();
    expect(state.changeSetSelection.size).toBe(0);
    expect(state.project.versions.length).toBe(initialVersionCount + 1);
    expect(state.project.versions.at(-1)?.name).toBe("Before deepen_node apply");
    expect(state.project.versions.at(-1)?.taskType).toBe("deepen_node");
    expect(state.project.graph.nodes.length).toBe(initialNodeCount + 1);
    expect(state.project.graph.nodes.map((node) => node.id)).toContain("equipment_failure_downtime");
    expect(state.project.graph.nodes.map((node) => node.id)).not.toContain("process_interruption_downtime");
  });

  it("discardPendingChangeSet clears pending change-set state", () => {
    useVdtStudioStore.setState({
      pendingChangeSet: mockDeepenChangeSet(),
      changeSetSelection: new Set(["add_equipment_failure_downtime"]),
      aiActionError: "stale error"
    });

    useVdtStudioStore.getState().discardPendingChangeSet();

    const state = useVdtStudioStore.getState();
    expect(state.pendingChangeSet).toBeUndefined();
    expect(state.changeSetSelection.size).toBe(0);
    expect(state.aiActionError).toBeUndefined();
  });

  it("restoreVersionSnapshot reverts graph and discards pending change set", () => {
    const changeSet = mockDeepenChangeSet();
    const initialNodeCount = useVdtStudioStore.getState().project.graph.nodes.length;

    useVdtStudioStore.setState({
      pendingChangeSet: changeSet,
      changeSetSelection: new Set([
        "add_equipment_failure_downtime",
        "add_process_interruption_downtime"
      ])
    });
    useVdtStudioStore.getState().applyPendingChangeSet();

    const versionId = useVdtStudioStore.getState().project.versions.at(-1)!.id;
    expect(useVdtStudioStore.getState().project.graph.nodes.length).toBe(initialNodeCount + 2);

    useVdtStudioStore.setState({
      pendingChangeSet: changeSet,
      changeSetSelection: new Set(["add_equipment_failure_downtime"]),
      aiActionError: "stale preview"
    });

    useVdtStudioStore.getState().restoreVersionSnapshot(versionId);

    const state = useVdtStudioStore.getState();
    expect(state.pendingChangeSet).toBeUndefined();
    expect(state.changeSetSelection.size).toBe(0);
    expect(state.aiActionError).toBeUndefined();
    expect(state.project.graph.nodes.length).toBe(initialNodeCount);
    expect(state.project.graph.nodes.map((node) => node.id)).not.toContain("equipment_failure_downtime");
  });

  it("runAiAction stores advisory results for review_model", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/ai/run-task")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            result: { kind: "advisory", result: productionVolumeReviewOutput }
          })
        } as Response;
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({ agents: [] })
      } as Response;
    });

    await useVdtStudioStore.getState().runAiAction("review_model", {});

    const state = useVdtStudioStore.getState();
    expect(state.pendingAdvisoryResult).toEqual(productionVolumeReviewOutput);
    expect(state.pendingChangeSet).toBeUndefined();
    expect(state.aiActionError).toBeUndefined();
  });
});

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
      providerId: "local_runner",
      runnerPairingToken: "test-session-token"
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

  it("stores enriched detection fields from the detect-clis API", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        agents: [
          {
            id: "cursor-agent",
            installed: true,
            executable: "/usr/local/bin/agent",
            alias: "agent",
            version: "0.46.0",
            status: "ready",
            authSummary: "Cursor account is authenticated and ready.",
            diagnostics: []
          }
        ],
        modelsByAgent: { "cursor-agent": ["auto"] }
      })
    } as Response);

    await useVdtStudioStore.getState().rescanClis();

    const agent = useVdtStudioStore.getState().cliDetectionAgents?.find((entry) => entry.id === "cursor-agent");
    expect(agent?.status).toBe("ready");
    expect(agent?.authSummary).toMatch(/authenticated/i);
    expect(useVdtStudioStore.getState().cliDiscoveredModelsByAgent["cursor-agent"]).toEqual(["auto"]);
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
      runnerPairingToken: "test-session-token",
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
        backendId?: string;
        pairingToken?: string;
        timeoutMs?: number;
      };
    };

    expect(body.operation).toBe("connection_test");
    expect(body.providerId).toBe("local_runner");
    expect(body.providerConfig).toMatchObject({
      backendId: "claude_subscription",
      pairingToken: "test-session-token",
      timeoutMs: 60_000
    });

    const state = useVdtStudioStore.getState();
    expect(state.cliTestStatusByAgent.claude?.kind).toBe("success");
  });

  it("posts a real Local CLI connection test for codex", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/ai/generate-vdt")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true })
        } as Response;
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({ agents: [] })
      } as Response;
    });

    useVdtStudioStore.setState({
      runnerPairingToken: "test-session-token",
      cliDetectionAgents: [
        {
          id: "codex",
          installed: true,
          executable: "/usr/local/bin/codex",
          alias: "/usr/local/bin/codex",
          version: "0.25.0",
          status: "ready",
          authSummary: "ChatGPT subscription is authenticated and ready."
        }
      ],
      executionSettings: {
        ...DEFAULT_EXECUTION_SETTINGS,
        executionMode: "local_cli",
        selectedCliAgentId: "codex",
        localRunnerPresetId: "custom_cli_json",
        runnerProviderId: "cli_stub",
        command: "/usr/local/bin/codex"
      }
    });

    await useVdtStudioStore.getState().testCli("codex");

    const testProviderCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/api/ai/generate-vdt"));
    expect(testProviderCall).toBeDefined();

    const [, requestInit] = testProviderCall!;
    const body = JSON.parse(String(requestInit?.body)) as {
      operation?: string;
      providerId?: string;
      providerConfig?: { backendId?: string };
    };

    expect(body.operation).toBe("connection_test");
    expect(body.providerId).toBe("local_runner");
    expect(body.providerConfig?.backendId).toBe("codex_subscription");
    expect(useVdtStudioStore.getState().cliTestStatusByAgent.codex?.kind).toBe("success");
  });

  it("shows a real CLI test error from the application API", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ ok: false, error: "Claude Code authentication failed." })
    } as Response);

    useVdtStudioStore.setState({
      runnerPairingToken: "test-session-token",
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

    useVdtStudioStore.setState({ runnerPairingToken: "test-session-token" });

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
