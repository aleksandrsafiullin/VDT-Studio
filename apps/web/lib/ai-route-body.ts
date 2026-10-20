/** HTTP admission shared by AI entries before parsing or any trusted execution. */
export const SMART_HTTP_BODY_BYTES = 32 * 1024;
export const AI_ROUTE_BODY_BYTES = 512 * 1024;
const routeError = (code: string) => Object.assign(new Error(code), { code });

export function assertAiRouteOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") throw routeError("ORIGIN_REJECTED");
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") throw routeError("CONTENT_TYPE_REJECTED");
}

export async function readAiRouteBody(request: Request, maxBytes = AI_ROUTE_BODY_BYTES): Promise<{ text: string; bytes: number }> {
  assertAiRouteOrigin(request);
  if (Number(request.headers.get("content-length")) > maxBytes) throw routeError("INPUT_TOO_LARGE");
  const reader = request.body?.getReader();
  if (!reader) throw routeError("INVALID_BODY");
  let interrupt = (_error: Error) => {};
  const interrupted = new Promise<never>((_, reject) => { interrupt = reject; });
  const stop = (code: string) => { interrupt(routeError(code)); void reader.cancel().catch(() => {}); };
  const abort = () => stop("CANCELLED");
  const timer = setTimeout(() => stop("TIMEOUT"), 2_000);
  request.signal.addEventListener("abort", abort, { once: true });
  if (request.signal.aborted) abort();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0, text = "";
  try {
    while (true) {
      const next = await Promise.race([reader.read(), interrupted]);
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maxBytes) { void reader.cancel().catch(() => {}); throw routeError("INPUT_TOO_LARGE"); }
      text += decoder.decode(next.value, { stream: true });
    }
    return { text: text + decoder.decode(), bytes };
  } finally {
    clearTimeout(timer); request.signal.removeEventListener("abort", abort);
    try { reader.releaseLock(); } catch { /* pending cancelled reader */ }
  }
}

export function aiRouteGuardStatus(error: unknown): number | undefined {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  return code === "ORIGIN_REJECTED" ? 403 : code === "CONTENT_TYPE_REJECTED" ? 415 : code === "INPUT_TOO_LARGE" ? 413 : code === "TIMEOUT" ? 408 : code === "CANCELLED" ? 409 : undefined;
}
