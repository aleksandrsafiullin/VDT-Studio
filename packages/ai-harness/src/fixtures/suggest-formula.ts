import { suggestFormulaOutputSchema, type SuggestFormulaOutput } from "../schemas/suggest-formula";

export const productionVolumeFormulaOutput: SuggestFormulaOutput = suggestFormulaOutputSchema.parse({
  nodeId: "production_volume",
  proposedFormula: "effective_working_time * average_productivity",
  proposedUnit: "tonnes/month",
  aiRationale:
    "Production volume is driven by productive hours multiplied by achieved productivity rate.",
  confidence: 0.93,
  assumptions: ["Useful output excludes non-saleable material."],
  questionsForUser: ["Should waste or off-spec tonnes be excluded from this root KPI?"],
  warnings: []
});
