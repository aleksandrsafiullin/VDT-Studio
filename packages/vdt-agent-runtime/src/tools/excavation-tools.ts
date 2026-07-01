import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  stableSnakeId,
  warning,
  type VdtChangeSet,
  type VdtNode,
  type VdtNodeAddition,
  type VdtNodePatch,
  type VdtNodeValueSource,
  type VdtNodeValueStatus,
  type VdtProject,
  type VdtWarning
} from "@vdt-studio/vdt-core";
import { proposeAndMaybeApplyMutation } from "../mutation-pipeline";
import { AgentToolError, type AgentTool, type AgentToolContext } from "../tool-registry";
import { summarizeValidation } from "../summaries";
import { requireBuilder } from "./builder-mutation-utils";

type MaterialMode = "ore_tonnes" | "rock_solid_m3" | "mixed_ore_tonnes_and_rock_m3";
type ExcavationScope = "output" | "productivity";
type DowntimeBasis = "per_excavator" | "fleet_total";
type SplitMode = "none" | "equipment_class";

interface ExcavationValidationOptions {
  requireCanonicalOutputTopology?: boolean | undefined;
  requireProductivityTopology?: boolean | undefined;
}

interface NodeSpec {
  id: string;
  name: string;
  type?: VdtNode["type"] | undefined;
  unit?: string | undefined;
  relation?: VdtNodeAddition["relation"] | undefined;
  formula?: string | undefined;
  baselineValue?: number | undefined;
  valueStatus?: VdtNodeValueStatus | undefined;
  valueSource?: VdtNodeValueSource | undefined;
  status?: VdtNode["status"] | undefined;
  assumptions?: string[] | undefined;
  tags?: string[] | undefined;
}

export interface ExcavationReferenceSuggestion {
  nodeId: string;
  value: number;
  unit: string;
  range?: [number, number] | undefined;
  sourceTier: string;
  confidence: string;
  catalogRef: string;
  assumptionStatus: "default_assumption";
  editableInDialog: true;
  acceptedByUserInDialog: false;
  referenceFile: string;
}

const valueStatusSchema = z.enum([
  "unknown",
  "user_provided_value",
  "default_assumption",
  "calculated",
  "partially_calculable"
]);

const valueSourceSchema = z.object({
  sourceTier: z.string().max(120).optional(),
  confidence: z.string().max(80).optional(),
  catalogRef: z.string().max(240).optional(),
  acceptedByUserInDialog: z.boolean().optional(),
  editableInDialog: z.boolean().optional(),
  note: z.string().max(500).optional(),
  range: z.tuple([z.number().finite(), z.number().finite()]).optional()
}).strict();

const seedTopologyInputSchema = z.object({
  materialMode: z.enum(["ore_tonnes", "rock_solid_m3", "mixed_ore_tonnes_and_rock_m3"]).default("ore_tonnes"),
  scope: z.enum(["output", "productivity"]).default("output"),
  splitMode: z.enum(["none", "equipment_class"]).default("none"),
  rootKpi: z.string().min(1).max(200).optional(),
  unit: z.string().max(80).optional(),
  timePeriod: z.string().max(80).optional(),
  downtimeBasis: z.enum(["per_excavator", "fleet_total"]).default("per_excavator"),
  includeReadinessDowntime: z.boolean().default(true)
}).strict();

const suggestInputSchema = z.object({
  nodeId: z.string().min(1).max(160),
  materialKey: z.string().max(120).optional(),
  equipmentAlias: z.string().max(120).optional()
}).strict();

const writeInputValueSchema = z.object({
  nodeId: z.string().min(1).max(160),
  value: z.number().finite().optional(),
  unit: z.string().max(80).optional(),
  valueStatus: valueStatusSchema,
  source: valueSourceSchema.optional()
}).strict();

export function createExcavationTools(): AgentTool[] {
  return [
    excavationDialoguePolicyTool,
    excavationSeedTopologyTool,
    excavationSuggestReferenceValueTool,
    excavationWriteInputValueTool,
    excavationValidateTool
  ];
}

const excavationDialoguePolicyTool: AgentTool = {
  name: "excavation.dialogue_policy",
  description: "Read the compact dialog-only policy from excavation-dialogue-flow.yaml for topology-first conversation order.",
  inputSchema: z.object({
    section: z.enum(["runtime_principles", "topology_questions", "input_order", "reference_lookup_policy", "final_validation"]).default("input_order")
  }).strict(),
  outputSchema: z.record(z.unknown()),
  phase: "planning_decomposition",
  async run(_context, input) {
    const dialogue = await readReferenceFile("excavation-dialogue-flow.yaml");
    return dialoguePolicySection(dialogue, input.section);
  }
};

const excavationSeedTopologyTool: AgentTool = {
  name: "excavation.seed_topology",
  description: "Build a mining excavation VDT topology first, with unknown numeric leaves and no silent defaults.",
  inputSchema: seedTopologyInputSchema,
  outputSchema: z.record(z.unknown()),
  mutatesProject: true,
  requiresDraftProject: true,
  phase: "building_graph",
  run(context, input) {
    const builder = requireBuilder(context.builder);
    let project = builder.getProject();
    const rootKpi = input.rootKpi ?? defaultRootKpi(input.materialMode, input.scope, input.splitMode);
    if (project.graph.nodes.length === 0) {
      const result = builder.createDraft({
        projectTitle: `${rootKpi} Driver Model`,
        rootKpi,
        unit: input.unit ?? defaultUnit(input.materialMode, input.scope),
        timePeriod: input.timePeriod
      });
      project = result.project;
      context.store.updateRun(context.runId, { draftProject: project });
      context.emit({
        type: "graph_patch",
        phase: "building_graph",
        title: "Excavation draft root created",
        message: result.event.message,
        metadata: { revision: result.revision, rootNodeId: project.rootNodeId }
      });
    }

    if (input.materialMode === "mixed_ore_tonnes_and_rock_m3") {
      return seedMixedUnitSplit(context, project.rootNodeId);
    }
    if (input.splitMode === "equipment_class") {
      return seedEquipmentSplit(context, project.rootNodeId);
    }
    if (input.scope === "productivity") {
      return seedProductivityRoot(context, project.rootNodeId, input.materialMode);
    }
    return seedOutputTopology(context, project.rootNodeId, input.materialMode, input.downtimeBasis, input.includeReadinessDowntime);
  }
};

const excavationSuggestReferenceValueTool: AgentTool = {
  name: "excavation.suggest_reference_value",
  description: "Return one targeted excavation reference suggestion for the active input KPI only.",
  inputSchema: suggestInputSchema,
  outputSchema: z.record(z.unknown()),
  phase: "planning_decomposition",
  async run(_context, input) {
    const suggestion = await suggestExcavationReference(input.nodeId, {
      materialKey: input.materialKey,
      equipmentAlias: input.equipmentAlias
    });
    return {
      suggestion,
      policy: {
        dialogOnly: true,
        applyAutomatically: false,
        acceptedStatus: "default_assumption",
        fullCatalogLoadedIntoPrompt: false
      }
    };
  }
};

const excavationWriteInputValueTool: AgentTool = {
  name: "excavation.write_input_value",
  description: "Write one dialog-provided or accepted-default excavation input value with explicit provenance.",
  inputSchema: writeInputValueSchema,
  outputSchema: z.record(z.unknown()),
  mutatesProject: true,
  requiresDraftProject: true,
  phase: "building_graph",
  run(context, input) {
    const builder = requireBuilder(context.builder);
    const project = builder.getProject();
    if (!project.graph.nodes.some((node) => node.id === input.nodeId)) {
      throw new AgentToolError("NODE_NOT_FOUND", `Node "${input.nodeId}" was not found.`);
    }
    const patch: VdtNodePatch = {
      status: input.valueStatus === "unknown" ? "needs_data" : input.valueStatus === "default_assumption" ? "assumption" : "accepted",
      valueStatus: input.valueStatus
    };
    if (input.value !== undefined) {
      patch.baselineValue = input.value;
      patch.value = input.value;
    }
    if (input.unit) patch.unit = input.unit;
    if (input.source) patch.valueSource = input.source;

    const mutation = proposeAndMaybeApplyMutation(context, {
      title: "Excavation input value captured",
      summary: `Captured ${input.valueStatus} for ${input.nodeId}.`,
      targetNodeId: input.nodeId,
      changeSet: changeSet(context, {
        updates: [{ id: `update_${input.nodeId}_value`, nodeId: input.nodeId, patch }]
      })
    });
    return {
      nodeId: input.nodeId,
      valueStatus: input.valueStatus,
      revision: mutation.revision,
      mutationProposal: { id: mutation.proposal.id, status: mutation.proposal.status },
      validation: mutation.validation
    };
  }
};

const excavationValidateTool: AgentTool = {
  name: "excavation.validate",
  description: "Validate excavation-specific graph guardrails such as readiness downtime, forbidden haulage creep, and mixed-unit sums.",
  inputSchema: z.object({}),
  outputSchema: z.record(z.unknown()),
  requiresDraftProject: true,
  phase: "validating_graph",
  run(context) {
    const project = requireBuilder(context.builder).getProject();
    const result = validateExcavationProject(project);
    context.emit({
      type: "graph_validation",
      phase: "validating_graph",
      title: result.valid ? "Excavation validation passed" : "Excavation validation found issues",
      message: result.valid
        ? `Excavation validation passed with ${result.warnings.length} warning${result.warnings.length === 1 ? "" : "s"}.`
        : `Excavation validation found ${result.errors.length} error${result.errors.length === 1 ? "" : "s"}.`,
      metadata: { errors: result.errors.length, warnings: result.warnings.length }
    });
    return result;
  }
};

function seedOutputTopology(
  context: AgentToolContext,
  rootNodeId: string,
  materialMode: Exclude<MaterialMode, "mixed_ore_tonnes_and_rock_m3">,
  downtimeBasis: DowntimeBasis,
  includeReadinessDowntime: boolean
): Record<string, unknown> {
  const proposals = [];
  const top = applyLayer(context, rootNodeId, [
    inputNode("active_excavator_count", "Active excavator count", "excavators"),
    calculatedNode("net_excavation_time_per_excavator_h", "Net excavation time per excavator", "h"),
    calculatedNode("excavator_productivity", "Excavator productivity", materialMode === "ore_tonnes" ? "t/h" : "solid m3/h")
  ], [
    {
      nodeId: rootNodeId,
      patch: {
        formula: "active_excavator_count * net_excavation_time_per_excavator_h * excavator_productivity",
        valueStatus: "calculated"
      }
    }
  ], {
    title: "Excavation top drivers added",
    summary: "Added the canonical active fleet, net time, and productivity drivers.",
    assumptions: ["Numeric site inputs remain unknown until collected through dialog."]
  });
  proposals.push(top);
  if (!top.applied) return pendingResult(context, proposals);

  const timeLayer = applyLayer(context, "net_excavation_time_per_excavator_h", [
    calculatedNode("calendar_time_per_excavator_h", "Calendar time per excavator", "h"),
    calculatedNode("downtime_per_excavator_h", "Downtime per excavator", "h")
  ], [], {
    title: "Excavation time branch added",
    summary: "Added calendar time and downtime under net excavation time."
  });
  proposals.push(timeLayer);
  if (!timeLayer.applied) return pendingResult(context, proposals);

  const calendarLayer = applyLayer(context, "calendar_time_per_excavator_h", [
    inputNode("period_days", "Period days", "days"),
    constantNode("hours_per_day_24", "Hours per day", "h/day", 24)
  ], [
    { nodeId: "calendar_time_per_excavator_h", patch: { formula: "period_days * 24", valueStatus: "calculated" } },
    { nodeId: "net_excavation_time_per_excavator_h", patch: { formula: "calendar_time_per_excavator_h - downtime_per_excavator_h", valueStatus: "calculated" } }
  ], {
    title: "Excavation calendar branch added",
    summary: "Added period and fixed 24-hour calendar constant."
  });
  proposals.push(calendarLayer);
  if (!calendarLayer.applied) return pendingResult(context, proposals);

  if (downtimeBasis === "fleet_total") {
    const fleetLayer = applyLayer(context, "downtime_per_excavator_h", [
      inputNode("fleet_downtime_h", "Fleet downtime", "h")
    ], [
      { nodeId: "downtime_per_excavator_h", patch: { formula: "fleet_downtime_h / active_excavator_count", valueStatus: "calculated" } }
    ], {
      title: "Excavation fleet downtime branch added",
      summary: "Converted fleet-total downtime to downtime per excavator.",
      warnings: [
        excavationWarning("fleet_downtime_basis", "downtime basis is fleet total and must be converted or modeled as fleet net time", "downtime_per_excavator_h")
      ]
    });
    proposals.push(fleetLayer);
    if (!fleetLayer.applied) return pendingResult(context, proposals);
  } else {
    const downtimeNodes = downtimeCategoryNodes(includeReadinessDowntime);
    const firstDowntime = applyLayer(context, "downtime_per_excavator_h", downtimeNodes.slice(0, 8), [], {
      title: "Excavation downtime categories added",
      summary: "Added the first visible layer of downtime categories.",
      assumptions: ["Readiness, drill/blast waits, access, geotechnical, and safety restrictions are downtime categories, not caps."]
    });
    proposals.push(firstDowntime);
    if (!firstDowntime.applied) return pendingResult(context, proposals);
    const remaining = downtimeNodes.slice(8);
    if (remaining.length > 0) {
      const secondDowntime = applyLayer(context, "downtime_per_excavator_h", remaining, [], {
        title: "Excavation downtime categories completed",
        summary: "Added remaining downtime categories."
      });
      proposals.push(secondDowntime);
      if (!secondDowntime.applied) return pendingResult(context, proposals);
    }
    const downtimeFormula = applyUpdates(context, [
      {
        nodeId: "downtime_per_excavator_h",
        patch: {
          formula: downtimeCategoryFormula(downtimeNodes.map((node) => node.id)),
          valueStatus: "calculated"
        }
      }
    ], {
      title: "Excavation downtime formula set",
      summary: "Set downtime as the sum of explicit downtime categories."
    });
    proposals.push(downtimeFormula);
    if (!downtimeFormula.applied) return pendingResult(context, proposals);
  }

  const productivity = seedProductivityBranch(context, "excavator_productivity", materialMode);
  proposals.push(...productivity.proposals);
  if (!productivity.applied) return pendingResult(context, proposals);

  const validation = validateExcavationProject(requireBuilder(context.builder).getProject());
  context.store.updateRun(context.runId, { validationState: summarizeValidation(validation) });
  return {
    applied: true,
    rootNodeId,
    materialMode,
    proposals: proposals.map((proposal) => proposalSummary(proposal)),
    validation
  };
}

function seedProductivityRoot(
  context: AgentToolContext,
  rootNodeId: string,
  materialMode: Exclude<MaterialMode, "mixed_ore_tonnes_and_rock_m3">
): Record<string, unknown> {
  const productivity = seedProductivityBranch(context, rootNodeId, materialMode);
  const validation = validateExcavationProject(requireBuilder(context.builder).getProject());
  context.store.updateRun(context.runId, { validationState: summarizeValidation(validation) });
  return {
    applied: productivity.applied,
    rootNodeId,
    materialMode,
    proposals: productivity.proposals.map((proposal) => proposalSummary(proposal)),
    validation
  };
}

function seedProductivityBranch(
  context: AgentToolContext,
  parentNodeId: string,
  materialMode: Exclude<MaterialMode, "mixed_ore_tonnes_and_rock_m3">
): { applied: boolean; proposals: ReturnType<typeof applyLayer>[] } {
  const proposals: ReturnType<typeof applyLayer>[] = [];
  const namedProductivityId = materialMode === "ore_tonnes" ? "ore_excavator_productivity_tph" : "rock_excavator_productivity_m3ph";
  const materialPerTruckId = materialMode === "ore_tonnes" ? "tonnes_per_truck" : "rock_volume_per_truck_in_solid_m3";
  const materialPerTruckName = materialMode === "ore_tonnes" ? "Tonnes per truck" : "Rock volume per truck in solid m3";
  const materialPerTruckUnit = materialMode === "ore_tonnes" ? "t/truck" : "solid m3/truck";
  const productivityUnit = materialMode === "ore_tonnes" ? "t/h" : "solid m3/h";

  const layer = applyLayer(context, parentNodeId, [
    calculatedNode("loaded_trucks_per_hour", "Loaded trucks per hour", "trucks/h"),
    calculatedNode("material_per_truck", "Material per truck", materialPerTruckUnit),
    calculatedNode(namedProductivityId, materialMode === "ore_tonnes" ? "Ore excavator productivity" : "Rock excavator productivity", productivityUnit)
  ], [
    { nodeId: parentNodeId, patch: { formula: "loaded_trucks_per_hour * material_per_truck", valueStatus: "calculated" } }
  ], {
    title: "Excavation productivity branch added",
    summary: "Added loaded trucks per hour and material per truck without adding haulage cycle nodes."
  });
  proposals.push(layer);
  if (!layer.applied) return { applied: false, proposals };

  const loadedTruckLayer = applyLayer(context, "loaded_trucks_per_hour", [
    constantNode("minutes_per_hour_60", "Minutes per hour", "min/h", 60),
    calculatedNode("truck_loading_time_min", "Truck loading time", "min/truck")
  ], [
    { nodeId: "loaded_trucks_per_hour", patch: { formula: "60 / truck_loading_time_min", valueStatus: "calculated" } }
  ], {
    title: "Excavation loaded-truck rate added",
    summary: "Added loading-time denominator for loaded trucks per hour."
  });
  proposals.push(loadedTruckLayer);
  if (!loadedTruckLayer.applied) return { applied: false, proposals };

  const truckLoadingLayer = applyLayer(context, "truck_loading_time_min", [
    calculatedNode("loading_movement_unloading_time_min", "Loading movement and unloading time", "min/truck"),
    inputNode("face_breakdown_ripping_time_min", "Face breakdown or ripping time", "min/truck"),
    inputNode("truck_departure_arrival_time_min", "Truck departure and arrival time", "min/truck"),
    inputNode("relocation_time_min", "Relocation time", "min/truck")
  ], [
    {
      nodeId: "truck_loading_time_min",
      patch: {
        formula: "loading_movement_unloading_time_min + face_breakdown_ripping_time_min + truck_departure_arrival_time_min + relocation_time_min",
        valueStatus: "calculated"
      }
    }
  ], {
    title: "Excavation loading-time components added",
    summary: "Added loading-time components without route, queueing, or dispatch nodes."
  });
  proposals.push(truckLoadingLayer);
  if (!truckLoadingLayer.applied) return { applied: false, proposals };

  const materialLayer = applyLayer(context, "material_per_truck", [
    calculatedNode(materialPerTruckId, materialPerTruckName, materialPerTruckUnit)
  ], [
    { nodeId: "material_per_truck", patch: { formula: materialPerTruckId, valueStatus: "calculated" } },
    {
      nodeId: namedProductivityId,
      patch: {
        formula: `loaded_trucks_per_hour * ${materialPerTruckId}`,
        valueStatus: "calculated"
      }
    }
  ], {
    title: "Excavation material-per-truck branch added",
    summary: `Added ${materialPerTruckName.toLowerCase()} for the selected material mode.`
  });
  proposals.push(materialLayer);
  if (!materialLayer.applied) return { applied: false, proposals };

  const materialBranch = materialMode === "ore_tonnes" ? seedOreMaterialBranch(context) : seedRockMaterialBranch(context);
  proposals.push(...materialBranch);
  if (materialBranch.some((proposal) => !proposal.applied)) return { applied: false, proposals };
  const formulaLayer = applyUpdates(context, [
    {
      nodeId: "loading_movement_unloading_time_min",
      patch: { formula: "buckets_per_truck * bucket_cycle_time_sec / 60", valueStatus: "calculated" }
    }
  ], {
    title: "Excavation bucket movement formula set",
    summary: "Set loading movement time from bucket passes and bucket cycle time."
  });
  proposals.push(formulaLayer);
  return { applied: proposals.every((proposal) => proposal.applied), proposals };
}

function seedOreMaterialBranch(context: AgentToolContext): ReturnType<typeof applyLayer>[] {
  const proposals: ReturnType<typeof applyLayer>[] = [];
  const truckLayer = applyLayer(context, "tonnes_per_truck", [
    inputNode("buckets_per_truck", "Buckets per truck", "buckets/truck"),
    calculatedNode("tonnes_per_bucket", "Tonnes per bucket", "t/bucket")
  ], [
    { nodeId: "tonnes_per_truck", patch: { formula: "buckets_per_truck * tonnes_per_bucket", valueStatus: "calculated" } }
  ], {
    title: "Excavation ore truck payload branch added",
    summary: "Added buckets per truck and tonnes per bucket."
  });
  proposals.push(truckLayer);
  if (!truckLayer.applied) return proposals;

  const bucketLayer = applyLayer(context, "tonnes_per_bucket", [
    inputNode("average_bucket_volume_m3", "Average bucket volume", "m3"),
    inputNode("ore_density_in_solid_t_per_m3", "Ore density in solid tonnes per m3", "t/solid m3"),
    inputNode("swell_factor", "Swell factor", "ratio"),
    inputNode("actual_bucket_fill_factor", "Actual bucket fill factor", "ratio"),
    inputNode("bucket_cycle_time_sec", "Bucket cycle time", "sec/bucket")
  ], [
    {
      nodeId: "tonnes_per_bucket",
      patch: {
        formula: "average_bucket_volume_m3 / swell_factor * actual_bucket_fill_factor * ore_density_in_solid_t_per_m3",
        valueStatus: "calculated"
      }
    }
  ], {
    title: "Excavation ore bucket payload branch added",
    summary: "Added bucket volume, density, swell, fill factor, and bucket cycle inputs."
  });
  proposals.push(bucketLayer);
  return proposals;
}

function seedRockMaterialBranch(context: AgentToolContext): ReturnType<typeof applyLayer>[] {
  const proposals: ReturnType<typeof applyLayer>[] = [];
  const truckLayer = applyLayer(context, "rock_volume_per_truck_in_solid_m3", [
    inputNode("buckets_per_truck", "Buckets per truck", "buckets/truck"),
    calculatedNode("rock_volume_per_bucket_in_solid_m3", "Rock volume per bucket in solid m3", "solid m3/bucket")
  ], [
    {
      nodeId: "rock_volume_per_truck_in_solid_m3",
      patch: { formula: "buckets_per_truck * rock_volume_per_bucket_in_solid_m3", valueStatus: "calculated" }
    }
  ], {
    title: "Excavation rock truck-volume branch added",
    summary: "Added buckets per truck and solid rock volume per bucket."
  });
  proposals.push(truckLayer);
  if (!truckLayer.applied) return proposals;

  const bucketLayer = applyLayer(context, "rock_volume_per_bucket_in_solid_m3", [
    inputNode("average_bucket_volume_m3", "Average bucket volume", "m3"),
    inputNode("swell_factor", "Swell factor", "ratio"),
    inputNode("actual_bucket_fill_factor", "Actual bucket fill factor", "ratio"),
    inputNode("bucket_cycle_time_sec", "Bucket cycle time", "sec/bucket")
  ], [
    {
      nodeId: "rock_volume_per_bucket_in_solid_m3",
      patch: { formula: "average_bucket_volume_m3 / swell_factor * actual_bucket_fill_factor", valueStatus: "calculated" }
    }
  ], {
    title: "Excavation rock bucket-volume branch added",
    summary: "Added bucket volume, swell, fill factor, and bucket cycle inputs."
  });
  proposals.push(bucketLayer);
  return proposals;
}

function seedMixedUnitSplit(context: AgentToolContext, rootNodeId: string): Record<string, unknown> {
  const proposal = applyLayer(context, rootNodeId, [
    calculatedNode("ore_excavation_output_t", "Ore excavation output", "t"),
    calculatedNode("rock_excavation_output_solid_m3", "Rock excavation output", "solid m3")
  ], [], {
    title: "Excavation material split added",
    summary: "Added ore tonnes and rock solid-m3 branches without summing unlike units.",
    warnings: [
      excavationWarning(
        "mixed_units_reporting_convention",
        "ore tonnes and rock cubic meters cannot be summed without an explicit reporting convention"
      )
    ]
  });
  const validation = validateExcavationProject(requireBuilder(context.builder).getProject());
  return { applied: proposal.applied, rootNodeId, proposals: [proposalSummary(proposal)], validation };
}

function seedEquipmentSplit(context: AgentToolContext, rootNodeId: string): Record<string, unknown> {
  const proposal = applyLayer(context, rootNodeId, [
    calculatedNode("hydraulic_shovel_excavation_output", "Hydraulic shovel excavation output"),
    calculatedNode("rope_shovel_excavation_output", "Rope shovel excavation output")
  ], [
    {
      nodeId: rootNodeId,
      patch: {
        formula: "hydraulic_shovel_excavation_output + rope_shovel_excavation_output",
        valueStatus: "calculated"
      }
    }
  ], {
    title: "Excavation equipment split added",
    summary: "Split excavation output by equipment class because productivity drivers differ."
  });
  const validation = validateExcavationProject(requireBuilder(context.builder).getProject());
  return { applied: proposal.applied, rootNodeId, proposals: [proposalSummary(proposal)], validation };
}

function applyLayer(
  context: AgentToolContext,
  parentNodeId: string,
  nodeSpecs: NodeSpec[],
  updates: Array<{ nodeId: string; patch: VdtNodePatch }> = [],
  options: { title: string; summary: string; assumptions?: string[]; warnings?: VdtWarning[] }
) {
  const project = requireBuilder(context.builder).getProject();
  const existing = new Set(project.graph.nodes.map((node) => node.id));
  const additions = nodeSpecs
    .filter((node) => !existing.has(node.id))
    .map((node) => addition(parentNodeId, node));
  return applyChangeSet(context, additions, updates, parentNodeId, options);
}

function applyUpdates(
  context: AgentToolContext,
  updates: Array<{ nodeId: string; patch: VdtNodePatch }>,
  options: { title: string; summary: string; assumptions?: string[]; warnings?: VdtWarning[] }
) {
  return applyChangeSet(context, [], updates, undefined, options);
}

function applyChangeSet(
  context: AgentToolContext,
  additions: VdtNodeAddition[],
  updates: Array<{ nodeId: string; patch: VdtNodePatch }>,
  targetNodeId: string | undefined,
  options: { title: string; summary: string; assumptions?: string[]; warnings?: VdtWarning[] }
) {
  if (additions.length === 0 && updates.length === 0) {
    return {
      applied: true,
      revision: requireBuilder(context.builder).getRevision(),
      proposal: {
        id: `${context.runId}:mutation:skipped`,
        status: "applied",
        title: options.title,
        summary: options.summary
      }
    };
  }
  return proposeAndMaybeApplyMutation(context, {
    title: options.title,
    summary: options.summary,
    targetNodeId,
    allowSkillDefinedDepth: true,
    changeSet: changeSet(context, {
      additions,
      updates: updates.map((update) => ({ id: `update_${update.nodeId}_${stableSnakeId(options.title, "excavation")}`, ...update })),
      ...(options.assumptions ? { assumptions: options.assumptions } : {}),
      ...(options.warnings ? { warnings: options.warnings } : {})
    })
  });
}

function changeSet(
  context: AgentToolContext,
  input: Partial<Pick<VdtChangeSet, "additions" | "updates" | "deletions" | "edgeChanges" | "assumptions" | "questions" | "warnings">>
): VdtChangeSet {
  return {
    id: `changeset_${context.runId}_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    taskType: "generate_tree",
    backendId: context.getRun().request.providerId,
    createdAt: new Date().toISOString(),
    additions: input.additions ?? [],
    updates: input.updates ?? [],
    deletions: input.deletions ?? [],
    edgeChanges: input.edgeChanges ?? [],
    assumptions: input.assumptions ?? [],
    questions: input.questions ?? [],
    warnings: input.warnings ?? []
  };
}

function addition(parentNodeId: string, node: NodeSpec): VdtNodeAddition {
  return {
    id: `add_${node.id}`,
    nodeId: node.id,
    parentNodeId,
    relation: node.relation ?? (node.formula || node.type === "calculated" ? "formula_dependency" : "positive_driver"),
    name: node.name,
    description: undefined,
    type: node.type,
    unit: node.unit,
    formula: node.formula,
    baselineValue: node.baselineValue,
    valueStatus: node.valueStatus,
    valueSource: node.valueSource,
    assumptions: node.assumptions,
    tags: node.tags
  };
}

function inputNode(id: string, name: string, unit?: string): NodeSpec {
  return {
    id,
    name,
    type: "input",
    unit,
    status: "needs_data",
    valueStatus: "unknown",
    assumptions: ["Collect value through dialog; do not silently default."]
  };
}

function calculatedNode(id: string, name: string, unit?: string): NodeSpec {
  return { id, name, type: "calculated", unit, valueStatus: "calculated", relation: "formula_dependency" };
}

function constantNode(id: string, name: string, unit: string, value: number): NodeSpec {
  return {
    id,
    name,
    type: "assumption",
    unit,
    baselineValue: value,
    valueStatus: "default_assumption",
    valueSource: {
      sourceTier: "fixed_time_conversion",
      confidence: "high",
      acceptedByUserInDialog: true,
      editableInDialog: false,
      note: "Fixed calendar conversion constant."
    },
    assumptions: ["Fixed conversion constant."]
  };
}

function downtimeCategoryNodes(includeReadiness: boolean): NodeSpec[] {
  const base = [
    inputNode("scheduled_non_excavation_time_h", "Scheduled non-excavation time", "h"),
    inputNode("technical_downtime_h", "Technical downtime", "h"),
    inputNode("technological_downtime_h", "Technological downtime", "h"),
    inputNode("organizational_downtime_h", "Organizational downtime", "h"),
    inputNode("relocation_or_move_time_h", "Relocation or move time", "h")
  ];
  if (!includeReadiness) {
    return [...base, inputNode("other_downtime_h", "Other downtime", "h")];
  }
  return [
    ...base,
    inputNode("material_or_face_not_ready_time_h", "Material or face not ready time", "h"),
    inputNode("drill_blast_waiting_or_restricted_access_time_h", "Drill/blast waiting or restricted access time", "h"),
    inputNode("operating_area_access_restriction_time_h", "Operating area access restriction time", "h"),
    inputNode("geotechnical_or_safety_restriction_time_h", "Geotechnical or safety restriction time", "h"),
    inputNode("other_downtime_h", "Other downtime", "h")
  ];
}

function downtimeCategoryFormula(nodeIds: string[]): string {
  return nodeIds.join(" + ");
}

function defaultRootKpi(materialMode: MaterialMode, scope: ExcavationScope, splitMode: SplitMode): string {
  if (splitMode === "equipment_class") return "total_excavation_output";
  if (materialMode === "mixed_ore_tonnes_and_rock_m3") return "material_output_split";
  if (scope === "productivity") {
    return materialMode === "ore_tonnes" ? "ore_excavator_productivity_tph" : "rock_excavator_productivity_m3ph";
  }
  return materialMode === "ore_tonnes" ? "excavation_output" : "rock_excavation_output_solid_m3";
}

function defaultUnit(materialMode: MaterialMode, scope: ExcavationScope): string | undefined {
  if (materialMode === "mixed_ore_tonnes_and_rock_m3") return undefined;
  if (scope === "productivity") return materialMode === "ore_tonnes" ? "t/h" : "solid m3/h";
  return materialMode === "ore_tonnes" ? "t" : "solid m3";
}

function pendingResult(context: AgentToolContext, proposals: ReturnType<typeof applyLayer>[]): Record<string, unknown> {
  const latest = context.store.getState(context.runId).pendingMutationProposal;
  return {
    applied: false,
    pendingMutationProposal: latest ? { id: latest.id, status: latest.status, title: latest.title } : undefined,
    proposals: proposals.map((proposal) => proposalSummary(proposal))
  };
}

function proposalSummary(proposal: ReturnType<typeof applyLayer>): Record<string, unknown> {
  return {
    id: proposal.proposal.id,
    status: proposal.proposal.status,
    title: proposal.proposal.title,
    applied: proposal.applied
  };
}

export async function suggestExcavationReference(
  nodeId: string,
  input: { materialKey?: string | undefined; equipmentAlias?: string | undefined } = {}
): Promise<ExcavationReferenceSuggestion | null> {
  if (nodeId === "average_bucket_volume_m3" && input.equipmentAlias) {
    const equipment = await equipmentSuggestion(input.equipmentAlias);
    if (equipment) return equipment;
  }
  return defaultSuggestion(nodeId, input.materialKey);
}

async function equipmentSuggestion(alias: string): Promise<ExcavationReferenceSuggestion | null> {
  const normalized = normalizeKey(alias);
  if (!["cat6020", "caterpillar6020", "cat_6020"].includes(normalized)) return null;
  await readReferenceFile("equipment-catalog.yaml");
  return {
    nodeId: "average_bucket_volume_m3",
    value: 12,
    unit: "m3",
    sourceTier: "equipment_model_specific_value",
    confidence: "medium",
    catalogRef: "references/equipment-catalog.yaml#excavators.cat_6020.bucket.nominal_volume_m3",
    assumptionStatus: "default_assumption",
    editableInDialog: true,
    acceptedByUserInDialog: false,
    referenceFile: "references/equipment-catalog.yaml"
  };
}

async function defaultSuggestion(nodeId: string, materialKey?: string | undefined): Promise<ExcavationReferenceSuggestion | null> {
  await readReferenceFile("excavation-defaults.yaml");
  const key = normalizeKey(materialKey ?? "");
  if (nodeId === "actual_bucket_fill_factor") {
    if (key.includes("average") || key.includes("blast") || !key) {
      return defaultReference(nodeId, 0.825, "ratio", [0.75, 0.9], "material_specific_industry_default", "low", "references/excavation-defaults.yaml#default_tables.actual_bucket_fill_factor.entries.average_blasted_rock");
    }
  }
  if (nodeId === "swell_factor") {
    const rock = key.includes("waste") || key.includes("rock");
    return defaultReference(nodeId, rock ? 1.65 : 1.6, "ratio_loose_to_bank", rock ? [1.5, 1.75] : [1.45, 1.7], "material_specific_industry_default", "low", `references/excavation-defaults.yaml#default_tables.swell_factor.entries.${rock ? "unknown_blasted_waste_rock" : "unknown_blasted_ore"}`);
  }
  if (nodeId === "buckets_per_truck") {
    return defaultReference(nodeId, 5, "buckets/truck", [3, 6], "generic_open_pit_excavation_default", "low", "references/excavation-defaults.yaml#default_tables.buckets_per_truck.entries.generic_open_pit_excavation_default");
  }
  if (nodeId === "bucket_cycle_time_sec") {
    const shovel = key.includes("hydraulic") ? "hydraulic_front_shovel" : "unknown_mining_excavator";
    return defaultReference(nodeId, shovel === "hydraulic_front_shovel" ? 29 : 30, "sec/bucket", shovel === "hydraulic_front_shovel" ? [25, 33] : [25, 35], "generic_open_pit_excavation_default", "low", `references/excavation-defaults.yaml#default_tables.bucket_cycle_time_sec.entries.${shovel}`);
  }
  return null;
}

function defaultReference(
  nodeId: string,
  value: number,
  unit: string,
  range: [number, number],
  sourceTier: string,
  confidence: string,
  catalogRef: string
): ExcavationReferenceSuggestion {
  return {
    nodeId,
    value,
    unit,
    range,
    sourceTier,
    confidence,
    catalogRef,
    assumptionStatus: "default_assumption",
    editableInDialog: true,
    acceptedByUserInDialog: false,
    referenceFile: catalogRef.split("#")[0]!.replace("references/", "references/")
  };
}

async function readReferenceFile(fileName: "excavation-dialogue-flow.yaml" | "excavation-defaults.yaml" | "equipment-catalog.yaml"): Promise<string> {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(moduleDir, "../../../vdt-agent/skills/mining/references", fileName),
    join(moduleDir, "../../vdt-agent-skills/mining/references", fileName),
    join(moduleDir, "vdt-agent-skills/mining/references", fileName)
  ];
  for (const candidate of candidates) {
    try {
      return await readFile(candidate, "utf8");
    } catch {
      // Probe the next source/sidecar skill location.
    }
  }
  throw new AgentToolError("REFERENCE_FILE_NOT_FOUND", `Excavation reference file "${fileName}" was not found.`);
}

function dialoguePolicySection(text: string, section: string): Record<string, unknown> {
  if (section === "runtime_principles") {
    return {
      referenceFile: "references/excavation-dialogue-flow.yaml",
      interactionMode: scalarAfter(text, "interaction_mode"),
      noMissingInputsPanel: booleanAfter(text, "no_missing_inputs_panel"),
      topologyBeforeInputValues: booleanAfter(text, "topology_before_input_values"),
      maxQuestionsPerTurn: numberAfter(text, "max_questions_per_turn"),
      acceptedDefaultsStatus: scalarAfter(text, "store_accepted_defaults_as"),
      skippedValuesStatus: scalarAfter(text, "store_skipped_values_as"),
      readinessAccessAsDowntime: booleanAfter(text, "model_readiness_access_as_downtime"),
      noReadinessAccessMinCaps: booleanAfter(text, "do_not_create_readiness_access_min_caps")
    };
  }
  if (section === "topology_questions") {
    return {
      referenceFile: "references/excavation-dialogue-flow.yaml",
      topologyQuestionIds: listItemIds(text, "topology_question_bank"),
      maxQuestionsPerTurn: numberAfter(text, "max_questions_per_turn"),
      topologyOnlyBeforeValues: true
    };
  }
  if (section === "reference_lookup_policy") {
    return {
      referenceFile: "references/excavation-dialogue-flow.yaml",
      defaultsCatalogNodes: nestedList(text, "load_defaults_catalog_for_nodes"),
      equipmentCatalogNodes: nestedList(text, "load_equipment_catalog_for_nodes"),
      noReferenceDefaultsForNodes: nestedList(text, "no_reference_defaults_for_nodes"),
      loadOnlyActiveQuestionEntries: true
    };
  }
  if (section === "final_validation") {
    return {
      referenceFile: "references/excavation-dialogue-flow.yaml",
      requiredChecks: nestedList(text, "required_checks")
    };
  }
  return {
    referenceFile: "references/excavation-dialogue-flow.yaml",
    inputKpiQuestionOrder: nestedList(text, "input_kpi_question_order"),
    answerOptions: ["enter_custom_value", "use_suggested_reference_value_when_available", "leave_unknown_for_now"],
    valueStatuses: {
      customUserValue: "user_provided_value",
      acceptedCatalogSuggestion: "default_assumption",
      skippedOrUnknown: "unknown"
    }
  };
}

function scalarAfter(text: string, key: string): string | undefined {
  return new RegExp(`\\n\\s*${key}:\\s*([^\\n]+)`).exec(`\n${text}`)?.[1]?.trim();
}

function booleanAfter(text: string, key: string): boolean | undefined {
  const value = scalarAfter(text, key);
  return value === "true" ? true : value === "false" ? false : undefined;
}

function numberAfter(text: string, key: string): number | undefined {
  const value = Number(scalarAfter(text, key));
  return Number.isFinite(value) ? value : undefined;
}

function nestedList(text: string, key: string): string[] {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `${key}:`);
  if (start === -1) return [];
  const values: string[] = [];
  const baseIndent = leadingSpaces(lines[start]!);
  for (const line of lines.slice(start + 1)) {
    if (line.trim() && leadingSpaces(line) <= baseIndent && !line.trim().startsWith("- ")) break;
    const item = /^\s*-\s+(.+)$/.exec(line)?.[1]?.trim();
    if (item) values.push(item);
  }
  return values;
}

function listItemIds(text: string, key: string): string[] {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `${key}:`);
  if (start === -1) return [];
  const values: string[] = [];
  const baseIndent = leadingSpaces(lines[start]!);
  for (const line of lines.slice(start + 1)) {
    if (line.trim() && leadingSpaces(line) <= baseIndent) break;
    const item = /^\s*-\s+id:\s+(.+)$/.exec(line)?.[1]?.trim();
    if (item) values.push(item);
  }
  return values;
}

function leadingSpaces(value: string): number {
  return value.match(/^\s*/)?.[0].length ?? 0;
}

export function validateExcavationProject(
  project: VdtProject,
  options: ExcavationValidationOptions = {}
): { valid: boolean; errors: VdtWarning[]; warnings: VdtWarning[] } {
  const errors: VdtWarning[] = [];
  const warnings: VdtWarning[] = [];
  const nodeIds = new Set(project.graph.nodes.map((node) => node.id));
  const normalizedNodes = new Map(project.graph.nodes.map((node) => [normalizeKey(node.id), node]));
  const childrenByParent = new Map<string, string[]>();
  for (const edge of project.graph.edges) {
    childrenByParent.set(edge.sourceNodeId, [...(childrenByParent.get(edge.sourceNodeId) ?? []), edge.targetNodeId]);
  }

  for (const forbidden of GLOBAL_FORBIDDEN_NODES) {
    if (nodeIds.has(forbidden) || normalizedNodes.has(normalizeKey(forbidden))) {
      errors.push(excavationWarning(`forbidden_${forbidden}`, `Forbidden excavation skill node present: ${forbidden}.`, forbidden));
    }
  }

  for (const node of project.graph.nodes) {
    const normalizedId = normalizeKey(node.id);
    const normalizedName = normalizeKey(node.name);
    const formula = normalizeFormula(node.formula ?? "");
    if ((normalizedId.includes("cap") || normalizedName.includes("cap")) && READINESS_ACCESS_TERMS.some((term) => normalizedId.includes(term) || normalizedName.includes(term))) {
      errors.push(excavationWarning(`readiness_cap_${node.id}`, "Readiness and access restrictions must be downtime categories, not cap nodes.", node.id));
    }
    if (formula.includes("min(") || /material.*readiness.*factor/.test(formula)) {
      errors.push(excavationWarning(`readiness_formula_${node.id}`, "Readiness and access restrictions must not be modeled as min caps or output multipliers.", node.id));
    }
    if (/(ktg|kio|availability|utilization).*coefficient/.test(normalizedId) || /(ktg|kio|availability|utilization).*coefficient/.test(formula)) {
      errors.push(excavationWarning(`coefficient_substitute_${node.id}`, "Do not substitute KTG/KIO/availability/utilization coefficients for explicit excavation time and downtime structure.", node.id));
    }
    if (/activexcavatorcount\*\(activexcavatorcount\*perioddays\*24-fleetdowntimeh\)\*excavatorproductivity/.test(formula)) {
      errors.push(excavationWarning(`double_count_${node.id}`, "Fleet downtime is multiplied by active excavator count twice.", node.id));
    }
    if (/oreexcavationoutputt\+rockexcavationoutputsolidm3|rockexcavationoutputsolidm3\+oreexcavationoutputt/.test(formula)) {
      errors.push(excavationWarning(`mixed_unit_sum_${node.id}`, "Ore tonnes and rock cubic meters cannot be summed without an explicit reporting convention.", node.id));
    }
  }

  for (const readinessNodeId of READINESS_DOWNTIME_NODE_IDS) {
    if (!nodeIds.has(readinessNodeId)) continue;
    const downtimeChildren = new Set(childrenByParent.get("downtime_per_excavator_h") ?? []);
    if (!downtimeChildren.has(readinessNodeId)) {
      errors.push(excavationWarning(`readiness_parent_${readinessNodeId}`, `${readinessNodeId} must sit under downtime_per_excavator_h.`, readinessNodeId));
    }
  }

  const hasFleetDowntime = nodeIds.has("fleet_downtime_h");
  const downtimeFormula = project.graph.nodes.find((node) => node.id === "downtime_per_excavator_h")?.formula;
  if (hasFleetDowntime && downtimeFormula !== "fleet_downtime_h / active_excavator_count") {
    warnings.push(excavationWarning("fleet_downtime_basis", "downtime basis is fleet total and must be converted or modeled as fleet net time", "downtime_per_excavator_h"));
  }

  const missingVisibleStatus = project.graph.nodes.filter(
    (node) => node.type === "input" && node.baselineValue === undefined && node.valueStatus !== "unknown"
  );
  for (const node of missingVisibleStatus) {
    warnings.push(excavationWarning(`unknown_status_${node.id}`, "Missing numeric values should be visibly marked unknown.", node.id));
  }

  const requireCanonicalOutput = options.requireCanonicalOutputTopology === true ||
    hasCanonicalExcavationOutputSignal(project, nodeIds);
  if (requireCanonicalOutput) {
    requireNodeSet(nodeIds, CANONICAL_OUTPUT_NODE_IDS, "canonical_output", errors);
    requireChildren(project.rootNodeId, ["active_excavator_count", "net_excavation_time_per_excavator_h", "excavator_productivity"], childrenByParent, errors);
    requireFormula(project, project.rootNodeId, "active_excavator_count * net_excavation_time_per_excavator_h * excavator_productivity", errors);
    requireChildren("net_excavation_time_per_excavator_h", ["calendar_time_per_excavator_h", "downtime_per_excavator_h"], childrenByParent, errors);
    requireChildren("calendar_time_per_excavator_h", ["period_days", "hours_per_day_24"], childrenByParent, errors);
    requireFormula(project, "calendar_time_per_excavator_h", "period_days * 24", errors);
    requireFormula(project, "net_excavation_time_per_excavator_h", "calendar_time_per_excavator_h - downtime_per_excavator_h", errors);
  }

  const requireProductivity = options.requireProductivityTopology === true || hasProductivitySignal(nodeIds);
  if (requireProductivity) {
    requireNodeSet(nodeIds, PRODUCTIVITY_NODE_IDS, "productivity", errors);
    const productivityParentId = nodeIds.has("excavator_productivity") ? "excavator_productivity" : project.rootNodeId;
    requireChildren(productivityParentId, ["loaded_trucks_per_hour", "material_per_truck"], childrenByParent, errors);
    requireFormula(project, productivityParentId, "loaded_trucks_per_hour * material_per_truck", errors);
    requireChildren("loaded_trucks_per_hour", ["minutes_per_hour_60", "truck_loading_time_min"], childrenByParent, errors);
    requireFormula(project, "loaded_trucks_per_hour", "60 / truck_loading_time_min", errors);
    requireNodeSet(nodeIds, TRUCK_LOADING_TIME_COMPONENT_NODE_IDS, "truck_loading_time", errors);
    requireChildren("truck_loading_time_min", TRUCK_LOADING_TIME_COMPONENT_NODE_IDS, childrenByParent, errors);
    requireFormula(project, "truck_loading_time_min", "loading_movement_unloading_time_min + face_breakdown_ripping_time_min + truck_departure_arrival_time_min + relocation_time_min", errors);
    requireFormula(project, "loading_movement_unloading_time_min", "buckets_per_truck * bucket_cycle_time_sec / 60", errors);

    const hasOreBranch = ORE_MATERIAL_BRANCH_NODE_IDS.every((nodeId) => nodeIds.has(nodeId));
    const hasRockBranch = ROCK_MATERIAL_BRANCH_NODE_IDS.every((nodeId) => nodeIds.has(nodeId));
    if (!hasOreBranch && !hasRockBranch) {
      errors.push(excavationWarning(
        "incomplete_material_per_truck_branch",
        "Excavation productivity must decompose material_per_truck into either the ore tonnes branch or the rock solid-volume branch.",
        "material_per_truck"
      ));
    }
    if (nodeIds.has("tonnes_per_truck") || (!hasOreBranch && !hasRockBranch)) {
      requireNodeSet(nodeIds, ORE_MATERIAL_BRANCH_NODE_IDS, "ore_material_branch", errors);
      requireChildren("material_per_truck", ["tonnes_per_truck"], childrenByParent, errors);
      requireChildren("tonnes_per_truck", ["buckets_per_truck", "tonnes_per_bucket"], childrenByParent, errors);
      requireChildren("tonnes_per_bucket", ["average_bucket_volume_m3", "ore_density_in_solid_t_per_m3", "swell_factor", "actual_bucket_fill_factor", "bucket_cycle_time_sec"], childrenByParent, errors);
      requireFormula(project, "material_per_truck", "tonnes_per_truck", errors);
      requireFormula(project, "tonnes_per_truck", "buckets_per_truck * tonnes_per_bucket", errors);
      requireFormula(project, "tonnes_per_bucket", "average_bucket_volume_m3 / swell_factor * actual_bucket_fill_factor * ore_density_in_solid_t_per_m3", errors);
    }
    if (nodeIds.has("rock_volume_per_truck_in_solid_m3")) {
      requireNodeSet(nodeIds, ROCK_MATERIAL_BRANCH_NODE_IDS, "rock_material_branch", errors);
      requireChildren("material_per_truck", ["rock_volume_per_truck_in_solid_m3"], childrenByParent, errors);
      requireChildren("rock_volume_per_truck_in_solid_m3", ["buckets_per_truck", "rock_volume_per_bucket_in_solid_m3"], childrenByParent, errors);
      requireChildren("rock_volume_per_bucket_in_solid_m3", ["average_bucket_volume_m3", "swell_factor", "actual_bucket_fill_factor", "bucket_cycle_time_sec"], childrenByParent, errors);
      requireFormula(project, "material_per_truck", "rock_volume_per_truck_in_solid_m3", errors);
      requireFormula(project, "rock_volume_per_truck_in_solid_m3", "buckets_per_truck * rock_volume_per_bucket_in_solid_m3", errors);
      requireFormula(project, "rock_volume_per_bucket_in_solid_m3", "average_bucket_volume_m3 / swell_factor * actual_bucket_fill_factor", errors);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

function hasCanonicalExcavationOutputSignal(project: VdtProject, nodeIds: Set<string>): boolean {
  const root = project.graph.nodes.find((node) => node.id === project.rootNodeId);
  const rootKey = normalizeKey(`${root?.id ?? ""} ${root?.name ?? ""}`);
  const rootFormula = normalizeFormula(root?.formula ?? "");
  return (
    rootKey.includes("excavation") ||
    nodeIds.has("active_excavator_count") ||
    nodeIds.has("net_excavation_time_per_excavator_h") ||
    nodeIds.has("hydraulic_shovel_excavation_output") ||
    rootFormula === normalizeFormula("active_excavator_count * net_excavation_time_per_excavator_h * excavator_productivity")
  );
}

function hasProductivitySignal(nodeIds: Set<string>): boolean {
  return [
    "excavator_productivity",
    "loaded_trucks_per_hour",
    "truck_loading_time_min",
    "material_per_truck",
    "tonnes_per_truck",
    "rock_volume_per_truck_in_solid_m3"
  ].some((nodeId) => nodeIds.has(nodeId));
}

function requireNodeSet(nodeIds: Set<string>, requiredNodeIds: string[], scope: string, errors: VdtWarning[]): void {
  for (const nodeId of requiredNodeIds) {
    if (!nodeIds.has(nodeId)) {
      errors.push(excavationWarning(`missing_${scope}_${nodeId}`, `Required excavation skill node is missing: ${nodeId}.`, nodeId));
    }
  }
}

function requireChildren(
  parentNodeId: string,
  requiredChildIds: string[],
  childrenByParent: Map<string, string[]>,
  errors: VdtWarning[]
): void {
  const children = new Set(childrenByParent.get(parentNodeId) ?? []);
  for (const childId of requiredChildIds) {
    if (!children.has(childId)) {
      errors.push(excavationWarning(`missing_child_${parentNodeId}_${childId}`, `${parentNodeId} must decompose into ${childId}.`, parentNodeId));
    }
  }
}

function requireFormula(project: VdtProject, nodeId: string, expectedFormula: string, errors: VdtWarning[]): void {
  const node = project.graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return;
  if (normalizeFormula(node.formula ?? "") !== normalizeFormula(expectedFormula)) {
    errors.push(excavationWarning(
      `formula_${nodeId}`,
      `${nodeId} must use the excavation skill formula: ${expectedFormula}.`,
      nodeId
    ));
  }
}

function excavationWarning(id: string, message: string, nodeId?: string | undefined): VdtWarning {
  return warning({
    id: `excavation_${id}`,
    severity: id.startsWith("fleet_") || id.startsWith("unknown_") || id.startsWith("mixed_units") ? "warning" : "error",
    type: "invalid_graph",
    message,
    nodeId
  });
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeFormula(value: string): string {
  return normalizeKey(value);
}

const GLOBAL_FORBIDDEN_NODES = [
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
];

const READINESS_DOWNTIME_NODE_IDS = [
  "material_or_face_not_ready_time_h",
  "drill_blast_waiting_or_restricted_access_time_h",
  "operating_area_access_restriction_time_h",
  "geotechnical_or_safety_restriction_time_h"
];

const READINESS_ACCESS_TERMS = ["materialready", "facenotready", "access", "drillblast", "geotechnical", "safety"];

const CANONICAL_OUTPUT_NODE_IDS = [
  "active_excavator_count",
  "net_excavation_time_per_excavator_h",
  "calendar_time_per_excavator_h",
  "period_days",
  "hours_per_day_24",
  "downtime_per_excavator_h",
  "excavator_productivity"
];

const PRODUCTIVITY_NODE_IDS = [
  "loaded_trucks_per_hour",
  "minutes_per_hour_60",
  "truck_loading_time_min",
  "material_per_truck"
];

const TRUCK_LOADING_TIME_COMPONENT_NODE_IDS = [
  "loading_movement_unloading_time_min",
  "face_breakdown_ripping_time_min",
  "truck_departure_arrival_time_min",
  "relocation_time_min"
];

const ORE_MATERIAL_BRANCH_NODE_IDS = [
  "tonnes_per_truck",
  "buckets_per_truck",
  "tonnes_per_bucket",
  "average_bucket_volume_m3",
  "ore_density_in_solid_t_per_m3",
  "swell_factor",
  "actual_bucket_fill_factor",
  "bucket_cycle_time_sec"
];

const ROCK_MATERIAL_BRANCH_NODE_IDS = [
  "rock_volume_per_truck_in_solid_m3",
  "buckets_per_truck",
  "rock_volume_per_bucket_in_solid_m3",
  "average_bucket_volume_m3",
  "swell_factor",
  "actual_bucket_fill_factor",
  "bucket_cycle_time_sec"
];
