import { describe, expect, it, vi } from "vitest";
import { createAgentClient } from "./agent-client";

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
