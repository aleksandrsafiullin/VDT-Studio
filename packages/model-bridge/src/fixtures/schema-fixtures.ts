import type { VdtOutputSchemaId } from "../schema-registry";

const advisory = {
  assumptions: ["Baseline month is representative."],
  questionsForUser: ["Confirm unit conventions?"],
  warnings: [{ severity: "info", message: "Sample warning." }]
};

export const VALID_SCHEMA_FIXTURES: Record<VdtOutputSchemaId, unknown> = {
  "orchestrator-first-response-v1": {
    assistantMessage: "I will use the visible brief as the source of truth and start by checking the requested VDT scope.",
    nextAction: "continue_building",
    questions: [],
    publicStatus: {
      phase: "planning_model",
      message: "Planning the VDT from your request."
    }
  },
  "agent-decision-v1": {
    type: "call_tool",
    toolName: "skill.search",
    args: {
      rootKpi: "Ore haulage",
      industry: "Mining",
      maxSkills: 3
    },
    statusMessage: "Searching for a truck haulage skill."
  },
  "agent-plan-v1": {
    buildIntent: {
      rootKpi: "Ore haulage",
      industry: "Mining",
      businessContext: "Open-pit truck haulage",
      unit: "tonnes/year",
      timePeriod: "year",
      goal: "Build a truck haulage VDT"
    },
    selectedSkillIds: ["mining.haulage_truck_cycle"],
    skillRationale: "The request describes truck count, haul distance, and loaded/empty travel speeds.",
    extractedInputs: [
      {
        id: "number_of_trucks",
        label: "Number of trucks",
        value: 5,
        unit: "trucks",
        sourceText: "I have 5 trucks"
      }
    ],
    missingInputs: [
      {
        id: "payload_per_trip_t",
        question: "What is the average payload per trip in tonnes?",
        reason: "Truck-cycle tonnes require payload per trip.",
        required: true
      }
    ],
    driverPlan: [
      {
        id: "number_of_trucks",
        parentNodeId: "root",
        name: "Number of trucks",
        type: "input",
        unit: "trucks",
        relation: "multiplicative_driver",
        formula: "",
        description: "Active haul trucks in the fleet.",
        value: 5,
        assumptions: []
      }
    ],
    rootFormula: "number_of_trucks * trips_per_truck * payload_per_trip_t",
    ...advisory,
    confidence: 0.88
  },
  "generate-tree-v1": {
    projectTitle: "Production Volume",
    rootNodeId: "production_volume",
    nodes: [{ id: "production_volume", name: "Production Volume", type: "root_kpi" }],
    edges: [],
    ...advisory
  },
  "deepen-node-v1": {
    targetNodeId: "unplanned_downtime",
    nodes: [{ id: "child_a", name: "Child A", type: "input" }],
    edges: [],
    ...advisory
  },
  "simplify-branch-v1": {
    branchRootNodeId: "average_productivity",
    nodeRemovals: [{ nodeId: "yield_factor" }],
    edgeChanges: [],
    rationale: "Simplify branch",
    ...advisory
  },
  "suggest-alternative-v1": {
    targetNodeId: "effective_working_time",
    nodes: [{ id: "alt_a", name: "Alt A", type: "input" }],
    edges: [],
    rationale: "Alternative decomposition",
    ...advisory
  },
  "suggest-formula-v1": {
    nodeId: "production_volume",
    proposedFormula: "effective_working_time * average_productivity",
    aiRationale: "Standard decomposition",
    confidence: 0.9,
    ...advisory
  },
  "review-model-v1": {
    findings: [{ severity: "warning", category: "unit_consistency", message: "Percent labels may be ratios." }],
    ...advisory
  },
  "check-units-v1": {
    unitFindings: [{ nodeId: "yield_factor", severity: "warning", message: "Unit mismatch." }],
    ...advisory
  },
  "identify-missing-drivers-v1": {
    missingDrivers: [
      {
        parentNodeId: "unplanned_downtime",
        suggestedName: "Maintenance backlog",
        suggestedType: "input",
        rationale: "Deferred maintenance may explain downtime."
      }
    ],
    ...advisory
  },
  "identify-duplicate-drivers-v1": {
    duplicateClusters: [
      {
        nodeIds: ["planned_downtime", "unplanned_downtime"],
        similarityReason: "Both reduce working time."
      }
    ],
    ...advisory
  },
  "explain-node-v1": {
    nodeId: "production_volume",
    explanation: "Production volume equals time times productivity.",
    keyDrivers: ["Effective Working Time"],
    assumptions: ["Saleable output only."],
    questionsForUser: ["Gross or net tonnes?"]
  },
  "explain-scenario-v1": {
    scenarioId: "scenario_reduce_downtime",
    narrative: "Lowering unplanned downtime lifts production volume.",
    impactHighlights: [{ nodeId: "unplanned_downtime", message: "Primary scenario lever." }],
    assumptions: ["Overrides apply uniformly."],
    questionsForUser: ["Is the scenario realistic?"]
  },
  "generate-executive-summary-v1": {
    headline: "Focus on downtime and productivity levers.",
    keyDrivers: ["Unplanned downtime", "Average productivity"],
    risks: ["Unit label ambiguity"],
    recommendations: ["Validate baseline inputs"]
  }
};

export const INVALID_SCHEMA_FIXTURES: Record<VdtOutputSchemaId, unknown> = {
  "orchestrator-first-response-v1": {
    assistantMessage: "",
    nextAction: "replace_scope",
    questions: "bad",
    publicStatus: {}
  },
  "agent-decision-v1": {
    type: "call_tool",
    toolName: "vdt.add_many_drivers",
    args: {},
    statusMessage: "Returning a forbidden full plan.",
    driverPlan: []
  },
  "agent-plan-v1": {
    selectedSkillIds: ["mining.production_volume"],
    skillRationale: "x",
    extractedInputs: [{ id: "root_kpi", label: "Root KPI", value: { bad: true } }],
    missingInputs: [{ id: "baseline_period", question: "Baseline?", reason: "Needed.", required: true }],
    confidence: 0.8
  },
  "generate-tree-v1": { projectTitle: "x" },
  "deepen-node-v1": { targetNodeId: "a", nodes: [], edges: [], assumptions: [], questionsForUser: [], warnings: [] },
  "simplify-branch-v1": { branchRootNodeId: "a", nodeRemovals: "bad", edgeChanges: [], rationale: "x", ...advisory },
  "suggest-alternative-v1": { targetNodeId: "a", nodes: "bad", edges: [], rationale: "x", ...advisory },
  "suggest-formula-v1": { nodeId: "a", proposedFormula: "x", aiRationale: "x", confidence: "bad", ...advisory },
  "review-model-v1": { findings: "bad", ...advisory },
  "check-units-v1": { unitFindings: "bad", ...advisory },
  "identify-missing-drivers-v1": { missingDrivers: "bad", ...advisory },
  "identify-duplicate-drivers-v1": { duplicateClusters: "bad", ...advisory },
  "explain-node-v1": { nodeId: "a", explanation: "x", keyDrivers: "bad", assumptions: [], questionsForUser: [] },
  "explain-scenario-v1": { scenarioId: "a", narrative: "x", impactHighlights: "bad", assumptions: [], questionsForUser: [] },
  "generate-executive-summary-v1": { headline: "x", keyDrivers: "bad", risks: [], recommendations: [] }
};
