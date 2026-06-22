import { suggestAlternativeOutputSchema, type SuggestAlternativeOutput } from "../schemas/suggest-alternative";

export const effectiveWorkingTimeAlternativeOutput: SuggestAlternativeOutput =
  suggestAlternativeOutputSchema.parse({
    targetNodeId: "effective_working_time",
    removeChildNodeIds: ["calendar_time", "planned_downtime", "unplanned_downtime"],
    nodes: [
      {
        id: "gross_available_hours",
        name: "Gross Available Hours",
        description: "Total calendar hours available in the month.",
        type: "input",
        unit: "hours/month",
        aiConfidence: 0.88,
        aiRationale: "Calendar time as a single gross availability input.",
        controllability: "none",
        materiality: "medium"
      },
      {
        id: "total_downtime_hours",
        name: "Total Downtime Hours",
        description: "Combined planned and unplanned downtime hours.",
        type: "input",
        unit: "hours/month",
        aiConfidence: 0.86,
        aiRationale: "Aggregated downtime is easier to scenario-plan at executive level.",
        controllability: "high",
        materiality: "high"
      }
    ],
    edges: [
      {
        id: "edge_effective_gross_hours",
        sourceNodeId: "effective_working_time",
        targetNodeId: "gross_available_hours",
        relation: "additive_component",
        label: "starts from",
        aiConfidence: 0.88
      },
      {
        id: "edge_effective_total_downtime",
        sourceNodeId: "effective_working_time",
        targetNodeId: "total_downtime_hours",
        relation: "subtractive_component",
        label: "reduced by",
        aiConfidence: 0.86
      }
    ],
    targetNodePatch: {
      formula: "gross_available_hours - total_downtime_hours",
      aiRationale: "Replace three downtime children with gross hours minus aggregated downtime."
    },
    rationale:
      "Offer a simpler time bridge using gross availability minus total downtime instead of three separate time-loss nodes.",
    assumptions: [
      "Planned and unplanned downtime can be reported as one operational loss bucket for scenario work."
    ],
    questionsForUser: [
      "Do you need planned vs unplanned downtime split for reliability reporting?"
    ],
    warnings: [
      {
        severity: "warning",
        message: "This alternative removes three existing child nodes and replaces them with two inputs."
      }
    ]
  });
