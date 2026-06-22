import { explainNodeOutputSchema, type ExplainNodeOutput } from "../schemas/explain-node";

export const productionVolumeExplainNodeOutput: ExplainNodeOutput = explainNodeOutputSchema.parse({
  nodeId: "production_volume",
  explanation:
    "## Production Volume\n\nMonthly **production volume** is the root KPI: useful tonnes produced in the period. It is calculated as **effective working time** multiplied by **average productivity**.\n\nImproving hours available or tonnes per hour both lift output.",
  keyDrivers: ["Effective Working Time", "Average Productivity"],
  assumptions: ["Volume counts saleable output only."],
  questionsForUser: ["Should gross vs net tonnes be distinguished in this KPI?"]
});
