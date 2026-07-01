import { simplifyBranchOutputSchema, type SimplifyBranchOutput } from "../schemas/simplify-branch";

export const averageProductivitySimplifyOutput: SimplifyBranchOutput = simplifyBranchOutputSchema.parse({
  branchRootNodeId: "average_productivity",
  nodeRemovals: [
    {
      nodeId: "yield_factor",
      rationale: "Yield is immaterial for monthly volume planning and can be omitted from this productivity branch."
    }
  ],
  nodeUpdates: [
    {
      nodeId: "average_productivity",
      formula: "nominal_rate",
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
    "Remove yield_factor to reduce decomposition depth while keeping nominal rate as the core productivity lever.",
  assumptions: ["Yield losses are immaterial for this executive reporting view."],
  questionsForUser: ["Is saleable yield tracked separately in your monthly KPI pack?"],
  warnings: []
});
