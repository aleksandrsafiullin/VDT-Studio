import { checkUnitsOutputSchema, type CheckUnitsOutput } from "../schemas/check-units";

export const productionVolumeCheckUnitsOutput: CheckUnitsOutput = checkUnitsOutputSchema.parse({
  unitFindings: [
    {
      nodeId: "yield_factor",
      expectedUnit: "1",
      actualUnit: "1",
      severity: "info",
      message: "Yield factor is a dimensionless multiplier and needs no conversion."
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
  questionsForUser: [],
  warnings: []
});
