import { describe, expect, it } from "vitest";
import { VdtBuilderSession } from "@vdt-studio/vdt-core";
import { AgentRunStore } from "../run-store";
import { ToolRegistry, type AgentToolContext } from "../tool-registry";
import { createSubagentTools } from "./subagent-tools";

describe("subagent tools", () => {
  it("executes a bounded critic subagent and records a compact report without mutating the graph", async () => {
    const store = new AgentRunStore({ now: fixedClock("2026-06-29T12:00:00.000Z") });
    const run = store.createRun({
      mode: "generate_vdt",
      input: { rootKpi: "Production Volume", unit: "t/year" },
      providerId: "mock"
    });
    const builder = new VdtBuilderSession({ now: fixedClock("2026-06-29T12:00:01.000Z") });
    const draft = builder.createDraft({
      projectTitle: "Production Volume Driver Model",
      rootKpi: "Production Volume",
      unit: "t/year"
    }).project;
    store.updateRun(run.runId, {
      status: "running",
      phase: "planning_decomposition",
      builder,
      draftProject: draft
    });
    const nodeCountBefore = builder.getProject().graph.nodes.length;

    const registry = new ToolRegistry();
    for (const tool of createSubagentTools()) registry.register(tool);
    const result = await registry.run("subagent.create_task", {
      type: "critic",
      objective: "Check whether the draft can safely continue."
    }, toolContext(store, run.runId));

    expect(result.ok).toBe(true);
    expect(result.projectChanged).toBe(false);
    expect(builder.getProject().graph.nodes).toHaveLength(nodeCountBefore);
    const state = store.getState(run.runId);
    expect(state.subagentTasks).toEqual([
      expect.objectContaining({
        type: "critic",
        status: "succeeded",
        startedAt: expect.any(String),
        completedAt: expect.any(String)
      })
    ]);
    expect(state.subagentReports).toEqual([
      expect.objectContaining({
        taskId: state.subagentTasks![0]!.id,
        status: "needs_user_input",
        summaryForOrchestrator: expect.stringContaining("Validation passed")
      })
    ]);
    expect(state.subagentReports![0]!.summaryForOrchestrator.length).toBeLessThan(500);
  });

  it("runs the required subagent types and reports retryable failure when graph context is missing", async () => {
    const store = new AgentRunStore({ now: fixedClock("2026-06-29T12:10:00.000Z") });
    const run = store.createRun({
      mode: "generate_vdt",
      input: { rootKpi: "Revenue" },
      providerId: "mock"
    });
    const registry = new ToolRegistry();
    for (const tool of createSubagentTools()) registry.register(tool);

    for (const type of ["brief_alignment", "level_decomposition", "formula_builder", "critic", "memory_curator"] as const) {
      const result = await registry.run("subagent.create_task", { type }, toolContext(store, run.runId));
      expect(result.ok).toBe(true);
    }

    const reports = store.getState(run.runId).subagentReports ?? [];
    expect(reports.map((report) => report.status)).toEqual([
      "succeeded",
      "failed_retryable",
      "failed_retryable",
      "failed_retryable",
      "succeeded"
    ]);
    expect(store.getState(run.runId).subagentTasks?.map((task) => task.type)).toEqual([
      "brief_alignment",
      "level_decomposition",
      "formula_builder",
      "critic",
      "memory_curator"
    ]);
  });
});

function toolContext(store: AgentRunStore, runId: string): AgentToolContext {
  return {
    runId,
    store,
    emit: (event) => {
      store.appendEvent(runId, event);
    },
    getRun: () => store.getSnapshot(runId),
    updateRun: (patch) => {
      store.updateRun(runId, patch);
    },
    builder: store.getState(runId).builder,
    signal: new AbortController().signal
  };
}

function fixedClock(value: string): () => string {
  return () => value;
}
