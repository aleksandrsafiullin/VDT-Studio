import { createHash } from "node:crypto";
import {
  agentRunEventV2Schema,
  type AgentRunEventV2
} from "./schemas/agent-run-event-v2";

type EventServerFields =
  | "schemaVersion"
  | "id"
  | "runId"
  | "seq"
  | "previousHash"
  | "hash"
  | "timestamp";

export type AgentRunEventV2Draft = AgentRunEventV2 extends infer Event
  ? Event extends AgentRunEventV2
    ? Omit<Event, EventServerFields>
    : never
  : never;

export interface AgentRunEventV2Sink {
  append(event: AgentRunEventV2): Promise<void> | void;
}

export interface AgentRunEventOutboxOptions {
  now?: (() => string) | undefined;
  sink?: AgentRunEventV2Sink | undefined;
  initialEvents?: readonly AgentRunEventV2[] | undefined;
}

/** Immutable per-run V2 event chain. Live transports may wake readers, but
 * this chain is the replay and Last-Event-ID authority. */
export class AgentRunEventOutbox {
  private readonly events: AgentRunEventV2[] = [];
  private readonly now: () => string;
  private readonly sink: AgentRunEventV2Sink | undefined;
  private appendTail: Promise<void> = Promise.resolve();
  private appendStarted = false;

  constructor(readonly runId: string, options: AgentRunEventOutboxOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.sink = options.sink;
    if (options.initialEvents) this.hydrate(options.initialEvents);
  }

  append(draft: AgentRunEventV2Draft): Promise<AgentRunEventV2> {
    this.appendStarted = true;
    const append = this.appendTail.then(() => this.appendSerialized(draft));
    this.appendTail = append.then(() => undefined, () => undefined);
    return append;
  }

  private async appendSerialized(draft: AgentRunEventV2Draft): Promise<AgentRunEventV2> {
    const seq = this.events.length + 1;
    const previousHash = this.events.at(-1)?.hash ?? null;
    const withoutHash = {
      schemaVersion: 2 as const,
      id: `${this.runId}:${seq}`,
      runId: this.runId,
      seq,
      previousHash,
      timestamp: this.now(),
      ...draft
    };
    const event = agentRunEventV2Schema.parse({
      ...withoutHash,
      hash: hashEvent(withoutHash)
    });
    await this.sink?.append(event);
    this.events.push(event);
    return structuredClone(event);
  }

  readAfter(sequence: number, limit = 500): AgentRunEventV2[] {
    if (!Number.isSafeInteger(sequence) || sequence < 0) {
      throw new AgentRunEventOutboxError("INVALID_EVENT_CURSOR", "Event cursor must be a non-negative integer.");
    }
    if (sequence > this.events.length) {
      throw new AgentRunEventOutboxError("EVENT_CURSOR_AHEAD", "Event cursor is ahead of the durable event head.");
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
      throw new AgentRunEventOutboxError("INVALID_EVENT_LIMIT", "Event limit must be between 1 and 1000.");
    }
    return this.events.slice(sequence, sequence + limit).map((event) => structuredClone(event));
  }

  head(): AgentRunEventV2 | undefined {
    const event = this.events.at(-1);
    return event ? structuredClone(event) : undefined;
  }

  snapshot(): AgentRunEventV2[] {
    return this.events.map((event) => structuredClone(event));
  }

  /** Hydrates a recovered Supervisor before its first new append. Existing
   * state is accepted only when it is the exact same durable chain. */
  hydrateDurable(events: readonly AgentRunEventV2[]): void {
    if (this.appendStarted) {
      throw new AgentRunEventOutboxError(
        "EVENT_LOG_ALREADY_ACTIVE",
        "A durable outbox cannot be hydrated after appends have started."
      );
    }
    if (this.events.length === 0) {
      this.hydrate(events);
      return;
    }
    const candidate = new AgentRunEventOutbox(this.runId, { initialEvents: events });
    if (canonicalEvents(this.events) !== canonicalEvents(candidate.events)) {
      throw new AgentRunEventOutboxError(
        "EVENT_LOG_HYDRATION_CONFLICT",
        "Recovered events do not match the already hydrated durable outbox."
      );
    }
  }

  private hydrate(events: readonly AgentRunEventV2[]): void {
    let previousHash: string | null = null;
    for (const [index, raw] of events.entries()) {
      const event = agentRunEventV2Schema.parse(raw);
      const expectedSequence = index + 1;
      if (
        event.runId !== this.runId
        || event.seq !== expectedSequence
        || event.previousHash !== previousHash
      ) {
        throw new AgentRunEventOutboxError(
          "EVENT_LOG_CORRUPT",
          `Event ${event.id} does not match the expected run/sequence/hash predecessor.`
        );
      }
      const { hash, ...withoutHash } = event;
      if (hashEvent(withoutHash) !== hash) {
        throw new AgentRunEventOutboxError("EVENT_LOG_CORRUPT", `Event ${event.id} hash does not verify.`);
      }
      this.events.push(event);
      previousHash = event.hash;
    }
  }
}

export class AgentRunEventOutboxError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AgentRunEventOutboxError";
  }
}

function hashEvent(value: unknown): string {
  const canonical = JSON.stringify(sortJson(value));
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortJson(entry)])
  );
}

function canonicalEvents(events: readonly AgentRunEventV2[]): string {
  return JSON.stringify(sortJson(events));
}
