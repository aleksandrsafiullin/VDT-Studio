import { agentRuntime, jsonError } from "../../runtime";

function encodeSse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  if (!agentRuntime.store.has(runId)) {
    return jsonError("Agent run was not found.", 404, "RUN_NOT_FOUND");
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of agentRuntime.store.getSnapshot(runId).events) {
        controller.enqueue(encoder.encode(encodeSse("agent_event", event)));
      }

      unsubscribe = agentRuntime.store.eventBus.subscribe(runId, (event) => {
        try {
          controller.enqueue(encoder.encode(encodeSse("agent_event", event)));
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
