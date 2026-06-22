import {
  identifyDuplicateDriversOutputSchema,
  type IdentifyDuplicateDriversOutput
} from "../schemas/identify-duplicate-drivers";

export const productionVolumeDuplicateDriversOutput: IdentifyDuplicateDriversOutput =
  identifyDuplicateDriversOutputSchema.parse({
    duplicateClusters: [
      {
        nodeIds: ["utilization_factor", "yield_factor"],
        similarityReason:
          "Both are fractional efficiency adjustments applied multiplicatively to nominal rate.",
        mergeSuggestion: "Consider a single net efficiency factor unless yield is reported separately."
      }
    ],
    assumptions: ["Efficiency factors are reviewed at the same operational cadence."],
    questionsForUser: ["Are utilization and yield owned by the same operations team?"],
    warnings: []
  });
