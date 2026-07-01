import { describe, expect, it } from "vitest";
import { AgentRunStore } from "../run-store";
import { AgentToolError, ToolRegistry, type AgentToolContext } from "../tool-registry";
import { createResearchTools, type ResearchProvider } from "./research-tools";

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

  it("returns normalized results from a configured research provider", async () => {
    const { registry, context } = testRegistry({
      id: "test-search",
      async search(query, options) {
        return [{
          id: "test_1",
          title: `Result for ${query}`,
          url: "https://example.com/process",
          sourceName: "Example",
          snippet: `Purpose ${options.purpose} with ${options.maxResults} requested results.`,
          retrievedAt: "2026-07-01T00:00:00.000Z"
        }];
      }
    });

    const result = await registry.run("research.search_web", {
      query: "mine production process drivers",
      purpose: "process_components",
      maxResults: 3
    }, context);

    expect(result.ok).toBe(true);
    expect(result.output).toEqual({
      providerConfigured: true,
      providerId: "test-search",
      results: [
        {
          id: "test_1",
          title: "Result for mine production process drivers",
          url: "https://example.com/process",
          sourceName: "Example",
          snippet: "Purpose process_components with 3 requested results.",
          retrievedAt: "2026-07-01T00:00:00.000Z"
        }
      ]
    });
  });

  it("returns provider failures through the tool envelope without exposing provider secrets", async () => {
    const providerSecret = "research-provider-secret";
    const { registry, context } = testRegistry({
      id: "test-search",
      async search() {
        void providerSecret;
        throw new AgentToolError(
          "RESEARCH_PROVIDER_RATE_LIMITED",
          "Research provider \"test-search\" request failed with status 429.",
          { providerId: "test-search", status: 429 }
        );
      }
    });

    const result = await registry.run("research.search_web", {
      query: "mine production process drivers",
      purpose: "process_components"
    }, context);

    expect(result.ok).toBe(false);
    expect(result.error).toEqual({
      code: "RESEARCH_PROVIDER_RATE_LIMITED",
      message: "Research provider \"test-search\" request failed with status 429.",
      details: { providerId: "test-search", status: 429 }
    });
    expect(JSON.stringify(result)).not.toContain(providerSecret);
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

function testRegistry(provider?: ResearchProvider) {
  const store = new AgentRunStore({ now: () => "2026-07-01T00:00:00.000Z" });
  const run = store.createRun({
    mode: "generate_vdt",
    input: { rootKpi: "Ore mined" },
    providerId: "mock"
  });
  const registry = new ToolRegistry();
  for (const tool of createResearchTools(provider)) registry.register(tool);
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
