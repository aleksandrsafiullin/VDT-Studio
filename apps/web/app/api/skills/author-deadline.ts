/** Server-only deadline ownership shared by both read-only Skill Author routes. */
export class SkillAuthorTimeoutError extends Error {
  readonly code = "SKILL_AUTHOR_TIMEOUT";
  constructor(readonly timeoutMs: number, readonly providerTimedOut = false) {
    super("Skill Author exceeded its preparation deadline.");
  }
}

export class SkillAuthorCancelledError extends Error {
  readonly code = "SKILL_AUTHOR_CANCELLED";
  constructor() {
    super("Skill preparation was cancelled.");
  }
}

/** Abort the same provider operation and reject promptly even if its transport
 * ignores cancellation. The losing operation remains observed and cannot
 * publish a late result into the HTTP response. */
export async function withSkillAuthorDeadline<T>(caller: AbortSignal, timeoutMs: number, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  if (caller.aborted) throw new SkillAuthorCancelledError();
  const controller = new AbortController();
  let timedOut = false;
  let interrupt: (reason: unknown) => void = () => {};
  const interrupted = new Promise<never>((_, reject) => { interrupt = reject; });
  const stop = () => interrupt(controller.signal.reason);
  controller.signal.addEventListener("abort", stop, { once: true });
  // Promise.race observes both branches before any queued operation starts.
  const work = Promise.resolve().then(() => { controller.signal.throwIfAborted(); return operation(controller.signal); });
  const completion = Promise.race([work, interrupted]);
  const abort = () => controller.abort(new SkillAuthorCancelledError());
  caller.addEventListener("abort", abort, { once: true });
  if (caller.aborted) abort();
  const deadline = setTimeout(() => {
    if (controller.signal.aborted) return;
    timedOut = true;
    controller.abort(new SkillAuthorTimeoutError(timeoutMs));
  }, timeoutMs);
  try {
    const result = await completion;
    controller.signal.throwIfAborted();
    return result;
  } catch (error) {
    if (timedOut) throw new SkillAuthorTimeoutError(timeoutMs);
    if (caller.aborted) throw new SkillAuthorCancelledError();
    // Only a known structured timeout code is classified. Upstream text and
    // arbitrary error codes never become user-facing diagnostics here.
    if (error && typeof error === "object" && "code" in error && error.code === "TIMEOUT") throw new SkillAuthorTimeoutError(timeoutMs, true);
    throw error;
  } finally {
    clearTimeout(deadline);
    caller.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", stop);
  }
}

export function skillAuthorInterruptionResponse(error: unknown): Response | undefined {
  if (error instanceof SkillAuthorTimeoutError) {
    const seconds = error.timeoutMs / 1000, budget = seconds === 300 ? "300 seconds (5 minutes)" : `${seconds} seconds`;
    const message = error.providerTimedOut ? `The selected provider timed out before Skill Author completed (waiting limit: ${budget}).`
      : `Skill Author did not finish within ${budget}.`;
    return Response.json({ ok: false, error: { code: error.code,
      message: `${message} Try again, simplify the tree, or choose a faster model.` } },
    { status: 504, headers: { "cache-control": "no-store" } });
  }
  if (error instanceof SkillAuthorCancelledError) return Response.json({ ok: false, error: { code: error.code, message: error.message } },
    { status: 409, headers: { "cache-control": "no-store" } });
  return undefined;
}

export function skillAuthorBudgetResponse(error: unknown): Response | undefined {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  const message = code === "SKILL_AUTHOR_CONTEXT_LIMIT"
    ? "The complete tree and skill guidance cannot fit the bounded local Skill Author context. Reduce the input or choose another model."
    : code === "SKILL_AUTHOR_OUTPUT_LIMIT"
      ? "Skill Author exhausted its bounded output budget before completing an answer. Try again or choose a faster model."
      : undefined;
  return message ? Response.json({ ok: false, error: { code, message } }, { status: 422, headers: { "cache-control": "no-store" } }) : undefined;
}
