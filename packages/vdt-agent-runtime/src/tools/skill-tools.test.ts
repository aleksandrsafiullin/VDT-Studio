import { describe, expect, it } from "vitest";
import { VdtBuilderSession } from "@vdt-studio/vdt-core";
import { AgentRunStore } from "../run-store";
import { ToolRegistry, type AgentToolContext } from "../tool-registry";
import { createSkillTools } from "./skill-tools";

describe("skill tools", () => {
  it("returns recipe quality, source, and warnings from skill.compile_recipe", async () => {
    const { registry, context } = testRegistry();

    const result = await registry.run("skill.compile_recipe", {
      skillId: "mining.drill_and_blast"
    }, context);

    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({
      skillId: "mining.drill_and_blast",
      recipeQuality: "complete",
      recipeSource: "template",
      warnings: expect.any(Array)
    });
  });

  it("does not seed a missing generic-support recipe as a domain draft", async () => {
    const builder = new VdtBuilderSession({ now: () => "2026-07-01T00:00:00.000Z" });
    builder.createDraft({ projectTitle: "Custom KPI", rootKpi: "Custom KPI" });
    const { registry, context, store, runId } = testRegistry(builder);
    store.updateRun(runId, {
      recipes: [{
        skillId: "mining.unseeded_process",
        recipeQuality: "missing",
        recipeSource: "generic_fallback",
        requiredInputs: ["driver_logic"],
        questions: [],
        initialDrivers: [],
        formulaTemplates: [],
        deepenRules: [],
        warnings: ["Executable recipe missing."]
      }]
    });

    const result = await registry.run("skill.seed_draft_from_recipe", {
      skillId: "mining.unseeded_process",
      rootKpi: "Custom KPI"
    }, context);

    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({
      code: "RECIPE_INCOMPLETE"
    });
  });
});

function testRegistry(builder?: VdtBuilderSession) {
  const store = new AgentRunStore({ now: () => "2026-07-01T00:00:00.000Z" });
  const run = store.createRun({
    mode: "generate_vdt",
    input: { rootKpi: "Mining KPI" },
    providerId: "mock",
    options: { autoApplyPatches: true }
  });
  if (builder) store.updateRun(run.runId, { builder, draftProject: builder.getProject() });
  const registry = new ToolRegistry();
  for (const tool of createSkillTools()) registry.register(tool);
  const context = {
    runId: run.runId,
    store,
    emit: (event) => store.appendEvent(run.runId, event),
    getRun: () => store.getSnapshot(run.runId),
    updateRun: (patch) => {
      store.updateRun(run.runId, patch);
    },
    builder,
    signal: run.abortController.signal
  } satisfies AgentToolContext;
  return { registry, context, store, runId: run.runId };
}
