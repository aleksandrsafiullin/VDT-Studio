export interface LocalInferenceAdmission {
  readonly waitMs: number;
  readonly pendingAhead: number;
}

export class LocalInferenceQueueFullError extends Error {
  readonly code = "LOCAL_INFERENCE_QUEUE_FULL";
  readonly statusCode = 429;

  constructor() {
    super("The local inference queue is full. Wait for the active request or cancel a queued request.");
  }
}

type Release = () => void;
interface WaitingJob {
  readonly admit: () => void;
}

/** Process-local owner arbitration. Each lease is held until its response
 * stream ends or cancellation settles at the owned transport. */
export class LocalInferenceQueue {
  private active = false;
  private readonly waiting: WaitingJob[] = [];

  constructor(private readonly maxWaiting = 4) {
    if (!Number.isSafeInteger(maxWaiting) || maxWaiting < 0) throw new RangeError("Invalid local inference queue bound.");
  }

  private acquire(signal?: AbortSignal | null): Promise<{ release: Release; admission: LocalInferenceAdmission }> {
    signal?.throwIfAborted();
    if (this.active && this.waiting.length >= this.maxWaiting) throw new LocalInferenceQueueFullError();
    const started = performance.now();
    const pendingAhead = this.waiting.length + Number(this.active);
    return new Promise((resolve, reject) => {
      const abandon = () => {
        const index = this.waiting.indexOf(waiter);
        if (index >= 0) this.waiting.splice(index, 1);
        reject(signal?.reason);
      };
      const waiter: WaitingJob = { admit: () => {
        signal?.removeEventListener("abort", abandon);
        this.active = true;
        let settled = false;
        resolve({
          admission: { waitMs: performance.now() - started, pendingAhead },
          release: () => {
            if (settled) return;
            settled = true;
            this.active = false;
            this.waiting.shift()?.admit();
          }
        });
      } };
      if (!this.active) waiter.admit();
      else {
        this.waiting.push(waiter);
        signal?.addEventListener("abort", abandon, { once: true });
      }
    });
  }

  async fetch(
    dispatch: (admission: LocalInferenceAdmission) => Promise<Response>,
    signal?: AbortSignal | null
  ): Promise<Response> {
    const { release, admission } = await this.acquire(signal);
    try {
      signal?.throwIfAborted();
      const response = await dispatch(admission);
      if (!response.body) {
        release();
        signal?.throwIfAborted();
        return response;
      }
      return responseWithLease(response, release, signal);
    } catch (error) {
      release();
      throw error;
    }
  }
}

function responseWithLease(response: Response, release: Release, signal?: AbortSignal | null): Response {
  const reader = response.body!.getReader();
  let cancellation: Promise<void> | undefined;
  function finish() {
    signal?.removeEventListener("abort", abort);
    release();
  }
  function cancel(reason: unknown): Promise<void> {
    cancellation ??= reader.cancel(reason).finally(finish);
    return cancellation;
  }
  let controller: ReadableStreamDefaultController<Uint8Array>;
  function abort() {
    controller.error(signal?.reason);
    void cancel(signal?.reason).catch(() => undefined);
  }
  return new Response(new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort, { once: true });
    },
    async pull(output) {
      try {
        const { value, done } = await reader.read();
        // An abort while reading waits for the upstream cancellation, even
        // if the canceled read resolves before reader.cancel() does.
        if (cancellation) return;
        if (done) {
          output.close();
          finish();
        } else output.enqueue(value);
      } catch (error) {
        if (cancellation) return;
        output.error(error);
        finish();
      }
    },
    cancel
  }), { status: response.status, statusText: response.statusText, headers: response.headers });
}
