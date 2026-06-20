import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import type { ResolvedProviderTarget } from "./provider-target-security";

export async function fetchPinnedProvider(
  target: ResolvedProviderTarget,
  init: { method: string; headers: Headers; body: string; signal: AbortSignal }
): Promise<Response> {
  const url = target.url;
  const transport = url.protocol === "https:" ? https : http;

  return await new Promise<Response>((resolve, reject) => {
    const headers = Object.fromEntries(init.headers.entries());
    headers.host = url.host;
    const request = transport.request({
      protocol: url.protocol,
      hostname: target.address,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: init.method,
      headers,
      family: target.family,
      ...(url.protocol === "https:" ? { servername: url.hostname } : {})
    }, (response) => {
      const responseHeaders = new Headers();
      for (const [name, value] of Object.entries(response.headers)) {
        if (Array.isArray(value)) value.forEach((item) => responseHeaders.append(name, item));
        else if (value !== undefined) responseHeaders.set(name, String(value));
      }
      resolve(new Response(Readable.toWeb(response) as ReadableStream<Uint8Array>, {
        status: response.statusCode ?? 502,
        ...(response.statusMessage ? { statusText: response.statusMessage } : {}),
        headers: responseHeaders
      }));
    });
    const abort = () => request.destroy(new DOMException("aborted", "AbortError"));
    if (init.signal.aborted) abort();
    else init.signal.addEventListener("abort", abort, { once: true });
    request.once("error", reject);
    request.once("close", () => init.signal.removeEventListener("abort", abort));
    request.end(init.body);
  });
}
