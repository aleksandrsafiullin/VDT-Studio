import { beforeEach, describe, expect, it, vi } from "vitest";
import { cloneProject, productionVolumeProject, type VdtChangeSet } from "@vdt-studio/vdt-core";
import { productionVolumeReviewOutput } from "@vdt-studio/ai-harness";
import { DEFAULT_EXECUTION_SETTINGS, getCliCatalogEntry } from "@/lib/execution-mode-catalog";
import type { VdtAgentRunSnapshot } from "@/lib/agent-client";

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

beforeEach(() => {
  useVdtStudioStore.setState({
    isGenerating: false,
    generateActivity: undefined,
    agentChatHistory: [],
    aiError: undefined,
    activeAgentRunId: undefined,
    agentRun: undefined,
    agentEvents: [],
    agentPendingQuestions: undefined,
    agentError: undefined,
    agentConnectionStatus: "disconnected"
  });
});

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

function jsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
    json: async () => payload
  } as Response;
}

function runtimeSnapshotFixture(overrides: Record<string, unknown> = {}) {
  const runId = typeof overrides.runId === "string" ? overrides.runId : "agent-run-store-1";
  const updatedAt = "2026-06-24T10:00:05.000Z";
  const project = cloneProject(productionVolumeProject);
  const request = {
    mode: "generate_vdt",
    input: {
      rootKpi: "Production Volume",
      industry: "Mining"
    },
    providerId: "mock",
    options: {
      autoApplyPatches: true,
      continueWithAssumptions: false,
      maxSteps: 30
    }
  };

  return {
    runId,
    status: "succeeded",
    phase: "reporting",
    request,
    project,
    selectedSkills: [
      {
        id: "mining.production_volume",
        path: "packages/vdt-agent/skills/mining/production-volume.md",
        title: "Production volume",
        score: 92,
        reason: "Matched production volume mining context.",
        matchedTerms: ["production", "volume"]
      }
    ],
    events: [
      {
        id: `${runId}:1`,
        runId,
        seq: 1,
        timestamp: "2026-06-24T10:00:01.000Z",
        phase: "classifying_request",
        type: "classification",
        title: "Classified request",
        message: "Classified request as mining / production throughput."
      },
      {
        id: `${runId}:2`,
        runId,
        seq: 2,
        timestamp: updatedAt,
        phase: "reporting",
        type: "final_report",
        title: "Final report",
        message: "Generated final report."
      }
    ],
    chatMessages: [],
    publicStatus: {
      phase: "ready",
      message: "Validation result: Graph validation passed.",
      updatedAt
    },
    visibleContext: {
      threadId: runId,
      visibleTitle: "Production Volume",
      brief: {
        rootKpi: "Production Volume",
        industry: "Mining"
      },
      project: {
        id: project.id,
        name: project.name,
        rootNodeName: "Production Volume",
        rootNodeUnit: "tonnes/year"
      },
      visibleMessages: []
    },
    finalReport: "Validation result: Graph validation passed.",
    createdAt: "2026-06-24T10:00:00.000Z",
    updatedAt,
    completedAt: updatedAt,
    ...overrides
  };
}

function stubEventSource() {
  vi.stubGlobal("EventSource", class {
    addEventListener() {}
    close() {}
  });
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

  it("startAgentRun sends the first user instruction as prompt instead of dropping it", async () => {
    const prompt = "I have 5 trucks\nAverage distance 2.7 km\nAverage load speed - 7 km/h\nAverage empty speed - 11 km/h";
    const fetchMock = vi.mocked(fetch);
    vi.stubGlobal("EventSource", class {
      addEventListener() {}
      close() {}
    });
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/agent/runs")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            ok: true,
            runId: "agent-run-start-1",
            snapshot: {
              runId: "agent-run-start-1",
              status: "needs_user_input",
              phase: "asking_clarifying_questions",
              request: JSON.parse(String(init?.body)),
              selectedSkills: [{ id: "mining.haulage_truck_cycle", path: "mining/haulage-truck-cycle.md", title: "Truck cycle", score: 92, reason: "AI selected truck cycle.", matchedTerms: [] }],
              events: [],
              pendingQuestions: [{ id: "payload_per_trip_t", question: "Payload?", reason: "Needed.", required: true }],
              createdAt: "2026-06-27T00:00:00.000Z",
              updatedAt: "2026-06-27T00:00:00.000Z"
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
      executionSettings: {
        ...DEFAULT_EXECUTION_SETTINGS,
        executionMode: "byok",
        gatewayPresetId: "openai-default",
        byokProtocol: "openai",
        useMockProvider: false,
        apiKey: "test-key",
        model: "gpt-test"
      },
      brief: {
        rootKpi: "Ore haulage",
        industry: "Mining",
        businessContext: "",
        unit: "tonnes/year",
        timePeriod: "year",
        goal: "Build a VDT",
        levelOfDetail: "medium"
      }
    });

    await useVdtStudioStore.getState().startAgentRun(prompt, { researchMode: "on" });

    const startCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/api/agent/runs"));
    expect(startCall).toBeDefined();
    const [, requestInit] = startCall!;
    const body = JSON.parse(String(requestInit?.body)) as {
      input?: { prompt?: string; businessContext?: string };
      providerId?: string;
    };
    expect(body.providerId).toBe("openai_compatible");
    expect((body as { options?: { researchMode?: string } }).options?.researchMode).toBe("on");
    expect(body.input?.prompt).toBe(prompt);
    expect(body.input?.businessContext ?? "").not.toContain(prompt);
    expect(useVdtStudioStore.getState().agentRun?.selectedSkills.map((skill) => skill.id)).toEqual([
      "mining.haulage_truck_cycle"
    ]);
  });

  it("sendAgentInstruction sends researchMode for the active agent run", async () => {
    const runId = "agent-run-research-mode";
    let capturedMessageBody: unknown;
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(`/api/agent/runs/${runId}/messages`)) {
        capturedMessageBody = JSON.parse(String(init?.body));
        return jsonResponse({
          ok: true,
          snapshot: runtimeSnapshotFixture({
            runId,
            status: "running",
            phase: "planning_decomposition",
            completedAt: undefined,
            chatMessages: []
          })
        });
      }
      return jsonResponse({ agents: [] });
    });

    useVdtStudioStore.setState({
      activeAgentRunId: runId,
      agentRun: runtimeSnapshotFixture({
        runId,
        status: "running",
        phase: "planning_decomposition",
        completedAt: undefined
      }) as VdtAgentRunSnapshot
    });

    const accepted = await useVdtStudioStore.getState().sendAgentInstruction(
      "Continue without web research.",
      "calendar_time",
      "off"
    );

    expect(accepted).toBe(true);
    expect(capturedMessageBody).toMatchObject({
      type: "user_instruction",
      text: "Continue without web research.",
      selectedNodeId: "calendar_time",
      researchMode: "off"
    });
  });

  it("sends structured answers from restored activity and marks the agent as reading immediately", async () => {
    const fetchMock = vi.mocked(fetch);
    let capturedMessageBody: unknown;
    let resolveMessage: ((response: Response) => void) | undefined;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/agent/runs/agent-run-restored/messages")) {
        capturedMessageBody = JSON.parse(String(init?.body));
        return await new Promise<Response>((resolve) => {
          resolveMessage = resolve;
        });
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ agents: [] })
      } as Response;
    });

    useVdtStudioStore.setState({
      activeAgentRunId: undefined,
      agentRun: undefined,
      generateActivity: {
        runId: "agent-run-restored",
        status: "needs_user_input",
        phase: "waiting_provider",
        phaseStartedAt: "2026-06-27T00:00:00.000Z",
        startedAt: "2026-06-27T00:00:00.000Z",
        updatedAt: "2026-06-27T00:00:00.000Z",
        providerId: "openai_compatible",
        providerLabel: "OpenAI",
        appMode: "development_web",
        canCancel: true,
        cancelRequested: false,
        publicStatus: {
          phase: "waiting_user",
          message: "Waiting for your answer.",
          updatedAt: "2026-06-27T00:00:00.000Z"
        }
      }
    });

    const sendPromise = useVdtStudioStore.getState().sendAgentAnswers([
      {
        questionId: "fleet_in_scope",
        fields: {
          excavator_count: 5,
          haul_truck_count: 10
        }
      }
    ]);

    expect(capturedMessageBody).toMatchObject({
      type: "user_answer",
      structuredAnswers: [
        {
          questionId: "fleet_in_scope",
          fields: {
            excavator_count: 5,
            haul_truck_count: 10
          }
        }
      ]
    });
    expect(useVdtStudioStore.getState().activeAgentRunId).toBe("agent-run-restored");
    expect(useVdtStudioStore.getState().generateActivity?.status).toBe("running");
    expect(useVdtStudioStore.getState().generateActivity?.publicStatus?.message).toBe("Reading your answer...");

    resolveMessage?.({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        ok: true,
        snapshot: {
          runId: "agent-run-restored",
          status: "running",
          phase: "planning_decomposition",
          request: {
            mode: "generate_vdt",
            input: {
              prompt: "Build an excavation model.",
              rootKpi: "Excavation"
            },
            providerId: "openai_compatible"
          },
          selectedSkills: [],
          events: [],
          chatMessages: [],
          publicStatus: {
            phase: "planning_model",
            message: "Reading your answer...",
            updatedAt: "2026-06-27T00:00:01.000Z"
          },
          visibleContext: {
            threadId: "agent-run-restored",
            visibleTitle: "Excavation",
            visibleMessages: []
          },
          createdAt: "2026-06-27T00:00:00.000Z",
          updatedAt: "2026-06-27T00:00:01.000Z"
        }
      })
    } as Response);
    await sendPromise;

    expect(useVdtStudioStore.getState().generateActivity?.status).toBe("running");
    expect(useVdtStudioStore.getState().agentRun?.runId).toBe("agent-run-restored");
  });

  it("sends mutation approval messages from the active agent run", async () => {
    const fetchMock = vi.mocked(fetch);
    let capturedMessageBody: unknown;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/agent/runs/agent-run-approval/messages")) {
        capturedMessageBody = JSON.parse(String(init?.body));
        return jsonResponse({
          ok: true,
          snapshot: runtimeSnapshotFixture({
            runId: "agent-run-approval",
            status: "running",
            phase: "building_graph",
            completedAt: undefined
          })
        });
      }
      return jsonResponse({ agents: [] });
    });

    useVdtStudioStore.setState({
      activeAgentRunId: "agent-run-approval",
      generateActivity: {
        runId: "agent-run-approval",
        status: "running",
        phase: "waiting_provider",
        phaseStartedAt: "2026-06-27T00:00:00.000Z",
        startedAt: "2026-06-27T00:00:00.000Z",
        updatedAt: "2026-06-27T00:00:00.000Z",
        providerId: "mock",
        providerLabel: "Mock",
        appMode: "development_web",
        canCancel: true,
        cancelRequested: false
      }
    });

    await useVdtStudioStore.getState().sendAgentApproval(true, ["add_working_time"]);

    expect(capturedMessageBody).toEqual({
      type: "approval",
      approved: true,
      selectedChangeIds: ["add_working_time"]
    });
    expect(useVdtStudioStore.getState().agentRun?.runId).toBe("agent-run-approval");
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

  it("addManualIncomingKpi creates an editable incoming KPI under the selected node", () => {
    const initialNodeCount = useVdtStudioStore.getState().project.graph.nodes.length;

    useVdtStudioStore.getState().addManualIncomingKpi("calendar_time");

    const state = useVdtStudioStore.getState();
    const parent = state.project.graph.nodes.find((node) => node.id === "calendar_time");
    const added = state.project.graph.nodes.find((node) => node.id === parent?.formula);
    const edge = state.project.graph.edges.find((candidate) => candidate.targetNodeId === added?.id);

    expect(state.project.graph.nodes.length).toBe(initialNodeCount + 1);
    expect(parent).toMatchObject({
      type: "calculated",
      status: "edited"
    });
    expect(added).toMatchObject({
      name: "New incoming KPI",
      type: "input",
      status: "edited",
      unit: "hours/month",
      aiGenerated: false
    });
    expect(edge).toMatchObject({
      sourceNodeId: "calendar_time",
      targetNodeId: added?.id,
      relation: "formula_dependency",
      aiGenerated: false
    });
    expect(state.selectedNodeId).toBe(added?.id);
    expect(state.selectedPanelTab).toBe("properties");
  });

  it("requestIncomingKpisWithAi posts a selected-node instruction into the active agent chat", async () => {
    const runId = "agent-run-incoming-kpis";
    let capturedMessageBody: unknown;
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(`/api/agent/runs/${runId}/messages`)) {
        capturedMessageBody = JSON.parse(String(init?.body));
        return jsonResponse({
          ok: true,
          snapshot: runtimeSnapshotFixture({
            runId,
            status: "running",
            phase: "building_graph",
            completedAt: undefined,
            chatMessages: [
              {
                id: "msg-incoming-kpis",
                runId,
                role: "user",
                kind: "instruction",
                text: (capturedMessageBody as { text?: string }).text,
                createdAt: "2026-06-24T10:00:00.000Z"
              }
            ]
          })
        });
      }
      return jsonResponse({ agents: [] });
    });

    useVdtStudioStore.setState({
      activeAgentRunId: runId,
      agentRun: runtimeSnapshotFixture({
        runId,
        status: "running",
        phase: "building_graph",
        completedAt: undefined
      }) as VdtAgentRunSnapshot,
      generateActivity: {
        runId,
        status: "running",
        phase: "waiting_provider",
        phaseStartedAt: "2026-06-27T00:00:00.000Z",
        startedAt: "2026-06-27T00:00:00.000Z",
        updatedAt: "2026-06-27T00:00:00.000Z",
        providerId: "mock",
        providerLabel: "Mock",
        appMode: "development_web",
        canCancel: true,
        cancelRequested: false
      }
    });

    const accepted = await useVdtStudioStore.getState().requestIncomingKpisWithAi("calendar_time");

    expect(accepted).toBe(true);
    expect(capturedMessageBody).toMatchObject({
      type: "user_instruction",
      selectedNodeId: "calendar_time",
      text: expect.stringContaining('Add incoming KPI drivers for "Calendar Time".')
    });
    expect((capturedMessageBody as { text?: string }).text).toContain("set or update the formula");
    expect(useVdtStudioStore.getState().selectedNodeId).toBe("calendar_time");
  });

  it("requestIncomingKpisWithAi starts a project-aware agent chat when no active run can continue", async () => {
    const fetchMock = vi.mocked(fetch);
    let capturedStartBody: Record<string, unknown> | undefined;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/agent/runs")) {
        capturedStartBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return jsonResponse({
          ok: true,
          runId: "agent-run-continue-project",
          snapshot: runtimeSnapshotFixture({
            runId: "agent-run-continue-project",
            status: "running",
            phase: "building_graph",
            completedAt: undefined,
            request: capturedStartBody
          })
        });
      }
      return jsonResponse({ agents: [] });
    });

    useVdtStudioStore.setState({
      activeAgentRunId: undefined,
      agentRun: undefined,
      generateActivity: undefined,
      executionSettings: {
        ...DEFAULT_EXECUTION_SETTINGS,
        executionMode: "byok",
        gatewayPresetId: "openai-default",
        apiKey: "test-api-key"
      }
    });

    const accepted = await useVdtStudioStore.getState().requestIncomingKpisWithAi("calendar_time");

    const input = capturedStartBody?.input as { project?: { id?: string }; selectedNodeId?: string; prompt?: string };
    expect(accepted).toBe(true);
    expect(capturedStartBody).toMatchObject({
      mode: "continue_project"
    });
    expect(input.selectedNodeId).toBe("calendar_time");
    expect(input.project?.id).toBe(productionVolumeProject.id);
    expect(input.prompt).toContain('Add incoming KPI drivers for "Calendar Time".');
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

  it("starts Cursor Agent generation through the canonical agent run without standalone pairing", async () => {
    vi.stubEnv("NEXT_PUBLIC_VDT_APP_MODE", "desktop");
    const fetchMock = vi.mocked(fetch);
    let capturedBody: Record<string, unknown> | undefined;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/agent/runs")) {
        capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return jsonResponse({
          ok: true,
          runId: "agent-run-cursor",
          snapshot: runtimeSnapshotFixture({
            runId: "agent-run-cursor",
            request: capturedBody
          })
        });
      }
      return jsonResponse({ agents: [] });
    });

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

      expect(capturedBody).toMatchObject({
        mode: "generate_vdt",
        providerId: "local_runner",
        providerConfig: expect.objectContaining({
          backendId: "cursor_subscription",
          timeoutMs: 60_000
        })
      });
      expect(JSON.stringify(capturedBody)).not.toContain("pairingToken");
      const state = useVdtStudioStore.getState();
      expect(state.aiError).toBeUndefined();
      expect(state.agentRun?.runId).toBe("agent-run-cursor");
      expect(state.isGenerating).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("starts Codex CLI generation through the canonical agent run without standalone pairing", async () => {
    vi.stubEnv("NEXT_PUBLIC_VDT_APP_MODE", "desktop");
    const fetchMock = vi.mocked(fetch);
    let capturedBody: Record<string, unknown> | undefined;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/agent/runs")) {
        capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return jsonResponse({
          ok: true,
          runId: "agent-run-codex",
          snapshot: runtimeSnapshotFixture({
            runId: "agent-run-codex",
            request: capturedBody
          })
        });
      }
      return jsonResponse({ agents: [] });
    });

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

      expect(capturedBody).toMatchObject({
        mode: "generate_vdt",
        providerId: "local_runner",
        providerConfig: expect.objectContaining({
          backendId: "codex_subscription",
          timeoutMs: 60_000
        })
      });
      expect(JSON.stringify(capturedBody)).not.toContain("pairingToken");
      const state = useVdtStudioStore.getState();
      expect(state.aiError).toBeUndefined();
      expect(state.agentRun?.runId).toBe("agent-run-codex");
      expect(state.isGenerating).toBe(false);
    } finally {
      vi.unstubAllEnvs();
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
      if (url.endsWith("/api/agent/runs")) {
        return jsonResponse({ ok: false, error: providerMessage }, 502);
      }
      return jsonResponse({ agents: [] });
    });

    await useVdtStudioStore.getState().generateWithAi();

    const state = useVdtStudioStore.getState();
    expect(state.aiError).toContain(providerMessage);
    expect(state.isGenerating).toBe(false);

    const generateCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/api/agent/runs"));
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
        text: async () => JSON.stringify({
          ok: true,
          runId: "agent-run-store-1",
          snapshot: runtimeSnapshotFixture()
        }),
        json: async () => ({
          ok: true,
          runId: "agent-run-store-1",
          snapshot: runtimeSnapshotFixture()
        })
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
      providerLabel: "Runtime not configured",
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

  it("stores agent runtime snapshots in chat history using the first user message as the title", () => {
    const runId = "agent-run-history";
    useVdtStudioStore.getState().applyAgentGraphPatch(runtimeSnapshotFixture({
      runId,
      updatedAt: "2026-06-24T10:10:00.000Z",
      completedAt: "2026-06-24T10:10:00.000Z",
      chatMessages: [
        {
          id: "msg-history-user",
          runId,
          role: "user",
          kind: "instruction",
          text: "Build annual ore production for excavators",
          createdAt: "2026-06-24T10:00:00.000Z"
        },
        {
          id: "msg-history-agent",
          runId,
          role: "assistant",
          kind: "assistant_message",
          text: "I will use the fleet as the starting scope.",
          createdAt: "2026-06-24T10:00:01.000Z"
        }
      ]
    }) as VdtAgentRunSnapshot);

    const state = useVdtStudioStore.getState();
    expect(state.agentChatHistory).toHaveLength(1);
    expect(state.agentChatHistory[0]).toMatchObject({
      runId,
      title: "Build annual ore production for excavators",
      status: "ready",
      messageCount: 2
    });
    expect(state.agentChatHistory[0]?.activity.agentChatMessages).toHaveLength(2);
  });

  it("starts a new agent chat by archiving the current transcript and clearing the panel", () => {
    const runId = "agent-run-new-chat";
    useVdtStudioStore.getState().applyAgentGraphPatch(runtimeSnapshotFixture({
      runId,
      chatMessages: [
        {
          id: "msg-new-chat-user",
          runId,
          role: "user",
          kind: "instruction",
          text: "Create a drilling VDT",
          createdAt: "2026-06-24T10:00:00.000Z"
        }
      ]
    }) as VdtAgentRunSnapshot);

    const accepted = useVdtStudioStore.getState().startNewAgentChat();

    const state = useVdtStudioStore.getState();
    expect(accepted).toBe(true);
    expect(state.generateActivity).toBeUndefined();
    expect(state.activeAgentRunId).toBeUndefined();
    expect(state.agentRun).toBeUndefined();
    expect(state.agentChatHistory[0]).toMatchObject({
      runId,
      title: "Create a drilling VDT"
    });
  });

  it("opens an archived agent chat back into the visible agent panel", () => {
    const runId = "agent-run-open-history";
    useVdtStudioStore.getState().applyAgentGraphPatch(runtimeSnapshotFixture({
      runId,
      chatMessages: [
        {
          id: "msg-open-history-user",
          runId,
          role: "user",
          kind: "instruction",
          text: "Compare monthly crusher throughput",
          createdAt: "2026-06-24T10:00:00.000Z"
        }
      ]
    }) as VdtAgentRunSnapshot);
    expect(useVdtStudioStore.getState().startNewAgentChat()).toBe(true);

    const opened = useVdtStudioStore.getState().openAgentChat(runId);

    const state = useVdtStudioStore.getState();
    expect(opened).toBe(true);
    expect(state.generateActivity).toMatchObject({
      runId,
      status: "ready",
      agentChatMessages: expect.arrayContaining([
        expect.objectContaining({ text: "Compare monthly crusher throughput" })
      ])
    });
    expect(state.agentRun?.runId).toBe(runId);
    expect(state.isGenerating).toBe(false);
  });

  it("starts a new chat from a running agent chat by keeping the running chat in history", () => {
    const runId = "agent-run-history-running";
    useVdtStudioStore.getState().applyAgentGraphPatch(runtimeSnapshotFixture({
      runId,
      status: "running",
      phase: "building_graph",
      project: undefined,
      finalReport: undefined,
      completedAt: undefined,
      publicStatus: {
        phase: "building_draft",
        message: "Building the draft.",
        updatedAt: "2026-06-24T10:00:05.000Z"
      },
      chatMessages: [
        {
          id: "msg-running-user",
          runId,
          role: "user",
          kind: "instruction",
          text: "Build a live model",
          createdAt: "2026-06-24T10:00:00.000Z"
        }
      ]
    }) as VdtAgentRunSnapshot);

    const accepted = useVdtStudioStore.getState().startNewAgentChat();

    const state = useVdtStudioStore.getState();
    expect(accepted).toBe(true);
    expect(state.generateActivity).toBeUndefined();
    expect(state.isGenerating).toBe(false);
    expect(state.agentChatHistory[0]).toMatchObject({
      runId,
      status: "running",
      title: "Build a live model"
    });
    expect(state.aiError).toBeUndefined();
  });

  it("starts local CLI generation as an agent run and applies the returned snapshot", async () => {
    const fetchMock = vi.mocked(fetch);
    let capturedStartBody: Record<string, unknown> | undefined;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/agent/runs")) {
        capturedStartBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return jsonResponse({
          ok: true,
          runId: "agent-run-local-cli",
          snapshot: runtimeSnapshotFixture({
            runId: "agent-run-local-cli",
            request: capturedStartBody
          })
        });
      }

      return jsonResponse({ agents: [] });
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
    expect(capturedStartBody).toMatchObject({
      mode: "generate_vdt",
      providerId: "local_runner",
      providerConfig: expect.objectContaining({
        backendId: "codex_subscription",
        timeoutMs: 60_000
      })
    });
    expect(activity).toMatchObject({
      status: "ready",
      phase: "ready",
      backendId: "codex_subscription",
      canCancel: false
    });
    expect(activity?.summary).toBe("Validation result: Graph validation passed.");
    expect(activity?.agentRun).toMatchObject({
      runId: "agent-run-local-cli",
      status: "succeeded",
      selectedSkills: expect.arrayContaining([expect.objectContaining({ id: "mining.production_volume" })])
    });
    expect(activity?.agentEvents?.map((event) => event.type)).toEqual(expect.arrayContaining([
      "classification",
      "final_report"
    ]));
    expect(activity?.finalReport).toBe("Validation result: Graph validation passed.");
  });

  it("keeps needs_user_input status and questions from runtime agentRun snapshots", async () => {
    stubEventSource();
    const fetchMock = vi.mocked(fetch);
    let capturedStartBody: Record<string, unknown> | undefined;
    let cancelRequested = false;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/agent/runs")) {
        capturedStartBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return jsonResponse({
          ok: true,
          runId: "agent-run-needs-input",
          snapshot: runtimeSnapshotFixture({
            runId: "agent-run-needs-input",
            status: "needs_user_input",
            phase: "asking_clarifying_questions",
            request: capturedStartBody,
            project: undefined,
            finalReport: undefined,
            pendingQuestions: [
              {
                id: "rated_truck_payload",
                question: "What is the rated truck payload?",
                reason: "Needed to calculate haulage capacity.",
                required: true
              }
            ],
            publicStatus: {
              phase: "waiting_user",
              message: "Waiting for your answer.",
              updatedAt: "2026-06-24T10:00:05.000Z"
            },
            completedAt: undefined
          })
        });
      }
      if (url.endsWith("/api/agent/runs/agent-run-needs-input/cancel")) {
        cancelRequested = true;
        return jsonResponse({ ok: true });
      }
      if (url.endsWith("/api/agent/runs/agent-run-needs-input")) {
        return jsonResponse({
          ok: true,
          snapshot: runtimeSnapshotFixture({
            runId: "agent-run-needs-input",
            status: "cancelled",
            phase: "asking_clarifying_questions",
            request: capturedStartBody,
            project: undefined,
            finalReport: undefined,
            publicStatus: {
              phase: "retryable_error",
              message: "Agent run cancelled.",
              updatedAt: "2026-06-24T10:00:06.000Z"
            },
            completedAt: "2026-06-24T10:00:06.000Z"
          })
        });
      }

      return jsonResponse({ agents: [] });
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
    expect(capturedStartBody).toMatchObject({
      mode: "generate_vdt",
      providerId: "local_runner"
    });
    await vi.waitFor(() => expect(useVdtStudioStore.getState().generateActivity?.status).toBe("needs_user_input"));

    const activity = useVdtStudioStore.getState().generateActivity;
    expect(activity?.questionsForUser).toEqual(["What is the rated truck payload?"]);
    expect(activity?.agentRun?.status).toBe("needs_user_input");
    expect(activity?.canCancel).toBe(true);

    useVdtStudioStore.getState().cancelGenerate();
    await vi.waitFor(() => expect(cancelRequested).toBe(true));
    await vi.waitFor(() => expect(useVdtStudioStore.getState().generateActivity?.status).toBe("cancelled"));
  });

  it("cancels an active agent run through cancelGenerate", async () => {
    stubEventSource();
    let cancelRequested = false;
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/agent/runs")) {
        return jsonResponse({
          ok: true,
          runId: "agent-run-cancel",
          snapshot: runtimeSnapshotFixture({
            runId: "agent-run-cancel",
            status: "running",
            phase: "building_graph",
            finalReport: undefined,
            project: undefined,
            publicStatus: {
              phase: "building_draft",
              message: "Building the next visible layer.",
              updatedAt: "2026-06-24T10:00:05.000Z"
            },
            completedAt: undefined
          })
        });
      }
      if (url.endsWith("/api/agent/runs/agent-run-cancel/cancel")) {
        cancelRequested = true;
        return jsonResponse({ ok: true });
      }
      if (url.endsWith("/api/agent/runs/agent-run-cancel")) {
        return jsonResponse({
          ok: true,
          snapshot: runtimeSnapshotFixture({
            runId: "agent-run-cancel",
            status: "cancelled",
            phase: "building_graph",
            finalReport: undefined,
            project: undefined,
            publicStatus: {
              phase: "retryable_error",
              message: "Agent run cancelled.",
              updatedAt: "2026-06-24T10:00:06.000Z"
            },
            completedAt: "2026-06-24T10:00:06.000Z"
          })
        });
      }
      return jsonResponse({ agents: [] });
    });

    await useVdtStudioStore.getState().generateWithAi();
    await vi.waitFor(() => expect(useVdtStudioStore.getState().generateActivity?.status).toBe("running"));

    useVdtStudioStore.getState().cancelGenerate();
    expect(useVdtStudioStore.getState().generateActivity).toMatchObject({
      status: "running",
      cancelRequested: true,
      canCancel: false,
      message: "Cancelling agent run..."
    });
    await vi.waitFor(() => expect(cancelRequested).toBe(true));
    await vi.waitFor(() => expect(useVdtStudioStore.getState().generateActivity?.status).toBe("cancelled"));

    const state = useVdtStudioStore.getState();
    expect(state.isGenerating).toBe(false);
    expect(state.aiError).toBeUndefined();
    expect(state.generateActivity).toMatchObject({
      status: "cancelled",
      canCancel: false,
      message: "Cancelling agent run..."
    });
  });

  it("does not call the deprecated one-shot generate endpoint", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/agent/runs")) {
        const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return jsonResponse({
          ok: true,
          runId: "agent-run-no-legacy",
          snapshot: runtimeSnapshotFixture({
            runId: "agent-run-no-legacy",
            request
          })
        });
      }
      return jsonResponse({ agents: [] });
    });

    await useVdtStudioStore.getState().generateWithAi();

    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/ai/generate-vdt"))).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/ai/dev-runtime"))).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/api/agent/runs"))).toBe(true);
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

describe("vdt-store setMainScenario", () => {
  const scenarioId = "scenario_reduce_unplanned_downtime";

  beforeEach(() => {
    localStorageMock.clear();
    useVdtStudioStore.setState({
      project: cloneProject(productionVolumeProject),
      activeScenarioId: scenarioId
    });
  });

  it("sets exactly one main scenario at a time", () => {
    useVdtStudioStore.getState().createScenario();
    const secondId = useVdtStudioStore.getState().activeScenarioId;

    useVdtStudioStore.getState().setMainScenario(secondId);

    const scenarios = useVdtStudioStore.getState().project.scenarios;
    expect(scenarios.find((scenario) => scenario.id === secondId)?.isMain).toBe(true);
    expect(scenarios.find((scenario) => scenario.id === scenarioId)?.isMain).toBe(false);
    expect(scenarios.filter((scenario) => scenario.isMain).length).toBe(1);
  });

  it("promotes another scenario when deleting the main scenario", () => {
    useVdtStudioStore.getState().createScenario();
    const secondId = useVdtStudioStore.getState().activeScenarioId;

    useVdtStudioStore.getState().deleteScenario(scenarioId);

    const scenarios = useVdtStudioStore.getState().project.scenarios;
    expect(scenarios).toHaveLength(1);
    expect(scenarios[0]?.id).toBe(secondId);
    expect(scenarios[0]?.isMain).toBe(true);
  });
});

describe("vdt-store main scenario migration", () => {
  it("ensures exactly one main scenario when replacing a legacy project without isMain", () => {
    localStorageMock.clear();
    const legacyProject = {
      ...cloneProject(productionVolumeProject),
      scenarios: productionVolumeProject.scenarios.map((scenario) => {
        const next = { ...scenario };
        delete next.isMain;
        return next;
      })
    };

    useVdtStudioStore.getState().replaceProject(legacyProject);

    const state = useVdtStudioStore.getState();
    const mainScenario = state.project.scenarios.find((scenario) => scenario.isMain === true);
    expect(state.project.scenarios.filter((scenario) => scenario.isMain).length).toBe(1);
    expect(mainScenario).toBeDefined();
    expect(state.activeScenarioId).toBe(mainScenario?.id);
  });

  it("ensures exactly one main scenario on loadExample and selects it", () => {
    localStorageMock.clear();
    useVdtStudioStore.getState().loadExample("production_volume");

    const state = useVdtStudioStore.getState();
    const mainScenario = state.project.scenarios.find((scenario) => scenario.isMain === true);
    expect(state.project.scenarios.filter((scenario) => scenario.isMain).length).toBe(1);
    expect(mainScenario).toBeDefined();
    expect(state.activeScenarioId).toBe(mainScenario?.id);
  });

  it("ensures exactly one main scenario after persist merge hydration", async () => {
    localStorageMock.clear();
    const legacyProject = {
      ...cloneProject(productionVolumeProject),
      scenarios: productionVolumeProject.scenarios.map((scenario) => {
        const next = { ...scenario };
        delete next.isMain;
        return next;
      })
    };

    localStorageMock.setItem(
      "vdt-studio-state",
      JSON.stringify({
        state: {
          project: legacyProject,
          activeScenarioId: legacyProject.scenarios[0]?.id ?? "",
          brief: useVdtStudioStore.getState().brief,
          providerId: "mock",
          executionSettings: {
            ...DEFAULT_EXECUTION_SETTINGS,
            useMockProvider: true,
            gatewayPresetId: "mock"
          }
        },
        version: 2
      })
    );

    await useVdtStudioStore.persist.rehydrate();

    const state = useVdtStudioStore.getState();
    const mainScenario = state.project.scenarios.find((scenario) => scenario.isMain === true);
    expect(state.project.scenarios.filter((scenario) => scenario.isMain).length).toBe(1);
    expect(mainScenario).toBeDefined();
    expect(state.activeScenarioId).toBe(mainScenario?.id);
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
    expect(clone?.isMain).toBeUndefined();
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
