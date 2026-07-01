import {
  identifyDuplicateDriversOutputSchema,
  type IdentifyDuplicateDriversOutput
} from "../schemas/identify-duplicate-drivers";

export const productionVolumeDuplicateDriversOutput: IdentifyDuplicateDriversOutput =
  identifyDuplicateDriversOutputSchema.parse({
    duplicateClusters: [
      {
        nodeIds: ["planned_downtime", "unplanned_downtime"],
        similarityReason:
          "Both are downtime buckets that reduce working time and may be confused if maintenance events are inconsistently classified.",
        mergeSuggestion: "Keep them separate only if planned and unplanned downtime are governed and tracked separately."
      }
    ],
    assumptions: ["Downtime categories are reviewed at the same operational cadence."],
    questionsForUser: ["Do planned and unplanned downtime have separate owners and source systems?"],
    warnings: []
  });
