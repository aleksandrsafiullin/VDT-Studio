import { afterEach, expect, it, vi } from "vitest";
import type { VdtAgentRunSnapshot } from "@/lib/agent-client";
import { useVdtStudioStore as store } from "./vdt-store";

const runId = "verified-run";
const timestamp = "2026-11-11T12:00:00.000Z";
const running: VdtAgentRunSnapshot = {
  runId, status: "running", phase: "building_graph",
  request: { mode: "continue_project", input: { rootKpi: "Выручка" }, providerId: "openai_compatible" },
  createdAt: timestamp, updatedAt: timestamp, selectedSkills: [], events: [], chatMessages: [],
  publicStatus: { phase: "building_draft", message: "Building the draft.", updatedAt: timestamp },
  visibleContext: { threadId: runId, visibleTitle: "Выручка", brief: { rootKpi: "Выручка" }, visibleMessages: [] }
};

afterEach(() => {
  store.getState().startNewAgentChat();
  vi.unstubAllGlobals();
});

it("refreshes the visible final after a Supervisor completion arrives during an earlier snapshot read", async () => {
  const finalText = "Итог расчёта «Выручка» — 4 900 USD.";
  const completed: VdtAgentRunSnapshot = {
    ...running, status: "succeeded", phase: "reporting",
    finalReport: finalText,
    chatMessages: [{
      id: "verified-result", runId, createdAt: timestamp, role: "assistant", kind: "final_report", text: finalText
    }]
  };
  let resolveProgress!: (response: Response) => void;
  const progressRead = new Promise<Response>((resolve) => { resolveProgress = resolve; });
  const fetcher = vi.fn()
    .mockReturnValueOnce(progressRead)
    .mockResolvedValueOnce(Response.json({ ok: true, snapshot: completed }));
  vi.stubGlobal("fetch", fetcher);
  const source = Object.assign(new EventTarget(), { close: vi.fn() });
  vi.stubGlobal("EventSource", function TestEventSource() { return source; });
  const send = (type: string, seq: number, payload: object) => source.dispatchEvent(
    new MessageEvent("agent_event", { data: JSON.stringify({ schemaVersion: 2, runId, type, seq, payload }) })
  );

  store.getState().applyAgentGraphPatch(running);
  store.getState().connectAgentEvents(runId);
  send("tool_result", 1, { toolName: "run.request_finish", status: "succeeded" });
  expect(fetcher).toHaveBeenCalledOnce();
  send("final", 2, { text: finalText });
  send("runtime_status", 3, { code: "RUN_SUCCEEDED", state: "succeeded" });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(store.getState().generateActivity?.finalReport).toBeUndefined();

  resolveProgress(Response.json({ ok: true, snapshot: running }));
  await vi.waitFor(() => expect(store.getState().generateActivity).toMatchObject({
    status: "ready", finalReport: finalText, agentChatMessages: completed.chatMessages
  }));
  expect(fetcher.mock.calls).toHaveLength(2);
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    `/api/agent/runs/${runId}`,
    `/api/agent/runs/${runId}`
  ]);
});
