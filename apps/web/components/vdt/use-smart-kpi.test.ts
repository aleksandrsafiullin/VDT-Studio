import { describe, expect, it } from "vitest";
import { smartKpiAgentIsActive } from "./use-smart-kpi";

const idle = { isGenerating: false, smartKpiFencedRunIds: [], agentConnectionStatus: "idle" };
describe("Smart canvas execution gate", () => {
  it("keeps paused historical fenced runs inspectable without pausing new preparation", () => {
    const history = { ...idle, agentRun: { runId: "previous", status: "needs_user_input" }, smartKpiFencedRunIds: ["previous"], agentPendingQuestions: [{}] };
    expect(smartKpiAgentIsActive(history)).toBe(false);
    expect(smartKpiAgentIsActive({ ...history, isGenerating: true })).toBe(true);
    expect(smartKpiAgentIsActive({ ...history, agentRun: { runId: "fresh", status: "running" } })).toBe(true);
  });
  it("pauses live connection, questions and legacy generation, and releases completed runs", () => {
    expect(smartKpiAgentIsActive(idle)).toBe(false);
    expect(smartKpiAgentIsActive({ ...idle, agentConnectionStatus: "connecting" })).toBe(true);
    expect(smartKpiAgentIsActive({ ...idle, agentPendingQuestions: [{}] })).toBe(true);
    expect(smartKpiAgentIsActive({ ...idle, generateActivity: { runId: "legacy", status: "running" } })).toBe(true);
    expect(smartKpiAgentIsActive({ ...idle, generateActivity: { runId: "legacy", status: "needs_user_input" }, smartKpiFencedRunIds: ["legacy"] })).toBe(false);
    expect(smartKpiAgentIsActive({ ...idle, agentRun: { runId: "finished", status: "completed" } })).toBe(false);
  });
});
