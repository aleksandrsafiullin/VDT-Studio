import { executiveSummaryOutputSchema, type ExecutiveSummaryOutput } from "../schemas/executive-summary";

export const productionVolumeExecutiveSummaryOutput: ExecutiveSummaryOutput =
  executiveSummaryOutputSchema.parse({
    headline: "Production volume is most sensitive to unplanned downtime and achieved productivity.",
    keyDrivers: [
      "Effective working time — calendar hours minus planned and unplanned losses",
      "Average productivity — nominal rate adjusted by utilization and yield",
      "Unplanned downtime — largest controllable time loss in the baseline"
    ],
    risks: [
      "Percent-labeled factors may be misinterpreted if entered as whole numbers instead of ratios.",
      "Yield and utilization overlap may double-count efficiency effects."
    ],
    recommendations: [
      "Prioritize reliability programs targeting unplanned downtime.",
      "Normalize unit labels for multiplicative percentage drivers.",
      "Validate baseline input values with operations before scenario planning."
    ]
  });
