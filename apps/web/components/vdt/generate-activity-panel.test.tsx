import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GenerateActivityPanel } from "./generate-activity-panel";
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
    ...overrides
  };
}

describe("GenerateActivityPanel", () => {
  it("renders real agent events and selected skills without fake narrative", () => {
    const html = renderToStaticMarkup(<GenerateActivityPanel activity={activity()} onCancel={() => undefined} />);

    expect(html).toContain('data-testid="generate-activity-panel"');
    expect(html).toContain('data-testid="generate-agent-events"');
    expect(html).toContain('data-testid="generate-selected-skills"');
    expect(html).toContain('data-testid="generate-run-details"');
    expect(html).toContain("Generating Graph");
    expect(html).toContain("Classified request as mining / production throughput.");
    expect(html).toContain("Selected mining.production_volume and mining.haulage_truck_cycle.");
    expect(html).toContain("mining.production_volume");
    expect(html).toContain("Matched ore mined production context.");
    expect(html).not.toContain("Model " + "is thinking");
    expect(html).not.toContain("Reason" + "ing");
    expect(html).not.toContain("The model " + "is deciding");
    expect(html).not.toContain("I&#x27;m treating");
    expect(html).not.toContain("Next I");
    expect(html).toContain('data-testid="cancel-generate"');
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
          }
        })}
        onCancel={() => undefined}
      />
    );

    expect(html).toContain("VDT ready");
    expect(html).toContain("Final Report");
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
          }
        })}
        onCancel={() => undefined}
      />
    );

    expect(html).toContain("Needs input");
    expect(html).toContain('data-testid="generate-questions"');
    expect(html).toContain("What is the rated truck payload?");
  });
});
