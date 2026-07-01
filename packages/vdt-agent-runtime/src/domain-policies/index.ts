import { miningPolicySummaryForRun, type AgentDomainPolicySummary } from "./mining";
import type { VdtAgentRunState } from "../types";

export type { AgentDomainPolicySummary };

export function policySummaryForRun(state: VdtAgentRunState): AgentDomainPolicySummary[] {
  return [
    ...miningPolicySummaryForRun(state)
  ];
}
