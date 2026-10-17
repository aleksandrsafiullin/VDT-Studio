import { calculateGraph, VdtBuilderSession } from "@vdt-studio/vdt-core";
import { loadDefaultSkillLibrary, readExecutableSkillTopology } from "@vdt-studio/vdt-agent";
import { describe, expect, it } from "vitest";
import { AgentRunStore } from "../run-store";
import type { AgentToolContext } from "../tool-registry";
import { createDefaultToolRegistry } from ".";

function setup(options: { autoApplyPatches?: boolean; continueWithAssumptions?: boolean; unit?: string; mode?: "continue_project" | "deepen_node" } = {}) {
  const builder = new VdtBuilderSession();
  builder.createDraft({ projectTitle: "Mine draft", rootKpi: "Excavation", unit: options.unit ?? "t", timePeriod: "Year" });
  const store = new AgentRunStore();
  const run = store.createRun({ mode: options.mode ?? "continue_project", providerId: "mock", input: {
    rootKpi: "Excavation", unit: options.unit ?? "t", timePeriod: "Year", project: builder.getProject(),
    ...(options.mode === "deepen_node" ? { selectedNodeId: builder.getProject().rootNodeId } : {}),
    prompt: "4 excavators; 10 trucks; one-way distance 2 km; loaded speed 10 km/h; empty speed 7 km/h; planned truck repair 15 days."
  }, options: { autoApplyPatches: options.autoApplyPatches ?? true, continueWithAssumptions: options.continueWithAssumptions ?? true } });
  store.updateRun(run.runId, { builder, draftProject: builder.getProject() });
  const context: AgentToolContext = { runId: run.runId, store, builder, signal: run.abortController.signal,
    emit: (event) => store.appendEvent(run.runId, event), getRun: () => store.getSnapshot(run.runId),
    updateRun: (patch) => { store.updateRun(run.runId, patch); } };
  return { builder, store, context, registry: createDefaultToolRegistry() };
}
async function defaults() {
  const skill = (await loadDefaultSkillLibrary()).byId.get("mining.load_and_haul")!;
  return Object.fromEntries(readExecutableSkillTopology(skill)!.nodes.filter((node) => node.illustrativeDefault).map((node) => [node.id, true]));
}

describe("explicit complete skill topology seeding", () => {
  it("keeps six supplied facts unknown, marks all selected estimates, and calculates both annual bottlenecks after fact capture", async () => {
    const { builder, store, context, registry } = setup(); const rootId = builder.getProject().rootNodeId;
    const seeded = await registry.run("skill.seed_topology", { skillId: "mining.load_and_haul", defaults: await defaults() }, context);
    expect(seeded.ok, JSON.stringify(seeded.error)).toBe(true);
    expect(builder.getProject().rootNodeId).toBe(rootId);
    expect(builder.getProject().graph.nodes).toHaveLength(35);
    expect(builder.getProject().graph.nodes.find((node) => node.id === rootId)?.type).toBe("root_kpi");
    expect(seeded.output).toMatchObject({ remainingInputIds: ["excavator_count", "truck_count", "truck_repair_days", "haul_distance_km", "loaded_speed_kmh", "empty_speed_kmh"] });
    const estimates = builder.getProject().graph.nodes.filter((node) => node.valueStatus === "default_assumption");
    expect(estimates).toHaveLength(16);
    expect(estimates.every((node) => node.valueSource?.acceptedByUserInDialog === false && node.valueSource?.editableInDialog === true)).toBe(true);
    const filled = await registry.run("vdt.fill_input_values_batch", { values: [
      { nodeId: "excavator_count", value: 4, provenance: "user_provided_value", note: "4 excavators" },
      { nodeId: "truck_count", value: 10, provenance: "user_provided_value", note: "10 trucks" },
      { nodeId: "truck_repair_days", value: 15, provenance: "user_provided_value", note: "planned truck repair 15 days" },
      { nodeId: "haul_distance_km", value: 2, provenance: "user_provided_value", note: "one-way distance 2 km" },
      { nodeId: "loaded_speed_kmh", value: 10, provenance: "user_provided_value", note: "loaded speed 10 km/h" },
      { nodeId: "empty_speed_kmh", value: 7, provenance: "user_provided_value", note: "empty speed 7 km/h" }
    ] }, context);
    expect(filled.ok).toBe(true);
    const project = builder.getProject(); const result = calculateGraph(project);
    expect(builder.validate().validation.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.values.productive_hours_day).toBe(21.5);
    expect(result.values.loaded_travel_minutes).toBe(12);
    expect(result.values.empty_travel_minutes).toBeCloseTo(120 / 7, 9);
    expect(result.values.excavator_working_days).toBe(355);
    expect(result.values.truck_working_days).toBe(350);
    expect(result.values.excavator_net_hours_year).toBeCloseTo(7250.875, 8);
    expect(result.values.truck_loading_minutes).toBeCloseTo(50 / 9, 9);
    expect(result.values.haul_cycle_minutes).toBeCloseTo(2501 / 63, 9);
    expect(result.values.excavation_capacity_t).toBeCloseTo(31323780, 5);
    expect(result.rootValue).toBeCloseTo(10 * 7148.75 * 60 * 100 * 63 / 2501, 5);
    const fasterReturn = calculateGraph(project, { overrides: { empty_speed_kmh: 14 } });
    expect(fasterReturn.rootValue!).toBeGreaterThan(result.rootValue!);
    expect(fasterReturn.values.excavation_capacity_t).toBe(result.values.excavation_capacity_t);
    const fewerExcavators = calculateGraph(project, { overrides: { excavator_count: 1 } });
    expect(fewerExcavators.rootValue).toBeCloseTo(7830945, 5);
    expect(fewerExcavators.rootValue).toBe(fewerExcavators.values.excavation_capacity_t);
    const longerMeals = calculateGraph(project, { overrides: { meal_hours_shift: 2 } });
    expect(longerMeals.values.productive_hours_day).toBe(19.5);
    expect(store.getState(context.runId).selectedSkills.map((skill) => skill.id)).toEqual(["mining.load_and_haul"]);
  });

  it("creates no numeric defaults unless the actor explicitly selects them", async () => {
    const { builder, context, registry } = setup({ continueWithAssumptions: false });
    const result = await registry.run("skill.seed_topology", { skillId: "mining.load_and_haul", defaults: {} }, context);
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect(builder.getProject().graph.nodes.filter((node) => Number.isFinite(node.baselineValue ?? node.value))).toEqual([]);
  });

  it("rejects unauthorized or nonexistent defaults atomically", async () => {
    for (const [permission, selected, code] of [
      [false, { calendar_days: true }, "ASSUMPTIONS_NOT_AUTHORIZED"],
      [true, { excavator_count: true }, "UNKNOWN_REFERENCE_DEFAULT"]
    ] as const) {
      const { builder, context, registry } = setup({ continueWithAssumptions: permission }); const before = JSON.stringify(builder.getProject());
      const result = await registry.run("skill.seed_topology", { skillId: "mining.load_and_haul", defaults: selected }, context);
      expect(result.error?.code).toBe(code);
      expect(JSON.stringify(builder.getProject())).toBe(before);
    }
  });

  it("preserves existing work and incompatible root units", async () => {
    const unit = setup({ unit: "USD" }); const unitBefore = JSON.stringify(unit.builder.getProject());
    expect((await unit.registry.run("skill.seed_topology", { skillId: "mining.load_and_haul", defaults: {} }, unit.context)).error?.code).toBe("TOPOLOGY_SCOPE_MISMATCH");
    expect(JSON.stringify(unit.builder.getProject())).toBe(unitBefore);
    const existing = setup(); existing.builder.addDriver({ parentNodeId: existing.builder.getProject().rootNodeId, name: "Existing input" });
    const before = JSON.stringify(existing.builder.getProject());
    expect((await existing.registry.run("skill.seed_topology", { skillId: "mining.load_and_haul", defaults: {} }, existing.context)).error?.code).toBe("TOPOLOGY_REQUIRES_BLANK_ROOT");
    expect(JSON.stringify(existing.builder.getProject())).toBe(before);
  });

  it("never bypasses the selected one-layer scope of a deepen run", async () => {
    const { builder, registry, context } = setup({ mode: "deepen_node" });
    const before = JSON.stringify(builder.getProject());
    const result = await registry.run("skill.seed_topology", { skillId: "mining.load_and_haul", defaults: {} }, context);
    expect(result.error?.code).toBe("MUTATION_SCOPE_VIOLATION");
    expect(JSON.stringify(builder.getProject())).toBe(before);
  });

  it("leaves the actual root untouched while approval is pending", async () => {
    const { builder, context, registry, store } = setup({ autoApplyPatches: false });
    const before = JSON.stringify(builder.getProject());
    const result = await registry.run("skill.seed_topology", { skillId: "mining.load_and_haul", defaults: await defaults() }, context);
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect(JSON.stringify(builder.getProject())).toBe(before);
    expect(store.getSnapshot(context.runId).pendingMutationProposal?.previewProject.graph.nodes).toHaveLength(35);
  });
});
