import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentClient } from "./agent-client";

afterEach(() => vi.unstubAllGlobals());

it("signals Supervisor snapshot changes and forwards legacy events directly", () => {
  const source = Object.assign(new EventTarget(), { close: vi.fn() });
  vi.stubGlobal("EventSource", function TestEventSource() { return source; });
  const onSupervisorUpdate = vi.fn();
  const onEvent = vi.fn();
  const unsubscribe = createAgentClient().subscribe("run", { onEvent, onSupervisorUpdate });
  const send = (data: object) => source.dispatchEvent(new MessageEvent("agent_event", { data: JSON.stringify(data) }));
  const legacy = { type: "assistant_message", title: "Agent message", message: "Existing chat response" };
  send(legacy);
  expect(onEvent).toHaveBeenCalledExactlyOnceWith(legacy);
  expect(onSupervisorUpdate).not.toHaveBeenCalled();

  for (const event of [
    { type: "checkpoint", payload: { reason: "finish_verified" } },
    { type: "final", payload: { text: "Verified final pending projection." } }
  ]) send({ schemaVersion: 2, ...event });
  expect(onSupervisorUpdate).not.toHaveBeenCalled();

  const visibleUpdates = [
    { type: "runtime_status", payload: { code: "SESSION_STARTED", state: "running" } },
    { type: "tool_call", payload: { toolName: "vdt.calculate" } },
    { type: "tool_result", payload: { toolName: "vdt.calculate", status: "succeeded" } },
    { type: "assistant_message", payload: { text: "Established-tree review." } },
    { type: "question", payload: { questions: [] } },
    { type: "approval_required", payload: { approvalId: "approval" } },
    { type: "warning", payload: { code: "TRANSPORT_DIAGNOSTIC" } },
    { type: "error", payload: { code: "ENGINE_STREAM_FAILED" } },
    { type: "runtime_status", payload: { code: "RUN_SUCCEEDED", state: "succeeded" } }
  ];
  for (const event of visibleUpdates) send({ schemaVersion: 2, ...event });
  expect(onSupervisorUpdate).toHaveBeenCalledTimes(visibleUpdates.length);
  expect(onEvent).toHaveBeenCalledTimes(1);
  unsubscribe();
  expect(source.close).toHaveBeenCalledOnce();
});

describe("selected incoming handoff cancellation receipt", () => {
  it("keeps ordinary cancel compatible and requires an explicit terminal receipt for a handoff", async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: true, status: "cancelled" }));
    const client = createAgentClient(fetcher);
    await expect(client.cancel("run/id")).resolves.toBeUndefined();
    expect(fetcher.mock.calls[0]).toEqual(["/api/agent/runs/run%2Fid/cancel", expect.objectContaining({ body: "{}" })]);
    await expect(client.cancel("run/id", { awaitTerminal: true })).rejects.toThrow("cleanup is not confirmed");
    expect(fetcher.mock.calls[1]).toEqual(["/api/agent/runs/run%2Fid/cancel", expect.objectContaining({ body: '{"awaitTerminal":true}' })]);
  });
  it("admits a handoff only after the host's positive cleanup receipt", async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: true, status: "cancelled", terminalCleanupConfirmed: true }));
    await expect(createAgentClient(fetcher).cancel("old", { awaitTerminal: true })).resolves.toBeUndefined();
  });
});
