# Local Runner

The local runner is a localhost service intended for privacy-sensitive model execution and CLI adapters.

MVP endpoints:

- `GET /health`
- `POST /test-provider`
- `GET /providers`
- `POST /run`

`GET /providers` returns the registered adapters:

- `cli_stub`: guarded CLI provider. It only executes when `VDT_LOCAL_RUNNER_ENABLE_CLI=true`, uses `command + args` with `shell: false`, sends JSON via stdin and expects JSON on stdout.
- `local_http_stub`: OpenAI-compatible local HTTP provider for Ollama, LM Studio, vLLM and similar local model servers.
- `mock_stub`: safe deterministic mock provider for dry-run integration tests. It accepts any non-empty `taskType` as mock metadata, without running the requested task.

It also returns UI-ready presets:

- `ollama_openai`: `http://127.0.0.1:11434/v1`
- `lm_studio_openai`: `http://127.0.0.1:1234/v1`
- `vllm_openai`: `http://127.0.0.1:8000/v1`
- `custom_cli_json`: a guarded JSON stdin/stdout CLI adapter template.

`POST /test-provider` accepts the same adapter configuration shape as `/run`, but performs a short connection diagnostic:

```json
{
  "providerId": "local_http_stub",
  "providerConfig": {
    "baseUrl": "http://127.0.0.1:11434/v1",
    "model": "qwen3"
  },
  "timeoutSec": 10
}
```

For local HTTP adapters it calls `/models` on the OpenAI-compatible endpoint and returns discovered model IDs when available. For CLI adapters it runs a `connection_test` probe only when `VDT_LOCAL_RUNNER_ENABLE_CLI=true` and the command is listed in `VDT_LOCAL_RUNNER_ALLOWED_CLI_COMMANDS`.

`POST /run` accepts:

```json
{
  "providerId": "mock_stub",
  "taskType": "dry_run",
  "input": {},
  "schema": {},
  "timeoutSec": 30
}
```

The runner now supports real local HTTP calls and guarded CLI execution. The safe mock provider still returns only summarized request metadata and does not echo input content.

Local HTTP run example:

```json
{
  "providerId": "local_http_stub",
  "taskType": "generate_vdt",
  "input": { "rootKpi": "Production Volume" },
  "systemPrompt": "Return valid JSON only.",
  "userPrompt": "Generate a Value Driver Tree.",
  "providerConfig": {
    "baseUrl": "http://127.0.0.1:11434/v1",
    "model": "qwen3"
  },
  "timeoutSec": 60
}
```

CLI run example:

```bash
VDT_LOCAL_RUNNER_ENABLE_CLI=true \
VDT_LOCAL_RUNNER_ALLOWED_CLI_COMMANDS=qwen \
pnpm local-runner:start
```

```json
{
  "providerId": "cli_stub",
  "taskType": "generate_vdt",
  "input": { "rootKpi": "Production Volume" },
  "providerConfig": {
    "name": "Local Qwen CLI",
    "command": "qwen",
    "args": ["--model", "qwen3-vdt"],
    "inputMode": "stdin",
    "outputMode": "stdout_json",
    "timeoutSec": 120
  }
}
```

Security notes:

- The local runner binds to `127.0.0.1` by default.
- The local runner rejects non-local/non-private `Host` headers.
- Browser requests with an `Origin` header must come from the runner origin, `localhost:3000`, `localhost:3001`, or origins listed in `VDT_LOCAL_RUNNER_ALLOWED_ORIGINS`.
- POST requests must use `application/json`.
- Local HTTP adapters only allow localhost/private model servers unless `VDT_LOCAL_RUNNER_ALLOW_REMOTE_HTTP=true`.
- CLI execution is off unless `VDT_LOCAL_RUNNER_ENABLE_CLI=true`.
- CLI execution also requires the binary name to be listed in `VDT_LOCAL_RUNNER_ALLOWED_CLI_COMMANDS`.
- Only allowlist dedicated adapter binaries. Do not allowlist general-purpose interpreters such as `node`, `python` or shell tools for production use.
- CLI execution never uses a shell. Commands must be binary names on `PATH`, not paths or shell expressions.
- Provider responses are capped at 1 MB.
