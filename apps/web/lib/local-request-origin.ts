import { isLocalWebHostname } from "./app-mode";

/** Next may reconstruct request.url with localhost even when the browser used
 * 127.0.0.1. Use the direct Host authority, never forwarded proxy headers, and
 * require both authorities to remain local and on the server's actual port. */
export function hasSameLocalOrigin(request: Request): boolean {
  try {
    const server = new URL(request.url);
    if (!isLocalWebHostname(server.hostname)) return false;
    const host = request.headers.get("host");
    const application = host ? new URL(`${server.protocol}//${host}`) : server;
    if (host && application.host.toLowerCase() !== host.toLowerCase()) return false;
    return isLocalWebHostname(application.hostname)
      && application.port === server.port
      && request.headers.get("origin") === application.origin
      && request.headers.get("sec-fetch-site") !== "cross-site";
  } catch {
    return false;
  }
}
