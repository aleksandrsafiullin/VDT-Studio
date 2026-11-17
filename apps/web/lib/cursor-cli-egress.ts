import { createServer } from "node:http";
import { createConnection, Socket } from "node:net";
import { resolvePublicProviderTarget, type ProviderDnsLookup } from "./provider-target-security";

// Keep this list specific to inference and token refresh. The CLI's browser sign-in
// is a separate action. Changes to this list require requalifying the runner.
export const CURSOR_CLI_EGRESS_HOSTS = Object.freeze([
  "api2.cursor.sh",
  "api5.cursor.sh",
  "agent.api5.cursor.sh",
  "agentn.api5.cursor.sh",
  "agent.us.api5.cursor.sh",
  "agentn.us.api5.cursor.sh",
  "agent.global.api5.cursor.sh",
  "agentn.global.api5.cursor.sh",
  "authenticate.cursor.sh",
  "authentication.cursor.sh",
  "prod.authentication.cursor.sh"
] as const);

const vendorTargets = new Map<string, string>(CURSOR_CLI_EGRESS_HOSTS.map(host => [`${host}:443`, host]));
const HEADER_DEADLINE_MS = 4_000;
const OUTBOUND_CONNECT_DEADLINE_MS = 8_000;
const IDLE_DEADLINE_MS = 90_000;

type CursorEgressPhase =
  | "client_open" | "client_end" | "client_error" | "client_close" | "client_idle"
  | "header_deadline" | "header_rejected" | "connection_limit"
  | "request_rejected" | "target_rejected" | "target_resolved" | "connect_deadline" | "tunnel_open"
  | "upstream_end" | "upstream_error" | "upstream_close" | "upstream_idle" | "broker_close";

const socketErrorCodes = [
  "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH", "EPIPE"
] as const;
type SocketErrorCode = typeof socketErrorCodes[number];

export interface CursorEgressEvent {
  readonly phase: CursorEgressPhase;
  readonly elapsedMs: number;
  readonly connection?: number;
  readonly host?: string;
  readonly code?: SocketErrorCode;
}

type ClientConnection = {
  readonly id: number;
  readonly headerDeadline: NodeJS.Timeout;
  host?: string;
};

export interface CursorCliEgress {
  readonly port: number;
  readonly proxyUrl: string;
  connectedHosts(): readonly string[];
  close(): Promise<void>;
}

/** The worker's OS policy must permit only this listener or a private relay
 * to it. The listener does not by itself constrain any other network access. */
export async function startCursorCliEgress(
  lookup?: ProviderDnsLookup,
  observe?: (event: CursorEgressEvent) => void
): Promise<CursorCliEgress> {
  const sockets = new Map<Socket, ClientConnection>();
  const connected = new Set<string>();
  const startedAt = performance.now();
  let connectionId = 0;
  let closing: Promise<void> | undefined;
  function record(phase: CursorEgressPhase, connection?: ClientConnection, error?: NodeJS.ErrnoException) {
    if (!observe) return;
    const code = socketErrorCodes.find(candidate => candidate === error?.code);
    try {
      observe({
        phase,
        elapsedMs: Math.round(performance.now() - startedAt),
        ...(connection ? { connection: connection.id } : {}),
        ...(connection?.host ? { host: connection.host } : {}),
        ...(code ? { code } : {})
      });
    } catch {
      // Diagnostics cannot change tunnel lifetime or network admission.
    }
  }

  const server = createServer({ maxHeaderSize: 8192, headersTimeout: HEADER_DEADLINE_MS }, (_req, res) => {
    record("request_rejected", res.socket ? sockets.get(res.socket) : undefined);
    res.writeHead(405, { Connection: "close" });
    res.end();
  });
  server.maxConnections = 12;
  server.on("drop", () => record("connection_limit"));

  server.on("connection", socket => {
    // Bound slow headers even when the built-in timer's sweep has not run.
    const deadline = setTimeout(() => {
      record("header_deadline", connection);
      socket.destroy();
    }, HEADER_DEADLINE_MS);
    deadline.unref();
    const connection: ClientConnection = { id: ++connectionId, headerDeadline: deadline };
    sockets.set(socket, connection);
    record("client_open", connection);
    socket.once("end", () => record("client_end", connection));
    socket.on("error", error => {
      record("client_error", connection, error);
      socket.destroy();
    });
    socket.once("close", () => {
      clearTimeout(deadline);
      sockets.delete(socket);
      record("client_close", connection);
    });
  });
  server.on("connect", (request, stream, head) => {
    const client = stream as Socket;
    const connection = sockets.get(client);
    if (!connection) {
      client.destroy();
      return;
    }
    clearTimeout(connection.headerDeadline);
    const hostname = vendorTargets.get(request.url ?? "");
    if (!hostname || head.length !== 0 || request.headers["transfer-encoding"] ||
        (request.headers["content-length"] !== undefined && request.headers["content-length"] !== "0")) {
      record("header_rejected", connection);
      client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    connection.host = hostname;
    client.pause();
    // Include DNS resolution in the connection deadline. An expired/closed
    // client cannot start a delayed outbound connection after the lookup.
    const deadline = setTimeout(() => {
      record("connect_deadline", connection);
      client.destroy();
    }, OUTBOUND_CONNECT_DEADLINE_MS);
    deadline.unref();
    client.once("close", () => clearTimeout(deadline));
    void (async () => {
      try {
        const target = await resolvePublicProviderTarget(`https://${hostname}`, lookup);
        if (client.destroyed || closing) return;
        record("target_resolved", connection);
        const upstream = createConnection({ host: target.address, family: target.family, port: 443 });
        client.once("close", () => upstream.destroy());
        upstream.once("end", () => record("upstream_end", connection));
        upstream.once("error", error => {
          record("upstream_error", connection, error);
          client.destroy();
        });
        upstream.once("close", () => {
          record("upstream_close", connection);
          if (!upstream.readableEnded) {
            client.destroy();
            return;
          }
          // The outgoing socket is fully closed. Flush the last response bytes
          // and release the CONNECT slot even if the CLI keeps its write half open.
          client.destroySoon();
        });
        upstream.once("connect", () => {
          clearTimeout(deadline);
          if (client.destroyed || closing) {
            upstream.destroy();
            return;
          }
          connected.add(hostname);
          record("tunnel_open", connection);
          client.setTimeout(IDLE_DEADLINE_MS, () => {
            record("client_idle", connection);
            client.destroy();
          });
          upstream.setTimeout(IDLE_DEADLINE_MS, () => {
            record("upstream_idle", connection);
            upstream.destroy();
          });
          client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          client.pipe(upstream);
          upstream.pipe(client);
        });
      } catch {
        clearTimeout(deadline);
        record("target_rejected", connection);
        if (!client.destroyed) client.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
      }
    })();
  });
  server.on("upgrade", (_request, socket) => socket.destroy());
  server.on("clientError", (_error, socket) => {
    record("header_rejected", socket instanceof Socket ? sockets.get(socket) : undefined);
    socket.destroy();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("The Cursor egress listener could not be bound.");
  }
  return {
    port: address.port,
    proxyUrl: `http://127.0.0.1:${address.port}`,
    connectedHosts: () => [...connected].sort(),
    close() {
      closing ??= new Promise<void>((resolve, reject) => {
        record("broker_close");
        server.close(error => error ? reject(error) : resolve());
        for (const socket of sockets.keys()) socket.destroy();
      });
      return closing;
    }
  };
}
