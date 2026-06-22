import { TASK_LIMITS } from "../tasks/registry";
import {
  executiveSummaryOutputSchema,
  type ExecutiveSummaryResult,
  type ExecutiveSummaryOutput
} from "../schemas/executive-summary";
import { assertTextSectionLength } from "./changeset-graph";

export function validateExecutiveSummaryOutput(rawOutput: unknown): ExecutiveSummaryResult {
  const output = executiveSummaryOutputSchema.parse(rawOutput);
  const maxBytes = TASK_LIMITS.generate_executive_summary.maxTextSectionBytes ?? 8 * 1024;

  assertTextSectionLength(output.headline, maxBytes, "headline");

  if (output.keyDrivers.length === 0) {
    throw new Error("Executive summary must include at least one key driver.");
  }
  if (output.risks.length === 0) {
    throw new Error("Executive summary must include at least one risk.");
  }
  if (output.recommendations.length === 0) {
    throw new Error("Executive summary must include at least one recommendation.");
  }

  return output;
}

export type { ExecutiveSummaryOutput };
