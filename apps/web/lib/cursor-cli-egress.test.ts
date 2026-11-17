import { once } from "node:events";
import { createConnection, createServer, Socket } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { startCursorCliEgress, type CursorEgressEvent } from "./cursor-cli-egress";

vi.mock("node:net", async (importOriginal) => {
  const net = await importOriginal<typeof import("node:net")>();
  return { ...net, createConnection: vi.fn(net.createConnection) };
});

async function send(port: number, request: string): Promise<string> {
  const socket = createConnection({ host: "127.0.0.1", port });
  const chunks: Buffer[] = [];
  socket.on("data", chunk => chunks.push(chunk));
  socket.setTimeout(2000, () => socket.destroy(new Error("Proxy fixture timed out")));
  socket.write(request);
  await once(socket, "close");
  return Buffer.concat(chunks).toString("utf8");
}

describe("Cursor CLI egress", () => {
  it("rejects alternate destinations and cleartext methods before DNS", async () => {
    const lookup = vi.fn(async () => []);
    const events: CursorEgressEvent[] = [];
    const broker = await startCursorCliEgress(lookup, event => events.push(event));
    try {
      const tests = [
        ["CONNECT api2.cursor.sh.evil.example:443", 403],
        ["CONNECT api2.cursor.sh:80", 403],
        ["CONNECT 127.0.0.1:443", 403],
        ["GET https://api2.cursor.sh/", 405]
      ] as const;
      for (const [request, status] of tests) {
        const response = await send(broker.port, `${request} HTTP/1.1\r\nHost: api2.cursor.sh\r\nConnection: close\r\n\r\n`);
        expect(response).toMatch(new RegExp(`^HTTP/1.1 ${status} `));
      }
      expect(lookup).not.toHaveBeenCalled();
      expect(broker.connectedHosts()).toEqual([]);
      expect(events.filter(event => event.phase === "header_rejected")).toHaveLength(3);
      expect(events.filter(event => event.phase === "request_rejected")).toHaveLength(1);
      expect(events.every(event => event.host === undefined && event.code === undefined)).toBe(true);
    } finally {
      await broker.close();
    }
  });

  it("refuses an allowed host with any private or local DNS result", async () => {
    const lookup = vi.fn(async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "::ffff:127.0.0.1", family: 6 }
    ]);
    const observe = vi.fn(() => { throw new Error("Local observer unavailable"); });
    const broker = await startCursorCliEgress(lookup, observe);
    try {
      const response = await send(broker.port, "CONNECT api2.cursor.sh:443 HTTP/1.1\r\nHost: api2.cursor.sh:443\r\n\r\n");
      expect(response).toMatch(/^HTTP\/1.1 502 /);
      expect(lookup).toHaveBeenCalledExactlyOnceWith("api2.cursor.sh", { all: true, verbatim: true });
      expect(broker.connectedHosts()).toEqual([]);
      expect(observe).toHaveBeenCalledWith(expect.objectContaining({
        phase: "target_rejected", host: "api2.cursor.sh", connection: 1
      }));
      expect(JSON.stringify(observe.mock.calls)).not.toMatch(/93\.184|127\.0\.0/);
    } finally {
      await broker.close();
    }
  });

  it("drains the upstream tail and frees slots when the CLI holds its write half open", async () => {
    const upstream = createServer(socket => socket.end("last response bytes"));
    upstream.listen(0, "127.0.0.1");
    await once(upstream, "listening");
    const address = upstream.address();
    if (!address || typeof address === "string") throw new Error("The upstream fixture has no port");
    const dial = vi.mocked(createConnection);
    dial.mockImplementation(() => new Socket().connect(address.port, "127.0.0.1"));
    const events: CursorEgressEvent[] = [];
    const clients: Socket[] = [];
    const broker = await startCursorCliEgress(
      async () => [{ address: "93.184.216.34", family: 4 }],
      event => events.push(event)
    );
    try {
      for (let index = 0; index < 13; index++) {
        const socket = new Socket({ allowHalfOpen: true });
        clients.push(socket);
        const chunks: Buffer[] = [];
        socket.on("data", chunk => chunks.push(chunk));
        socket.setTimeout(2_000, () => socket.destroy(new Error("Half-open fixture timed out")));
        const ended = once(socket, "end");
        socket.connect(broker.port, "127.0.0.1");
        socket.write("CONNECT api2.cursor.sh:443 HTTP/1.1\r\nHost: api2.cursor.sh:443\r\n\r\n");
        await ended;
        socket.setTimeout(0);
        expect(Buffer.concat(chunks).toString()).toBe(
          "HTTP/1.1 200 Connection Established\r\n\r\nlast response bytes"
        );
        expect(socket.writableEnded).toBe(false);
      }
      await vi.waitFor(() => expect(events.filter(event => event.phase === "client_close")).toHaveLength(13));
      expect(events.filter(event => event.phase === "connection_limit")).toEqual([]);
    } finally {
      for (const socket of clients) socket.destroy();
      await broker.close();
      await new Promise<void>(resolve => upstream.close(() => resolve()));
      dial.mockReset();
    }
  });
});
