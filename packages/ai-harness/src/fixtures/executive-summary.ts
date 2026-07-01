import { executiveSummaryOutputSchema, type ExecutiveSummaryOutput } from "../schemas/executive-summary";

export const productionVolumeExecutiveSummaryOutput: ExecutiveSummaryOutput =
  executiveSummaryOutputSchema.parse({
    headline: "Production volume is most sensitive to unplanned downtime and achieved productivity.",
    keyDrivers: [
      "Effective working time — calendar hours minus planned and unplanned losses",
      "Average productivity — nominal rate adjusted by yield when relevant",
      "Unplanned downtime — largest controllable time loss in the baseline"
    ],
    risks: [
      "Percent-labeled factors may be misinterpreted if entered as whole numbers instead of ratios.",
      "Downtime categories may overlap if events are not classified consistently."
    ],
    recommendations: [
      "Prioritize reliability programs targeting unplanned downtime.",
      "Normalize unit labels for multiplicative percentage drivers.",
      "Validate baseline input values with operations before scenario planning."
    ]
  });
