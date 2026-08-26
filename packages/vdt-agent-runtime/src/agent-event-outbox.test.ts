import { describe, expect, it } from "vitest";
import { AgentRunEventOutbox, AgentRunEventOutboxError } from "./agent-event-outbox";
import type { AgentRunEventV2 } from "./schemas/agent-run-event-v2";

describe("AgentRunEventOutbox", () => {
  it("persists a deterministic hash chain and resumes after a sequence cursor", async () => {
    const persisted: unknown[] = [];
    const outbox = new AgentRunEventOutbox("run-1", {
      now: () => "2026-08-26T10:00:00.000Z",
      sink: { append: (event) => { persisted.push(event); } }
    });

    const first = await outbox.append({
      type: "runtime_status",
      source: "runtime",
      payload: { code: "STARTING", message: "Starting the run.", state: "opening" }
    });
    const second = await outbox.append({
      type: "assistant_message",
      source: "vdt_agent",
      sessionId: "binding-1",
      messageId: "message-1",
      payload: { text: "I will build the tree.", format: "markdown", completed: true }
    });

    expect(first).toMatchObject({ seq: 1, previousHash: null });
    expect(second).toMatchObject({ seq: 2, previousHash: first.hash });
    expect(persisted).toHaveLength(2);
    expect(outbox.readAfter(1)).toEqual([second]);

    const recovered = new AgentRunEventOutbox("run-1", { initialEvents: outbox.snapshot() });
    expect(recovered.head()).toEqual(second);
  });

  it("rejects a corrupt replay chain", async () => {
    const outbox = new AgentRunEventOutbox("run-1", {
      now: () => "2026-08-26T10:00:00.000Z"
    });
    await outbox.append({
      type: "runtime_status",
      source: "runtime",
      payload: { code: "STARTING", message: "Starting the run." }
    });
    const original = outbox.snapshot()[0]!;
    const corrupt = [{
      ...original,
      payload: { code: "TAMPERED", message: "Starting the run." }
    }] as unknown as AgentRunEventV2[];

    expect(() => new AgentRunEventOutbox("run-1", { initialEvents: corrupt }))
      .toThrowError(AgentRunEventOutboxError);
  });

  it("does not advance the durable head when its sink rejects", async () => {
    const outbox = new AgentRunEventOutbox("run-1", {
      sink: { append: () => { throw new Error("storage unavailable"); } }
    });

    await expect(outbox.append({
      type: "runtime_status",
      source: "runtime",
      payload: { code: "STARTING", message: "Starting the run." }
    })).rejects.toThrow("storage unavailable");
    expect(outbox.snapshot()).toEqual([]);
  });

  it("serializes concurrent writers before assigning sequence and predecessor hashes", async () => {
    const persisted: AgentRunEventV2[] = [];
    let releaseFirst!: () => void;
    const firstSinkWait = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const outbox = new AgentRunEventOutbox("run-1", {
      now: () => "2026-08-26T10:00:00.000Z",
      sink: {
        append: async (event) => {
          if (event.seq === 1) await firstSinkWait;
          persisted.push(event);
        }
      }
    });

    const first = outbox.append({
      type: "runtime_status",
      source: "runtime",
      payload: { code: "STARTING", message: "Starting the run." }
    });
    const second = outbox.append({
      type: "runtime_status",
      source: "runtime",
      payload: { code: "RUNNING", message: "The run is active." }
    });
    await Promise.resolve();
    expect(outbox.snapshot()).toEqual([]);

    releaseFirst();
    const [firstEvent, secondEvent] = await Promise.all([first, second]);
    expect(firstEvent.seq).toBe(1);
    expect(secondEvent).toMatchObject({ seq: 2, previousHash: firstEvent.hash });
    expect(persisted.map((event) => event.seq)).toEqual([1, 2]);
  });

  it("hydrates the exact durable chain before recovery appends and rejects late hydration", async () => {
    const original = new AgentRunEventOutbox("run-recovery", {
      now: () => "2026-08-26T10:00:00.000Z"
    });
    const first = await original.append({
      type: "runtime_status",
      source: "runtime",
      payload: { code: "STARTED", message: "Started.", state: "running" }
    });
    const recovered = new AgentRunEventOutbox("run-recovery", {
      now: () => "2026-08-26T10:01:00.000Z"
    });

    recovered.hydrateDurable(original.snapshot());
    const second = await recovered.append({
      type: "runtime_status",
      source: "runtime",
      payload: { code: "RESUMED", message: "Resumed.", state: "running" }
    });

    expect(second).toMatchObject({ seq: 2, previousHash: first.hash });
    expect(() => recovered.hydrateDurable(original.snapshot())).toThrowError(
      expect.objectContaining({ code: "EVENT_LOG_ALREADY_ACTIVE" })
    );
  });
});
