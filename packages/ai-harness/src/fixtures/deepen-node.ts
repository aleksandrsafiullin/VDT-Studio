import { deepenNodeOutputSchema, type DeepenNodeOutput } from "../schemas/deepen-node";

export const unplannedDowntimeDeepenOutput: DeepenNodeOutput = deepenNodeOutputSchema.parse({
  targetNodeId: "unplanned_downtime",
  nodes: [
    {
      id: "equipment_failure_downtime",
      name: "Equipment Failure Downtime",
      description: "Unplanned downtime caused by equipment breakdowns or failures.",
      type: "input",
      unit: "hours/month",
      aiConfidence: 0.76,
      aiRationale: "Equipment failures are a common and measurable share of unplanned downtime.",
      controllability: "high",
      materiality: "high"
    },
    {
      id: "process_interruption_downtime",
      name: "Process Interruption Downtime",
      description: "Unplanned downtime caused by process upsets, blockages, or material issues.",
      type: "input",
      unit: "hours/month",
      aiConfidence: 0.74,
      aiRationale: "Process interruptions often explain a distinct portion of unplanned stops.",
      controllability: "medium",
      materiality: "high"
    }
  ],
  edges: [
    {
      id: "edge_unplanned_downtime_equipment_failure",
      sourceNodeId: "unplanned_downtime",
      targetNodeId: "equipment_failure_downtime",
      relation: "additive_component",
      label: "includes",
      aiConfidence: 0.76
    },
    {
      id: "edge_unplanned_downtime_process_interruption",
      sourceNodeId: "unplanned_downtime",
      targetNodeId: "process_interruption_downtime",
      relation: "additive_component",
      label: "includes",
      aiConfidence: 0.74
    }
  ],
  assumptions: [
    "Unplanned downtime is decomposed by primary cause, not overlapping event codes.",
    "Equipment and process categories are mutually exclusive for reporting."
  ],
  questionsForUser: [
    "Do you already tag downtime by cause in your CMMS or historian?",
    "Should minor stops below a threshold be excluded from this breakdown?"
  ],
  warnings: []
});
