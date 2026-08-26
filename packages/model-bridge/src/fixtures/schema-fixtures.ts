import type { VdtSchemaId } from "../schema-registry";

type RegisteredOutputSchemaId = Exclude<VdtSchemaId, "connection-test-v1">;

const advisory = {
  assumptions: ["Baseline month is representative."],
  questionsForUser: ["Confirm unit conventions?"],
  warnings: [{ severity: "info", message: "Sample warning." }]
};

export const VALID_SCHEMA_FIXTURES: Record<RegisteredOutputSchemaId, unknown> = {
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
  "agent-decision-v2": {
    type: "call_tools",
    calls: [
      {
        toolName: "skill.search",
        args: { rootKpi: "Ore haulage", industry: "Mining", maxSkills: 3 }
      },
      {
        toolName: "project.get_subtree",
        args: { nodeId: "root", maxDepth: 2 }
      }
    ],
    statusMessage: "Inspecting the relevant haulage context."
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
  "data-agent-decision-v1": {
    type: "tool_call",
    toolName: "table.profile",
    rationale: "Column profiles are needed before semantic inference.",
    input: {
      tableId: "table_1"
    }
  },
  "analyze-raw-dataset-v1": {
    datasetId: "dataset_1",
    summary: {
      rowCount: 4,
      tableCount: 1,
      likelyDatasetKind: "event log / downtime",
      confidence: 0.82,
      description: "Detected a small event log."
    },
    columns: [
      {
        tableId: "table_1",
        columnName: "Minutes",
        physicalType: "number",
        logicalType: "duration",
        semanticRole: "duration",
        unit: "minute",
        confidence: 0.88,
        evidence: [
          {
            type: "column_name",
            message: "Column name suggests minutes.",
            strength: "strong"
          }
        ],
        profileRef: "table_1.minutes"
      }
    ],
    metricCandidates: [
      {
        id: "metric_total_minutes",
        name: "Total Minutes",
        description: "Sum of downtime minutes.",
        sourceTableId: "table_1",
        sourceColumns: ["Minutes"],
        aggregation: "sum",
        unit: "minute",
        confidence: 0.88,
        evidence: [
          {
            type: "value_pattern",
            message: "Most values parse as positive numbers.",
            strength: "strong"
          }
        ],
        limitations: []
      }
    ],
    assumptions: ["Minutes are interpreted as duration."],
    questionsForUser: ["Confirm that Minutes is measured in minutes."],
    warnings: []
  },
  "review-dataset-proposal-v1": {
    datasetId: "dataset_1",
    summary: {
      rowCount: 4,
      tableCount: 1,
      likelyDatasetKind: "event log / downtime",
      confidence: 0.82,
      description: "Reviewed dataset proposal."
    },
    columns: [
      {
        tableId: "table_1",
        columnName: "Reason",
        physicalType: "string",
        logicalType: "category",
        semanticRole: "event_reason",
        confidence: 0.9,
        evidence: [
          {
            type: "distribution",
            message: "Reason has recurring values.",
            strength: "strong"
          }
        ],
        profileRef: "table_1.reason"
      }
    ],
    metricCandidates: [],
    assumptions: [],
    questionsForUser: [],
    warnings: []
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

export const INVALID_SCHEMA_FIXTURES: Record<RegisteredOutputSchemaId, unknown> = {
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
  "agent-decision-v2": {
    type: "call_tools",
    calls: [
      { toolName: "user.ask", args: {} },
      { toolName: "project.get_node", args: { nodeId: "root" } }
    ],
    statusMessage: "Invalid interactive batch."
  },
  "agent-plan-v1": {
    selectedSkillIds: ["mining.production_volume"],
    skillRationale: "x",
    extractedInputs: [{ id: "root_kpi", label: "Root KPI", value: { bad: true } }],
    missingInputs: [{ id: "baseline_period", question: "Baseline?", reason: "Needed.", required: true }],
    confidence: 0.8
  },
  "data-agent-decision-v1": {
    type: "bad",
    toolName: "table.profile",
    rationale: "Invalid decision type.",
    input: {}
  },
  "analyze-raw-dataset-v1": {
    datasetId: "dataset_1",
    summary: {},
    columns: "bad",
    metricCandidates: [],
    assumptions: [],
    questionsForUser: [],
    warnings: []
  },
  "review-dataset-proposal-v1": {
    datasetId: "dataset_1",
    summary: {
      rowCount: 1,
      tableCount: 1,
      likelyDatasetKind: "x",
      confidence: 2,
      description: "x"
    },
    columns: [],
    metricCandidates: [],
    assumptions: [],
    questionsForUser: [],
    warnings: []
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
