import { z } from "zod";
import type { AgentTool } from "../tool-registry";
import { summarizeEvents, summarizeManualChanges } from "../summaries";

export function createMemoryTools(): AgentTool[] {
  return [getRecentEventsTool, getUserAnswersTool, getManualChangesTool, addNoteTool];
}

const getRecentEventsTool: AgentTool = {
  name: "memory.get_recent_events",
  description: "Read recent agent event summaries.",
  inputSchema: z.object({ limit: z.number().int().min(1).max(50).optional() }),
  outputSchema: z.record(z.unknown()),
  phase: "planning_decomposition",
  run(context, input) {
    return { events: summarizeEvents(context.store.getState(context.runId).events, input.limit ?? 30) };
  }
};

const getUserAnswersTool: AgentTool = {
  name: "memory.get_user_answers",
  description: "Read user answers collected during this run.",
  inputSchema: z.object({}),
  outputSchema: z.record(z.unknown()),
  phase: "planning_decomposition",
  run(context) {
    return { answers: context.store.getState(context.runId).answers };
  }
};

const getManualChangesTool: AgentTool = {
  name: "memory.get_manual_changes",
  description: "Read recent manual project changes observed during this run.",
  inputSchema: z.object({ limit: z.number().int().min(1).max(50).optional() }),
  outputSchema: z.record(z.unknown()),
  phase: "planning_decomposition",
  run(context, input) {
    return { manualChanges: summarizeManualChanges(context.store.getState(context.runId), input.limit ?? 20) };
  }
};

const addNoteTool: AgentTool = {
  name: "memory.add_note",
  description: "Store a concise, user-safe note for this run.",
  inputSchema: z.object({
    note: z.string().min(1).max(500),
    tags: z.array(z.string().min(1).max(40)).max(10).optional()
  }),
  outputSchema: z.object({ ok: z.literal(true) }),
  phase: "planning_decomposition",
  run(context, input) {
    const state = context.store.getState(context.runId);
    context.store.updateRun(context.runId, {
      memoryNotes: [
        ...state.memoryNotes,
        {
          note: input.note,
          tags: input.tags ?? [],
          createdAt: new Date().toISOString()
        }
      ].slice(-50)
    });
    return { ok: true };
  }
};
