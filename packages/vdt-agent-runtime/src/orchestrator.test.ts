import { describe, expect, it } from "vitest";
import { createVdtAgentRuntime } from "./orchestrator";

describe("VdtAgentRuntime", () => {
  it("stops on critical questions before building a project", async () => {
    const runtime = createVdtAgentRuntime();
    const snapshot = await runtime.startRun({
      mode: "generate_vdt",
      input: {
        rootKpi: "Monthly production volume",
        industry: "Mining",
        businessContext: "Open-pit mine production"
      },
      providerId: "mock",
      options: { continueWithAssumptions: false }
    });

    expect(snapshot.status).toBe("needs_user_input");
    expect(snapshot.pendingQuestions?.map((question) => question.id)).toEqual(
      expect.arrayContaining(["unit", "timePeriod"])
    );
    expect(snapshot.draftProject).toBeUndefined();
    expect(snapshot.events.find((event) => event.type === "clarifying_questions")?.metadata).toMatchObject({
      providerWasCalled: false
    });
  });

  it("resumes after answers and builds first-level graph patches", async () => {
    const runtime = createVdtAgentRuntime();
    const start = await runtime.startRun({
      mode: "generate_vdt",
      input: {
        rootKpi: "Monthly production volume",
        industry: "Mining",
        businessContext: "Open-pit mine production with haulage bottleneck"
      },
      providerId: "mock",
      options: { continueWithAssumptions: false }
    });

    const resumed = await runtime.handleMessage(start.runId, {
      type: "user_answer",
      answers: {
        unit: "tonnes",
        timePeriod: "monthly"
      }
    });

    expect(resumed.status).toBe("succeeded");
    expect(resumed.draftProject?.graph.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining(["monthly_production_volume", "effective_working_time", "average_productivity"])
    );
    expect(resumed.events.map((event) => event.type)).toEqual(expect.arrayContaining([
      "user_answer_received",
      "graph_patch",
      "graph_validation",
      "final_report",
      "run_completed"
    ]));
  });

  it("records manual project changes as run context", async () => {
    const runtime = createVdtAgentRuntime();
    const snapshot = await runtime.startRun({
      mode: "generate_vdt",
      input: {
        rootKpi: "Available output",
        unit: "units",
        timePeriod: "monthly",
        businessContext: "Generic capacity model"
      },
      providerId: "mock",
      options: { continueWithAssumptions: true }
    });

    const afterEdit = await runtime.handleMessage(snapshot.runId, {
      type: "manual_project_change",
      projectRevision: 1,
      change: {
        kind: "node_updated",
        nodeId: "available_output",
        patch: { name: "Renamed output" }
      }
    });

    expect(afterEdit.events.at(-1)?.type).toBe("manual_change_observed");
    expect(afterEdit.draftProject?.graph.nodes.find((node) => node.id === "available_output")?.name).toBe("Renamed output");
  });
});
