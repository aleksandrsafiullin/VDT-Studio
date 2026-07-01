import { checkUnitsOutputSchema, type CheckUnitsOutput } from "../schemas/check-units";

export const productionVolumeCheckUnitsOutput: CheckUnitsOutput = checkUnitsOutputSchema.parse({
  unitFindings: [
    {
      nodeId: "yield_factor",
      expectedUnit: "ratio",
      actualUnit: "%",
      severity: "warning",
      message: "Yield factor label suggests percent while values behave as ratios."
    },
    {
      nodeId: "average_productivity",
      expectedUnit: "tonnes/hour",
      actualUnit: "tonnes/hour",
      severity: "info",
      message: "Productivity unit is consistent with root volume when multiplied by hours."
    }
  ],
  assumptions: ["Dimensional checks assume multiplicative composition unless marked additive."],
  questionsForUser: ["Should % drivers be normalized to explicit ratio units across the model?"],
  warnings: []
});
