import { reviewModelOutputSchema, type ReviewModelOutput } from "../schemas/review-model";

export const productionVolumeReviewOutput: ReviewModelOutput = reviewModelOutputSchema.parse({
  findings: [
    {
      severity: "warning",
      category: "unit_consistency",
      message: "yield_factor uses a % label but is applied as a multiplicative ratio (0-1).",
      nodeId: "yield_factor"
    },
    {
      severity: "info",
      category: "business_logic",
      message: "Unplanned downtime is a high-materiality lever with a defined improvement scenario.",
      nodeId: "unplanned_downtime"
    },
    {
      severity: "info",
      category: "duplicate_hints",
      message: "Calendar time and gross availability concepts may overlap if both appear after restructuring.",
      nodeId: "calendar_time"
    }
  ],
  assumptions: ["Baseline values represent a typical operating month."],
  questionsForUser: ["Are percentage inputs entered as decimals (0.9) or whole numbers (90)?"],
  warnings: []
});
