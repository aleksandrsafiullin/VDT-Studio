import type { VdtEdgeRelation, VdtNodeType } from "@vdt-studio/vdt-core";
import type { SkillExcerpt, VdtSkill } from "./index";
import { buildCriticalQuestions, type VdtAgentQuestion } from "./skill-questions";

export interface DriverTemplate {
  id: string;
  name: string;
  type?: VdtNodeType | undefined;
  unit?: string | undefined;
  relation?: VdtEdgeRelation | undefined;
  formula?: string | undefined;
  description?: string | undefined;
  assumptions?: string[] | undefined;
}

export interface FormulaTemplate {
  targetNodeId: string;
  formula: string;
  description?: string | undefined;
}

export interface DeepenRule {
  nodeId: string;
  useSkillId?: string | undefined;
  suggestedDrivers: string[];
  guidance: string;
}

export type VdtSkillRecipeQuality = "complete" | "partial" | "missing";
export type VdtSkillRecipeSource = "template" | "markdown_extracted" | "generic_fallback";

export interface VdtSkillRecipe {
  skillId: string;
  recipeQuality: VdtSkillRecipeQuality;
  recipeSource: VdtSkillRecipeSource;
  requiredInputs: string[];
  questions: VdtAgentQuestion[];
  initialDrivers: DriverTemplate[];
  formulaTemplates: FormulaTemplate[];
  deepenRules: DeepenRule[];
  warnings: string[];
}

type RecipeTemplate = Omit<VdtSkillRecipe, "questions" | "recipeQuality" | "recipeSource"> & {
  questionIds?: string[] | undefined;
};

const RECIPE_TEMPLATES: Record<string, RecipeTemplate> = {
  "mining.excavation": {
    skillId: "mining.excavation",
    requiredInputs: [
      "target_kpi_and_unit",
      "equipment_scope_and_active_count",
      "period_days",
      "downtime_basis_and_categories",
      "productivity_material_mode",
      "bucket_truck_loading_inputs"
    ],
    initialDrivers: [
      {
        id: "active_excavator_count",
        name: "Active excavator count",
        type: "input",
        unit: "excavators",
        relation: "multiplicative_driver",
        assumptions: ["Collect through dialog; leave unknown until provided."]
      },
      {
        id: "net_excavation_time_per_excavator_h",
        name: "Net excavation time per excavator",
        type: "calculated",
        unit: "h",
        relation: "multiplicative_driver"
      },
      {
        id: "excavator_productivity",
        name: "Excavator productivity",
        type: "calculated",
        relation: "multiplicative_driver"
      }
    ],
    formulaTemplates: [
      { targetNodeId: "root", formula: "active_excavator_count * net_excavation_time_per_excavator_h * excavator_productivity" },
      { targetNodeId: "calendar_time_per_excavator_h", formula: "period_days * hours_per_day_24" },
      { targetNodeId: "net_excavation_time_per_excavator_h", formula: "calendar_time_per_excavator_h - downtime_per_excavator_h" },
      { targetNodeId: "loaded_trucks_per_hour", formula: "minutes_per_hour_60 / truck_loading_time_min" },
      { targetNodeId: "truck_loading_time_min", formula: "loading_movement_unloading_time_min + face_breakdown_ripping_time_min + truck_departure_arrival_time_min + relocation_time_min" },
      { targetNodeId: "ore_excavator_productivity_tph", formula: "loaded_trucks_per_hour * tonnes_per_truck" },
      { targetNodeId: "rock_excavator_productivity_m3ph", formula: "loaded_trucks_per_hour * rock_volume_per_truck_in_solid_m3" }
    ],
    deepenRules: [
      {
        nodeId: "net_excavation_time_per_excavator_h",
        suggestedDrivers: ["calendar_time_per_excavator_h", "downtime_per_excavator_h"],
        guidance: "Model material readiness, drill/blast waits, access, geotechnical, and safety restrictions as downtime categories only."
      },
      {
        nodeId: "excavator_productivity",
        suggestedDrivers: ["loaded_trucks_per_hour", "material_per_truck"],
        guidance: "Keep the branch excavation-only; trucks are a loading container, not a haulage cycle tree."
      }
    ],
    warnings: [
      "Build topology with unknown numeric leaves before suggesting defaults.",
      "Accepted catalog values must be marked default_assumption.",
      "Do not model readiness or access limits as caps, min branches, or multipliers."
    ]
  },
  "mining.production_volume": {
    skillId: "mining.production_volume",
    requiredInputs: ["unit", "timePeriod", "bottleneck"],
    initialDrivers: [
      { id: "effective_working_time", name: "Effective working time", type: "calculated", unit: "hours", relation: "multiplicative_driver" },
      { id: "average_productivity", name: "Average productivity", type: "calculated", unit: "tonnes/hour", relation: "multiplicative_driver" }
    ],
    formulaTemplates: [
      { targetNodeId: "root", formula: "effective_working_time * average_productivity" },
      { targetNodeId: "effective_working_time", formula: "calendar_time - planned_downtime - unplanned_downtime" },
      { targetNodeId: "average_productivity", formula: "bottleneck_rate * yield_factor" }
    ],
    deepenRules: [
      {
        nodeId: "effective_working_time",
        suggestedDrivers: ["calendar_time", "planned_downtime", "unplanned_downtime"],
        guidance: "Deepen time with shift calendar, planned maintenance, breakdowns, weather, and workforce availability."
      },
      {
        nodeId: "average_productivity",
        useSkillId: "mining.haulage_truck_cycle",
        suggestedDrivers: ["bottleneck_rate", "yield_factor"],
        guidance: "Deepen productivity with the named bottleneck such as haulage, loading, crushing, or dumping."
      }
    ],
    warnings: ["Do not double count downtime inside both working time and productivity."]
  },
  "mining.haulage_truck_cycle": {
    skillId: "mining.haulage_truck_cycle",
    requiredInputs: ["number_of_trucks", "payload_per_trip_t", "cycle_time_h", "truck_working_time"],
    initialDrivers: [
      { id: "number_of_trucks", name: "Number of trucks", type: "input", relation: "multiplicative_driver" },
      { id: "trips_per_truck", name: "Trips per truck", type: "calculated", relation: "multiplicative_driver" },
      { id: "payload_per_trip_t", name: "Payload per trip", type: "input", unit: "tonnes", relation: "multiplicative_driver" },
      { id: "truck_working_time", name: "Truck working time", type: "calculated", unit: "hours", relation: "multiplicative_driver" },
      { id: "payload_factor", name: "Payload factor", type: "assumption", relation: "multiplicative_driver" }
    ],
    formulaTemplates: [
      { targetNodeId: "hauled_tonnes", formula: "number_of_trucks * trips_per_truck * payload_per_trip_t * payload_factor" },
      { targetNodeId: "trips_per_truck", formula: "truck_working_time / cycle_time_h" },
      { targetNodeId: "cycle_time_h", formula: "loading_time_h + loaded_travel_time_h + dumping_time_h + empty_return_time_h + queue_time_h" }
    ],
    deepenRules: [
      {
        nodeId: "cycle_time_h",
        suggestedDrivers: ["loading_time_h", "loaded_travel_time_h", "dumping_time_h", "empty_return_time_h", "queue_time_h"],
        guidance: "Deepen cycle time into loading, travel, dumping, return, and queueing components."
      }
    ],
    warnings: ["Do not count standby trucks in active fleet unless they are available to operate."]
  },
  "mining.block_preparation_dozer": {
    skillId: "mining.block_preparation_dozer",
    requiredInputs: ["mine_type", "dozer_count", "dozer_effective_hours", "dozer_productivity_rate", "block_area_or_volume", "material_type", "allocation_policy"],
    initialDrivers: [
      { id: "dozer_effective_hours", name: "Dozer effective hours", type: "calculated", unit: "hours", relation: "multiplicative_driver" },
      { id: "dozer_productivity_rate", name: "Dozer productivity rate", type: "input", relation: "multiplicative_driver" },
      { id: "floor_acceptance_factor", name: "Floor acceptance factor", type: "assumption", relation: "multiplicative_driver" },
      { id: "material_allocation_policy", name: "Material allocation policy", type: "assumption", relation: "formula_dependency" }
    ],
    formulaTemplates: [
      { targetNodeId: "root", formula: "dozer_effective_hours * dozer_productivity_rate * floor_acceptance_factor" },
      { targetNodeId: "dozer_effective_hours", formula: "dozer_count * scheduled_hours - dozer_downtime_hours" }
    ],
    deepenRules: [
      {
        nodeId: "dozer_effective_hours",
        suggestedDrivers: ["dozer_count", "scheduled_hours", "dozer_downtime_hours"],
        guidance: "Deepen dozer time into fleet count, scheduled hours, maintenance, weather, access, and standby delay categories."
      },
      {
        nodeId: "floor_acceptance_factor",
        suggestedDrivers: ["survey_release", "grade_control_release", "geotechnical_release", "drainage_release"],
        guidance: "Separate physical preparation capacity from release/acceptance readiness."
      }
    ],
    warnings: ["Do not treat prepared area, prepared volume, and released tonnes as interchangeable without density or geometry assumptions."]
  },
  "mining.drill_and_blast": {
    skillId: "mining.drill_and_blast",
    requiredInputs: ["mine_type", "drill_count", "drill_effective_hours", "penetration_rate_mph", "blast_pattern", "explosive_consumption", "material_type", "allocation_policy"],
    initialDrivers: [
      { id: "drilled_meters", name: "Drilled meters", type: "calculated", unit: "m", relation: "multiplicative_driver" },
      { id: "tonnes_per_drilled_meter", name: "Tonnes per drilled meter", type: "input", unit: "t/m", relation: "multiplicative_driver" },
      { id: "blast_quality_factor", name: "Blast quality factor", type: "assumption", relation: "multiplicative_driver" },
      { id: "material_allocation_policy", name: "Material allocation policy", type: "assumption", relation: "formula_dependency" }
    ],
    formulaTemplates: [
      { targetNodeId: "root", formula: "drilled_meters * tonnes_per_drilled_meter * blast_quality_factor" },
      { targetNodeId: "drilled_meters", formula: "drill_count * drill_effective_hours * penetration_rate_mph" },
      { targetNodeId: "explosives_kg", formula: "blasted_tonnes * powder_factor_kg_per_t" }
    ],
    deepenRules: [
      {
        nodeId: "drilled_meters",
        suggestedDrivers: ["drill_count", "drill_effective_hours", "penetration_rate_mph"],
        guidance: "Deepen drilling into available rigs, effective drilling hours, penetration rate, redrill, and drilling delays."
      },
      {
        nodeId: "blast_quality_factor",
        suggestedDrivers: ["fragmentation_factor", "misfire_loss", "dilution_factor", "ore_loss_factor"],
        guidance: "Use quality factors only when they represent explicit blast outcomes such as fragmentation, dilution, ore loss, or rework."
      }
    ],
    warnings: ["Do not mix drill meters, blasted tonnes, explosives kg, and advance meters without an explicit conversion boundary."]
  },
  "mining.material_allocation_ore_waste": {
    skillId: "mining.material_allocation_ore_waste",
    requiredInputs: ["material_types", "equipment_classes", "allocation_policy", "equipment_effective_hours", "material_productivity_rates"],
    initialDrivers: [
      { id: "ore_capacity_tonnes", name: "Ore capacity tonnes", type: "calculated", unit: "tonnes", relation: "positive_driver" },
      { id: "waste_capacity_tonnes", name: "Waste capacity tonnes", type: "calculated", unit: "tonnes", relation: "positive_driver" },
      { id: "allocation_policy", name: "Allocation policy", type: "assumption", relation: "formula_dependency" },
      { id: "ore_time_share", name: "Ore time share", type: "assumption", relation: "formula_dependency" },
      { id: "waste_time_share", name: "Waste time share", type: "assumption", relation: "formula_dependency" }
    ],
    formulaTemplates: [
      { targetNodeId: "total_material_moved", formula: "ore_capacity_tonnes + waste_capacity_tonnes" },
      { targetNodeId: "ore_capacity_tonnes", formula: "equipment_effective_hours * ore_time_share * ore_productivity_rate" },
      { targetNodeId: "waste_capacity_tonnes", formula: "equipment_effective_hours * waste_time_share * waste_productivity_rate" },
      { targetNodeId: "strip_ratio_t_per_t", formula: "waste_capacity_tonnes / ore_capacity_tonnes" }
    ],
    deepenRules: [
      {
        nodeId: "allocation_policy",
        suggestedDrivers: ["hard_allocation", "time_share_allocation", "dynamic_dispatch_allocation"],
        guidance: "Ask which allocation policy applies when ore and waste share equipment."
      }
    ],
    warnings: ["Do not sum ore and waste into a product KPI unless the root KPI is total material moved."]
  },
  "mining.mine_production_system": {
    skillId: "mining.mine_production_system",
    requiredInputs: ["mine_type", "production_boundary", "time_period", "material_types", "stage_capacities", "allocation_policy"],
    initialDrivers: [
      { id: "production_boundary", name: "Production boundary", type: "assumption", relation: "formula_dependency" },
      { id: "mine_type", name: "Mine type", type: "assumption", relation: "formula_dependency" },
      { id: "material_scope", name: "Material scope", type: "assumption", relation: "formula_dependency" },
      { id: "stage_readiness_tonnes", name: "Stage readiness tonnes", type: "calculated", unit: "tonnes", relation: "multiplicative_driver" },
      { id: "material_allocation_policy", name: "Material allocation policy", type: "assumption", relation: "formula_dependency" },
      { id: "downstream_capacity_tonnes", name: "Downstream capacity tonnes", type: "calculated", unit: "tonnes", relation: "multiplicative_driver" },
      { id: "yield_factor", name: "Yield factor", type: "assumption", relation: "multiplicative_driver" }
    ],
    formulaTemplates: [],
    deepenRules: [
      {
        nodeId: "stage_readiness_tonnes",
        suggestedDrivers: ["block_preparation", "drill_and_blast", "excavation_loading", "haulage", "dump_or_crusher"],
        guidance: "For open-pit systems, deepen stage readiness through preparation, drill/blast, excavation/loading, haulage, and dump/crusher readiness. Treat sequential stages as bottlenecks, not additive contributors."
      },
      {
        nodeId: "material_allocation_policy",
        useSkillId: "mining.material_allocation_ore_waste",
        suggestedDrivers: ["hard_allocation", "time_share_allocation", "dynamic_dispatch_allocation"],
        guidance: "Clarify ore/waste material allocation before mixing material streams."
      }
    ],
    warnings: [
      "Formula engine does not auto-apply min(stage_readiness_tonnes, downstream_capacity_tonnes); ask the user or model an explicit bottleneck/assumption before final formula setup.",
      "Do not add sequential production stages together unless a stockpile or buffer boundary is explicit."
    ]
  },
  "mining.underground_production_cycle": {
    skillId: "mining.underground_production_cycle",
    requiredInputs: ["mining_method", "face_or_stope_availability", "drill_charge_blast_cycle_time", "ventilation_reentry_time", "mucking_loading_capacity", "haulage_or_hoisting_capacity", "ground_support_or_backfill_constraint"],
    initialDrivers: [
      { id: "development_readiness", name: "Development readiness", type: "calculated", relation: "multiplicative_driver" },
      { id: "stope_production_tonnes", name: "Stope production tonnes", type: "calculated", unit: "tonnes", relation: "multiplicative_driver" },
      { id: "mucking_loading_capacity_tonnes", name: "Mucking/loading capacity tonnes", type: "calculated", unit: "tonnes", relation: "multiplicative_driver" },
      { id: "underground_haulage_or_hoisting_capacity_tonnes", name: "Underground haulage or hoisting capacity tonnes", type: "calculated", unit: "tonnes", relation: "multiplicative_driver" },
      { id: "ground_support_or_backfill_constraint", name: "Ground support or backfill constraint", type: "assumption", relation: "multiplicative_driver" }
    ],
    formulaTemplates: [
      { targetNodeId: "stope_production_tonnes", formula: "completed_rounds * tonnes_per_round" },
      { targetNodeId: "completed_rounds", formula: "available_cycle_time / drill_charge_blast_muck_cycle_time" }
    ],
    deepenRules: [
      {
        nodeId: "development_readiness",
        suggestedDrivers: ["face_availability", "drill_charge_blast_cycle_time", "ventilation_reentry_time", "ground_support_time"],
        guidance: "Model underground readiness with development cycle, ventilation re-entry, support, services, and access constraints."
      },
      {
        nodeId: "underground_haulage_or_hoisting_capacity_tonnes",
        suggestedDrivers: ["lhd_capacity", "truck_haulage_capacity", "orepass_capacity", "hoisting_capacity"],
        guidance: "Keep underground haulage/hoisting distinct from open-pit truck route assumptions unless the user specifies a mixed operation."
      }
    ],
    warnings: ["Do not force underground stoping or development into an open-pit block-drill-blast-load-haul chain."]
  },
  "finance.revenue_profit": {
    skillId: "finance.revenue_profit",
    requiredInputs: ["unit", "timePeriod", "profitScope"],
    initialDrivers: [
      { id: "revenue", name: "Revenue", type: "calculated", relation: "positive_driver" },
      { id: "variable_costs", name: "Variable costs", type: "input", relation: "negative_driver" },
      { id: "operating_expenses", name: "Operating expenses", type: "input", relation: "negative_driver" }
    ],
    formulaTemplates: [
      { targetNodeId: "revenue", formula: "units_sold * average_selling_price * (1 - discount_rate) - refunds" },
      { targetNodeId: "gross_profit", formula: "revenue - variable_costs - cost_of_goods_sold" },
      { targetNodeId: "operating_profit", formula: "gross_profit - operating_expenses" }
    ],
    deepenRules: [
      {
        nodeId: "revenue",
        suggestedDrivers: ["units_sold", "average_selling_price", "discount_rate", "refunds"],
        guidance: "Deepen revenue by customer, price, discount, product mix, and returns."
      }
    ],
    warnings: ["Do not subtract variable costs twice if COGS already includes them."]
  },
  "saas.funnel_growth": {
    skillId: "saas.funnel_growth",
    requiredInputs: ["unit", "timePeriod", "recurringRevenueMetric"],
    initialDrivers: [
      { id: "new_mrr", name: "New MRR", type: "calculated", relation: "positive_driver" },
      { id: "expansion_mrr", name: "Expansion MRR", type: "input", relation: "positive_driver" },
      { id: "contraction_mrr", name: "Contraction MRR", type: "input", relation: "negative_driver" },
      { id: "churned_mrr", name: "Churned MRR", type: "input", relation: "negative_driver" }
    ],
    formulaTemplates: [
      { targetNodeId: "mrr", formula: "active_customers * arpa" },
      { targetNodeId: "new_customers", formula: "visitors * signup_rate * activation_rate * paid_conversion_rate" },
      { targetNodeId: "new_mrr", formula: "new_customers * new_customer_arpa" },
      { targetNodeId: "net_new_mrr", formula: "new_mrr + expansion_mrr - contraction_mrr - churned_mrr" }
    ],
    deepenRules: [
      {
        nodeId: "new_mrr",
        suggestedDrivers: ["new_customers", "new_customer_arpa"],
        guidance: "Deepen new MRR through acquisition, activation, conversion, and ARPA."
      }
    ],
    warnings: ["Do not mix customer churn and revenue churn without labeling the unit."]
  },
  "generic.logical_kpi_decomposition": {
    skillId: "generic.logical_kpi_decomposition",
    requiredInputs: ["unit", "timePeriod", "driverLogic"],
    initialDrivers: [
      { id: "throughput_rate", name: "Throughput rate", type: "input", relation: "multiplicative_driver" },
      { id: "working_time", name: "Working time", type: "calculated", relation: "multiplicative_driver" },
      { id: "quality_factor", name: "Quality factor", type: "assumption", relation: "multiplicative_driver" }
    ],
    formulaTemplates: [
      { targetNodeId: "root", formula: "throughput_rate * working_time * quality_factor" },
      { targetNodeId: "available_output", formula: "throughput_rate * working_time * quality_factor" },
      { targetNodeId: "net_flow", formula: "inflow - outflow" }
    ],
    deepenRules: [
      {
        nodeId: "working_time",
        suggestedDrivers: ["scheduled_time", "planned_downtime", "unplanned_downtime", "operational_delay_time"],
        guidance: "Deepen working time into scheduled time and explicit downtime or delay categories."
      }
    ],
    warnings: ["Do not add ratios as if they were amounts."]
  }
};

export function compileSkillRecipe(skill: VdtSkill | SkillExcerpt): VdtSkillRecipe {
  const template = RECIPE_TEMPLATES[skill.id];
  const questions = buildCriticalQuestions({ rootKpi: skill.title, industry: skill.domain }, [{ id: skill.id }]);
  const markdown = "raw" in skill ? skill.body : skill.excerpt;
  if (!template) {
    return compileRecipeFromMarkdown(skill, markdown, questions);
  }
  return {
    skillId: skill.id,
    recipeQuality: "complete",
    recipeSource: "template",
    requiredInputs: [...template.requiredInputs],
    questions,
    initialDrivers: template.initialDrivers.map((driver) => ({ ...driver })),
    formulaTemplates: [
      ...template.formulaTemplates.map((formula) => ({ ...formula })),
      ...markdownFormulaTemplatesForSkill(skill.id, markdown)
    ].filter(uniqueFormulaTemplate),
    deepenRules: template.deepenRules.map((rule) => ({ ...rule, suggestedDrivers: [...rule.suggestedDrivers] })),
    warnings: [...template.warnings]
  };
}

function compileRecipeFromMarkdown(
  skill: VdtSkill | SkillExcerpt,
  markdown: string,
  questions: VdtAgentQuestion[]
): VdtSkillRecipe {
  const extractedDrivers = extractDriverTemplates(markdown);
  const extractedFormulas = markdownFormulaTemplatesForSkill(skill.id, markdown);
  if (extractedDrivers.length > 0 || extractedFormulas.length > 0) {
    return {
      skillId: skill.id,
      recipeQuality: "partial",
      recipeSource: "markdown_extracted",
      requiredInputs: inferRequiredInputs(skill),
      questions,
      initialDrivers: extractedDrivers.length > 0 ? extractedDrivers : supportGenericDrivers(),
      formulaTemplates: extractedFormulas.filter(uniqueFormulaTemplate),
      deepenRules: extractedDrivers.map((driver) => ({
        nodeId: driver.id,
        suggestedDrivers: [],
        guidance: "Extracted from markdown decomposition guidance; read the full skill before building deeper structure."
      })),
      warnings: ["Executable recipe template is not available; recipe was partially extracted from markdown guidance."]
    };
  }

  const generic = RECIPE_TEMPLATES["generic.logical_kpi_decomposition"]!;
  return {
    skillId: skill.id,
    recipeQuality: "missing",
    recipeSource: "generic_fallback",
    requiredInputs: inferRequiredInputs(skill),
    questions,
    initialDrivers: generic.initialDrivers.map((driver) => ({ ...driver })),
    formulaTemplates: [],
    deepenRules: [],
    warnings: [
      "Executable recipe missing. Generic driver skeleton is support only and must not be treated as a complete domain recipe.",
      "Read markdown guidance, use research/discovery, or ask the user before building."
    ]
  };
}

export function compileSkillRecipes(skills: Array<VdtSkill | SkillExcerpt>): VdtSkillRecipe[] {
  return skills.map((skill) => compileSkillRecipe(skill));
}

export function initialDriversFromRecipes(recipes: VdtSkillRecipe[], maxDrivers = 8): DriverTemplate[] {
  const byId = new Map<string, DriverTemplate>();
  for (const recipe of recipes) {
    for (const driver of recipe.initialDrivers) {
      if (!byId.has(driver.id)) {
        byId.set(driver.id, { ...driver });
      }
    }
  }
  return [...byId.values()].slice(0, maxDrivers);
}

function inferRequiredInputs(skill: VdtSkill | SkillExcerpt): string[] {
  if ("frontmatter" in skill) return [...skill.frontmatter.requires];
  return ["root_kpi_definition", "unit", "time_period", "driver_logic"];
}

function supportGenericDrivers(): DriverTemplate[] {
  const generic = RECIPE_TEMPLATES["generic.logical_kpi_decomposition"]!;
  return generic.initialDrivers.map((driver) => ({ ...driver }));
}

function extractDriverTemplates(text: string): DriverTemplate[] {
  const drivers = new Map<string, DriverTemplate>();
  const matches = text.matchAll(/```(?:text)?\n([\s\S]*?)```/g);
  for (const match of matches) {
    const lines = (match[1] ?? "").split("\n");
    for (const line of lines.slice(1)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.includes("=") || /^[-*]/.test(trimmed)) continue;
      if (!/^[a-zA-Z][a-zA-Z0-9_\s/()-]+$/.test(trimmed)) continue;
      const id = stableRecipeId(trimmed);
      if (!drivers.has(id)) {
        drivers.set(id, {
          id,
          name: titleFromId(trimmed),
          type: "calculated",
          relation: "positive_driver"
        });
      }
    }
  }
  return [...drivers.values()].slice(0, 8);
}

function extractFormulaTemplates(text: string): string[] {
  const formulas: string[] = [];
  const matches = text.matchAll(/```(?:text)?\n([\s\S]*?)```/g);
  for (const match of matches) {
    const body = match[1] ?? "";
    for (const line of body.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.includes("=")) formulas.push(trimmed);
    }
  }
  return formulas;
}

function markdownFormulaTemplatesForSkill(skillId: string, markdown: string): FormulaTemplate[] {
  if (skillId === "mining.mine_production_system") return [];
  return extractFormulaTemplates(markdown)
    .map((formula) => ({
      targetNodeId: formula.split("=")[0]?.trim() || "root",
      formula: formula.includes("=") ? formula.split("=").slice(1).join("=").trim() : formula
    }))
    .filter(isExecutableFormulaTemplate);
}

function isExecutableFormulaTemplate(template: FormulaTemplate): boolean {
  if (/[+\-*/(),\s]/.test(template.targetNodeId)) return false;
  if (/\b(min|max|sum)\s*\(/i.test(template.formula)) return false;
  return /^[a-zA-Z0-9_+\-*/().\s]+$/.test(template.formula);
}

function stableRecipeId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "driver";
}

function titleFromId(value: string): string {
  return value
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function uniqueFormulaTemplate(template: FormulaTemplate, index: number, all: FormulaTemplate[]): boolean {
  return all.findIndex((candidate) => candidate.targetNodeId === template.targetNodeId && candidate.formula === template.formula) === index;
}
