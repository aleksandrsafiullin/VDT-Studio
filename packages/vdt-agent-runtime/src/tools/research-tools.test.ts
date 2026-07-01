import { describe, expect, it } from "vitest";
import { AgentRunStore } from "../run-store";
import { ToolRegistry, type AgentToolContext } from "../tool-registry";
import { createResearchTools } from "./research-tools";

describe("research tools", () => {
  it("returns a controlled tool failure when no research provider is configured", async () => {
    const { registry, context } = testRegistry();

    const result = await registry.run("research.search_web", {
      query: "mine production process drivers",
      purpose: "process_components"
    }, context);

    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({
      code: "RESEARCH_PROVIDER_NOT_CONFIGURED",
      message: "Research provider is not configured. Ask the user for process details or continue with explicit assumptions."
    });
  });

  it("extracts candidate drivers from process text deterministically", async () => {
    const { registry, context } = testRegistry();

    const result = await registry.run("research.extract_process_drivers", {
      rootKpi: "Ore mined",
      industry: "mining",
      processDescription: "Ore mined depends on working time, downtime, fleet productivity rate, material allocation, and yield recovery.",
      sourceIds: ["skill:mining.production_volume"]
    }, context);

    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({
      candidateDrivers: expect.arrayContaining([
        expect.objectContaining({ id: "working_time", driverType: "time" }),
        expect.objectContaining({ id: "process_rate", driverType: "rate" }),
        expect.objectContaining({ id: "yield_factor", driverType: "yield" })
      ])
    });
  });

  it("proposes a first-layer decomposition from candidate drivers", async () => {
    const { registry, context } = testRegistry();

    const result = await registry.run("research.propose_decomposition", {
      rootKpi: "Ore mined",
      candidateDrivers: [
        { id: "working_time", name: "Working time", driverType: "time", confidence: 0.82, sourceIds: ["s1"] },
        { id: "process_rate", name: "Process rate", driverType: "rate", confidence: 0.78, sourceIds: ["s1"] },
        { id: "yield_factor", name: "Yield factor", driverType: "yield", confidence: 0.72, sourceIds: ["s1"] }
      ]
    }, context);

    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({
      firstLevelDrivers: expect.arrayContaining([
        expect.objectContaining({ id: "working_time" }),
        expect.objectContaining({ id: "process_rate" })
      ]),
      formulaCandidates: [expect.objectContaining({ formula: "working_time * process_rate * yield_factor" })]
    });
  });
});

function testRegistry() {
  const store = new AgentRunStore({ now: () => "2026-07-01T00:00:00.000Z" });
  const run = store.createRun({
    mode: "generate_vdt",
    input: { rootKpi: "Ore mined" },
    providerId: "mock"
  });
  const registry = new ToolRegistry();
  for (const tool of createResearchTools()) registry.register(tool);
  const context = {
      runId: run.runId,
      store,
      emit: (event) => store.appendEvent(run.runId, event),
      getRun: () => store.getSnapshot(run.runId),
      updateRun: (patch) => {
        store.updateRun(run.runId, patch);
      },
      signal: run.abortController.signal
    } satisfies AgentToolContext;
  return { registry, context };
}
