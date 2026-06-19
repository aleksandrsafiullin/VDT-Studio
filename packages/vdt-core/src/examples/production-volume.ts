import type { VdtProject } from "../types";

const createdAt = "2026-01-01T00:00:00.000Z";

export const productionVolumeProject: VdtProject = {
  id: "project_production_volume",
  name: "Production Volume Driver Model",
  description: "Demo model for monthly mining / processing plant production volume.",
  industry: "Mining / Processing Plant",
  businessContext: "Operational performance analysis",
  rootNodeId: "production_volume",
  graph: {
    nodes: [
      {
        id: "production_volume",
        name: "Production Volume",
        description: "Total useful output produced during the selected month.",
        type: "root_kpi",
        status: "ai_suggested",
        unit: "tonnes/month",
        formula: "effective_working_time * average_productivity",
        aiGenerated: true,
        aiConfidence: 0.94,
        aiRationale: "Production volume is primarily driven by productive time and achieved production rate.",
        controllability: "medium",
        materiality: "high",
        createdAt,
        updatedAt: createdAt
      },
      {
        id: "effective_working_time",
        name: "Effective Working Time",
        description: "Time available for actual production after planned and unplanned losses.",
        type: "calculated",
        status: "ai_suggested",
        unit: "hours/month",
        formula: "calendar_time - planned_downtime - unplanned_downtime",
        aiGenerated: true,
        aiConfidence: 0.92,
        aiRationale: "Available production time is a direct driver of monthly output.",
        controllability: "high",
        materiality: "high",
        createdAt,
        updatedAt: createdAt
      },
      {
        id: "average_productivity",
        name: "Average Productivity",
        description: "Average production rate achieved during effective working time.",
        type: "calculated",
        status: "ai_suggested",
        unit: "tonnes/hour",
        formula: "nominal_rate * utilization_factor * yield_factor",
        aiGenerated: true,
        aiConfidence: 0.87,
        aiRationale: "Actual productivity is typically below nominal rate due to utilization and yield losses.",
        controllability: "high",
        materiality: "high",
        createdAt,
        updatedAt: createdAt
      },
      {
        id: "calendar_time",
        name: "Calendar Time",
        description: "Total available calendar hours in the month.",
        type: "input",
        status: "ai_suggested",
        unit: "hours/month",
        baselineValue: 720,
        aiGenerated: true,
        aiConfidence: 0.9,
        aiRationale: "Calendar time provides the maximum theoretical time base.",
        controllability: "none",
        materiality: "medium",
        createdAt,
        updatedAt: createdAt
      },
      {
        id: "planned_downtime",
        name: "Planned Downtime",
        description: "Scheduled downtime for maintenance, shutdowns or planned stops.",
        type: "input",
        status: "ai_suggested",
        unit: "hours/month",
        baselineValue: 40,
        aiGenerated: true,
        aiConfidence: 0.86,
        aiRationale: "Planned downtime reduces available production time.",
        controllability: "medium",
        materiality: "high",
        createdAt,
        updatedAt: createdAt
      },
      {
        id: "unplanned_downtime",
        name: "Unplanned Downtime",
        description: "Unexpected downtime caused by equipment, process, material or operational issues.",
        type: "input",
        status: "ai_suggested",
        unit: "hours/month",
        baselineValue: 80,
        aiGenerated: true,
        aiConfidence: 0.89,
        aiRationale: "Unplanned downtime is often one of the largest controllable losses.",
        controllability: "high",
        materiality: "high",
        createdAt,
        updatedAt: createdAt
      },
      {
        id: "nominal_rate",
        name: "Nominal Rate",
        description: "Theoretical or design production rate.",
        type: "input",
        status: "ai_suggested",
        unit: "tonnes/hour",
        baselineValue: 220,
        aiGenerated: true,
        aiConfidence: 0.82,
        aiRationale: "Nominal rate defines the technical capacity baseline.",
        controllability: "low",
        materiality: "high",
        createdAt,
        updatedAt: createdAt
      },
      {
        id: "utilization_factor",
        name: "Utilization Factor",
        description: "Share of nominal production rate actually utilized.",
        type: "input",
        status: "ai_suggested",
        unit: "%",
        baselineValue: 0.9,
        aiGenerated: true,
        aiConfidence: 0.78,
        aiRationale: "Utilization captures operational inefficiencies below design rate.",
        controllability: "high",
        materiality: "high",
        createdAt,
        updatedAt: createdAt
      },
      {
        id: "yield_factor",
        name: "Yield Factor",
        description: "Share of produced material counted as useful or saleable output.",
        type: "input",
        status: "ai_suggested",
        unit: "%",
        baselineValue: 0.96,
        aiGenerated: true,
        aiConfidence: 0.72,
        aiRationale: "Yield may affect final production volume depending on process definition.",
        controllability: "medium",
        materiality: "medium",
        createdAt,
        updatedAt: createdAt
      }
    ],
    edges: [
      {
        id: "edge_production_volume_effective_working_time",
        sourceNodeId: "production_volume",
        targetNodeId: "effective_working_time",
        relation: "multiplicative_driver",
        label: "driven by",
        aiGenerated: true,
        aiConfidence: 0.94
      },
      {
        id: "edge_production_volume_average_productivity",
        sourceNodeId: "production_volume",
        targetNodeId: "average_productivity",
        relation: "multiplicative_driver",
        label: "driven by",
        aiGenerated: true,
        aiConfidence: 0.94
      },
      {
        id: "edge_effective_working_time_calendar_time",
        sourceNodeId: "effective_working_time",
        targetNodeId: "calendar_time",
        relation: "additive_component",
        label: "starts from",
        aiGenerated: true,
        aiConfidence: 0.9
      },
      {
        id: "edge_effective_working_time_planned_downtime",
        sourceNodeId: "effective_working_time",
        targetNodeId: "planned_downtime",
        relation: "subtractive_component",
        label: "reduced by",
        aiGenerated: true,
        aiConfidence: 0.86
      },
      {
        id: "edge_effective_working_time_unplanned_downtime",
        sourceNodeId: "effective_working_time",
        targetNodeId: "unplanned_downtime",
        relation: "subtractive_component",
        label: "reduced by",
        aiGenerated: true,
        aiConfidence: 0.89
      },
      {
        id: "edge_average_productivity_nominal_rate",
        sourceNodeId: "average_productivity",
        targetNodeId: "nominal_rate",
        relation: "multiplicative_driver",
        label: "based on",
        aiGenerated: true,
        aiConfidence: 0.82
      },
      {
        id: "edge_average_productivity_utilization_factor",
        sourceNodeId: "average_productivity",
        targetNodeId: "utilization_factor",
        relation: "multiplicative_driver",
        label: "adjusted by",
        aiGenerated: true,
        aiConfidence: 0.78
      },
      {
        id: "edge_average_productivity_yield_factor",
        sourceNodeId: "average_productivity",
        targetNodeId: "yield_factor",
        relation: "multiplicative_driver",
        label: "adjusted by",
        aiGenerated: true,
        aiConfidence: 0.72
      }
    ]
  },
  scenarios: [
    {
      id: "scenario_reduce_unplanned_downtime",
      name: "Reduce unplanned downtime",
      description: "Reduce unplanned downtime from 80 to 60 hours/month.",
      overrides: [
        {
          nodeId: "unplanned_downtime",
          value: 60,
          reason: "Maintenance reliability improvement"
        }
      ],
      createdAt,
      updatedAt: createdAt
    }
  ],
  dataSources: [],
  aiSettings: {
    defaultProviderId: "mock"
  },
  versions: [],
  createdAt,
  updatedAt: createdAt
};
