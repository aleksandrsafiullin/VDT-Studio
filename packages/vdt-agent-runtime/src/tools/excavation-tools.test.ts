import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { VdtBuilderSession, calculateGraph, type VdtProject } from "@vdt-studio/vdt-core";
import { AgentRunStore } from "../run-store";
import { type AgentToolContext } from "../tool-registry";
import { createDefaultToolRegistry } from ".";
import { validateExcavationProject } from "./excavation-tools";

const timestamp = "2026-06-30T00:00:00.000Z";

describe("excavation runtime tools", () => {
  it("reads compact dialogue policy from the excavation dialogue-flow reference", async () => {
    const { context } = createExcavationContext("excavation_output");
    const registry = createDefaultToolRegistry();

    const policy = await registry.run("excavation.dialogue_policy", { section: "input_order" }, context);

    expect(policy.ok).toBe(true);
    expect(policy.output).toMatchObject({
      referenceFile: "references/excavation-dialogue-flow.yaml",
      answerOptions: ["enter_custom_value", "use_suggested_reference_value_when_available", "leave_unknown_for_now"],
      valueStatuses: {
        customUserValue: "user_provided_value",
        acceptedCatalogSuggestion: "default_assumption",
        skippedOrUnknown: "unknown"
      }
    });
    expect((policy.output as { inputKpiQuestionOrder: string[] }).inputKpiQuestionOrder).toEqual(expect.arrayContaining([
      "active_excavator_count",
      "actual_bucket_fill_factor",
      "ore_density_in_solid_t_per_m3"
    ]));
    expect(JSON.stringify(policy.output)).not.toContain("cat_6020_average_bucket_volume_m3");
    expect(JSON.stringify(policy.output)).not.toContain("formula_numeric_ore_productivity_example");
  });

  it("builds the canonical ore excavation topology with unknown numeric leaves", async () => {
    const { builder, context } = createExcavationContext("excavation_output");
    const registry = createDefaultToolRegistry();

    const result = await registry.run("excavation.seed_topology", {
      materialMode: "ore_tonnes",
      rootKpi: "excavation_output",
      unit: "t",
      timePeriod: "month"
    }, context);

    expect(result.ok).toBe(true);
    const project = builder.getProject();
    expectNodeIds(project, [
      "active_excavator_count",
      "net_excavation_time_per_excavator_h",
      "calendar_time_per_excavator_h",
      "period_days",
      "hours_per_day_24",
      "downtime_per_excavator_h",
      "ore_excavator_productivity_tph",
      "loaded_trucks_per_hour",
      "truck_loading_time_min",
      "tonnes_per_truck",
      "tonnes_per_bucket",
      "average_bucket_volume_m3",
      "ore_density_in_solid_t_per_m3",
      "swell_factor",
      "actual_bucket_fill_factor"
    ]);
    expect(formula(project, "excavation_output")).toBe("active_excavator_count * net_excavation_time_per_excavator_h * excavator_productivity");
    expect(formula(project, "calendar_time_per_excavator_h")).toBe("period_days * 24");
    expect(formula(project, "net_excavation_time_per_excavator_h")).toBe("calendar_time_per_excavator_h - downtime_per_excavator_h");
    expect(formula(project, "ore_excavator_productivity_tph")).toBe("loaded_trucks_per_hour * tonnes_per_truck");
    expect(project.graph.nodes.find((node) => node.id === "average_bucket_volume_m3")).toMatchObject({ valueStatus: "unknown" });
    expect(project.graph.nodes.find((node) => node.id === "hours_per_day_24")).toMatchObject({
      baselineValue: 24,
      valueStatus: "default_assumption"
    });
    expectForbiddenNodesAbsent(project);
  });

  it("does not truncate the deterministic excavation topology at the default progressive depth", async () => {
    const { builder, context } = createExcavationContext("excavation_output", { maxAutoDepth: 3 });
    const registry = createDefaultToolRegistry();

    const result = await registry.run("excavation.seed_topology", {
      materialMode: "ore_tonnes",
      rootKpi: "excavation_output",
      unit: "t",
      timePeriod: "month"
    }, context);

    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({ applied: true, validation: { valid: true } });
    const project = builder.getProject();
    expectNodeIds(project, [
      "truck_loading_time_min",
      "loading_movement_unloading_time_min",
      "face_breakdown_ripping_time_min",
      "truck_departure_arrival_time_min",
      "relocation_time_min",
      "tonnes_per_truck",
      "buckets_per_truck",
      "tonnes_per_bucket",
      "bucket_cycle_time_sec"
    ]);
    expect(formula(project, "truck_loading_time_min")).toBe(
      "loading_movement_unloading_time_min + face_breakdown_ripping_time_min + truck_departure_arrival_time_min + relocation_time_min"
    );
    expect(formula(project, "loading_movement_unloading_time_min")).toBe("buckets_per_truck * bucket_cycle_time_sec / 60");
  });

  it("rejects an equipment-only excavation split as an incomplete skill topology", () => {
    const builder = new VdtBuilderSession({ now: () => timestamp });
    builder.createDraft({
      projectTitle: "Ore Excavation Driver Model",
      rootKpi: "Ore Excavation",
      unit: "Tonnes/Year",
      timePeriod: "Year",
      industry: "Mining"
    });
    builder.addDriver({
      parentNodeId: "ore_excavation",
      nodeId: "hydraulic_shovel_excavation_output",
      name: "Hydraulic shovel excavation output",
      type: "calculated"
    });
    builder.addDriver({
      parentNodeId: "hydraulic_shovel_excavation_output",
      nodeId: "komatsu_pc1250_excavation_output",
      name: "Komatsu PC1250 excavation output",
      type: "input",
      baselineValue: 8_760_000
    });
    builder.addDriver({
      parentNodeId: "hydraulic_shovel_excavation_output",
      nodeId: "komatsu_pc2000_excavation_output",
      name: "Komatsu PC2000 excavation output",
      type: "input",
      baselineValue: 3_504_000
    });
    builder.setFormula({
      nodeId: "hydraulic_shovel_excavation_output",
      formula: "komatsu_pc1250_excavation_output + komatsu_pc2000_excavation_output"
    });
    builder.setFormula({
      nodeId: "ore_excavation",
      formula: "hydraulic_shovel_excavation_output"
    });

    const validation = validateExcavationProject(builder.getProject(), {
      requireCanonicalOutputTopology: true,
      requireProductivityTopology: true
    });

    expect(validation.valid).toBe(false);
    expect(validation.errors.map((error) => error.id)).toEqual(expect.arrayContaining([
      "excavation_missing_canonical_output_active_excavator_count",
      "excavation_missing_canonical_output_excavator_productivity",
      "excavation_incomplete_material_per_truck_branch"
    ]));
  });

  it("models readiness and access restrictions as downtime, not output caps", async () => {
    const { builder, context } = createExcavationContext("excavation_output");
    const registry = createDefaultToolRegistry();

    await registry.run("excavation.seed_topology", {
      materialMode: "ore_tonnes",
      rootKpi: "excavation_output",
      includeReadinessDowntime: true
    }, context);

    const project = builder.getProject();
    const downtimeChildren = project.graph.edges
      .filter((edge) => edge.sourceNodeId === "downtime_per_excavator_h")
      .map((edge) => edge.targetNodeId);
    expect(downtimeChildren).toEqual(expect.arrayContaining([
      "material_or_face_not_ready_time_h",
      "drill_blast_waiting_or_restricted_access_time_h",
      "operating_area_access_restriction_time_h",
      "geotechnical_or_safety_restriction_time_h"
    ]));
    expect(formula(project, "downtime_per_excavator_h")).toContain("material_or_face_not_ready_time_h");
    expect(project.graph.nodes.map((node) => node.id)).not.toEqual(expect.arrayContaining([
      "material_ready_for_excavation_cap",
      "operating_area_access_cap",
      "actual_excavation_output_min_cap_branch"
    ]));
    expect(JSON.stringify(project.graph.nodes.map((node) => node.formula ?? ""))).not.toMatch(/min\(|material_readiness_factor/);
  });

  it("builds rock productivity in solid cubic meters without ore density or tonne nodes", async () => {
    const { builder, context } = createExcavationContext("rock_excavator_productivity_m3ph");
    const registry = createDefaultToolRegistry();

    const result = await registry.run("excavation.seed_topology", {
      materialMode: "rock_solid_m3",
      scope: "productivity",
      rootKpi: "rock_excavator_productivity_m3ph",
      unit: "solid m3/h"
    }, context);

    expect(result.ok).toBe(true);
    const project = builder.getProject();
    expectNodeIds(project, [
      "loaded_trucks_per_hour",
      "rock_volume_per_truck_in_solid_m3",
      "buckets_per_truck",
      "rock_volume_per_bucket_in_solid_m3",
      "average_bucket_volume_m3",
      "swell_factor",
      "actual_bucket_fill_factor"
    ]);
    expect(formula(project, "rock_volume_per_bucket_in_solid_m3")).toBe("average_bucket_volume_m3 / swell_factor * actual_bucket_fill_factor");
    expect(formula(project, "rock_excavator_productivity_m3ph")).toBe("loaded_trucks_per_hour * rock_volume_per_truck_in_solid_m3");
    expect(project.graph.nodes.map((node) => node.id)).not.toEqual(expect.arrayContaining([
      "ore_density_in_solid_t_per_m3",
      "tonnes_per_bucket",
      "truck_fleet_capacity"
    ]));
  });

  it("converts fleet-total downtime instead of multiplying excavator count twice", async () => {
    const { builder, context } = createExcavationContext("excavation_output");
    const registry = createDefaultToolRegistry();

    await registry.run("excavation.seed_topology", {
      materialMode: "ore_tonnes",
      rootKpi: "excavation_output",
      downtimeBasis: "fleet_total"
    }, context);
    const validation = await registry.run("excavation.validate", {}, context);

    const project = builder.getProject();
    expect(formula(project, "downtime_per_excavator_h")).toBe("fleet_downtime_h / active_excavator_count");
    expect(JSON.stringify(project.graph.nodes.map((node) => node.formula ?? ""))).not.toContain(
      "active_excavator_count * (active_excavator_count * period_days * 24 - fleet_downtime_h) * excavator_productivity"
    );
    expect(validation.ok).toBe(true);
  });

  it("does not sum ore tonnes and rock cubic meters without an explicit convention", async () => {
    const { builder, context } = createExcavationContext("material_output_split");
    const registry = createDefaultToolRegistry();

    await registry.run("excavation.seed_topology", {
      materialMode: "mixed_ore_tonnes_and_rock_m3",
      rootKpi: "material_output_split"
    }, context);

    const project = builder.getProject();
    expectNodeIds(project, ["ore_excavation_output_t", "rock_excavation_output_solid_m3"]);
    expect(formula(project, "material_output_split")).toBeUndefined();
    expect(JSON.stringify(project.graph.nodes.map((node) => node.formula ?? ""))).not.toContain("ore_excavation_output_t + rock_excavation_output_solid_m3");
  });

  it("splits equipment classes when productivity drivers differ", async () => {
    const { builder, context } = createExcavationContext("total_excavation_output");
    const registry = createDefaultToolRegistry();

    await registry.run("excavation.seed_topology", {
      splitMode: "equipment_class",
      rootKpi: "total_excavation_output"
    }, context);

    const project = builder.getProject();
    expectNodeIds(project, ["hydraulic_shovel_excavation_output", "rope_shovel_excavation_output"]);
    expect(formula(project, "total_excavation_output")).toBe("hydraulic_shovel_excavation_output + rope_shovel_excavation_output");
  });

  it("returns targeted defaults and records accepted catalog values as default assumptions", async () => {
    const { builder, context } = createExcavationContext("excavation_output");
    const registry = createDefaultToolRegistry();

    await registry.run("excavation.seed_topology", {
      materialMode: "ore_tonnes",
      rootKpi: "excavation_output"
    }, context);
    const suggestion = await registry.run("excavation.suggest_reference_value", {
      nodeId: "actual_bucket_fill_factor",
      materialKey: "average blasted ore"
    }, context);

    expect(suggestion.ok).toBe(true);
    const suggestionOutput = suggestion.output as { suggestion: Record<string, unknown> };
    expect(suggestionOutput.suggestion).toMatchObject({
      nodeId: "actual_bucket_fill_factor",
      value: 0.825,
      range: [0.75, 0.9],
      assumptionStatus: "default_assumption",
      editableInDialog: true,
      acceptedByUserInDialog: false
    });

    await registry.run("excavation.write_input_value", {
      nodeId: "actual_bucket_fill_factor",
      value: 0.825,
      unit: "ratio",
      valueStatus: "default_assumption",
      source: {
        sourceTier: "material_specific_industry_default",
        confidence: "low",
        catalogRef: "references/excavation-defaults.yaml#default_tables.actual_bucket_fill_factor.entries.average_blasted_rock",
        range: [0.75, 0.9],
        acceptedByUserInDialog: true,
        editableInDialog: true
      }
    }, context);

    expect(builder.getProject().graph.nodes.find((node) => node.id === "actual_bucket_fill_factor")).toMatchObject({
      baselineValue: 0.825,
      valueStatus: "default_assumption",
      valueSource: {
        acceptedByUserInDialog: true,
        editableInDialog: true,
        range: [0.75, 0.9]
      }
    });
  });

  it("targets equipment catalog lookup for Cat 6020 bucket volume", async () => {
    const registry = createDefaultToolRegistry();
    const { context } = createExcavationContext("excavation_output");

    const suggestion = await registry.run("excavation.suggest_reference_value", {
      nodeId: "average_bucket_volume_m3",
      equipmentAlias: "Cat 6020"
    }, context);

    expect(suggestion.ok).toBe(true);
    const suggestionOutput = suggestion.output as { suggestion: Record<string, unknown> };
    expect(suggestionOutput.suggestion).toMatchObject({
      nodeId: "average_bucket_volume_m3",
      value: 12,
      unit: "m3",
      sourceTier: "equipment_model_specific_value",
      assumptionStatus: "default_assumption"
    });
    expect(JSON.stringify(suggestion.output)).not.toContain("cat_6060_bucket_and_pass_context");
  });

  it("uses excavation eval JSON from tests only and preserves numeric formula sanity", async () => {
    const skillsRoot = join(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))), "vdt-agent", "skills");
    const evals = JSON.parse(await readFile(join(skillsRoot, "mining/evals/excavation.evals.json"), "utf8"));
    const numericCase = evals.tests.find((testCase: { id: string }) => testCase.id === "formula_numeric_ore_productivity_example");
    expect(numericCase).toBeDefined();

    const { builder, context } = createExcavationContext("excavator_productivity");
    const registry = createDefaultToolRegistry();
    await registry.run("excavation.seed_topology", {
      materialMode: "ore_tonnes",
      scope: "productivity",
      rootKpi: "excavator_productivity"
    }, context);
    for (const [nodeId, value] of Object.entries(numericCase.input_values as Record<string, number>)) {
      await registry.run("excavation.write_input_value", {
        nodeId,
        value,
        valueStatus: "user_provided_value",
        source: { acceptedByUserInDialog: true }
      }, context);
    }

    const calculation = calculateGraph(builder.getProject());
    for (const assertion of numericCase.numeric_assertions as Array<{ node_id: string; expected_value: number; tolerance: number }>) {
      expect(calculation.values[assertion.node_id]).toBeCloseTo(assertion.expected_value, 4);
    }
  });
});

function createExcavationContext(
  rootKpi: string,
  options: { maxAutoDepth?: number | undefined } = {}
): { builder: VdtBuilderSession; context: AgentToolContext } {
  const store = new AgentRunStore({ now: () => timestamp });
  const run = store.createRun({
    mode: "generate_vdt",
    input: {
      rootKpi,
      industry: "Mining",
      unit: "t",
      timePeriod: "month"
    },
    providerId: "mock",
    options: {
      autoApplyPatches: true,
      ...(options.maxAutoDepth !== undefined ? { maxAutoDepth: options.maxAutoDepth } : {})
    }
  });
  const builder = new VdtBuilderSession({ now: () => timestamp });
  store.updateRun(run.runId, { builder, draftProject: builder.getProject() });
  return {
    builder,
    context: {
      runId: run.runId,
      store,
      emit: (event) => store.appendEvent(run.runId, event),
      getRun: () => store.getSnapshot(run.runId),
      updateRun: (patch) => {
        store.updateRun(run.runId, patch);
      },
      builder,
      signal: run.abortController.signal
    }
  };
}

function expectNodeIds(project: VdtProject, expected: string[]): void {
  expect(project.graph.nodes.map((node) => node.id)).toEqual(expect.arrayContaining(expected));
}

function formula(project: VdtProject, nodeId: string): string | undefined {
  return project.graph.nodes.find((node) => node.id === nodeId)?.formula;
}

function expectForbiddenNodesAbsent(project: VdtProject): void {
  expect(project.graph.nodes.map((node) => node.id)).not.toEqual(expect.arrayContaining([
    "truck_fleet_capacity",
    "truck_arrival_rate",
    "truck_queueing_time",
    "haul_route_cycle_time",
    "dispatch_match_factor",
    "dumping_capacity",
    "processing_throughput",
    "material_ready_for_excavation_cap",
    "operating_area_access_cap",
    "drilling_blasting_readiness_cap"
  ]));
}
