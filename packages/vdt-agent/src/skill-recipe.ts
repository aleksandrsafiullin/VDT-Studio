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

export interface VdtSkillRecipe {
  skillId: string;
  requiredInputs: string[];
  questions: VdtAgentQuestion[];
  initialDrivers: DriverTemplate[];
  formulaTemplates: FormulaTemplate[];
  deepenRules: DeepenRule[];
  warnings: string[];
}

type RecipeTemplate = Omit<VdtSkillRecipe, "questions"> & {
  questionIds?: string[] | undefined;
};

const RECIPE_TEMPLATES: Record<string, RecipeTemplate> = {
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
      { targetNodeId: "average_productivity", formula: "bottleneck_rate * utilization_factor * yield_factor" }
    ],
    deepenRules: [
      {
        nodeId: "effective_working_time",
        suggestedDrivers: ["calendar_time", "planned_downtime", "unplanned_downtime"],
        guidance: "Deepen time with shift calendar, planned maintenance, breakdowns, weather, and workforce availability."
      },
      {
        nodeId: "average_productivity",
        useSkillId: "mining.haulage.truck_cycle",
        suggestedDrivers: ["bottleneck_rate", "utilization_factor", "yield_factor"],
        guidance: "Deepen productivity with the named bottleneck such as haulage, loading, crushing, or dumping."
      }
    ],
    warnings: ["Do not double count downtime inside both availability and utilization."]
  },
  "mining.haulage.truck_cycle": {
    skillId: "mining.haulage.truck_cycle",
    requiredInputs: ["number_of_trucks", "payload_per_trip_t", "cycle_time_h", "operating_hours", "truck_availability"],
    initialDrivers: [
      { id: "number_of_trucks", name: "Number of trucks", type: "input", relation: "multiplicative_driver" },
      { id: "trips_per_truck", name: "Trips per truck", type: "calculated", relation: "multiplicative_driver" },
      { id: "payload_per_trip_t", name: "Payload per trip", type: "input", unit: "tonnes", relation: "multiplicative_driver" },
      { id: "payload_factor", name: "Payload factor", type: "assumption", relation: "multiplicative_driver" }
    ],
    formulaTemplates: [
      { targetNodeId: "hauled_tonnes", formula: "number_of_trucks * trips_per_truck * payload_per_trip_t * payload_factor" },
      { targetNodeId: "trips_per_truck", formula: "available_truck_hours * utilization / cycle_time_h" },
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
      { id: "capacity", name: "Capacity", type: "input", relation: "multiplicative_driver" },
      { id: "utilization", name: "Utilization", type: "assumption", relation: "multiplicative_driver" },
      { id: "quality_factor", name: "Quality factor", type: "assumption", relation: "multiplicative_driver" }
    ],
    formulaTemplates: [
      { targetNodeId: "root", formula: "capacity * utilization * quality_factor" },
      { targetNodeId: "available_output", formula: "capacity * utilization * quality_factor" },
      { targetNodeId: "net_flow", formula: "inflow - outflow" }
    ],
    deepenRules: [
      {
        nodeId: "capacity",
        suggestedDrivers: ["base_population", "frequency", "throughput"],
        guidance: "Deepen capacity or volume drivers with count, frequency, throughput, or population logic."
      }
    ],
    warnings: ["Do not add ratios as if they were amounts."]
  }
};

export function compileSkillRecipe(skill: VdtSkill | SkillExcerpt): VdtSkillRecipe {
  const template = RECIPE_TEMPLATES[skill.id] ?? RECIPE_TEMPLATES["generic.logical_kpi_decomposition"]!;
  const questions = buildCriticalQuestions({ rootKpi: skill.title, industry: skill.domain }, [{ id: skill.id }]);
  return {
    skillId: template.skillId,
    requiredInputs: [...template.requiredInputs],
    questions,
    initialDrivers: template.initialDrivers.map((driver) => ({ ...driver })),
    formulaTemplates: [
      ...template.formulaTemplates.map((formula) => ({ ...formula })),
      ...extractFormulaTemplates("raw" in skill ? skill.body : skill.excerpt).map((formula) => ({
        targetNodeId: formula.split("=")[0]?.trim() || "root",
        formula: formula.includes("=") ? formula.split("=").slice(1).join("=").trim() : formula
      }))
    ].filter(uniqueFormulaTemplate),
    deepenRules: template.deepenRules.map((rule) => ({ ...rule, suggestedDrivers: [...rule.suggestedDrivers] })),
    warnings: [...template.warnings]
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

function uniqueFormulaTemplate(template: FormulaTemplate, index: number, all: FormulaTemplate[]): boolean {
  return all.findIndex((candidate) => candidate.targetNodeId === template.targetNodeId && candidate.formula === template.formula) === index;
}
