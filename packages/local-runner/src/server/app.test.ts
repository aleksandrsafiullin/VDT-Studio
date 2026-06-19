import { type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalRunnerServer } from "./app";

interface TestRunnerServer {
  baseUrl: string;
  server: Server;
}

const openServers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    openServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }

            resolve();
          });
        })
    )
  );
});

describe("local runner endpoints", () => {
  it("lists available stub providers", async () => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/providers`, {
      headers: {
        origin: "http://localhost:3000"
      }
    });
    const body = (await response.json()) as {
      ok: boolean;
      providers: Array<{ id: string; runMode: string; safety: { executesShell: boolean } }>;
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    expect(body.ok).toBe(true);
    expect(body.providers.map((provider) => provider.id)).toEqual(["cli_stub", "local_http_stub", "mock_stub"]);
    expect(body.providers.every((provider) => provider.safety.executesShell === false)).toBe(true);
  });

  it("returns a safe mock run response without echoing input values", async () => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/run`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        providerId: "mock_stub",
        taskType: "dry_run",
        input: {
          rootKpi: "Production Volume",
          secret: "do not echo this value"
        },
        schema: {
          type: "object",
          required: ["rootKpi"]
        },
        timeoutSec: 5
      })
    });
    const bodyText = await response.text();
    const body = JSON.parse(bodyText) as {
      ok: boolean;
      providerId: string;
      result: { mode: string; input: { keys: string[] }; schema: { keys: string[] } };
      diagnostics: { executed: boolean; shellExecution: boolean; remoteExecution: boolean; timeoutSec: number };
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.providerId).toBe("mock_stub");
    expect(body.result.mode).toBe("stub");
    expect(body.result.input.keys).toEqual(["rootKpi", "secret"]);
    expect(body.result.schema.keys).toEqual(["type", "required"]);
    expect(body.diagnostics).toEqual({
      executed: false,
      shellExecution: false,
      remoteExecution: false,
      timeoutSec: 5
    });
    expect(bodyText).not.toContain("do not echo this value");
  });

  it("does not execute disabled CLI provider stubs", async () => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/run`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        providerId: "cli_stub",
        taskType: "generate_vdt",
        input: {
          prompt: "run a command"
        },
        timeoutSec: 10
      })
    });
    const body = (await response.json()) as {
      ok: boolean;
      error: { code: string; message: string };
      diagnostics: { executed: boolean; shellExecution: boolean; remoteExecution: boolean; timeoutSec: number };
    };

    expect(response.status).toBe(501);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("PROVIDER_EXECUTION_DISABLED");
    expect(body.error.message).toContain("will not execute shell");
    expect(body.diagnostics).toEqual({
      executed: false,
      shellExecution: false,
      remoteExecution: false,
      timeoutSec: 10
    });
  });

  it("rejects invalid run request shapes", async () => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/run`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        providerId: "mock_stub",
        taskType: "dry_run",
        timeoutSec: 999
      })
    });
    const body = (await response.json()) as { ok: boolean; error: { code: string }; diagnostics: { executed: boolean } };

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("INVALID_TIMEOUT");
    expect(body.diagnostics.executed).toBe(false);
  });

  it("rejects malformed JSON without executing anything", async () => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/run`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: "{"
    });
    const body = (await response.json()) as { ok: boolean; error: { code: string }; diagnostics: { executed: boolean } };

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("INVALID_JSON");
    expect(body.diagnostics.executed).toBe(false);
  });
});

async function startServer(): Promise<TestRunnerServer> {
  const server = createLocalRunnerServer({ host: "127.0.0.1", port: 0 });
  openServers.push(server);

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected local runner test server to listen on a TCP port.");
  }

  return {
    baseUrl: `http://127.0.0.1:${(address as AddressInfo).port}`,
    server
  };
}
