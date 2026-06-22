import type { VdtOutputSchemaId } from "../schema-registry";

const advisory = {
  assumptions: ["Baseline month is representative."],
  questionsForUser: ["Confirm unit conventions?"],
  warnings: [{ severity: "info", message: "Sample warning." }]
};

export const VALID_SCHEMA_FIXTURES: Record<VdtOutputSchemaId, unknown> = {
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
    unitFindings: [{ nodeId: "utilization_factor", severity: "warning", message: "Unit mismatch." }],
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
        nodeIds: ["utilization_factor", "yield_factor"],
        similarityReason: "Both adjust productivity multiplicatively."
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
