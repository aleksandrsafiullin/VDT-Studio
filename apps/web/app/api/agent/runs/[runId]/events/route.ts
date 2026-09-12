import { agentRuntime, jsonError } from "../../runtime";
import {
  getPersistedSupervisorEvents,
  isPersistedSupervisorRun,
  subscribeToSupervisorEvents
} from "../../supervisor-runtime";
import { sequenceFromLastEventId } from "./sse-cursor";

function encodeSse(event: string, data: unknown, id?: string): string {
  return `${id ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  if (!agentRuntime.store.has(runId)) {
    return jsonError("Agent run was not found.", 404, "RUN_NOT_FOUND");
  }

  if (await isPersistedSupervisorRun(runId)) {
    return supervisorEventStream(request, runId);
  }

  const encoder = new TextEncoder();
  const replayEvents = agentRuntime.store.getSnapshot(runId).events;
  const lastEventId = request.headers.get("last-event-id");
  let deliveredSequence = sequenceFromLastEventId(lastEventId, replayEvents);
  let unsubscribe: (() => void) | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of replayEvents) {
        if (event.seq <= deliveredSequence) continue;
        controller.enqueue(encoder.encode(encodeSse("agent_event", event, event.id)));
        deliveredSequence = event.seq;
      }

      unsubscribe = agentRuntime.store.eventBus.subscribe(runId, (event) => {
        try {
          if (event.seq <= deliveredSequence) return;
          controller.enqueue(encoder.encode(encodeSse("agent_event", event, event.id)));
          deliveredSequence = event.seq;
        } catch {
          unsubscribe?.();
          unsubscribe = undefined;
        }
      });

      const close = () => {
        unsubscribe?.();
        unsubscribe = undefined;
        try {
          controller.close();
        } catch {
          // The browser may already have cancelled the stream.
        }
      };
      request.signal.addEventListener("abort", close, { once: true });
    },
    cancel() {
      unsubscribe?.();
      unsubscribe = undefined;
    }
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive"
    }
  });
}

async function supervisorEventStream(request: Request, runId: string): Promise<Response> {
  const encoder = new TextEncoder();
  const replayEvents = await getPersistedSupervisorEvents(runId);
  const lastEventId = request.headers.get("last-event-id");
  let deliveredSequence = sequenceFromLastEventId(lastEventId, replayEvents);
  let unsubscribe: (() => void) | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      unsubscribe = subscribeToSupervisorEvents(runId, (event) => {
        try {
          if (event.seq <= deliveredSequence) return;
          controller.enqueue(encoder.encode(encodeSse("agent_event", event, event.id)));
          deliveredSequence = event.seq;
        } catch {
          unsubscribe?.();
          unsubscribe = undefined;
        }
      });

      for (const event of replayEvents) {
        if (event.seq <= deliveredSequence) continue;
        controller.enqueue(encoder.encode(encodeSse("agent_event", event, event.id)));
        deliveredSequence = event.seq;
      }

      const close = () => {
        unsubscribe?.();
        unsubscribe = undefined;
        try {
          controller.close();
        } catch {
          // The browser may already have cancelled the stream.
        }
      };
      request.signal.addEventListener("abort", close, { once: true });
    },
    cancel() {
      unsubscribe?.();
      unsubscribe = undefined;
    }
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive"
    }
  });
}
