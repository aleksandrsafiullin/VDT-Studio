import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AgentRunStore } from "./run-store";
import { ToolRegistry } from "./tool-registry";

describe("ToolRegistry", () => {
  it("rejects unknown tools and emits a recoverable event", async () => {
    const store = new AgentRunStore({ now: () => "2026-06-26T00:00:00.000Z" });
    const run = store.createRun({
      mode: "generate_vdt",
      input: { rootKpi: "Revenue" },
      providerId: "mock"
    });
    const registry = new ToolRegistry();

    await expect(registry.run("missing.tool", {}, {
      runId: run.runId,
      store,
      emit: (event) => store.appendEvent(run.runId, event),
      getRun: () => store.getSnapshot(run.runId),
      updateRun: (patch) => {
        store.updateRun(run.runId, patch);
      },
      signal: run.abortController.signal
    })).rejects.toThrow(/Unknown agent tool/);
    expect(store.getSnapshot(run.runId).events.at(-1)?.type).toBe("tool_call_completed");
  });

  it("validates tool args with zod before running handler", async () => {
    const store = new AgentRunStore({ now: () => "2026-06-26T00:00:00.000Z" });
    const run = store.createRun({
      mode: "generate_vdt",
      input: { rootKpi: "Revenue" },
      providerId: "mock"
    });
    const registry = new ToolRegistry();
    registry.register({
      name: "test.echo",
      description: "Echo bounded input.",
      inputSchema: z.object({ value: z.string() }),
      outputSchema: z.object({ value: z.string() }),
      run: (_context, input) => input
    });

    await expect(registry.run("test.echo", { value: 1 }, {
      runId: run.runId,
      store,
      emit: (event) => store.appendEvent(run.runId, event),
      getRun: () => store.getSnapshot(run.runId),
      updateRun: (patch) => {
        store.updateRun(run.runId, patch);
      },
      signal: run.abortController.signal
    })).rejects.toThrow();
    expect(store.getSnapshot(run.runId).events.at(-1)?.message).toContain("Expected string");
  });
});
