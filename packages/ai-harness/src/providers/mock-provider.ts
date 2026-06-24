import {
  averageProductivitySimplifyOutput,
  effectiveWorkingTimeAlternativeOutput,
  productionVolumeCheckUnitsOutput,
  productionVolumeDuplicateDriversOutput,
  productionVolumeExecutiveSummaryOutput,
  productionVolumeExplainNodeOutput,
  productionVolumeFormulaOutput,
  productionVolumeMissingDriversOutput,
  productionVolumeReviewOutput,
  reduceDowntimeExplainScenarioOutput,
  unplannedDowntimeDeepenOutput
} from "../fixtures/mock";
import { generateVdtOutputSchema, type GenerateVdtOutput } from "../schemas/generate-vdt";
import type { DeepenNodeInput } from "../schemas/deepen-node";
import type { ExplainNodeInput } from "../schemas/explain-node";
import type { AiCompletionParams, AiProvider, AiTaskType, GenerateVdtInput } from "../types";

export const productionVolumeAiOutput: GenerateVdtOutput = generateVdtOutputSchema.parse({
  projectTitle: "Production Volume Driver Model",
  rootNodeId: "production_volume",
  nodes: [
    {
      id: "production_volume",
      name: "Production Volume",
      description: "Total useful output produced during the selected month.",
      type: "root_kpi",
      unit: "tonnes/month",
      formula: "effective_working_time * average_productivity",
      aiConfidence: 0.94,
      aiRationale: "Production volume is primarily driven by productive time and achieved production rate.",
      controllability: "medium",
      materiality: "high"
    },
    {
      id: "effective_working_time",
      name: "Effective Working Time",
      description: "Time available for actual production after planned and unplanned losses.",
      type: "calculated",
      unit: "hours/month",
      formula: "calendar_time - planned_downtime - unplanned_downtime",
      aiConfidence: 0.92,
      aiRationale: "Available production time is a direct driver of monthly output.",
      controllability: "high",
      materiality: "high"
    },
    {
      id: "average_productivity",
      name: "Average Productivity",
      description: "Average production rate achieved during effective working time.",
      type: "calculated",
      unit: "tonnes/hour",
      formula: "nominal_rate * utilization_factor * yield_factor",
      aiConfidence: 0.87,
      aiRationale: "Actual productivity is typically below nominal rate due to utilization and yield losses.",
      controllability: "high",
      materiality: "high"
    },
    {
      id: "calendar_time",
      name: "Calendar Time",
      description: "Total available calendar hours in the month.",
      type: "input",
      unit: "hours/month",
      aiConfidence: 0.9,
      aiRationale: "Calendar time provides the maximum theoretical time base.",
      controllability: "none",
      materiality: "medium"
    },
    {
      id: "planned_downtime",
      name: "Planned Downtime",
      description: "Scheduled downtime for maintenance, shutdowns or planned stops.",
      type: "input",
      unit: "hours/month",
      aiConfidence: 0.86,
      aiRationale: "Planned downtime reduces available production time.",
      controllability: "medium",
      materiality: "high"
    },
    {
      id: "unplanned_downtime",
      name: "Unplanned Downtime",
      description: "Unexpected downtime caused by equipment, process, material or operational issues.",
      type: "input",
      unit: "hours/month",
      aiConfidence: 0.89,
      aiRationale: "Unplanned downtime is often one of the largest controllable losses.",
      controllability: "high",
      materiality: "high"
    },
    {
      id: "nominal_rate",
      name: "Nominal Rate",
      description: "Theoretical or design production rate.",
      type: "input",
      unit: "tonnes/hour",
      aiConfidence: 0.82,
      aiRationale: "Nominal rate defines the technical capacity baseline.",
      controllability: "low",
      materiality: "high"
    },
    {
      id: "utilization_factor",
      name: "Utilization Factor",
      description: "Share of nominal production rate actually utilized.",
      type: "input",
      unit: "%",
      aiConfidence: 0.78,
      aiRationale: "Utilization captures operational inefficiencies below design rate.",
      controllability: "high",
      materiality: "high"
    },
    {
      id: "yield_factor",
      name: "Yield Factor",
      description: "Share of produced material that is counted as useful or saleable output.",
      type: "input",
      unit: "%",
      aiConfidence: 0.72,
      aiRationale: "Yield may affect final production volume depending on process definition.",
      controllability: "medium",
      materiality: "medium"
    }
  ],
  edges: [
    {
      id: "edge_production_volume_effective_working_time",
      sourceNodeId: "production_volume",
      targetNodeId: "effective_working_time",
      relation: "multiplicative_driver",
      label: "driven by",
      aiConfidence: 0.94
    },
    {
      id: "edge_production_volume_average_productivity",
      sourceNodeId: "production_volume",
      targetNodeId: "average_productivity",
      relation: "multiplicative_driver",
      label: "driven by",
      aiConfidence: 0.94
    },
    {
      id: "edge_effective_working_time_calendar_time",
      sourceNodeId: "effective_working_time",
      targetNodeId: "calendar_time",
      relation: "additive_component",
      label: "starts from",
      aiConfidence: 0.9
    },
    {
      id: "edge_effective_working_time_planned_downtime",
      sourceNodeId: "effective_working_time",
      targetNodeId: "planned_downtime",
      relation: "subtractive_component",
      label: "reduced by",
      aiConfidence: 0.86
    },
    {
      id: "edge_effective_working_time_unplanned_downtime",
      sourceNodeId: "effective_working_time",
      targetNodeId: "unplanned_downtime",
      relation: "subtractive_component",
      label: "reduced by",
      aiConfidence: 0.89
    },
    {
      id: "edge_average_productivity_nominal_rate",
      sourceNodeId: "average_productivity",
      targetNodeId: "nominal_rate",
      relation: "multiplicative_driver",
      label: "based on",
      aiConfidence: 0.82
    },
    {
      id: "edge_average_productivity_utilization_factor",
      sourceNodeId: "average_productivity",
      targetNodeId: "utilization_factor",
      relation: "multiplicative_driver",
      label: "adjusted by",
      aiConfidence: 0.78
    },
    {
      id: "edge_average_productivity_yield_factor",
      sourceNodeId: "average_productivity",
      targetNodeId: "yield_factor",
      relation: "multiplicative_driver",
      label: "adjusted by",
      aiConfidence: 0.72
    }
  ],
  assumptions: [
    "Production volume is measured as useful output, not gross material movement.",
    "Productivity is expressed per effective working hour.",
    "Yield factor may be removed if production volume already represents gross output."
  ],
  questionsForUser: [
    "Is production volume measured as gross output or saleable output?",
    "Are planned shutdowns included in the monthly target baseline?",
    "Do you track downtime by cause or only total downtime?",
    "Is productivity measured at equipment, line, plant or shift level?"
  ],
  warnings: [
    {
      severity: "warning",
      message: "Yield factor may not be relevant if the KPI already measures gross production volume."
    }
  ]
});

const MOCK_OUTPUT_BY_TASK: Record<AiTaskType, unknown> = {
  generate_tree: productionVolumeAiOutput,
  deepen_node: unplannedDowntimeDeepenOutput,
  simplify_branch: averageProductivitySimplifyOutput,
  suggest_alternative: effectiveWorkingTimeAlternativeOutput,
  suggest_formula: productionVolumeFormulaOutput,
  review_model: productionVolumeReviewOutput,
  check_units: productionVolumeCheckUnitsOutput,
  identify_missing_drivers: productionVolumeMissingDriversOutput,
  identify_duplicate_drivers: productionVolumeDuplicateDriversOutput,
  explain_node: productionVolumeExplainNodeOutput,
  explain_scenario: reduceDowntimeExplainScenarioOutput,
  generate_executive_summary: productionVolumeExecutiveSummaryOutput
};

function slugifyNodeId(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return slug || "root_kpi";
}

function edgeId(sourceNodeId: string, targetNodeId: string) {
  return `edge_${sourceNodeId}_${targetNodeId}`.replace(/_{2,}/g, "_").slice(0, 120);
}

function rootFormula(rootKpi: string, driverIds: string[]) {
  const lower = rootKpi.toLowerCase();
  if (
    lower.includes("rate") ||
    lower.includes("retention") ||
    lower.includes("conversion") ||
    lower.includes("availability") ||
    lower.includes("recovery") ||
    lower.includes("yield") ||
    lower.includes("service level") ||
    lower.includes("effectiveness")
  ) {
    return `${driverIds[0]} / ${driverIds[1]}`;
  }
  if (lower.includes("unit cost") || lower.includes("productivity")) {
    return `${driverIds[0]} / ${driverIds[1]}`;
  }
  return driverIds.join(" + ");
}

const REQUIRED_DRIVER_HINTS: Record<string, readonly string[]> = {
  "Overall Equipment Effectiveness": ["Availability", "Performance", "Quality"],
  Availability: ["Scheduled Time", "Planned Outage", "Forced Outage"],
  "Maintenance Cost": ["Labor Cost", "Spare Parts Cost", "Contractor Cost", "Emergency Work"],
  "Unit Cost": ["Operating Cost", "Production Volume", "Energy Cost", "Labor Cost"],
  "Inventory Level": ["Opening Inventory", "Receipts", "Demand", "Safety Stock"],
  "Service Level": ["Order Fill Rate", "On-Time Delivery", "Stock Availability"],
  "Working Capital": ["Accounts Receivable", "Inventory", "Accounts Payable"],
  EBITDA: ["Revenue", "Cost of Goods Sold", "Operating Expenses"],
  Revenue: ["Volume", "Average Price", "Returns", "Product Mix"],
  Retention: ["Renewals", "Churn", "Product Adoption", "Customer Success"],
  "Conversion Rate": ["Qualified Traffic", "Purchases", "Checkout Completion", "Product Availability"],
  "Delivery Time": ["Order Processing Time", "Warehouse Time", "Transit Time", "Last-Mile Time"],
  "Safety Incident Rate": ["Recordable Incidents", "Exposure Hours", "Training Compliance", "Hazard Controls"],
  "Energy Consumption": ["Operating Hours", "Equipment Load", "Efficiency", "Standby Losses"],
  Recovery: ["Recovered Metal", "Feed Metal", "Grind Size", "Reagent Dosing"],
  Throughput: ["Feed Availability", "Bottleneck Capacity", "Utilization", "Downtime"],
  Yield: ["Good Output", "Total Input", "Scrap", "Rework"],
  "Procurement Savings": ["Baseline Spend", "Negotiated Price Reduction", "Compliance", "Leakage"],
  "Workforce Productivity": ["Output Volume", "FTE Count", "Effective Working Time", "Skill Mix"]
};

function genericGenerateTreeOutput(input: GenerateVdtInput): GenerateVdtOutput {
  const rootKpi = input.rootKpi.trim();
  const rootNodeId = slugifyNodeId(rootKpi);
  const drivers = REQUIRED_DRIVER_HINTS[rootKpi] ?? ["Primary Driver", "Secondary Driver", "Operating Constraint", "Business Mix"];
  const driverIds = drivers.map((driver) => {
    const candidate = slugifyNodeId(driver);
    return candidate === rootNodeId ? `${candidate}_driver` : candidate;
  });
  const primaryDriverId = driverIds[0]!;
  const primaryDriverBaseId = `${primaryDriverId}_base`;
  const primaryDriverAdjustmentId = `${primaryDriverId}_adjustment`;
  const firstDriverChildren = [primaryDriverBaseId, primaryDriverAdjustmentId];
  const nodes: GenerateVdtOutput["nodes"] = [
    {
      id: rootNodeId,
      name: rootKpi,
      description: `Top-level KPI for ${input.industry}: ${rootKpi}.`,
      type: "root_kpi",
      unit: input.unit,
      formula: rootFormula(rootKpi, driverIds),
      aiConfidence: 0.86,
      aiRationale: `Mock baseline uses the business drivers requested for ${rootKpi}.`,
      controllability: "medium",
      materiality: "high"
    },
    ...drivers.map((driver, index) => ({
      id: driverIds[index]!,
      name: driver,
      description: `${driver} is a required business driver for ${rootKpi}.`,
      type: index === 0 ? "calculated" as const : "input" as const,
      unit: input.unit,
      ...(index === 0 ? { formula: `${primaryDriverBaseId} + ${primaryDriverAdjustmentId}` } : {}),
      aiConfidence: 0.8,
      aiRationale: `${driver} is included because it is material to the ${rootKpi} evaluation brief.`,
      controllability: index === 0 ? "high" as const : "medium" as const,
      materiality: "high" as const
    })),
    {
      id: primaryDriverBaseId,
      name: `${drivers[0]} Baseline`,
      description: `Baseline component for ${drivers[0]}.`,
      type: "input",
      unit: input.unit,
      aiConfidence: 0.74,
      aiRationale: `Separates ${drivers[0]} into a baseline component for graph depth.`,
      controllability: "medium",
      materiality: "medium"
    },
    {
      id: primaryDriverAdjustmentId,
      name: `${drivers[0]} Adjustment`,
      description: `Adjustment component for ${drivers[0]}.`,
      type: "input",
      unit: input.unit,
      aiConfidence: 0.72,
      aiRationale: `Separates ${drivers[0]} into an operating adjustment for graph depth.`,
      controllability: "high",
      materiality: "medium"
    }
  ];
  const edges: GenerateVdtOutput["edges"] = [
    ...driverIds.map((driverId, index) => ({
      id: edgeId(rootNodeId, driverId),
      sourceNodeId: rootNodeId,
      targetNodeId: driverId,
      relation: index === 0 ? "formula_dependency" as const : "positive_driver" as const,
      label: "driven by",
      aiConfidence: 0.82
    })),
    ...firstDriverChildren.map((childId) => ({
      id: edgeId(primaryDriverId, childId),
      sourceNodeId: primaryDriverId,
      targetNodeId: childId,
      relation: "additive_component" as const,
      label: "component",
      aiConfidence: 0.76
    }))
  ];

  return generateVdtOutputSchema.parse({
    projectTitle: `${rootKpi} Driver Model`,
    rootNodeId,
    nodes,
    edges,
    assumptions: [
      `${rootKpi} uses a deterministic mock structure for evaluation repeatability.`,
      `All required business drivers in the evaluation brief are represented as first-level nodes.`
    ],
    questionsForUser: [
      `Which source system owns the ${rootKpi} baseline?`,
      `Are the listed ${rootKpi} drivers measured at the same time grain?`,
      `Should any driver be split by site, product, customer segment or shift?`
    ],
    warnings: []
  });
}

function specializeGenerateTreeOutput(input: GenerateVdtInput): GenerateVdtOutput {
  const rootKpi = input.rootKpi.trim();
  if (rootKpi === "Production Volume" && input.unit === "tonnes/month") {
    return productionVolumeAiOutput;
  }
  return genericGenerateTreeOutput(input);
}

function resolveMockOutput<TInput>(params: AiCompletionParams<TInput>): unknown {
  if (params.taskType === "generate_tree") {
    return specializeGenerateTreeOutput(params.input as GenerateVdtInput);
  }

  if (params.taskType === "deepen_node") {
    const input = params.input as DeepenNodeInput;
    if (input.targetNodeId === "unplanned_downtime" || input.targetNodeId === unplannedDowntimeDeepenOutput.targetNodeId) {
      return unplannedDowntimeDeepenOutput;
    }
  }

  if (params.taskType === "explain_node") {
    const input = params.input as ExplainNodeInput;
    if (input.nodeId !== productionVolumeExplainNodeOutput.nodeId) {
      return {
        ...productionVolumeExplainNodeOutput,
        nodeId: input.nodeId,
        explanation: `## ${input.nodeId}\n\nMock explanation for **${input.nodeId}** in the production volume model.`
      };
    }
  }

  const output = MOCK_OUTPUT_BY_TASK[params.taskType];
  if (output === undefined) {
    throw new Error(`MockProvider has no stub for task: ${params.taskType}`);
  }
  return output;
}

export class MockProvider implements AiProvider {
  id = "mock";
  name = "Built-in Mock Provider";
  type = "mock" as const;

  async completeStructured<TInput, TOutput>(params: AiCompletionParams<TInput>): Promise<TOutput> {
    return resolveMockOutput(params) as TOutput;
  }
}
