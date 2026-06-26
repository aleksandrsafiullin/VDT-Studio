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

function agentRunFixture(overrides: Record<string, unknown> = {}) {
  return {
    runId: "agent-run-store-1",
    status: "succeeded",
    phase: "reporting",
    request: {
      rootKpi: "Production Volume",
      industry: "Mining"
    },
    selectedSkills: [
      {
        id: "mining.production_volume",
        path: "packages/vdt-agent/skills/mining/production-volume.md",
        reason: "Matched production volume mining context."
      }
    ],
    events: [
      {
        id: "evt-classification",
        timestamp: "2026-06-24T10:00:01.000Z",
        type: "classification",
        title: "Classified request",
        message: "Classified request as mining / production throughput."
      },
      {
        id: "evt-final-report",
        timestamp: "2026-06-24T10:00:05.000Z",
        type: "final_report",
        title: "Final report",
        message: "Generated final report."
      }
    ],
    finalReport: "Validation result: Graph validation passed.",
    ...overrides
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
            result: { kind: "change_set", changeSet, agentRun: agentRunFixture() }
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
    expect(state.generateActivity).toMatchObject({
      status: "ready",
      schemaId: "deepen-node-v1",
      agentRun: {
        runId: "agent-run-store-1",
        selectedSkills: expect.arrayContaining([expect.objectContaining({ id: "mining.production_volume" })])
      },
      finalReport: "Validation result: Graph validation passed."
    });
  });

  it("runAiAction reaches managed local CLI runtime without runner pairing", async () => {
    const changeSet = mockDeepenChangeSet();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/ai/dev-runtime")) {
        const body = JSON.parse(String(init?.body)) as {
          operation?: string;
          request?: {
            backendId?: string;
            taskType?: string;
            schemaId?: string;
            input?: { nodeId?: string; project?: { id?: string } };
          };
        };
        expect(body.operation).toBe("complete");
        expect(body.request).toMatchObject({
          backendId: "codex_subscription",
          taskType: "deepen_node",
          schemaId: "deepen-node-v1"
        });
        expect(body.request?.input?.nodeId).toBe("unplanned_downtime");
        expect(body.request?.input?.project?.id).toBe(productionVolumeProject.id);
        expect(String(init?.body)).not.toContain("pairingToken");
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            output: { kind: "change_set", changeSet }
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
      runnerPairingToken: undefined,
      cliDetectionAgents: [
        {
          id: "codex",
          installed: true,
          executable: "/usr/local/bin/codex",
          alias: "codex",
          version: "0.128.0",
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
        command: "/usr/local/bin/codex",
        cliModelSelection: { source: "agent_default" }
      },
      providerId: "local_runner",
      providerConfig: {
        localRunnerPresetId: "custom_cli_json",
        runnerProviderId: "cli_stub"
      }
    });

    await useVdtStudioStore.getState().runAiAction("deepen_node", { nodeId: "unplanned_downtime" });

    const devRuntimeCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/api/ai/dev-runtime"));
    expect(devRuntimeCall).toBeDefined();
    const state = useVdtStudioStore.getState();
    expect(state.aiActionError).toBeUndefined();
    expect(state.pendingChangeSet?.id).toBe(changeSet.id);
    expect(state.changeSetSelection).toEqual(
      new Set(["add_equipment_failure_downtime", "add_process_interruption_downtime"])
    );
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

  it("posts a real Local CLI connection test to the managed development runtime", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/ai/dev-runtime")) {
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

    const testProviderCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/api/ai/dev-runtime"));
    expect(testProviderCall).toBeDefined();

    const [, requestInit] = testProviderCall!;
    const body = JSON.parse(String(requestInit?.body)) as {
      operation?: string;
      backendId?: string;
    };

    expect(body).toEqual({
      operation: "test",
      backendId: "claude_subscription"
    });
    expect(String(requestInit?.body)).not.toContain("pairingToken");

    const state = useVdtStudioStore.getState();
    expect(state.cliTestStatusByAgent.claude?.kind).toBe("success");
  });

  it("posts a real Local CLI connection test for codex without pairing", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/ai/dev-runtime")) {
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
        command: "/usr/local/bin/codex"
      }
    });

    await useVdtStudioStore.getState().testCli("codex");

    const testProviderCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/api/ai/dev-runtime"));
    expect(testProviderCall).toBeDefined();

    const [, requestInit] = testProviderCall!;
    const body = JSON.parse(String(requestInit?.body)) as {
      operation?: string;
      backendId?: string;
    };

    expect(body.operation).toBe("test");
    expect(body.backendId).toBe("codex_subscription");
    expect(String(requestInit?.body)).not.toContain("pairingToken");
    expect(useVdtStudioStore.getState().cliTestStatusByAgent.codex?.kind).toBe("success");
  });

  it("generates with Cursor Agent through desktop sidecar without standalone pairing", async () => {
    vi.stubEnv("NEXT_PUBLIC_VDT_APP_MODE", "desktop");
    const previousTauri = (globalThis as typeof globalThis & { __TAURI__?: unknown }).__TAURI__;
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      expect(command).toBe("ai_complete");
      expect(JSON.stringify(args)).not.toContain("pairingToken");
      expect(args?.request).toMatchObject({
        providerId: "local_runner",
        backendId: "cursor_subscription",
        taskType: "generate_tree",
        schemaId: "generate-tree-v1",
        timeoutMs: 120_000
      });
      return {
        output: {
          projectTitle: "Revenue Value Driver Tree",
          rootNodeId: "revenue",
          nodes: [
            {
              id: "revenue",
              name: "Revenue",
              description: "Total business revenue.",
              type: "root_kpi",
              unit: "USD/month",
              aiConfidence: 0.9,
              aiRationale: "Revenue is the requested root KPI.",
              controllability: "medium",
              materiality: "high"
            },
            {
              id: "price",
              name: "Price",
              description: "Average selling price.",
              type: "input",
              unit: "USD/unit",
              aiConfidence: 0.8,
              aiRationale: "Price directly affects revenue.",
              controllability: "medium",
              materiality: "high"
            },
            {
              id: "volume",
              name: "Volume",
              description: "Units sold.",
              type: "input",
              unit: "units/month",
              aiConfidence: 0.8,
              aiRationale: "Volume directly affects revenue.",
              controllability: "high",
              materiality: "high"
            }
          ],
          edges: [
            {
              id: "edge_revenue_price",
              sourceNodeId: "revenue",
              targetNodeId: "price",
              relation: "multiplicative_driver",
              aiConfidence: 0.8
            },
            {
              id: "edge_revenue_volume",
              sourceNodeId: "revenue",
              targetNodeId: "volume",
              relation: "multiplicative_driver",
              aiConfidence: 0.8
            }
          ],
          assumptions: [],
          questionsForUser: [],
          warnings: []
        }
      };
    });

    vi.stubGlobal("__TAURI__", { core: { invoke } });

    try {
      useVdtStudioStore.setState({
        runnerPairingToken: undefined,
        cliDetectionAgents: [
          {
            id: "cursor-agent",
            installed: true,
            executable: "/Users/aks/.local/bin/agent",
            alias: "agent",
            version: "2026.06.19",
            status: "ready",
            authSummary: "Cursor account is authenticated and ready."
          }
        ],
        executionSettings: {
          ...DEFAULT_EXECUTION_SETTINGS,
          executionMode: "local_cli",
          selectedCliAgentId: "cursor-agent",
          localRunnerPresetId: "custom_cli_json",
          runnerProviderId: "cli_stub",
          timeoutSec: 60,
          cliModelSelection: { source: "agent_default" }
        },
        providerId: "local_runner",
        providerConfig: {
          localRunnerPresetId: "custom_cli_json",
          runnerProviderId: "cli_stub",
          timeoutSec: 60
        }
      });

      await useVdtStudioStore.getState().generateWithAi();

      expect(invoke).toHaveBeenCalledTimes(1);
      const state = useVdtStudioStore.getState();
      expect(state.aiError).toBeUndefined();
      expect(state.project.name).toBe("Revenue Value Driver Tree");
      expect(state.project.rootNodeId).toBe("revenue");
      expect(state.isGenerating).toBe(false);
    } finally {
      vi.unstubAllEnvs();
      vi.stubGlobal("__TAURI__", previousTauri);
    }
  });

  it("generates with Codex CLI through desktop sidecar without standalone pairing", async () => {
    vi.stubEnv("NEXT_PUBLIC_VDT_APP_MODE", "desktop");
    const previousTauri = (globalThis as typeof globalThis & { __TAURI__?: unknown }).__TAURI__;
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      expect(command).toBe("ai_complete");
      expect(JSON.stringify(args)).not.toContain("pairingToken");
      expect(args?.request).toMatchObject({
        providerId: "local_runner",
        backendId: "codex_subscription",
        taskType: "generate_tree",
        schemaId: "generate-tree-v1",
        timeoutMs: 120_000
      });
      return {
        output: {
          projectTitle: "Revenue Value Driver Tree",
          rootNodeId: "revenue",
          nodes: [
            {
              id: "revenue",
              name: "Revenue",
              description: "Total business revenue.",
              type: "root_kpi",
              unit: "USD/month",
              aiConfidence: 0.9,
              aiRationale: "Revenue is the requested root KPI.",
              controllability: "medium",
              materiality: "high"
            },
            {
              id: "price",
              name: "Price",
              description: "Average selling price.",
              type: "input",
              unit: "USD/unit",
              aiConfidence: 0.8,
              aiRationale: "Price directly affects revenue.",
              controllability: "medium",
              materiality: "high"
            },
            {
              id: "volume",
              name: "Volume",
              description: "Units sold.",
              type: "input",
              unit: "units/month",
              aiConfidence: 0.8,
              aiRationale: "Volume directly affects revenue.",
              controllability: "high",
              materiality: "high"
            }
          ],
          edges: [
            {
              id: "edge_revenue_price",
              sourceNodeId: "revenue",
              targetNodeId: "price",
              relation: "multiplicative_driver",
              aiConfidence: 0.8
            },
            {
              id: "edge_revenue_volume",
              sourceNodeId: "revenue",
              targetNodeId: "volume",
              relation: "multiplicative_driver",
              aiConfidence: 0.8
            }
          ],
          assumptions: [],
          questionsForUser: [],
          warnings: []
        }
      };
    });

    vi.stubGlobal("__TAURI__", { core: { invoke } });

    try {
      useVdtStudioStore.setState({
        runnerPairingToken: undefined,
        cliDetectionAgents: [
          {
            id: "codex",
            installed: true,
            executable: "/usr/local/bin/codex",
            alias: "codex",
            version: "0.128.0",
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
          timeoutSec: 60,
          cliModelSelection: { source: "agent_default" }
        },
        providerId: "local_runner",
        providerConfig: {
          localRunnerPresetId: "custom_cli_json",
          runnerProviderId: "cli_stub",
          timeoutSec: 60
        }
      });

      await useVdtStudioStore.getState().generateWithAi();

      expect(invoke).toHaveBeenCalledTimes(1);
      const state = useVdtStudioStore.getState();
      expect(state.aiError).toBeUndefined();
      expect(state.project.name).toBe("Revenue Value Driver Tree");
      expect(state.project.rootNodeId).toBe("revenue");
      expect(state.isGenerating).toBe(false);
    } finally {
      vi.unstubAllEnvs();
      vi.stubGlobal("__TAURI__", previousTauri);
    }
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
      if (url.includes("/api/ai/dev-runtime")) {
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

    const generateCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/api/ai/dev-runtime"));
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

describe("vdt-store generate activity", () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, project: cloneProject(productionVolumeProject), agentRun: agentRunFixture() })
      })
    );
    useVdtStudioStore.setState({
      project: cloneProject(productionVolumeProject),
      selectedNodeId: productionVolumeProject.rootNodeId,
      activeScenarioId: productionVolumeProject.scenarios[0]?.id ?? "",
      isGenerating: false,
      generateActivity: undefined,
      aiError: undefined,
      providerId: "mock",
      executionSettings: {
        ...DEFAULT_EXECUTION_SETTINGS,
        useMockProvider: true,
        gatewayPresetId: "mock"
      }
    });
  });

  it("tracks observable generate phases and marks the run ready", async () => {
    await useVdtStudioStore.getState().generateWithAi();

    const state = useVdtStudioStore.getState();
    expect(state.isGenerating).toBe(false);
    expect(state.aiError).toBeUndefined();
    expect(state.generateActivity).toMatchObject({
      status: "ready",
      phase: "ready",
      providerId: "mock",
      providerLabel: "Built-in mock",
      backendId: "mock",
      canCancel: false
    });
    expect(state.generateActivity?.runId).toBeTruthy();
    expect(state.generateActivity?.completedAt).toBeTruthy();
    expect(state.generateActivity?.agentRun).toMatchObject({
      runId: "agent-run-store-1",
      selectedSkills: expect.arrayContaining([expect.objectContaining({ id: "mining.production_volume" })])
    });
    expect(state.generateActivity?.agentEvents?.map((event) => event.type)).toEqual(expect.arrayContaining([
      "classification",
      "final_report"
    ]));
    expect(state.generateActivity?.finalReport).toBe("Validation result: Graph validation passed.");
    expect(state.generateActivity?.summary).toBe("Validation result: Graph validation passed.");
  });

  it("updates generate activity from client onProgress runtime events", async () => {
    const fetchMock = vi.mocked(fetch);
    let runtimeRequestId = "";
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/ai/dev-runtime")) {
        const body = JSON.parse(String(init?.body)) as {
          operation?: string;
          request?: { requestId?: string; backendId?: string; taskType?: string; schemaId?: string };
        };
        runtimeRequestId = body.request?.requestId ?? "";
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            output: cloneProject(productionVolumeProject),
            run: {
              requestId: runtimeRequestId,
              backendId: body.request?.backendId,
              taskType: body.request?.taskType,
              schemaId: body.request?.schemaId,
              status: "running",
              progress: {
                phase: "repairing_output",
                label: "Repairing output",
                updatedAt: "2026-06-24T10:00:04.000Z"
              },
              outputBytes: 4096,
              schemaValid: true,
              repairAttempted: true,
              repairSucceeded: true,
              agentRun: agentRunFixture()
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

    useVdtStudioStore.setState({
      cliDetectionAgents: [
        {
          id: "codex",
          installed: true,
          executable: "/usr/local/bin/codex",
          alias: "codex",
          version: "0.128.0",
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
        timeoutSec: 60,
        cliModelSelection: { source: "agent_default" }
      },
      providerId: "local_runner",
      providerConfig: {
        localRunnerPresetId: "custom_cli_json",
        runnerProviderId: "cli_stub",
        timeoutSec: 60
      }
    });

    await useVdtStudioStore.getState().generateWithAi();

    const activity = useVdtStudioStore.getState().generateActivity;
    expect(runtimeRequestId).toBeTruthy();
    expect(activity).toMatchObject({
      status: "ready",
      phase: "ready",
      requestId: runtimeRequestId,
      backendId: "codex_subscription",
      schemaId: "generate-tree-v1",
      outputBytes: 4096,
      schemaValid: true,
      repairAttempted: true,
      repairSucceeded: true
    });
    expect(activity?.summary).toBe("Validation result: Graph validation passed.");
    expect(activity?.agentRun).toMatchObject({
      runId: "agent-run-store-1",
      status: "succeeded",
      selectedSkills: expect.arrayContaining([expect.objectContaining({ id: "mining.production_volume" })])
    });
    expect(activity?.agentEvents?.map((event) => event.type)).toEqual(expect.arrayContaining([
      "classification",
      "final_report"
    ]));
    expect(activity?.finalReport).toBe("Validation result: Graph validation passed.");
    expect(activity?.details).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "request-prepared", status: "complete" }),
      expect.objectContaining({ id: "backend-started", status: "complete" }),
      expect.objectContaining({ id: "provider-request", status: "complete" }),
      expect.objectContaining({ id: "schema-validation", status: "complete" }),
      expect.objectContaining({ id: "canvas-build", status: "complete" })
    ]));
  });

  it("keeps needs_user_input status and questions from runtime agentRun snapshots", async () => {
    const fetchMock = vi.mocked(fetch);
    let runtimeRequestId = "";
    let capturedSignal: AbortSignal | undefined;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/ai/dev-runtime")) {
        const body = JSON.parse(String(init?.body)) as {
          operation?: string;
          requestId?: string;
          request?: { requestId?: string; backendId?: string; taskType?: string; schemaId?: string };
        };
        if (body.operation === "run") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              ok: true,
              run: {
                requestId: body.requestId,
                backendId: "codex_subscription",
                taskType: "generate_tree",
                schemaId: "generate-tree-v1",
                status: "running",
                progress: {
                  phase: "waiting_for_provider",
                  label: "Waiting for CLI/provider",
                  updatedAt: "2026-06-24T10:00:03.000Z"
                },
                agentRun: agentRunFixture({
                  status: "needs_user_input",
                  phase: "asking_clarifying_questions",
                  questionsForUser: ["What is the rated truck payload?"],
                  finalReport: undefined
                })
              }
            })
          } as Response;
        }
        runtimeRequestId = body.request?.requestId ?? "";
        capturedSignal = init?.signal ?? undefined;
        return await new Promise<Response>((_resolve, reject) => {
          capturedSignal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        });
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
          id: "codex",
          installed: true,
          executable: "/usr/local/bin/codex",
          alias: "codex",
          version: "0.128.0",
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
        timeoutSec: 60,
        cliModelSelection: { source: "agent_default" }
      },
      providerId: "local_runner",
      providerConfig: {
        localRunnerPresetId: "custom_cli_json",
        runnerProviderId: "cli_stub",
        timeoutSec: 60
      }
    });

    const generatePromise = useVdtStudioStore.getState().generateWithAi();
    await vi.waitFor(() => expect(runtimeRequestId).toMatch(/^[0-9a-f-]+$/));
    await vi.waitFor(() => expect(useVdtStudioStore.getState().generateActivity?.status).toBe("needs_user_input"));

    const activity = useVdtStudioStore.getState().generateActivity;
    expect(activity?.questionsForUser).toEqual(["What is the rated truck payload?"]);
    expect(activity?.agentRun?.status).toBe("needs_user_input");
    expect(activity?.canCancel).toBe(true);

    useVdtStudioStore.getState().cancelGenerate();
    await generatePromise;
    expect(capturedSignal?.aborted).toBe(true);
  });

  it("aborts an active generate request through cancelGenerate", async () => {
    let capturedSignal: AbortSignal | undefined;
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined;
      return await new Promise<Response>((_resolve, reject) => {
        capturedSignal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    });

    const generatePromise = useVdtStudioStore.getState().generateWithAi();
    await vi.waitFor(() => expect(useVdtStudioStore.getState().generateActivity?.status).toBe("running"));

    useVdtStudioStore.getState().cancelGenerate();
    expect(useVdtStudioStore.getState().generateActivity).toMatchObject({
      status: "cancelled",
      cancelRequested: true,
      canCancel: false,
      message: "Generation cancelled."
    });
    await generatePromise;

    const state = useVdtStudioStore.getState();
    expect(capturedSignal?.aborted).toBe(true);
    expect(state.isGenerating).toBe(false);
    expect(state.aiError).toBeUndefined();
    expect(state.generateActivity).toMatchObject({
      status: "cancelled",
      cancelRequested: true,
      canCancel: false,
      message: "Generation cancelled."
    });
  });

  it("does not apply a late successful completion after cancelGenerate", async () => {
    let capturedSignal: AbortSignal | undefined;
    let resolveFetch: ((response: Response) => void) | undefined;
    const lateProject = {
      ...cloneProject(productionVolumeProject),
      id: "late_project",
      name: "Late Cancelled Project",
      rootNodeId: productionVolumeProject.rootNodeId
    };
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined;
      return await new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });
    });

    const initialProjectId = useVdtStudioStore.getState().project.id;
    const initialProjectName = useVdtStudioStore.getState().project.name;
    const generatePromise = useVdtStudioStore.getState().generateWithAi();
    await vi.waitFor(() => expect(useVdtStudioStore.getState().generateActivity?.status).toBe("running"));

    useVdtStudioStore.getState().cancelGenerate();
    expect(capturedSignal?.aborted).toBe(true);
    resolveFetch?.({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, project: lateProject, agentRun: agentRunFixture() })
    } as Response);
    await generatePromise;

    const state = useVdtStudioStore.getState();
    expect(state.isGenerating).toBe(false);
    expect(state.project.id).toBe(initialProjectId);
    expect(state.project.name).toBe(initialProjectName);
    expect(state.project.name).not.toBe("Late Cancelled Project");
    expect(state.generateActivity).toMatchObject({
      status: "cancelled",
      cancelRequested: true,
      canCancel: false,
      message: "Generation cancelled."
    });
  });
});

describe("vdt-store renameScenario", () => {
  const scenarioId = "scenario_reduce_unplanned_downtime";
  const originalName = "Reduce unplanned downtime";

  beforeEach(() => {
    localStorageMock.clear();
    useVdtStudioStore.setState({
      project: cloneProject(productionVolumeProject),
      activeScenarioId: scenarioId
    });
  });

  it("trims whitespace from the new name", () => {
    useVdtStudioStore.getState().renameScenario(scenarioId, "  Optimized downtime  ");

    const scenario = useVdtStudioStore.getState().project.scenarios.find((s) => s.id === scenarioId);
    expect(scenario?.name).toBe("Optimized downtime");
  });

  it("no-ops on empty or whitespace-only names", () => {
    const before = useVdtStudioStore.getState().project;

    useVdtStudioStore.getState().renameScenario(scenarioId, "   ");
    expect(useVdtStudioStore.getState().project).toBe(before);

    useVdtStudioStore.getState().renameScenario(scenarioId, "");
    expect(useVdtStudioStore.getState().project).toBe(before);
    expect(
      useVdtStudioStore.getState().project.scenarios.find((s) => s.id === scenarioId)?.name
    ).toBe(originalName);
  });

  it("renames the scenario and updates timestamps", () => {
    const beforeProjectUpdatedAt = useVdtStudioStore.getState().project.updatedAt;
    const beforeScenarioUpdatedAt = useVdtStudioStore
      .getState()
      .project.scenarios.find((s) => s.id === scenarioId)?.updatedAt;

    useVdtStudioStore.getState().renameScenario(scenarioId, "Lower downtime case");

    const state = useVdtStudioStore.getState();
    const scenario = state.project.scenarios.find((s) => s.id === scenarioId);

    expect(scenario?.name).toBe("Lower downtime case");
    expect(scenario?.updatedAt).not.toBe(beforeScenarioUpdatedAt);
    expect(state.project.updatedAt).not.toBe(beforeProjectUpdatedAt);
    expect(state.activeScenarioId).toBe(scenarioId);
    expect(scenario?.overrides).toEqual(
      productionVolumeProject.scenarios.find((s) => s.id === scenarioId)?.overrides
    );
  });
});

describe("vdt-store deleteScenario", () => {
  const scenarioId = "scenario_reduce_unplanned_downtime";

  beforeEach(() => {
    localStorageMock.clear();
    useVdtStudioStore.setState({
      project: cloneProject(productionVolumeProject),
      activeScenarioId: scenarioId
    });
  });

  it("removes a non-active scenario without changing activeScenarioId", () => {
    useVdtStudioStore.getState().createScenario();
    const stateAfterCreate = useVdtStudioStore.getState();
    const secondId = stateAfterCreate.activeScenarioId;
    const firstId = scenarioId;

    useVdtStudioStore.getState().setActiveScenarioId(firstId);
    useVdtStudioStore.getState().deleteScenario(secondId);

    const state = useVdtStudioStore.getState();
    expect(state.activeScenarioId).toBe(firstId);
    expect(state.project.scenarios).toHaveLength(1);
    expect(state.project.scenarios.find((s) => s.id === secondId)).toBeUndefined();
  });

  it("reassigns activeScenarioId when deleting active scenario at index 0", () => {
    useVdtStudioStore.getState().createScenario();
    const secondId = useVdtStudioStore.getState().activeScenarioId;

    useVdtStudioStore.getState().setActiveScenarioId(scenarioId);
    useVdtStudioStore.getState().deleteScenario(scenarioId);

    const state = useVdtStudioStore.getState();
    expect(state.activeScenarioId).toBe(secondId);
    expect(state.project.scenarios).toHaveLength(1);
    expect(state.project.scenarios.find((s) => s.id === scenarioId)).toBeUndefined();
  });

  it("reassigns activeScenarioId when deleting active scenario at middle index", () => {
    useVdtStudioStore.getState().createScenario();
    const secondId = useVdtStudioStore.getState().activeScenarioId;
    useVdtStudioStore.getState().createScenario();
    const thirdId = useVdtStudioStore.getState().activeScenarioId;

    useVdtStudioStore.getState().setActiveScenarioId(secondId);
    useVdtStudioStore.getState().deleteScenario(secondId);

    const state = useVdtStudioStore.getState();
    expect(state.activeScenarioId).toBe(thirdId);
    expect(state.project.scenarios).toHaveLength(2);
    expect(state.project.scenarios.find((s) => s.id === secondId)).toBeUndefined();
  });

  it("reassigns activeScenarioId when deleting active scenario at last index", () => {
    useVdtStudioStore.getState().createScenario();
    const secondId = useVdtStudioStore.getState().activeScenarioId;

    useVdtStudioStore.getState().setActiveScenarioId(secondId);
    useVdtStudioStore.getState().deleteScenario(secondId);

    const state = useVdtStudioStore.getState();
    expect(state.activeScenarioId).toBe(scenarioId);
    expect(state.project.scenarios).toHaveLength(1);
    expect(state.project.scenarios.find((s) => s.id === secondId)).toBeUndefined();
  });

  it("no-ops when only one scenario remains", () => {
    const before = useVdtStudioStore.getState().project;

    useVdtStudioStore.getState().deleteScenario(scenarioId);

    expect(useVdtStudioStore.getState().project).toBe(before);
    expect(useVdtStudioStore.getState().activeScenarioId).toBe(scenarioId);
  });

  it("no-ops on unknown scenario id", () => {
    const before = useVdtStudioStore.getState().project;

    useVdtStudioStore.getState().deleteScenario("scenario_unknown");

    expect(useVdtStudioStore.getState().project).toBe(before);
    expect(useVdtStudioStore.getState().activeScenarioId).toBe(scenarioId);
  });
});

describe("vdt-store cloneScenario", () => {
  const scenarioId = "scenario_reduce_unplanned_downtime";
  const originalName = "Reduce unplanned downtime";

  beforeEach(() => {
    localStorageMock.clear();
    useVdtStudioStore.setState({
      project: cloneProject(productionVolumeProject),
      activeScenarioId: scenarioId
    });
  });

  it("clones overrides and activates the new scenario", () => {
    const sourceOverrides = productionVolumeProject.scenarios.find((s) => s.id === scenarioId)?.overrides;

    useVdtStudioStore.getState().cloneScenario(scenarioId);

    const state = useVdtStudioStore.getState();
    const clone = state.project.scenarios.find((scenario) => scenario.id === state.activeScenarioId);

    expect(state.project.scenarios).toHaveLength(2);
    expect(clone?.name).toBe(`${originalName} copy`);
    expect(clone?.overrides).toEqual(sourceOverrides);
    expect(clone?.results).toBeUndefined();
    expect(clone?.baselineScenarioId).toBeUndefined();
    expect(state.activeScenarioId).toBe(clone?.id);
    expect(state.project.updatedAt).not.toBe(productionVolumeProject.updatedAt);
  });

  it("dedupes clone names when a copy already exists", () => {
    useVdtStudioStore.getState().cloneScenario(scenarioId);
    useVdtStudioStore.getState().cloneScenario(scenarioId);

    const names = useVdtStudioStore.getState().project.scenarios.map((scenario) => scenario.name);
    expect(names).toContain(`${originalName} copy`);
    expect(names).toContain(`${originalName} copy (2)`);
  });

  it("no-ops on unknown scenario id", () => {
    const before = useVdtStudioStore.getState().project;

    useVdtStudioStore.getState().cloneScenario("scenario_unknown");

    expect(useVdtStudioStore.getState().project).toBe(before);
    expect(useVdtStudioStore.getState().activeScenarioId).toBe(scenarioId);
  });
});
