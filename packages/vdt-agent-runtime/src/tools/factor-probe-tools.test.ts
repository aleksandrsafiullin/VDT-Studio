import { applyDecompositionAssumptionOperation, productionVolumeProject, VdtBuilderSession } from "@vdt-studio/vdt-core";
import { describe, expect, it } from "vitest";
import { AgentRunStore } from "../run-store";
import { ToolRegistry, type AgentToolContext } from "../tool-registry";
import { createFactorProbeTools } from "./factor-probe-tools";

describe("vdt.probe_factor", () => {
  it.each([
    { formula: "min(stage_a, stage_b)", before: 70, after: 70, delta: 0, statement: "The stages are serial." },
    { formula: "stage_a + stage_b", before: 160, after: 170, delta: 10, statement: "The stages run independently in parallel." }
  ])("exposes read-only modeled sensitivity for $formula", async ({ formula, before, after, delta, statement }) => {
    const [root, , , , stageA, stageB] = productionVolumeProject.graph.nodes;
    const project = {
      ...productionVolumeProject, graph: {
        nodes: [{ ...root!, formula, unit: "t/h" },
          { ...stageA!, id: "stage_a", baselineValue: 70, unit: "t/h" },
          { ...stageB!, id: "stage_b", baselineValue: 90, unit: "t/h" }],
        edges: []
      }, scenarios: []
    };
    const evidence = { kind: "user_confirmed", sourceId: "user:1", quote: statement } as const;
    const assumption = applyDecompositionAssumptionOperation(project, {
      nodeId: project.rootNodeId, statement, changesConclusionWhen: "The flow relationship changes.", evidence
    }, { operationId: "test", now: project.updatedAt });
    if (assumption.status !== "ok") throw new Error(assumption.message);

    const builder = new VdtBuilderSession({ project: assumption.project });
    const revision = builder.getRevision();
    const original = structuredClone(builder.getProject());
    const store = new AgentRunStore();
    const { runId, abortController } = store.createRun({
      mode: "continue_project", providerId: "mock",
      input: { rootKpi: "Output", project: builder.getProject() }, options: {}
    });
    store.updateRun(runId, { builder, draftProject: builder.getProject() });
    const context: AgentToolContext = {
      runId, builder, store, signal: abortController.signal,
      emit: event => store.appendEvent(runId, event), getRun: () => store.getSnapshot(runId),
      updateRun: patch => { store.updateRun(runId, patch); }
    };

    const registry = new ToolRegistry();
    for (const tool of createFactorProbeTools()) {
      expect(tool.mutatesProject).toBeFalsy();
      registry.register(tool);
    }
    expect(await registry.run("vdt.probe_factor", { nodeId: "stage_b", value: 100 }, context)).toMatchObject({
      ok: true,
      output: {
        kind: "modeled_sensitivity", revision,
        input: { baselineValue: 90, simulatedValue: 100, unit: "t/h" },
        root: { formula, baselineValue: before, simulatedValue: after, absoluteChange: delta, unit: "t/h" },
        assumptions: [{ statement, evidence }]
      }
    });
    expect(builder.getRevision()).toBe(revision);
    expect(builder.getProject()).toEqual(original);
  });
});
