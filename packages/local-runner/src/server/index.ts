import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { describeCliProvider } from "../adapters/cli-provider";
import type { CliProviderConfig } from "../cli/types";

const PORT = Number(process.env.LOCAL_RUNNER_PORT ?? 8765);
const HOST = process.env.LOCAL_RUNNER_HOST ?? "127.0.0.1";
const allowedOrigins = new Set([
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
  "http://localhost:3000",
  "http://127.0.0.1:3000"
]);

function sendJson(request: IncomingMessage, response: ServerResponse, statusCode: number, payload: unknown) {
  const origin = request.headers.origin;
  const allowOrigin = typeof origin === "string" && allowedOrigins.has(origin) ? origin : `http://${HOST}:${PORT}`;
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  response.end(JSON.stringify(payload, null, 2));
}

async function readJson<T>(request: IncomingMessage): Promise<T | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return undefined;
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "OPTIONS") {
      sendJson(request, response, 204, {});
      return;
    }

    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(request, response, 200, {
        ok: true,
        service: "vdt-studio-local-runner",
        version: "0.1.0",
        adapters: ["cli_stub", "local_http_stub"]
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/test-provider") {
      const body = await readJson<{ provider?: CliProviderConfig }>(request);
      const provider = body?.provider ?? {
        name: "Local CLI Stub",
        command: "echo",
        args: ["{\"ok\":true}"],
        inputMode: "stdin",
        outputMode: "stdout_json",
        timeoutSec: 30
      };

      sendJson(request, response, 200, describeCliProvider(provider));
      return;
    }

    sendJson(request, response, 404, {
      ok: false,
      error: `No local-runner route for ${request.method ?? "UNKNOWN"} ${url.pathname}`
    });
  } catch (error) {
    sendJson(request, response, 500, {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown local-runner error"
    });
  }
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`VDT local runner listening at http://${HOST}:${PORT}\n`);
});
