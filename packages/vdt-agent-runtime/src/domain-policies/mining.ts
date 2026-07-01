import type { VdtAgentRunState } from "../types";

export interface AgentDomainPolicySummary {
  id: string;
  summary: string;
  validatorIds?: string[] | undefined;
}

export function miningPolicySummaryForRun(state: VdtAgentRunState): AgentDomainPolicySummary[] {
  const selectedSkillIds = new Set(state.selectedSkills.map((skill) => skill.id));
  const policies: AgentDomainPolicySummary[] = [];
  if ([...selectedSkillIds].some((skillId) => skillId.startsWith("mining."))) {
    policies.push({
      id: "mining.time.working_time",
      summary: "Mining time branches should use Working time and explicit downtime/delay categories instead of an unlabeled utilization factor.",
      validatorIds: ["mining.time.working_time"]
    });
  }
  if (selectedSkillIds.has("mining.excavation")) {
    policies.push(
      {
        id: "mining.excavation.boundary",
        summary: "Excavation skill may use trucks only as loading containers for loaded_trucks_per_hour * material_per_truck; do not model haulage route cycle, dispatch, queueing, dumping or processing under excavation productivity.",
        validatorIds: ["mining.excavation.runtime_signature"]
      },
      {
        id: "mining.excavation.readiness_as_downtime",
        summary: "Material readiness, face access, safety and geotechnical restrictions belong under downtime/delay for excavation; do not model them as independent caps or hidden multipliers.",
        validatorIds: ["mining.excavation.readiness_downtime"]
      }
    );
  }
  if (selectedSkillIds.has("mining.mine_production_system")) {
    policies.push({
      id: "mining.production.sequential_bottleneck",
      summary: "Sequential mining stage capacities should represent bottlenecks or readiness gates, not additive independent contributors, unless the model explicitly includes stockpile or buffer logic.",
      validatorIds: ["mining.production.sequential_bottleneck"]
    });
  }
  if (selectedSkillIds.has("mining.underground_production_cycle")) {
    policies.push({
      id: "mining.underground.boundary",
      summary: "Underground production models must preserve underground constraints such as ventilation re-entry, hoisting, ground support or backfill; do not force them into an open-pit-only stage chain.",
      validatorIds: ["mining.underground.boundary"]
    });
  }
  if (selectedSkillIds.has("mining.material_allocation_ore_waste")) {
    policies.push({
      id: "mining.material_allocation.product_scope",
      summary: "Do not sum ore tonnes and waste tonnes into a product KPI unless the root KPI is total material moved or another explicitly mixed material boundary.",
      validatorIds: ["mining.material_allocation.product_scope"]
    });
  }
  return policies;
}
