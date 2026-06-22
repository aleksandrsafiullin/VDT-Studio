import {
  identifyMissingDriversOutputSchema,
  type IdentifyMissingDriversOutput
} from "../schemas/identify-missing-drivers";

export const productionVolumeMissingDriversOutput: IdentifyMissingDriversOutput =
  identifyMissingDriversOutputSchema.parse({
    missingDrivers: [
      {
        parentNodeId: "unplanned_downtime",
        suggestedName: "Maintenance Backlog Hours",
        suggestedType: "input",
        unit: "hours/month",
        suggestedNodeId: "maintenance_backlog_hours",
        rationale:
          "Deferred maintenance often explains a share of unplanned downtime not captured by event codes alone."
      }
    ],
    assumptions: ["CMMS backlog data may be available monthly."],
    questionsForUser: ["Do you track deferred maintenance backlog hours separately?"],
    warnings: []
  });
