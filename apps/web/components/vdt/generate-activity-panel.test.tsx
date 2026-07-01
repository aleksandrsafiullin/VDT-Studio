import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  formatActiveElapsed,
  GenerateActivityPanel,
  isWaitingForUser,
  syncElapsedTracker
} from "./generate-activity-panel";
import type { GenerateActivityState } from "./vdt-store";

function activity(overrides: Partial<GenerateActivityState> = {}): GenerateActivityState {
  return {
    runId: "run-activity-123456789",
    requestId: "backend-request-123456789",
    status: "running",
    phase: "waiting_provider",
    phaseStartedAt: "2026-06-24T10:00:01.000Z",
    startedAt: "2026-06-24T10:00:00.000Z",
    updatedAt: "2026-06-24T10:00:03.000Z",
    providerId: "local_runner",
    providerLabel: "Cursor Agent",
    backendId: "cursor_subscription",
    backendLabel: "Cursor Agent",
    schemaId: "generate-tree-v1",
    outputBytes: 2048,
    schemaValid: true,
    repairAttempted: true,
    repairSucceeded: true,
    model: "auto",
    appMode: "desktop",
    canCancel: true,
    cancelRequested: false,
    timeoutMs: 120_000,
    agentRun: {
      runId: "agent-run-1",
      status: "running",
      phase: "generating_graph",
      request: {
        rootKpi: "Ore mined",
        industry: "Mining"
      },
      selectedSkills: [
        {
          id: "mining.production_volume",
          path: "packages/vdt-agent/skills/mining/production-volume.md",
          reason: "Matched ore mined production context."
        },
        {
          id: "mining.haulage_truck_cycle",
          path: "packages/vdt-agent/skills/mining/haulage-truck-cycle.md",
          reason: "Matched haulage throughput driver patterns."
        }
      ],
      events: [
        {
          id: "evt-classification",
          timestamp: "2026-06-24T10:00:01.000Z",
          type: "classification",
          title: "Classified request",
          message: "Classified request as mining / production throughput.",
          metadata: { domain: "mining" }
        },
        {
          id: "evt-skill-selected",
          timestamp: "2026-06-24T10:00:02.000Z",
          type: "skill_selected",
          title: "Selected skills",
          message: "Selected mining.production_volume and mining.haulage_truck_cycle."
        }
      ]
    },
    details: [
      {
        id: "provider-request",
        label: "Provider request running for generate-tree-v1.",
        status: "running",
        updatedAt: "2026-06-24T10:00:03.000Z"
      }
    ],
    agentChatMessages: [
      {
        id: "agent-run-1:chat:1",
        runId: "agent-run-1",
        role: "user",
        kind: "instruction",
        text: "Build an excavation model. I have 5 excavators.",
        createdAt: "2026-06-24T10:00:00.000Z"
      },
      {
        id: "agent-run-1:chat:2",
        runId: "agent-run-1",
        role: "assistant",
        kind: "assistant_message",
        text: "I will build this from the visible brief and avoid changing the scope without asking.",
        createdAt: "2026-06-24T10:00:01.000Z"
      }
    ],
    publicStatus: {
      phase: "planning_model",
      message: "Planning the VDT from your request.",
      updatedAt: "2026-06-24T10:00:03.000Z"
    },
    ...overrides
  };
}

describe("GenerateActivityPanel", () => {
  it("renders the chat transcript and hides diagnostics by default", () => {
    const base = activity();
    const html = renderToStaticMarkup(
      <GenerateActivityPanel
        activity={activity({
          agentChatMessages: [
            ...(base.agentChatMessages ?? []),
            {
              id: "agent-run-1:chat:status",
              runId: "agent-run-1",
              role: "system",
              kind: "status",
              text: "Planning the VDT from your request.",
              status: {
                phase: "planning_model",
                message: "Planning the VDT from your request.",
                updatedAt: "2026-06-24T10:00:03.000Z"
              },
              createdAt: "2026-06-24T10:00:03.000Z"
            }
          ]
        })}
        onCancel={() => undefined}
      />
    );

    expect(html).toContain('data-testid="generate-activity-panel"');
    expect(html).toContain('data-testid="agent-chat-thread"');
    expect(html).toContain("Build an excavation model. I have 5 excavators.");
    expect(html).toContain("I will build this from the visible brief");
    expect(html).toContain("Planning the VDT from your request.");
    expect(html.match(/Planning the VDT from your request\./g)?.length).toBe(1);
    expect(html).toContain('data-testid="agent-current-status"');
    expect(html).not.toContain('data-testid="agent-message-agent-run-1:chat:status"');
    expect(html).not.toContain('data-testid="generate-agent-events"');
    expect(html).not.toContain('data-testid="generate-selected-skills"');
    expect(html).not.toContain('data-testid="generate-run-details"');
    expect(html).not.toContain("Model " + "is thinking");
    expect(html).not.toContain("Reason" + "ing");
    expect(html).not.toContain("The model " + "is deciding");
    expect(html).not.toContain("I&#x27;m treating");
    expect(html).not.toContain("Next I");
    expect(html).toContain('data-testid="cancel-generate"');
  });

  it("keeps technical diagnostics available in debug mode", () => {
    const html = renderToStaticMarkup(
      <GenerateActivityPanel activity={activity()} onCancel={() => undefined} diagnostics />
    );

    expect(html).toContain('data-testid="generate-agent-events"');
    expect(html).toContain('data-testid="generate-selected-skills"');
    expect(html).toContain('data-testid="generate-run-details"');
    expect(html).toContain("Classified request as mining / production throughput.");
    expect(html).toContain("mining.production_volume");
  });

  it("shows terminal final report without the cancel action", () => {
    const html = renderToStaticMarkup(
      <GenerateActivityPanel
        activity={activity({
          status: "ready",
          phase: "ready",
          canCancel: false,
          finalReport: "Validation result: Graph validation passed. Applied graph to canvas.",
          completedAt: "2026-06-24T10:00:05.000Z",
          agentRun: {
            ...activity().agentRun!,
            status: "succeeded",
            phase: "reporting",
            finalReport: "Validation result: Graph validation passed. Applied graph to canvas."
          },
          agentChatMessages: []
        })}
        onCancel={() => undefined}
      />
    );

    expect(html).toContain("VDT ready");
    expect(html).toContain("Validation result: Graph validation passed.");
    expect(html).not.toContain('data-testid="cancel-generate"');
  });

  it("renders questions for needs_user_input status", () => {
    const html = renderToStaticMarkup(
      <GenerateActivityPanel
        activity={activity({
          status: "needs_user_input",
          questionsForUser: ["What is the rated truck payload?"],
          agentRun: {
            ...activity().agentRun!,
            status: "needs_user_input",
            phase: "asking_clarifying_questions",
            questionsForUser: ["What is the rated truck payload?"]
          },
          agentChatMessages: []
        })}
        onCancel={() => undefined}
      />
    );

    expect(html).toContain("Needs input");
    expect(html).toContain('data-testid="generate-questions"');
    expect(html).toContain("What is the rated truck payload?");
    expect(html).toContain('data-testid="agent-answer-field-question_1-answer"');
    expect(html).not.toContain('data-testid="agent-answer-freeform"');
  });

  it("renders structured question fields separately", () => {
    const html = renderToStaticMarkup(
      <GenerateActivityPanel
        activity={activity({
          status: "needs_user_input",
          agentQuestions: [
            {
              id: "fleet_in_scope",
              question: "What fleet is in scope?",
              reason: "Fleet counts determine available loading and hauling capacity.",
              required: true,
              answerKind: "field_group",
              freeTextAllowed: false,
              fields: [
                {
                  id: "excavator_count",
                  label: "Excavators",
                  kind: "number",
                  unit: "units",
                  required: true
                },
                {
                  id: "haul_truck_count",
                  label: "Haul trucks",
                  kind: "number",
                  unit: "units",
                  required: true
                }
              ]
            },
            {
              id: "shift_pattern",
              question: "How many shifts does the fleet work?",
              reason: "Shift pattern determines annual available operating hours.",
              required: true,
              answerKind: "field_group",
              freeTextAllowed: true,
              fields: [
                {
                  id: "shifts_per_day",
                  label: "Shifts per day",
                  kind: "number",
                  unit: "shifts/day",
                  required: true
                }
              ]
            }
          ],
          agentChatMessages: []
        })}
        onCancel={() => undefined}
      />
    );

    expect(html).toContain("What fleet is in scope?");
    expect(html).toContain("How many shifts does the fleet work?");
    expect(html).toContain('data-testid="agent-answer-field-fleet_in_scope-excavator_count"');
    expect(html).toContain('data-testid="agent-answer-field-fleet_in_scope-haul_truck_count"');
    expect(html).toContain('data-testid="agent-answer-field-shift_pattern-shifts_per_day"');
  });

  it("keeps a custom answer textarea available for option-only questions", () => {
    const html = renderToStaticMarkup(
      <GenerateActivityPanel
        activity={activity({
          status: "needs_user_input",
          agentQuestions: [
            {
              id: "root_kpi_definition",
              question: "What should New VDT measure?",
              reason: "The placeholder root KPI needs a business outcome.",
              required: true,
              answerKind: "single_choice",
              freeTextAllowed: true,
              options: [
                { id: "monthly_production", label: "Monthly production", value: "monthly_production" },
                { id: "unit_mining_cost", label: "Unit mining cost", value: "unit_mining_cost" }
              ]
            }
          ],
          agentChatMessages: []
        })}
        onCancel={() => undefined}
      />
    );

    expect(html).toContain("What should New VDT measure?");
    expect(html).toContain("Monthly production");
    expect(html).toContain("Unit mining cost");
    expect(html).toContain('data-testid="agent-answer-freeform"');
    expect(html).toContain("Custom answer or additional context");
  });

  it("renders pending mutation preview and approval actions", () => {
    const html = renderToStaticMarkup(
      <GenerateActivityPanel
        activity={activity({
          status: "running",
          runtimeAgentRun: {
            runId: "agent-run-1",
            status: "waiting_approval",
            phase: "previewing_mutation",
            request: {
              mode: "generate_vdt",
              input: { rootKpi: "Production Volume" },
              providerId: "mock"
            },
            selectedSkills: [],
            events: [],
            chatMessages: [],
            pendingMutationProposal: {
              id: "agent-run-1:mutation:1",
              runId: "agent-run-1",
              projectId: "project_1",
              vdtId: "production_volume",
              baseRevisionId: "revision_1",
              baseRevision: 1,
              source: "agent",
              title: "Add Working time layer",
              summary: "Add Working time as a direct driver before decomposing downtime.",
              changeSet: {
                id: "changeset_working_time",
                taskType: "generate_tree",
                backendId: "mock",
                createdAt: "2026-06-24T10:00:02.000Z",
                additions: [
                  {
                    id: "add_working_time",
                    nodeId: "working_time",
                    parentNodeId: "production_volume",
                    relation: "multiplicative_driver",
                    name: "Working time"
                  }
                ],
                updates: [],
                deletions: [],
                edgeChanges: [],
                assumptions: [],
                questions: [],
                warnings: []
              },
              selectedChangeIds: ["add_working_time"],
              previewProject: { id: "project_1", name: "Production Volume", rootNodeId: "production_volume", graph: { nodes: [], edges: [] } },
              validation: { valid: true, errors: [], warnings: [] },
              status: "proposed",
              policy: {
                autoApply: false,
                askBeforeFirstPatch: true,
                requireApprovalForGraphStructure: true,
                requireApprovalForFormulaChanges: true,
                requireApprovalForDelete: true
              },
              createdAt: "2026-06-24T10:00:02.000Z"
            },
            createdAt: "2026-06-24T10:00:00.000Z",
            updatedAt: "2026-06-24T10:00:02.000Z"
          } as unknown as NonNullable<GenerateActivityState["runtimeAgentRun"]>
        })}
        onCancel={() => undefined}
        onApproval={() => undefined}
      />
    );

    expect(html).toContain("Needs approval");
    expect(html).toContain('data-testid="mutation-preview"');
    expect(html).toContain("Add Working time layer");
    expect(html).toContain("Add Working time under production_volume");
    expect(html).toContain('data-testid="approve-mutation"');
    expect(html).toContain('data-testid="reject-mutation"');
  });
});

describe("isWaitingForUser", () => {
  it("returns true for needs_user_input", () => {
    expect(isWaitingForUser({ status: "needs_user_input" })).toBe(true);
  });

  it("returns true for waiting_approval even when status is running", () => {
    expect(isWaitingForUser({
      status: "running",
      runtimeAgentRun: { status: "waiting_approval" } as GenerateActivityState["runtimeAgentRun"]
    })).toBe(true);
  });

  it("returns false for active running without approval wait", () => {
    expect(isWaitingForUser({
      status: "running",
      runtimeAgentRun: { status: "running" } as GenerateActivityState["runtimeAgentRun"]
    })).toBe(false);
  });
});

describe("formatActiveElapsed", () => {
  const startedAt = "2026-06-24T10:00:00.000Z";

  it("counts wall time when not paused", () => {
    const now = Date.parse("2026-06-24T10:01:30.000Z");
    expect(formatActiveElapsed(startedAt, undefined, 0, null, now)).toBe("1:30");
  });

  it("freezes elapsed time while paused", () => {
    const pauseStartedAt = Date.parse("2026-06-24T10:00:45.000Z");
    const now = Date.parse("2026-06-24T10:20:00.000Z");
    expect(formatActiveElapsed(startedAt, undefined, 0, pauseStartedAt, now)).toBe("0:45");
  });

  it("subtracts accumulated pause time across resume cycles", () => {
    const pausedMs = 15 * 60 * 1000;
    const now = Date.parse("2026-06-24T10:17:30.000Z");
    expect(formatActiveElapsed(startedAt, undefined, pausedMs, null, now)).toBe("2:30");
  });

  it("uses completedAt for terminal activities", () => {
    const completedAt = "2026-06-24T10:00:05.000Z";
    expect(formatActiveElapsed(startedAt, completedAt, 0, null)).toBe("0:05");
  });
});

describe("syncElapsedTracker", () => {
  const startedAt = "2026-06-24T10:00:00.000Z";
  const runId = "run-activity-123456789";

  function trackerActivity(
    overrides: Partial<GenerateActivityState> = {}
  ): Pick<GenerateActivityState, "runId" | "status" | "runtimeAgentRun" | "updatedAt" | "startedAt" | "completedAt"> {
    return {
      runId,
      status: "running",
      startedAt,
      updatedAt: startedAt,
      ...overrides
    };
  }

  it("freezes elapsed time while waiting for user input", () => {
    let state = initTrackerForTest(runId, trackerActivity({
      status: "needs_user_input",
      updatedAt: "2026-06-24T10:00:45.000Z"
    }));

    const paused = syncElapsedTracker(
      state,
      trackerActivity({ status: "needs_user_input", updatedAt: "2026-06-24T10:00:45.000Z" }),
      Date.parse("2026-06-24T10:20:00.000Z")
    );
    state = paused.state;
    expect(paused.elapsed).toBe("0:45");
  });

  it("freezes elapsed time while waiting for approval", () => {
    let state = initTrackerForTest(runId, trackerActivity({
      status: "running",
      updatedAt: "2026-06-24T10:01:20.000Z",
      runtimeAgentRun: { status: "waiting_approval" } as GenerateActivityState["runtimeAgentRun"]
    }));

    const paused = syncElapsedTracker(
      state,
      trackerActivity({
        status: "running",
        updatedAt: "2026-06-24T10:01:20.000Z",
        runtimeAgentRun: { status: "waiting_approval" } as GenerateActivityState["runtimeAgentRun"]
      }),
      Date.parse("2026-06-24T10:30:00.000Z")
    );
    state = paused.state;
    expect(paused.elapsed).toBe("1:20");
  });

  it("resumes counting after user input and supports multiple pause cycles", () => {
    let state = initTrackerForTest(runId, trackerActivity({
      status: "needs_user_input",
      updatedAt: "2026-06-24T10:00:30.000Z"
    }));

    const resumed = syncElapsedTracker(
      state,
      trackerActivity({ status: "running", updatedAt: "2026-06-24T10:10:00.000Z" }),
      Date.parse("2026-06-24T10:10:00.000Z")
    );
    state = resumed.state;
    expect(resumed.elapsed).toBe("0:30");

    const working = syncElapsedTracker(
      state,
      trackerActivity({ status: "running", updatedAt: "2026-06-24T10:10:00.000Z" }),
      Date.parse("2026-06-24T10:10:15.000Z")
    );
    state = working.state;
    expect(working.elapsed).toBe("0:45");

    const pausedAgain = syncElapsedTracker(
      state,
      trackerActivity({
        status: "needs_user_input",
        updatedAt: "2026-06-24T10:10:15.000Z"
      }),
      Date.parse("2026-06-24T10:10:15.000Z")
    );
    state = pausedAgain.state;
    expect(pausedAgain.elapsed).toBe("0:45");

    const stillPaused = syncElapsedTracker(
      state,
      trackerActivity({
        status: "needs_user_input",
        updatedAt: "2026-06-24T10:10:15.000Z"
      }),
      Date.parse("2026-06-24T10:40:00.000Z")
    );
    expect(stillPaused.elapsed).toBe("0:45");
  });

  it("caps pause accumulation at completedAt on terminal transition", () => {
    const state = initTrackerForTest(runId, trackerActivity({
      status: "needs_user_input",
      updatedAt: "2026-06-24T10:00:30.000Z"
    }));

    const terminal = syncElapsedTracker(
      state,
      trackerActivity({
        status: "ready",
        completedAt: "2026-06-24T10:00:40.000Z",
        updatedAt: "2026-06-24T10:00:40.000Z"
      }),
      Date.parse("2026-06-24T10:05:00.000Z")
    );

    // 30s active before pause; without completedAt cap, late effect would subtract 5m pause → 0:00
    expect(terminal.elapsed).toBe("0:30");
  });

  it("resets tracking when runId changes", () => {
    const first = syncElapsedTracker(
      initTrackerForTest(runId, trackerActivity({
        status: "needs_user_input",
        updatedAt: "2026-06-24T10:00:30.000Z"
      })),
      trackerActivity({
        runId: "run-activity-next",
        status: "needs_user_input",
        updatedAt: "2026-06-24T10:02:00.000Z"
      }),
      Date.parse("2026-06-24T10:05:00.000Z")
    );

    expect(first.elapsed).toBe("2:00");
    expect(first.state.runId).toBe("run-activity-next");
    expect(first.state.pausedMs).toBe(0);
  });
});

function initTrackerForTest(
  runId: string,
  activity: Pick<GenerateActivityState, "status" | "runtimeAgentRun" | "updatedAt">
) {
  return syncElapsedTracker(
    { runId, pausedMs: 0, pauseStartedAt: null },
    { runId, startedAt: "2026-06-24T10:00:00.000Z", updatedAt: activity.updatedAt, status: activity.status, runtimeAgentRun: activity.runtimeAgentRun }
  ).state;
}
