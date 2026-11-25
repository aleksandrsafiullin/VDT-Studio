import { cloneProject, productionVolumeProject, VdtBuilderSession, type VdtProject } from "@vdt-studio/vdt-core";
import { describe, expect, it } from "vitest";
import { applyPendingMutationProposal } from "../mutation-pipeline";
import { AgentRunStore } from "../run-store";
import { ToolRegistry, type AgentToolContext } from "../tool-registry";
import { createBackCalculationTools } from "./back-calculation-tools";

const nodeId = "unplanned_downtime";
const setTool = "vdt.set_back_calculation";
const readTool = "vdt.read_back_calculation";
const setting = { targetNodeId: "effective_working_time", targetValue: 500 };

function setup({ autoApplyPatches = false, project = productionVolumeProject }: {
  autoApplyPatches?: boolean; project?: VdtProject
} = {}) {
  const builder = new VdtBuilderSession({ project });
  const store = new AgentRunStore();
  const { runId, abortController } = store.createRun({
    mode: "continue_project", providerId: "mock",
    input: { rootKpi: "Output", project: builder.getProject() },
    options: { autoApplyPatches }
  });
  store.updateRun(runId, { builder, draftProject: builder.getProject() });
  const context: AgentToolContext = {
    runId, builder, store, signal: abortController.signal,
    emit: event => store.appendEvent(runId, event), getRun: () => store.getSnapshot(runId),
    updateRun: patch => { store.updateRun(runId, patch); }
  };
  const registry = new ToolRegistry();
  for (const tool of createBackCalculationTools()) registry.register(tool);
  return { builder, context, run: (tool: string, input: unknown) => registry.run(tool, input, context) };
}

describe("back-calculation tools", () => {
  it("previews a setting and its clear, applying neither until approved", async () => {
    const { builder, context, run } = setup();
    const initialRevision = builder.getRevision();
    expect(await run(setTool, { nodeId, setting })).toMatchObject({
      ok: true, output: {
        revision: initialRevision, changed: false, preview: { setting, baselineValue: 180, sourceValue: 80 },
        mutationProposal: { status: "proposed" }
      }
    });
    expect(await run(readTool, { nodeId })).toMatchObject({ ok: true, output: { setting: null, baselineValue: 80 } });
    expect(applyPendingMutationProposal(context).applied).toBe(true);
    expect(await run(readTool, { nodeId })).toMatchObject({ ok: true, output: { setting, baselineValue: 180 } });
    expect(await run(setTool, { nodeId, setting: null })).toMatchObject({
      ok: true, output: { preview: { setting: null, baselineValue: 80 }, mutationProposal: { status: "proposed" } }
    });
    expect(context.store.getState(context.runId).pendingChangeSet?.updates[0]?.patch).toEqual({ clearGoalSeek: true });
    expect(applyPendingMutationProposal(context).applied).toBe(true);
    expect(await run(readTool, { nodeId })).toMatchObject({ ok: true, output: { setting: null, baselineValue: 80, sourceValue: 80 } });
  });

  it("returns the calculation diagnostics without using the stored value as a fallback", async () => {
    const project = cloneProject(productionVolumeProject);
    project.graph.nodes.find(node => node.id === setting.targetNodeId)!.formula = "calendar_time - planned_downtime - unplanned_downtime * 0";
    const { run } = setup({ project, autoApplyPatches: true });
    expect(await run(setTool, { nodeId, setting })).toMatchObject({
      ok: true, output: {
        setting, baselineValue: null, sourceValue: 80, mutationProposal: { status: "applied" },
        diagnostics: expect.arrayContaining([expect.objectContaining({ type: "goal_seek_error" })])
      }
    });
  });
});
