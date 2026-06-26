import { z } from "zod";
import type { AgentTool } from "../tool-registry";

export function createProjectTools(): AgentTool[] {
  return [readCurrentProjectTool, observeManualChangeTool];
}

const readCurrentProjectTool: AgentTool = {
  name: "project.read_current",
  description: "Read the current draft project snapshot.",
  inputSchema: z.object({}),
  outputSchema: z.record(z.unknown()),
  run(context) {
    const project = context.store.getSnapshot(context.runId).draftProject ?? context.store.getSnapshot(context.runId).project;
    return { project: project ?? null };
  }
};

const observeManualChangeTool: AgentTool = {
  name: "project.observe_manual_change",
  description: "Record a user-originated manual project change in agent context.",
  inputSchema: z.object({
    kind: z.string().min(1).max(120),
    nodeId: z.string().max(160).optional(),
    edgeId: z.string().max(160).optional(),
    summary: z.string().max(500).optional()
  }),
  outputSchema: z.object({ observed: z.boolean() }),
  run(context, input) {
    context.store.observeManualChange(context.runId, {
      change: {
        kind: input.kind as never,
        nodeId: input.nodeId,
        edgeId: input.edgeId,
        summary: input.summary
      }
    });
    return { observed: true };
  }
};
