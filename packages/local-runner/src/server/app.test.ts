import { Buffer } from "node:buffer";
import type { IncomingMessage } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleRun, routeLocalRunnerRequest } from "./app";

function makeRequest(
  method: string,
  url: string,
  body?: string,
  headers: Record<string, string> = {}
): IncomingMessage {
  return {
    method,
    url,
    headers: {
      host: "127.0.0.1:8765",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers
    },
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) {
        yield Buffer.from(body);
      }
    }
  } as IncomingMessage;
}

describe("local runner endpoints", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("lists available providers without opening a socket", async () => {
    const response = await routeLocalRunnerRequest(makeRequest("GET", "/providers"));
    const body = response.payload as {
      ok: boolean;
      providers: Array<{ id: string; runMode: string; safety: { executesShell: boolean; performsNetworkRequests: boolean } }>;
      presets: Array<{ id: string; providerId: string; providerConfig: { baseUrl?: string; command?: string } }>;
    };

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.providers.map((provider) => provider.id)).toEqual(["cli_stub", "local_http_stub", "mock_stub"]);
    expect(body.providers.find((provider) => provider.id === "cli_stub")?.safety.executesShell).toBe(true);
    expect(body.providers.find((provider) => provider.id === "local_http_stub")?.safety.performsNetworkRequests).toBe(true);
    expect(body.presets.map((preset) => preset.id)).toEqual([
      "ollama_openai",
      "lm_studio_openai",
      "vllm_openai",
      "custom_cli_json"
    ]);
    expect(body.presets.find((preset) => preset.id === "ollama_openai")?.providerConfig.baseUrl).toBe(
      "http://127.0.0.1:11434/v1"
    );
  });

  it("returns a safe mock run response without echoing input values", async () => {
    const response = await handleRun({
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
    });
    const bodyText = JSON.stringify(response.payload);
    const body = response.payload as {
      ok: boolean;
      providerId: string;
      result: { mode: string; input: { keys: string[] }; schema: { keys: string[] } };
      diagnostics: { executed: boolean; shellExecution: boolean; remoteExecution: boolean; timeoutSec: number };
    };

    expect(response.statusCode).toBe(200);
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

  it("does not execute CLI providers unless explicitly enabled", async () => {
    const response = await handleRun({
      providerId: "cli_stub",
      taskType: "generate_vdt",
      input: {
        prompt: "run a command"
      },
      providerConfig: {
        command: "node",
        inputMode: "stdin",
        outputMode: "stdout_json"
      },
      timeoutSec: 10
    });
    const body = response.payload as {
      ok: boolean;
      error: { code: string; message: string };
      diagnostics: { executed: boolean; shellExecution: boolean; remoteExecution: boolean; timeoutSec: number };
    };

    expect(response.statusCode).toBe(403);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("CLI_EXECUTION_DISABLED");
    expect(body.diagnostics).toEqual({
      executed: false,
      shellExecution: false,
      remoteExecution: false,
      timeoutSec: 10
    });
  });

  it("runs explicitly enabled CLI providers through JSON stdin/stdout without shell execution", async () => {
    vi.stubEnv("VDT_LOCAL_RUNNER_ENABLE_CLI", "true");
    vi.stubEnv("VDT_LOCAL_RUNNER_ALLOWED_CLI_COMMANDS", "node");

    const response = await handleRun({
      providerId: "cli_stub",
      taskType: "generate_vdt",
      input: { rootKpi: "Production Volume" },
      providerConfig: {
        command: "node",
        args: [
          "-e",
          "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(JSON.stringify({taskType:JSON.parse(d).taskType,ok:true})))"
        ],
        inputMode: "stdin",
        outputMode: "stdout_json",
        timeoutSec: 5
      },
      timeoutSec: 5
    });
    const body = response.payload as {
      ok: boolean;
      output: { ok: boolean; taskType: string };
      diagnostics: { executed: boolean; shellExecution: boolean; remoteExecution: boolean };
    };

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.output).toEqual({ ok: true, taskType: "generate_vdt" });
    expect(body.diagnostics).toMatchObject({
      executed: true,
      shellExecution: false,
      remoteExecution: false
    });
  });

  it("rejects explicitly enabled CLI providers when the command is not allowlisted", async () => {
    vi.stubEnv("VDT_LOCAL_RUNNER_ENABLE_CLI", "true");
    vi.stubEnv("VDT_LOCAL_RUNNER_ALLOWED_CLI_COMMANDS", "vdt-model-adapter");

    const response = await handleRun({
      providerId: "cli_stub",
      taskType: "generate_vdt",
      providerConfig: {
        command: "node",
        args: ["-e", "process.stdout.write('{}')"],
        inputMode: "stdin",
        outputMode: "stdout_json",
        timeoutSec: 5
      },
      timeoutSec: 5
    });
    const body = response.payload as {
      ok: boolean;
      error: { code: string };
      diagnostics: { executed: boolean; shellExecution: boolean; remoteExecution: boolean };
    };

    expect(response.statusCode).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("CLI_COMMAND_NOT_ALLOWED");
    expect(body.diagnostics).toMatchObject({
      executed: false,
      shellExecution: false,
      remoteExecution: false
    });
  });

  it("runs local HTTP providers against loopback OpenAI-compatible endpoints", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({ ok: true, projectTitle: "Generated VDT" })
                }
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      })
    );

    const response = await handleRun({
      providerId: "local_http_stub",
      taskType: "generate_vdt",
      input: { rootKpi: "Production Volume" },
      systemPrompt: "Return JSON.",
      userPrompt: "Generate a VDT.",
      providerConfig: {
        baseUrl: "http://127.0.0.1:11434/v1",
        model: "qwen3"
      },
      timeoutSec: 5
    });
    const body = response.payload as {
      ok: boolean;
      output: { ok: boolean; projectTitle: string };
      diagnostics: { executed: boolean; shellExecution: boolean; remoteExecution: boolean };
    };

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.output.projectTitle).toBe("Generated VDT");
    expect(body.diagnostics).toMatchObject({
      executed: true,
      shellExecution: false,
      remoteExecution: true
    });
  });

  it("tests local HTTP providers through OpenAI-compatible /models diagnostics", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe("http://127.0.0.1:11434/v1/models");
      return new Response(
        JSON.stringify({
          data: [{ id: "qwen3" }, { id: "llama3.2" }]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await routeLocalRunnerRequest(
      makeRequest(
        "POST",
        "/test-provider",
        JSON.stringify({
          providerId: "local_http_stub",
          providerConfig: {
            baseUrl: "http://127.0.0.1:11434/v1",
            model: "qwen3"
          },
          timeoutSec: 5
        })
      )
    );
    const body = response.payload as {
      ok: boolean;
      models: string[];
      diagnostics: { executed: boolean; shellExecution: boolean; remoteExecution: boolean };
    };

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.models).toEqual(["qwen3", "llama3.2"]);
    expect(body.diagnostics).toMatchObject({
      executed: true,
      shellExecution: false,
      remoteExecution: true
    });
  });

  it("does not test CLI providers unless explicitly enabled", async () => {
    const response = await routeLocalRunnerRequest(
      makeRequest(
        "POST",
        "/test-provider",
        JSON.stringify({
          providerId: "cli_stub",
          providerConfig: {
            command: "node",
            args: ["-e", "process.stdout.write('{}')"],
            inputMode: "stdin",
            outputMode: "stdout_json",
            timeoutSec: 5
          },
          timeoutSec: 5
        })
      )
    );
    const body = response.payload as { ok: boolean; error: { code: string }; diagnostics: { executed: boolean } };

    expect(response.statusCode).toBe(403);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("CLI_EXECUTION_DISABLED");
    expect(body.diagnostics.executed).toBe(false);
  });

  it("keeps legacy /test-provider CLI description compatibility", async () => {
    const response = await routeLocalRunnerRequest(
      makeRequest(
        "POST",
        "/test-provider",
        JSON.stringify({
          provider: {
            name: "Local CLI Stub",
            command: "echo",
            args: ["{\"ok\":true}"],
            inputMode: "stdin",
            outputMode: "stdout_json",
            timeoutSec: 30
          }
        })
      )
    );
    const body = response.payload as { ok: boolean; provider: string; command: string };

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.provider).toBe("Local CLI Stub");
    expect(body.command).toBe("echo {\"ok\":true}");
  });

  it("rejects untrusted browser origins before provider execution", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await routeLocalRunnerRequest(
      makeRequest(
        "POST",
        "/test-provider",
        JSON.stringify({
          providerId: "local_http_stub",
          providerConfig: {
            baseUrl: "http://127.0.0.1:11434/v1",
            model: "qwen3"
          }
        }),
        { origin: "https://evil.example" }
      )
    );
    const body = response.payload as { ok: boolean; error: { code: string }; diagnostics: { executed: boolean } };

    expect(response.statusCode).toBe(403);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("ORIGIN_NOT_ALLOWED");
    expect(body.diagnostics.executed).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects POST requests without application/json before provider execution", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await routeLocalRunnerRequest(
      makeRequest(
        "POST",
        "/test-provider",
        JSON.stringify({
          providerId: "local_http_stub",
          providerConfig: {
            baseUrl: "http://127.0.0.1:11434/v1",
            model: "qwen3"
          }
        }),
        { "content-type": "text/plain" }
      )
    );
    const body = response.payload as { ok: boolean; error: { code: string }; diagnostics: { executed: boolean } };

    expect(response.statusCode).toBe(415);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
    expect(body.diagnostics.executed).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects remote local HTTP URLs unless explicitly allowed", async () => {
    const response = await handleRun({
      providerId: "local_http_stub",
      taskType: "generate_vdt",
      providerConfig: {
        baseUrl: "https://example.com/v1",
        model: "remote"
      }
    });
    const body = response.payload as { ok: boolean; error: { code: string } };

    expect(response.statusCode).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("REMOTE_HTTP_DISABLED");
  });

  it("rejects invalid run request shapes", async () => {
    const response = await handleRun({
      providerId: "mock_stub",
      taskType: "dry_run",
      timeoutSec: 999
    });
    const body = response.payload as { ok: boolean; error: { code: string }; diagnostics: { executed: boolean } };

    expect(response.statusCode).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("INVALID_TIMEOUT");
    expect(body.diagnostics.executed).toBe(false);
  });

  it("rejects malformed JSON before route execution", async () => {
    await expect(routeLocalRunnerRequest(makeRequest("POST", "/run", "{"))).rejects.toThrow(
      "Request body must be valid JSON."
    );
  });
});
