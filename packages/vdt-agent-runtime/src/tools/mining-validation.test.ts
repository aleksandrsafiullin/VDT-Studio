import { describe, expect, it } from "vitest";
import { VdtBuilderSession, type VdtProject } from "@vdt-studio/vdt-core";
import { AgentRunStore } from "../run-store";
import type { VdtAgentRunState } from "../types";
import { validateMiningProject } from "./mining-validation";

describe("mining validation", () => {
  it("rejects additive sequential stage capacity in mine production systems", () => {
    const { state, project } = projectWithRootFormula(
      "Mine production",
      "block_preparation_capacity_tonnes + drill_and_blast_capacity_tonnes",
      ["mining.mine_production_system"],
      ["block_preparation_capacity_tonnes", "drill_and_blast_capacity_tonnes"]
    );

    const validation = validateMiningProject(state, project);

    expect(validation.valid).toBe(false);
    expect(validation.errors.map((error) => error.id)).toContain("mining_sequential_stage_addition");
  });

  it("rejects ore and waste sums when root KPI is a product KPI", () => {
    const { state, project } = projectWithRootFormula(
      "Ore mined",
      "ore_capacity_tonnes + waste_capacity_tonnes",
      ["mining.material_allocation_ore_waste"],
      ["ore_capacity_tonnes", "waste_capacity_tonnes"]
    );

    const validation = validateMiningProject(state, project);

    expect(validation.valid).toBe(false);
    expect(validation.errors.map((error) => error.id)).toContain("mining_ore_waste_product_scope");
  });

  it("keeps haul route cycle out of excavation productivity", () => {
    const builder = new VdtBuilderSession({ now: () => "2026-07-01T00:00:00.000Z" });
    builder.createDraft({ projectTitle: "Excavation", rootKpi: "Excavation" });
    builder.addDriver({
      parentNodeId: "excavation",
      nodeId: "excavator_productivity",
      name: "Excavator productivity",
      type: "calculated",
      relation: "multiplicative_driver"
    });
    builder.addDriver({
      parentNodeId: "excavator_productivity",
      nodeId: "haul_route_cycle",
      name: "Haul route cycle",
      type: "calculated",
      relation: "formula_dependency"
    });
    const state = stateWithSkills(["mining.excavation"]);

    const validation = validateMiningProject(state, builder.getProject());

    expect(validation.valid).toBe(false);
    expect(validation.errors.map((error) => error.id)).toContain("mining_excavation_haulage_boundary_haul_route_cycle");
  });

  it("rejects open-pit-only chains for underground production cycle", () => {
    const { state, project } = projectWithRootFormula(
      "Mine production",
      "block_preparation_capacity_tonnes",
      ["mining.underground_production_cycle"],
      ["block_preparation_capacity_tonnes"]
    );

    const validation = validateMiningProject(state, project);

    expect(validation.valid).toBe(false);
    expect(validation.errors.map((error) => error.id)).toContain("mining_underground_forced_open_pit");
  });
});

function projectWithRootFormula(
  rootKpi: string,
  formula: string,
  skillIds: string[],
  driverIds: string[]
): { state: VdtAgentRunState; project: VdtProject } {
  const builder = new VdtBuilderSession({ now: () => "2026-07-01T00:00:00.000Z" });
  builder.createDraft({ projectTitle: rootKpi, rootKpi });
  for (const driverId of driverIds) {
    builder.addDriver({
      parentNodeId: builder.getProject().rootNodeId,
      nodeId: driverId,
      name: driverId.replace(/_/g, " "),
      type: "input",
      relation: "positive_driver",
      baselineValue: 1
    });
  }
  builder.setFormula({ nodeId: builder.getProject().rootNodeId, formula });
  return { state: stateWithSkills(skillIds), project: builder.getProject() };
}

function stateWithSkills(skillIds: string[]): VdtAgentRunState {
  const store = new AgentRunStore({ now: () => "2026-07-01T00:00:00.000Z" });
  const state = store.createRun({
    mode: "generate_vdt",
    input: { rootKpi: "Mining KPI" },
    providerId: "mock"
  });
  return store.updateRun(state.runId, {
    selectedSkills: skillIds.map((id) => ({
      id,
      path: `${id}.md`,
      title: id,
      score: 100,
      reason: "test",
      matchedTerms: []
    }))
  });
}
