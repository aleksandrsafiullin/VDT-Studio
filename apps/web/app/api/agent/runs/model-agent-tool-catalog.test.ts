import { AgentRunStore, createDefaultToolRegistry, type AgentToolContext } from "@vdt-studio/vdt-agent-runtime";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { modelAgentToolCatalog, modelAgentToolCatalogHash, registerModelAgentSchemaTool } from "./model-agent-tool-catalog";

describe("model-facing tool parameter contracts", () => {
  it("publishes actual enum/type contracts instead of empty parameter placeholders within a bounded catalog", () => {
    const tools = createDefaultToolRegistry();
    const catalog = modelAgentToolCatalog(tools);
    expect(catalog.find((tool) => tool.name === "excavation.seed_topology")?.inputJsonSchema).toMatchObject({
      type: "object",
      properties: {
        materialMode: { type: "string", enum: ["ore_tonnes", "rock_solid_m3", "mixed_ore_tonnes_and_rock_m3"] },
        scope: { enum: ["output", "productivity"] },
        splitMode: { enum: ["none", "equipment_class"] },
        downtimeBasis: { enum: ["per_excavator", "fleet_total"] },
        includeReadinessDowntime: { type: "boolean" }
      }
    });
    expect(JSON.stringify(catalog).length).toBeLessThan(35_000);
    expect(modelAgentToolCatalogHash(tools)).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("describes full argument contracts only for the immutable public allowlist, without changing project state", async () => {
    const tools = createDefaultToolRegistry();
    tools.register({ name: "private.internal", description: "Hidden", inputSchema: z.object({ secretField: z.string() }), outputSchema: z.object({}), run: () => ({}) });
    const hash = modelAgentToolCatalogHash(tools);
    registerModelAgentSchemaTool(tools);
    expect(modelAgentToolCatalogHash(tools)).toBe(hash);
    const store = new AgentRunStore();
    const run = store.createRun({ providerId: "mock", mode: "continue_project", input: { rootKpi: "Excavation" } });
    const context: AgentToolContext = {
      store, runId: run.runId, signal: run.abortController.signal,
      getRun: () => store.getSnapshot(run.runId),
      emit: (event) => { store.appendEvent(run.runId, event); },
      updateRun: (patch) => { store.updateRun(run.runId, patch); }
    };
    const described = await tools.run("tools.describe", { toolNames: ["vdt.add_drivers_batch", "vdt.update_node"] }, context);
    expect(described.ok).toBe(true);
    expect(described.output).toMatchObject({ tools: [
      { name: "vdt.add_drivers_batch", inputJsonSchema: { properties: { drivers: { minItems: 2, items: { required: ["parentNodeId", "name"] } } } } },
      { name: "vdt.update_node", inputJsonSchema: { properties: { patch: { properties: { valueSource: { properties: { sourceTier: { type: "string" } } } } } } } }
    ] });
    expect(described.projectChanged).toBe(false);
    const hidden = await tools.run("tools.describe", { toolNames: ["private.internal"] }, context);
    expect(hidden.ok).toBe(false);
    expect(hidden.error?.code).toBe("UNKNOWN_TOOL");
    expect(JSON.stringify(hidden)).not.toContain("secretField");
  });
});
