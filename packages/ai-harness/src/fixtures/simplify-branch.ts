import { simplifyBranchOutputSchema, type SimplifyBranchOutput } from "../schemas/simplify-branch";

export const averageProductivitySimplifyOutput: SimplifyBranchOutput = simplifyBranchOutputSchema.parse({
  branchRootNodeId: "average_productivity",
  nodeRemovals: [
    {
      nodeId: "yield_factor",
      rationale: "Yield is immaterial for monthly volume planning and can be folded into utilization."
    }
  ],
  nodeUpdates: [
    {
      nodeId: "average_productivity",
      formula: "nominal_rate * utilization_factor",
      aiRationale: "Simplified productivity model without a separate yield factor."
    }
  ],
  edgeChanges: [
    {
      id: "edge_remove_yield",
      action: "remove",
      edgeId: "edge_average_productivity_yield_factor"
    }
  ],
  rationale:
    "Remove yield_factor to reduce decomposition depth while keeping nominal rate and utilization as the core productivity levers.",
  assumptions: ["Yield losses are already reflected in utilization for executive reporting."],
  questionsForUser: ["Is saleable yield tracked separately in your monthly KPI pack?"],
  warnings: []
});
