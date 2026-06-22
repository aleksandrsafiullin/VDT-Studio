import { explainScenarioOutputSchema, type ExplainScenarioOutput } from "../schemas/explain-scenario";

export const reduceDowntimeExplainScenarioOutput: ExplainScenarioOutput = explainScenarioOutputSchema.parse({
  scenarioId: "scenario_reduce_unplanned_downtime",
  narrative:
    "Reducing unplanned downtime from 80 to 60 hours/month adds 20 productive hours. With unchanged productivity, monthly production volume increases materially.",
  impactHighlights: [
    {
      nodeId: "unplanned_downtime",
      baselineValue: 80,
      scenarioValue: 60,
      delta: -20,
      message: "Unplanned downtime decreases by 20 hours/month."
    },
    {
      nodeId: "production_volume",
      baselineValue: 114048,
      scenarioValue: 117888,
      delta: 3840,
      message: "Root production volume increases with additional effective hours."
    }
  ],
  assumptions: ["Productivity drivers are unchanged under this scenario."],
  questionsForUser: ["Is a 20-hour downtime reduction achievable within one quarter?"]
});
